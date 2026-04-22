/**
 * Spec 8.2 — Stufe 2: NER (z. B. spaCy `de_core_news_lg`) über optionales HTTP-Mikroservice-API,
 * alternativ kompakter LLM-JSON-Extrakt wenn `PSEUDONYM_LLM_NER=1`.
 *
 * HTTP-Vertrag (empfohlen für spaCy-Dienst):
 *   POST PSEUDONYM_NER_URL
 *   Header: Authorization: Bearer <PSEUDONYM_NER_TOKEN> (optional)
 *   Body: { "text": string }
 *   Response: { "entities": [ { "text": string, "label": "PER"|"LOC"|"ORG"|... } ] }
 */
import { extractJson } from "../pipeline/extract-json.ts";
import { resolveModel } from "../model-resolver.ts";
import type { PseudonymRawMatch } from "../../../../src/lib/architecture/pseudonymize-stage1.ts";
import type { PseudonymType } from "../../../../src/lib/architecture/spec06-types.ts";

const MAX_NER_CHARS = 12_000;
const NER_LLM_TIMEOUT_MS = 60_000;

function labelToPseudonymType(label: string): PseudonymType | null {
  const u = String(label).toUpperCase();
  if (u === "PER" || u === "PERSON" || u === "PATIENT") return "person";
  if (u === "LOC" || u === "GPE" || u === "LOCATION") return "address";
  if (u === "ORG" || u === "ORGANIZATION") return "person";
  return null;
}

/** Alle Vorkommen von `needle` in `haystack`, nicht überlappend von links nach rechts. */
function occurrences(haystack: string, needle: string): { start: number; end: number }[] {
  if (!needle.trim()) return [];
  const out: { start: number; end: number }[] = [];
  let from = 0;
  while (from < haystack.length) {
    const i = haystack.indexOf(needle, from);
    if (i < 0) break;
    out.push({ start: i, end: i + needle.length });
    from = i + needle.length;
  }
  return out;
}

function spanLooksInsidePlaceholder(working: string, start: number, end: number): boolean {
  const chunk = working.slice(start, end);
  return chunk.includes("[[DOCBILL_PII:") || chunk.includes("]]");
}

function mergeOccurrencesToMatches(
  working: string,
  spans: { start: number; end: number; type: PseudonymType }[],
): PseudonymRawMatch[] {
  const sorted = [...spans].sort(
    (a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start,
  );
  const out: PseudonymRawMatch[] = [];
  for (const s of sorted) {
    if (spanLooksInsidePlaceholder(working, s.start, s.end)) continue;
    const overlaps = out.some((o) => !(s.end <= o.start || s.start >= o.end));
    if (!overlaps) {
      out.push({
        start: s.start,
        end: s.end,
        original: working.slice(s.start, s.end),
        type: s.type,
        source: "ner",
      });
    }
  }
  return out;
}

async function collectNerViaHttp(maskedText: string, working: string): Promise<PseudonymRawMatch[]> {
  const base = Deno.env.get("PSEUDONYM_NER_URL")?.trim();
  if (!base) return [];

  const token = Deno.env.get("PSEUDONYM_NER_TOKEN")?.trim();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(base, {
    method: "POST",
    headers,
    body: JSON.stringify({ text: maskedText.slice(0, MAX_NER_CHARS) }),
  });
  if (!res.ok) {
    console.warn(JSON.stringify({ level: "warn", msg: "pseudonym_ner_http", status: res.status }));
    return [];
  }
  const data = (await res.json()) as { entities?: { text?: string; label?: string }[] };
  if (!Array.isArray(data.entities)) return [];

  const spans: { start: number; end: number; type: PseudonymType }[] = [];
  const seen = new Set<string>();
  for (const e of data.entities) {
    const t = typeof e.text === "string" ? e.text.trim() : "";
    const typ = e.label ? labelToPseudonymType(e.label) : null;
    if (!t || !typ) continue;
    const key = `${typ}:${t}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const o of occurrences(working, t)) {
      spans.push({ start: o.start, end: o.end, type: typ });
    }
  }
  return mergeOccurrencesToMatches(working, spans);
}

async function collectNerViaLlm(working: string, apiKey: string, userModel: string): Promise<PseudonymRawMatch[]> {
  const truncated = working.length > MAX_NER_CHARS ? `${working.slice(0, MAX_NER_CHARS)}\n\n[…]` : working;
  const modelRaw =
    Deno.env.get("PSEUDONYM_LLM_NER_MODEL")?.trim() || userModel || "openai/gpt-4o-mini";
  const model = resolveModel(modelRaw);
  const systemPrompt = `Du extrahierst aus deutschem medizinischen Fließtext nur Eigennamen mit personen-/standort-/organisationsbezogenen Daten.
Antworte NUR als JSON: { "entities": [ { "text": "exakter Substring aus dem Eingabetext", "label": "PER" | "LOC" | "ORG" } ] }
PER = Personen, LOC = Orte, ORG = Organisationen/Praxen/Kassen. Keine reinen Krankheitsnamen ohne Eigennamen. Leeres Array wenn nichts.`;
  let raw = "";
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), NER_LLM_TIMEOUT_MS);
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: [{ type: "text", text: truncated }] },
        ],
        stream: false,
        temperature: 0,
        max_tokens: 2048,
        response_format: { type: "json_object" },
        plugins: [{ id: "response-healing" }],
      }),
      signal: ac.signal,
    });
    clearTimeout(t);
    if (!res.ok) return [];
    const data = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content === "string") raw = content;
    else if (Array.isArray(content)) {
      const parts = content
        .filter((p: { type?: string }) => p?.type === "text")
        .map((p: { text?: string }) => p.text ?? "");
      raw = parts.join("\n");
    } else raw = "";
  } catch {
    return [];
  }
  let parsed: { entities?: { text?: string; label?: string }[] };
  try {
    parsed = extractJson<{ entities?: { text?: string; label?: string }[] }>(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed.entities)) return [];

  const spans: { start: number; end: number; type: PseudonymType }[] = [];
  const seen = new Set<string>();
  for (const e of parsed.entities) {
    const t = typeof e.text === "string" ? e.text.trim() : "";
    const typ = e.label ? labelToPseudonymType(e.label) : null;
    if (!t || t.length < 2 || !typ) continue;
    const key = `${typ}:${t}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const o of occurrences(working, t)) {
      spans.push({ start: o.start, end: o.end, type: typ });
    }
  }
  return mergeOccurrencesToMatches(working, spans);
}

export async function collectStage2NerMatches(
  working: string,
  maskedForNer: string,
  ctx: { apiKey?: string; model?: string },
): Promise<PseudonymRawMatch[]> {
  const httpMs = await collectNerViaHttp(maskedForNer, working);
  if (httpMs.length > 0) return httpMs;

  const llmOn = Deno.env.get("PSEUDONYM_LLM_NER") === "1" || Deno.env.get("PSEUDONYM_LLM_NER") === "true";
  if (llmOn && ctx.apiKey?.trim()) {
    return collectNerViaLlm(working, ctx.apiKey, ctx.model ?? "openai/gpt-4o-mini");
  }
  return [];
}

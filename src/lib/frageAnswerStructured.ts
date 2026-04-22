import { filterExplicitQuellenEntries } from "@/lib/quellenMetaFilter";

export type KurzantwortVorschlag = { id: string; text: string };

/**
 * Strukturierte KI-Antwort (Frage-/Kurzantworten-JSON): ein Textblock.
 * Persistiert in structured_content; optional interaktive Folge-Prompts.
 */
export type FrageAnswerStructured = {
  kurzantwort: string;
  vorschlaege?: KurzantwortVorschlag[];
};

/**
 * Entfernt veraltete Listen-Labels „Korrekt:“ / „Zusatz:“ (mit/ohne **, mit/ohne „- „).
 * Logik muss mit supabase/functions/goae-chat/frage-answer-format.ts übereinstimmen.
 */
export function stripFrageListKorrektZusatzLabels(block: string): string {
  const lines = block.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    let s = line.replace(
      /^(\s*)((?:(?:[-*+])|\d+\.)\s+)?(?:\*\*)?(Korrekt|Zusatz)(?:\*\*\s*:|:\*\*|\s*:)/i,
      "$1$2",
    );
    const normList = /^(\s*)([-*+])\s+(.*)$/.exec(s);
    if (normList) {
      s = `${normList[1]}${normList[2]} ${normList[3].trimStart()}`;
    } else if (s.trim()) {
      s = s.trimStart();
    }
    if (!s.trim()) {
      out.push(s);
      continue;
    }
    if (!/^\s*(?:[-*+]|\d+\.)\s/.test(s)) {
      const m = /^(\s*)(.*)$/.exec(s);
      if (m) {
        out.push(`${m[1]}- ${m[2]}`);
        continue;
      }
    }
    out.push(s);
  }
  return out.join("\n");
}

function normalizeVorschlaegeParsed(raw: unknown): KurzantwortVorschlag[] {
  if (!Array.isArray(raw)) return [];
  const out: KurzantwortVorschlag[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (typeof item === "string") {
      const t = item.trim();
      if (t) out.push({ id: `s${i}`, text: t });
      continue;
    }
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const o = item as Record<string, unknown>;
      const tid = typeof o.id === "string" ? o.id.trim() : "";
      const ttext = typeof o.text === "string" ? o.text.trim() : "";
      if (ttext) out.push({ id: tid || `s${i}`, text: ttext });
    }
  }
  return out.slice(0, 5);
}

export function normalizeFrageAnswerParsed(raw: Record<string, unknown>): FrageAnswerStructured | null {
  const kurzRaw = raw.kurzantwort;
  const kurzStr = typeof kurzRaw === "string" ? kurzRaw.trim() : "";

  const erlRaw = raw.erlaeuterung;
  const erlStr =
    typeof erlRaw === "string" ? stripFrageListKorrektZusatzLabels(erlRaw.trim()) : "";

  const grenzRaw = raw.grenzfaelle_hinweise;
  const grenzStr =
    typeof grenzRaw === "string" ? stripFrageListKorrektZusatzLabels(grenzRaw.trim()) : "";

  const quellenRaw = raw.quellen;
  const quellenArr: unknown[] =
    typeof quellenRaw === "string"
      ? [quellenRaw]
      : Array.isArray(quellenRaw)
        ? quellenRaw
        : [];
  const quellenStr = filterExplicitQuellenEntries(
    quellenArr.filter((x): x is string => typeof x === "string"),
  );

  const vorschlaege = normalizeVorschlaegeParsed(raw.vorschlaege);

  const blocks: string[] = [];
  if (kurzStr) blocks.push(kurzStr);
  if (erlStr) blocks.push(erlStr);
  if (grenzStr) blocks.push(grenzStr);
  let merged = blocks.join("\n\n");
  if (quellenStr.length > 0) {
    merged += `${merged ? "\n\n" : ""}*Quellen:* ${quellenStr.join(" · ")}`;
  }
  merged = stripFrageListKorrektZusatzLabels(merged.trim());

  if (!merged.trim()) return null;

  const base: FrageAnswerStructured = { kurzantwort: merged };
  if (vorschlaege.length > 0) base.vorschlaege = vorschlaege;
  return base;
}

/** Heuristik: Antwort nennt konkrete Abrechnungsinhalte → Export-Follow-ups anbieten. */
export function frageAnswerSuggestsExportFinalize(a: FrageAnswerStructured): boolean {
  const blob = a.kurzantwort ?? "";
  return (
    /GOÄ|GOAe|GOAE/i.test(blob) ||
    /\b(Ziffer|Abrechnung|Position|Honorar|Steigerung|Analog)\b/i.test(blob) ||
    /\b\d{3,5}[a-z]?\b/i.test(blob)
  );
}

export function frageAnswerToMarkdown(a: FrageAnswerStructured): string {
  let out = a.kurzantwort.trim();
  if (a.vorschlaege?.length) {
    out += `\n\n### Vorschläge zur Vertiefung\n\n`;
    out += a.vorschlaege.map((v) => `- ${v.text}`).join("\n");
  }
  return out;
}

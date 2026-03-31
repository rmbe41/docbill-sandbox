/**
 * Batch-LLM: schriftliche Steigerungsbegründungen (Faktor oberhalb GOÄ-Schwellenwert).
 * Grundlage: § 5 Abs. 2 / § 12 Abs. 3 GOÄ – Schwierigkeit, Zeitaufwand, Umstände.
 */

import { callLlm, extractJson, pickExtractionModel } from "./llm-client.ts";
import { GOAE_PARAGRAPHEN_KOMPAKT } from "../goae-paragraphen.ts";
import { GOAE_BEGRUENDUNGEN } from "../goae-regeln.ts";
import type { MedizinischeAnalyse } from "./types.ts";

const BATCH_MAX = 12;
const BEG_MIN_LEN = 120;
const BEG_MAX_LEN = 520;

export interface SteigerungBegruendungItem {
  /** Stabiler Schlüssel wie im Frontend: (opt-)?ziffer|leistung */
  id: string;
  ziffer: string;
  bezeichnung: string;
  faktor: number;
  schwellenfaktor: number;
  hoechstfaktor: number;
  leistung: string;
  quelleBeschreibung?: string;
}

function withAdminContext(base: string, adminContext?: string): string {
  const a = adminContext?.trim();
  if (!a) return base;
  return `${base}\n\n## ADMIN-KONTEXT (Praxis):\n${a}`;
}

function buildSystemPrompt(kontextWissenEnabled = true): string {
  const rechtsRahmenBlock = kontextWissenEnabled
    ? `RECHTSRAHMEN (inhaltlich, im Fließtext keine Paragraphenzeichen „§“ verwenden – stattdessen „nach GOÄ“, „gemäß GOÄ zur Bemessung der Gebühren“, „schriftliche Begründung auf der Rechnung nach GOÄ“):

${GOAE_PARAGRAPHEN_KOMPAKT}

LEITFADEN BEGRÜNDUNGEN:

${GOAE_BEGRUENDUNGEN}`
    : `Es steht **kein** eingebetteter GOÄ-Paragraphen- oder Begründungsleitfaden zur Verfügung. Formuliere sachliche Steigerungsbegründungen aus dem **klinischen Kontext** und der **Leistungsbeschreibung**; vermeide wörtliche Paragraphenzitate; nutze Formulierungen wie „nach GOÄ üblich“ nur wenn sachlich angemessen.`;

  return `Du bist Fachanwalt für GOÄ-Abrechnung und Vertragsarztrecht. Du formulierst **schriftliche Steigerungsbegründungen** für Positionen, deren **Steigerungsfaktor über dem GOÄ-Schwellenwert** liegt.

${rechtsRahmenBlock}

AUFGABE:
- Du erhältst eine JSON-Liste von Positionen mit Faktor, Schwellenwert, Höchstfaktor, Leistungstext und klinischem Kontext.
- Für **jede** Position: eine **verständliche, nachvollziehbare** Begründung (Ziel: Prüfer und Zahlungspflichtige), die sich auf **Schwierigkeit**, **Zeitaufwand** und/oder **besondere Umstände bei der Ausführung** bezieht – mindestens **ein** konkreter Bezug zum gelieferten Kontext (Diagnose, Verlauf, Leistungsbeschreibung, Quelle).
- Keine **bloßen Floskeln** („erhöhter Aufwand“, „besonders zeitaufwändig“) ohne **konkrete** Ausgestaltung.
- Keine erfundenen Minutenangaben oder Befunde: nur Zeit/Dauer, wenn der Nutzer- oder Dokumentkontext das plausibel hergibt; sonst allgemeiner aber **sachlich** begründen („eingehende Abstimmung/Anleitung …“, „erschwerte Bedingungen …“) angelehnt an die genannten Umstände.
- **Sprache:** Deutsch, Sie-Form oder neutral sachlich, **ohne** das Zeichen „§“ im Text.
- Länge pro **begruendung:** ca. ${BEG_MIN_LEN}–${BEG_MAX_LEN} Zeichen (nicht kürzer als ${BEG_MIN_LEN}).

ANTWORTFORMAT (nur gültiges JSON, kein Markdown):
{
  "items": [
    { "id": "<exakt wie in der Eingabe>", "begruendung": "<Text ohne führendes Label \\\"Begründung:\\\">" }
  ]
}

Die **id** in jedem item muss **exakt** einer Eingabe-**id** entsprechen. **items** muss **alle** Eingabe-Positionen in derselben Reihenfolge abdecken.`;
}

function buildUserPayload(
  items: SteigerungBegruendungItem[],
  analyse: MedizinischeAnalyse,
): string {
  const diag = analyse.diagnosen.map((d) => d.text).join("; ") || "(keine)";
  const ctx = (analyse.klinischerKontext || "").trim().slice(0, 2800);
  const fg = analyse.fachgebiet || "(nicht angegeben)";

  const lines: string[] = [
    "## Zu begründende Positionen\n",
    JSON.stringify(
      items.map((it) => ({
        id: it.id,
        ziffer: it.ziffer,
        bezeichnung: it.bezeichnung,
        faktor: it.faktor,
        schwellenwert_faktor: it.schwellenfaktor,
        hoechstfaktor: it.hoechstfaktor,
        leistung: it.leistung,
        ...(it.quelleBeschreibung
          ? { dokumentbezug: it.quelleBeschreibung.slice(0, 800) }
          : {}),
      })),
      null,
      0,
    ),
    `\n## Fachgebiet: ${fg}`,
    `\n## Diagnosen: ${diag}`,
    `\n## Klinischer Kontext (Auszug):\n${ctx || "(leer)"}`,
  ];
  return lines.join("\n");
}

type LlmItems = { items?: { id?: string; begruendung?: string }[] };

function normalizeBegruendung(s: string): string {
  let t = s
    .trim()
    .replace(/^begründung\s*:\s*/i, "")
    .replace(/^begründung\s+/i, "")
    .trim();
  t = t.replace(/§\s*\d+/g, "nach GOÄ");
  return t.trim();
}

/**
 * Liefert Map id → Begründungstext. Bei Fehler/teilweiser Antwort: nur gültige Einträge.
 */
export async function enrichSteigerungsBegruendungenBatch(
  items: SteigerungBegruendungItem[],
  analyse: MedizinischeAnalyse,
  apiKey: string,
  userModel: string,
  adminContext?: string,
  kontextWissenEnabled = true,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (items.length === 0) return out;

  const model = pickExtractionModel(userModel);
  const systemPrompt = withAdminContext(
    buildSystemPrompt(kontextWissenEnabled),
    kontextWissenEnabled ? adminContext : undefined,
  );

  for (let offset = 0; offset < items.length; offset += BATCH_MAX) {
    const chunk = items.slice(offset, offset + BATCH_MAX);
    let raw = "";
    try {
      raw = await callLlm({
        apiKey,
        model,
        systemPrompt,
        userContent: [{ type: "text", text: buildUserPayload(chunk, analyse) }],
        jsonMode: true,
        temperature: 0.15,
        maxTokens: 8192,
      });
    } catch {
      continue;
    }

    let parsed: LlmItems;
    try {
      parsed = extractJson<LlmItems>(raw);
    } catch {
      continue;
    }

    const list = parsed.items;
    if (!Array.isArray(list)) continue;

    for (const row of list) {
      const id = typeof row.id === "string" ? row.id.trim() : "";
      const b = typeof row.begruendung === "string" ? normalizeBegruendung(row.begruendung) : "";
      if (!id || b.length < BEG_MIN_LEN) continue;
      out.set(id, b.length > BEG_MAX_LEN + 80 ? b.slice(0, BEG_MAX_LEN).trim() + "…" : b);
    }
  }

  return out;
}

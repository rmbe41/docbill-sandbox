/**
 * Step 2 – Medizinisches NLP
 *
 * Analysiert den medizinischen Textinhalt aus dem geparsten Dokument.
 * Erkennt Diagnosen, Behandlungen und den klinischen Kontext.
 *
 *   ParsedRechnung → LLM → MedizinischeAnalyse (JSON)
 */

import { callLlm, extractJson, pickExtractionModel } from "./llm-client.ts";
import type { ParsedRechnung, MedizinischeAnalyse } from "./types.ts";

const NLP_SYSTEM_PROMPT = `Du bist ein medizinisches NLP-System zur Analyse von Arztrechnungen.

AUFGABE: Analysiere die extrahierten Rechnungsdaten und identifiziere:
1. Alle Diagnosen mit ICD-Codes (sofern ableitbar) und Sicherheitsgrad
2. Alle durchgeführten Behandlungen/Untersuchungen
3. Den klinischen Gesamtkontext
4. Das medizinische Fachgebiet

Antworte AUSSCHLIESSLICH mit einem JSON-Objekt:

{
  "diagnosen": [
    {
      "text": "Altersbezogene Makuladegeneration (AMD), feucht",
      "icdCode": "H35.3",
      "sicherheit": "gesichert"
    }
  ],
  "behandlungen": [
    {
      "text": "OCT-Untersuchung der Makula",
      "typ": "diagnostik"
    },
    {
      "text": "Intravitreale Injektion (IVOM) mit Anti-VEGF",
      "typ": "therapie"
    },
    {
      "text": "Bevacizumab/Avastin Fertigspritze",
      "typ": "sachkosten"
    },
    {
      "text": "Steriles OP Set",
      "typ": "sachkosten"
    }
  ],
  "klinischerKontext": "Patient mit feuchter AMD unter Anti-VEGF-Therapie, Kontrolluntersuchung mit OCT und ggf. Re-Injektion.",
  "fachgebiet": "Augenheilkunde"
}

REGELN:
- "sicherheit": "gesichert" | "verdacht" | "ausschluss"
- "typ": "untersuchung" | "therapie" | "beratung" | "operation" | "diagnostik" | "sachkosten"
- "sachkosten": Nutze typ "sachkosten" für Materialien/Medikamente die separat abrechenbar sind, z.B.:
  - Steriles OP Set, OP-Set, Einmalset
  - Bevacizumab, Avastin, Aflibercept, Eylea, Lucentis (Fertigspritze/Injektion)
  - Anti-VEGF-Medikament, intravitreales Medikament (als Sachkosten)
  - Ähnliche Material- oder Medikamentenkosten
- Leite den klinischen Kontext aus den Diagnosen UND den abgerechneten Leistungen ab
- Erkenne implizite Behandlungen (z.B. GOÄ 1240 = Spaltlampenuntersuchung)
- Benenne das Fachgebiet basierend auf den verwendeten GOÄ-Ziffern`;

function withAdminContextPrompt(base: string, adminContext?: string): string {
  const a = adminContext?.trim();
  if (!a) return base;
  return `${base}\n\n## ADMIN-KONTEXT (Praxis-/Klinik-Wissen):\n${a}`;
}

export async function analysiereMedizinisch(
  rechnung: ParsedRechnung,
  apiKey: string,
  userModel: string,
  adminContext?: string,
): Promise<MedizinischeAnalyse> {
  const model = pickExtractionModel(userModel);

  const zusammenfassung = buildRechnungsSummary(rechnung);

  const raw = await callLlm({
    apiKey,
    model,
    systemPrompt: withAdminContextPrompt(NLP_SYSTEM_PROMPT, adminContext),
    userContent: [{ type: "text", text: zusammenfassung }],
    jsonMode: true,
    temperature: 0.1,
    maxTokens: 4096,
  });

  const analyse = extractJson<MedizinischeAnalyse>(raw);

  if (!analyse.diagnosen) analyse.diagnosen = [];
  if (!analyse.behandlungen) analyse.behandlungen = [];
  if (!analyse.klinischerKontext) analyse.klinischerKontext = "";
  if (!analyse.fachgebiet) analyse.fachgebiet = "Allgemeinmedizin";

  return analyse;
}

function buildRechnungsSummary(r: ParsedRechnung): string {
  const lines = ["## Extrahierte Rechnungsdaten\n"];

  if (r.datum) lines.push(`Datum: ${r.datum}`);

  if (r.diagnosen.length > 0) {
    lines.push("\n### Diagnosen aus der Rechnung:");
    for (const d of r.diagnosen) lines.push(`- ${d}`);
  }

  if (r.positionen.length > 0) {
    lines.push("\n### Abrechnungspositionen:");
    lines.push("| Nr | GOÄ | Bezeichnung | Faktor | Betrag |");
    lines.push("|-----|------|-------------|--------|--------|");
    for (const p of r.positionen) {
      lines.push(
        `| ${p.nr} | ${p.ziffer} | ${p.bezeichnung} | ${p.faktor}× | ${p.betrag.toFixed(2)}€ |`,
      );
    }
  }

  if (r.freitext) {
    lines.push(`\n### Freitext / Befund:\n${r.freitext}`);
  }

  if (r.rawText && r.rawText.length > 0) {
    const excerpt =
      r.rawText.length > 2000
        ? r.rawText.slice(0, 2000) + "\n[...]"
        : r.rawText;
    lines.push(`\n### Volltext:\n${excerpt}`);
  }

  return lines.join("\n");
}

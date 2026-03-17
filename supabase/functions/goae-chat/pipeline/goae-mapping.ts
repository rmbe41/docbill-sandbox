/**
 * Step 4 – GOÄ Mapping
 *
 * Ordnet jede erkannte Leistung einer passenden GOÄ-Ziffer zu.
 * Kombiniert deterministischen Katalog-Lookup mit einem LLM-Aufruf
 * für nicht zuordenbare Leistungen und Analogziffern.
 *
 *   ExtrahierteLeistung[] + GOÄ-Katalog → GoaeMappingResult
 */

import { callLlm, extractJson, pickExtractionModel } from "./llm-client.ts";
import { GOAE_KATALOG } from "../goae-catalog.ts";
import type {
  ParsedRechnung,
  ExtrahierteLeistung,
  MedizinischeAnalyse,
  GoaeMappingResult,
  GoaeZuordnung,
} from "./types.ts";

export async function mappeGoae(
  rechnung: ParsedRechnung,
  leistungen: ExtrahierteLeistung[],
  analyse: MedizinischeAnalyse,
  apiKey: string,
  userModel: string,
): Promise<GoaeMappingResult> {
  const zuordnungen: GoaeZuordnung[] = [];
  const nichtZugeordnet: ExtrahierteLeistung[] = [];

  for (const leistung of leistungen) {
    if (leistung.quellePositionNr != null) {
      const pos = rechnung.positionen.find(
        (p) => p.nr === leistung.quellePositionNr,
      );
      if (pos) {
        zuordnungen.push({
          leistung: leistung.bezeichnung,
          ziffer: pos.ziffer,
          bezeichnung: pos.bezeichnung,
          istAnalog: isAnalogZiffer(pos.ziffer),
          konfidenz: "hoch",
        });
        continue;
      }
    }
    nichtZugeordnet.push(leistung);
  }

  if (nichtZugeordnet.length > 0) {
    const llmMappings = await suggestMappingsViaLlm(
      nichtZugeordnet,
      analyse,
      apiKey,
      userModel,
    );
    zuordnungen.push(...llmMappings.zuordnungen);
    return {
      zuordnungen,
      fehlendeMappings: llmMappings.fehlendeMappings,
    };
  }

  return { zuordnungen, fehlendeMappings: [] };
}

function isAnalogZiffer(ziffer: string): boolean {
  return (
    ziffer.toLowerCase().startsWith("a") ||
    ziffer.toLowerCase().includes("analog")
  );
}

const MAPPING_PROMPT = `Du bist ein GOÄ-Abrechnungsexperte.

AUFGABE: Ordne die folgenden medizinischen Leistungen der passenden GOÄ-Ziffer zu.
Nutze den beigefügten GOÄ-Katalog als Referenz.

Antworte AUSSCHLIESSLICH mit JSON:

{
  "zuordnungen": [
    {
      "leistung": "OCT-Untersuchung der Makula",
      "ziffer": "1249",
      "bezeichnung": "Fluoreszenzangiographie (analog: SD-OCT)",
      "istAnalog": true,
      "analogBegruendung": "SD-OCT analog Nr. 1249 – optische Kohärenztomographie des Augenhintergrundes gemäß § 6 Abs. 2 GOÄ",
      "konfidenz": "hoch",
      "alternativZiffern": ["A7011"]
    }
  ],
  "fehlendeMappings": ["Leistungen die nicht zuordenbar sind"]
}

REGELN:
- Nutze Analogbewertung nach § 6 GOÄ, wenn keine direkte Ziffer existiert
- "konfidenz": "hoch" bei eindeutiger Zuordnung, "mittel" bei plausibel, "niedrig" bei unsicher
- Gib bei Analogziffern IMMER eine analogBegruendung an (fachlich präzise, max. ~140 Zeichen für UI)
- Bevorzuge gelistete Ziffern vor Analogbewertungen`;

async function suggestMappingsViaLlm(
  leistungen: ExtrahierteLeistung[],
  analyse: MedizinischeAnalyse,
  apiKey: string,
  userModel: string,
): Promise<GoaeMappingResult> {
  const model = pickExtractionModel(userModel);

  const prompt = [
    "## Nicht zugeordnete Leistungen:\n",
    ...leistungen.map((l, i) => `${i + 1}. ${l.bezeichnung}: ${l.beschreibung}`),
    `\n## Klinischer Kontext: ${analyse.klinischerKontext}`,
    `\n## Fachgebiet: ${analyse.fachgebiet}`,
    `\n## GOÄ-Katalog (Auszug):\n${GOAE_KATALOG}`,
  ].join("\n");

  const raw = await callLlm({
    apiKey,
    model,
    systemPrompt: MAPPING_PROMPT,
    userContent: [{ type: "text", text: prompt }],
    jsonMode: true,
    temperature: 0.1,
    maxTokens: 4096,
  });

  try {
    return extractJson<GoaeMappingResult>(raw);
  } catch {
    return { zuordnungen: [], fehlendeMappings: leistungen.map((l) => l.bezeichnung) };
  }
}

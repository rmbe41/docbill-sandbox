/**
 * EBM-Mapping: Leistungstexte → GOP (5-stellig), analog goae-mapping.
 */

import { callLlm, extractJson, pickExtractionModel } from "./llm-client.ts";
import {
  buildSelectiveEbmCatalogMarkdown,
  buildFallbackEbmCatalogMarkdown,
  ebmByGop,
} from "../ebm-catalog-json.ts";
import type {
  ParsedRechnung,
  ExtrahierteLeistung,
  MedizinischeAnalyse,
  GoaeMappingResult,
  GoaeZuordnung,
} from "./types.ts";

function gopSetFromTexts(texts: string[]): Set<string> {
  const out = new Set<string>();
  const r = /\b(\d{5})\b/g;
  for (const t of texts) {
    if (!t) continue;
    let m: RegExpExecArray | null;
    const rr = new RegExp(r);
    while ((m = rr.exec(t)) !== null) {
      if (m[1] !== "00000" && ebmByGop.has(m[1])) out.add(m[1]);
    }
  }
  return out;
}

function buildEbmMappingCatalogMarkdown(args: { leistungTexts: string[]; maxLines: number }): string {
  const gops = gopSetFromTexts(args.leistungTexts);
  if (gops.size === 0) {
    return buildFallbackEbmCatalogMarkdown(Math.min(args.maxLines, 120));
  }
  return buildSelectiveEbmCatalogMarkdown({
    gops,
    maxLines: args.maxLines,
    subtitle: "## EBM-Katalog (Auszug für Zuordnung)",
    priorityGops: gops,
  });
}

const EBM_MAPPING_PROMPT = `Du bist ein GKV-Abrechnungsexperte (EBM der KBV).

AUFGABE: Ordne die folgenden medizinischen Leistungen passenden **Gebührenordnungspositionen (GOP, fünf Stellen)** zu.
Nutze ausschließlich GOPs, die im mitgelieferten EBM-Katalogauszug vorkommen. Erfinke keine GOP-Nummern.

Antworte AUSSCHLIESSLICH mit JSON:

{
  "zuordnungen": [
    {
      "leistung": "kurze Beschreibung der Leistung",
      "ziffer": "01100",
      "bezeichnung": "Kurztext aus Katalog",
      "istAnalog": false,
      "analogBegruendung": null,
      "konfidenz": "hoch",
      "alternativZiffern": []
    }
  ],
  "fehlendeMappings": ["Leistungen, die sich nicht sinnvoll zuorden lassen"]
}

REGELN:
- "ziffer": exakt 5 Ziffern (GOP)
- "istAnalog": für EBM in der Regel false; nur true, wenn explizit eine Ersatz-/Verweisabrechnung sachlich nötig und klar benannt
- "konfidenz": "hoch" | "mittel" | "niedrig"
- "alternativZiffern": 0–3 weitere GOPs aus dem Auszug, falls plausibel
- Ohne Katalogstützung: Leistung in "fehlendeMappings" listen, statt Nummern zu erfinden`;

function withAdminContextPrompt(base: string, adminContext?: string): string {
  const a = adminContext?.trim();
  if (!a) return base;
  return `${base}\n\n## ADMIN-KONTEXT (Praxis-/Klinik-Wissen):\n${a}`;
}

async function suggestEbmMappingsViaLlm(
  leistungen: ExtrahierteLeistung[],
  analyse: MedizinischeAnalyse,
  apiKey: string,
  userModel: string,
  adminContext?: string,
  kontextWissenEnabled = true,
): Promise<GoaeMappingResult> {
  const model = pickExtractionModel(userModel);

  const leistungTexts = leistungen.flatMap((l) =>
    [l.bezeichnung, l.beschreibung].filter(Boolean) as string[],
  );
  const katalogMd = kontextWissenEnabled
    ? buildEbmMappingCatalogMarkdown({
        leistungTexts: [...leistungTexts, analyse.fachgebiet, analyse.klinischerKontext || ""],
        maxLines: 200,
      })
    : "";
  const katalogSection = kontextWissenEnabled
    ? `\n## EBM-Katalog (Auszug):\n${katalogMd}`
    : "\n## Hinweis\nKein EBM-Katalog mitgeliefert. Ordne nur zu, was ohne erfundene GOPs möglich ist; sonst **fehlendeMappings**.";

  const prompt = [
    "## Nicht zugeordnete Leistungen:\n",
    ...leistungen.map((l, i) => `${i + 1}. ${l.bezeichnung}: ${l.beschreibung}`),
    `\n## Klinischer Kontext: ${analyse.klinischerKontext}`,
    `\n## Fachgebiet: ${analyse.fachgebiet}`,
    katalogSection,
  ].join("\n");

  const raw = await callLlm({
    apiKey,
    model,
    systemPrompt: withAdminContextPrompt(
      EBM_MAPPING_PROMPT,
      kontextWissenEnabled ? adminContext : undefined,
    ),
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

function isEbmGop(s: string): boolean {
  return /^\d{5}$/.test(String(s).trim());
}

export async function mappeEbm(
  rechnung: ParsedRechnung,
  leistungen: ExtrahierteLeistung[],
  analyse: MedizinischeAnalyse,
  apiKey: string,
  userModel: string,
  adminContext?: string,
  kontextWissenEnabled = true,
): Promise<GoaeMappingResult> {
  const zuordnungen: GoaeZuordnung[] = [];
  const nichtZugeordnet: ExtrahierteLeistung[] = [];

  for (const leistung of leistungen) {
    if (leistung.quellePositionNr != null) {
      const pos = rechnung.positionen.find((p) => p.nr === leistung.quellePositionNr);
      if (pos) {
        const gop = String(pos.ziffer).trim();
        if (isEbmGop(gop)) {
          const fromCat = ebmByGop.get(gop);
          zuordnungen.push({
            leistung: leistung.bezeichnung,
            ziffer: gop,
            bezeichnung: fromCat?.bezeichnung || pos.bezeichnung,
            istAnalog: false,
            konfidenz: "hoch",
          });
          continue;
        }
      }
    }
    nichtZugeordnet.push(leistung);
  }

  if (nichtZugeordnet.length > 0) {
    const llmMappings = await suggestEbmMappingsViaLlm(
      nichtZugeordnet,
      analyse,
      apiKey,
      userModel,
      adminContext,
      kontextWissenEnabled,
    );
    zuordnungen.push(...llmMappings.zuordnungen);
    return {
      zuordnungen,
      fehlendeMappings: llmMappings.fehlendeMappings,
    };
  }

  return { zuordnungen, fehlendeMappings: [] };
}

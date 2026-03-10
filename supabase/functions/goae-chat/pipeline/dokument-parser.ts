/**
 * Step 1 – Dokument Parser
 *
 * Extrahiert strukturierte Daten aus einer Rechnung (PDF/Bild).
 * Nutzt einen fokussierten LLM-Aufruf mit JSON-Output.
 *
 *   Rechnung (PDF/Bild) → LLM → ParsedRechnung (JSON)
 */

import { callLlm, extractJson, pickExtractionModel } from "./llm-client.ts";
import type { FilePayload, ParsedRechnung } from "./types.ts";

const PARSER_SYSTEM_PROMPT = `Du bist ein Dokumentenparser für ärztliche Rechnungen nach der Gebührenordnung für Ärzte (GOÄ).

AUFGABE: Extrahiere ALLE strukturierten Daten aus dem hochgeladenen Rechnungsdokument.

WICHTIG:
- Gib KEINE personenbezogenen Daten wieder (Namen, Geburtsdaten, Adressen)
- Extrahiere NUR die abrechnungsrelevanten Informationen
- Jede GOÄ-Position muss erfasst werden

Antworte AUSSCHLIESSLICH mit einem JSON-Objekt in diesem Format:

{
  "positionen": [
    {
      "nr": 1,
      "ziffer": "1240",
      "bezeichnung": "Spaltlampenmikroskopie",
      "faktor": 2.3,
      "betrag": 9.92,
      "datum": "2025-01-15",
      "begruendung": null,
      "anzahl": 1
    }
  ],
  "diagnosen": ["Verdacht auf Glaukom", "Katarakt beidseits"],
  "datum": "2025-01-15",
  "freitext": "Befundbericht: ...",
  "rawText": "der komplette Text des Dokuments"
}

REGELN:
- "ziffer": die GOÄ-Ziffernummer als String (z.B. "1240", "5", "A7011")
- "faktor": numerischer Steigerungsfaktor (z.B. 2.3, 1.8, 3.5)
- "betrag": Euro-Betrag als Dezimalzahl (z.B. 9.92)
- "anzahl": Wie oft die Leistung abgerechnet wird (Standard: 1)
- "begruendung": falls eine Begründung für den Steigerungsfaktor angegeben ist
- "diagnosen": Liste aller genannten Diagnosen/Befunde
- "rawText": der gesamte extrahierte Text des Dokuments
- Bei unleserlichen Stellen: bestmögliche Interpretation, im freitext vermerken`;

export async function parseDokument(
  files: FilePayload[],
  apiKey: string,
  userModel: string,
): Promise<ParsedRechnung> {
  const model = pickExtractionModel(userModel);

  const contentParts: unknown[] = [
    {
      type: "text",
      text: "Lies dieses Rechnungsdokument vollständig aus und extrahiere alle Positionen, Diagnosen und relevanten Informationen als JSON.",
    },
  ];

  for (const file of files) {
    const mimeType = file.type || "application/octet-stream";
    if (mimeType === "application/pdf") {
      contentParts.push({
        type: "file",
        file: {
          filename: file.name,
          file_data: `data:application/pdf;base64,${file.data}`,
        },
      });
    } else {
      contentParts.push({
        type: "image_url",
        image_url: { url: `data:${mimeType};base64,${file.data}` },
      });
    }
  }

  const hasPdf = files.some((f) => (f.type || "").includes("pdf"));
  const plugins = hasPdf
    ? [{ id: "file-parser", pdf: { engine: "mistral-ocr" } }]
    : undefined;

  const raw = await callLlm({
    apiKey,
    model,
    systemPrompt: PARSER_SYSTEM_PROMPT,
    userContent: contentParts,
    jsonMode: true,
    temperature: 0.05,
    maxTokens: 8192,
    plugins,
  });

  const parsed = extractJson<ParsedRechnung>(raw);

  if (!parsed.positionen) parsed.positionen = [];
  if (!parsed.diagnosen) parsed.diagnosen = [];
  if (!parsed.rawText) parsed.rawText = "";

  for (const pos of parsed.positionen) {
    pos.anzahl = pos.anzahl || 1;
    pos.ziffer = String(pos.ziffer);
  }

  return parsed;
}

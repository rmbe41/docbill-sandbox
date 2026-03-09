/**
 * Step 6 – LLM zur Textgenerierung
 *
 * Erstellt verständliche Erklärungen und Optimierungsvorschläge
 * basierend auf den strukturierten Ergebnissen der Pipeline.
 *
 * Dies ist der EINZIGE Schritt, der streaming an den Client sendet.
 *
 *   PipelineResult → LLM (streaming) → formatierte Antwort
 */

import type { PipelineResult } from "./types.ts";
import { GOAE_PARAGRAPHEN } from "../goae-paragraphen.ts";
import {
  GOAE_ANALOGE_BEWERTUNG,
  GOAE_BEGRUENDUNGEN,
} from "../goae-regeln.ts";
import {
  buildFallbackModels,
  isRetryableModelStatus,
} from "../model-resolver.ts";

const TEXT_SYSTEM_PROMPT = `Du bist GOÄ-DocBill, ein KI-Experte für die Analyse und Optimierung von Arztrechnungen.

Du erhältst die VOLLSTÄNDIGEN ERGEBNISSE einer automatischen Rechnungsprüfung.
Die strukturierte Tabellendarstellung wird separat vom Frontend gerendert.

DEINE AUFGABE: Liefere ERGÄNZENDE ERKLÄRUNGEN und kontextbezogene Hinweise.

WICHTIG:
- DU erfindest KEINE eigenen Prüfungen – die Ergebnisse sind determiniert
- Erstelle KEINE Tabellen (die zeigt das Frontend bereits strukturiert an)
- Fokussiere dich auf Erklärungen, Begründungsvorschläge und klinischen Kontext
- Antworte IMMER auf Deutsch

⚠️ DATENSCHUTZ / DSGVO:
- Gib NIEMALS personenbezogene Daten wieder
- Referenziere Patienten nur als "Patient/in"

## DEIN FORMAT:

### 🔍 Analyse

Fasse kurz den klinischen Kontext und das Fachgebiet zusammen (2-3 Sätze).

### ⚠️ Korrekturbedarf

Für JEDE Position mit Status "fehler" oder "warnung":
- **GOÄ [Ziffer]** – [Problem kurz erklären]
  → **Vorschlag:** "[konkreter, kopierbarer Lösungstext]"

Bei Begründungspflicht (Faktor > Schwellenwert):
→ Formuliere eine **fertige, kopierbare Begründung** mit konkretem klinischen Bezug.

Bei Ausschlussziffern-Konflikt:
→ Sage konkret, welche Ziffer behalten/entfernen und warum (mit Betragsvergleich).

### 💡 Empfehlungen

Falls Optimierungen vorgeschlagen wurden:
- Erkläre kurz, warum die vorgeschlagenen Ziffern klinisch sinnvoll sind
- Gib den Kontext für Analogbewertungen nach § 6 GOÄ

### 📝 Fazit

2-3 Bullet Points mit den wichtigsten Handlungsempfehlungen.

DEIN KONTEXTWISSEN:

${GOAE_PARAGRAPHEN}

${GOAE_ANALOGE_BEWERTUNG}

${GOAE_BEGRUENDUNGEN}
`;

export function buildTextGenerationPrompt(result: PipelineResult): string {
  const lines: string[] = [];

  lines.push("# Ergebnisse der automatischen Rechnungsprüfung\n");

  // Medizinischer Kontext
  lines.push("## Medizinischer Kontext");
  lines.push(`Fachgebiet: ${result.medizinischeAnalyse.fachgebiet}`);
  lines.push(`Kontext: ${result.medizinischeAnalyse.klinischerKontext}`);

  if (result.medizinischeAnalyse.diagnosen.length > 0) {
    lines.push("\nDiagnosen:");
    for (const d of result.medizinischeAnalyse.diagnosen) {
      lines.push(
        `- ${d.text}${d.icdCode ? ` (${d.icdCode})` : ""} [${d.sicherheit}]`,
      );
    }
  }

  // Geprüfte Positionen
  lines.push("\n## Geprüfte Positionen\n");
  for (const pos of result.pruefung.positionen) {
    lines.push(`### Position ${pos.nr}: GOÄ ${pos.ziffer} – ${pos.bezeichnung}`);
    lines.push(`Faktor: ${pos.faktor}× | Betrag: ${pos.betrag.toFixed(2)}€ | Berechnet: ${pos.berechneterBetrag.toFixed(2)}€ | Status: ${pos.status}`);

    if (pos.pruefungen.length > 0) {
      lines.push("Prüfungen:");
      for (const p of pos.pruefungen) {
        lines.push(`- [${p.schwere.toUpperCase()}] ${p.typ}: ${p.nachricht}`);
        if (p.vorschlag) lines.push(`  → Vorschlag: ${p.vorschlag}`);
      }
    }
    lines.push("");
  }

  // Optimierungen
  if (result.pruefung.optimierungen.length > 0) {
    lines.push("## Optimierungsvorschläge\n");
    for (const opt of result.pruefung.optimierungen) {
      lines.push(
        `- GOÄ ${opt.ziffer} (${opt.bezeichnung}): ${opt.faktor}× = ${opt.betrag.toFixed(2)}€`,
      );
      lines.push(`  Grund: ${opt.begruendung}`);
    }
    lines.push("");
  }

  // Zusammenfassung
  const z = result.pruefung.zusammenfassung;
  lines.push("## Zusammenfassung");
  lines.push(`- Gesamt: ${z.gesamt} Positionen`);
  lines.push(`- Korrekt: ${z.korrekt}`);
  lines.push(`- Warnungen: ${z.warnungen}`);
  lines.push(`- Fehler: ${z.fehler}`);
  lines.push(`- Rechnungssumme: ${z.rechnungsSumme.toFixed(2)}€`);
  lines.push(`- Korrigierte Summe: ${z.korrigierteSumme.toFixed(2)}€`);
  lines.push(`- Optimierungspotenzial: +${z.optimierungsPotenzial.toFixed(2)}€`);

  return lines.join("\n");
}

/**
 * Startet den streaming LLM-Aufruf für die Textgenerierung.
 * Gibt den Response-Body als ReadableStream zurück.
 */
export async function generateTextStream(
  result: PipelineResult,
  apiKey: string,
  model: string,
  extraRules?: string,
  adminContext?: string,
): Promise<ReadableStream<Uint8Array>> {
  let systemContent = TEXT_SYSTEM_PROMPT;
  if (adminContext) {
    systemContent += `\n\n## ADMIN-KONTEXT:\n${adminContext}`;
  }
  if (extraRules) {
    systemContent += `\n\n## ZUSÄTZLICHE REGELN:\n${extraRules}`;
  }

  const prompt = buildTextGenerationPrompt(result);

  const modelsToTry = buildFallbackModels(model);
  let lastError = "Textgenerierung fehlgeschlagen";

  for (let i = 0; i < modelsToTry.length; i++) {
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: modelsToTry[i],
          messages: [
            { role: "system", content: systemContent },
            { role: "user", content: prompt },
          ],
          stream: true,
          temperature: 0.3,
        }),
      },
    );

    if (response.ok) {
      return response.body!;
    }

    const text = await response.text();
    lastError = `Textgenerierung fehlgeschlagen (${response.status}) mit Modell ${modelsToTry[i]}: ${text}`;
    if (!isRetryableModelStatus(response.status) || i === modelsToTry.length - 1) {
      throw new Error(lastError);
    }
  }

  throw new Error(lastError);
}

export { TEXT_SYSTEM_PROMPT };

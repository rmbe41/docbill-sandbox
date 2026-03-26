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
import { fetchWithTimeout } from "../fetch-with-timeout.ts";
import { GOAE_PARAGRAPHEN } from "../goae-paragraphen.ts";
import {
  GOAE_ANALOGE_BEWERTUNG,
  GOAE_BEGRUENDUNGEN,
} from "../goae-regeln.ts";
import {
  buildFallbackModels,
  isRetryableModelStatus,
  getReasoningConfigForStream,
} from "../model-resolver.ts";

/** Timeout für Textgenerierung (90s) – verhindert endloses Hängen */
const TEXT_FETCH_TIMEOUT_MS = 90000;

const TEXT_SYSTEM_PROMPT = `Du bist GOÄ-DocBill, ein KI-Experte für die Analyse und Optimierung von Arztrechnungen.

Du erhältst die VOLLSTÄNDIGEN ERGEBNISSE einer automatischen **Prüfung der hochgeladenen Rechnung** (Korrekturhinweise, Regelverstöße, Verbesserungspotenzial).
Die strukturierte Darstellung (Vorschläge, Annehmen/Ablehnen, Vorschau) wird separat vom Frontend gerendert.

DEINE AUFGABE: Liefere NUR zwei kompakte Blöcke – Analyse und Fazit. Fokus auf **Prüfung, regelkonforme Verbesserung und konkrete nächste Schritte**. KEINE Wiederholung der Vorschläge (die stehen bereits strukturiert im Frontend).

WICHTIG:
- DU erfindest KEINE eigenen Prüfungen – die Ergebnisse sind determiniert
- Erstelle KEINE Tabellen (die strukturierte Darstellung übernimmt das Frontend)
- Antworte IMMER auf Deutsch
- Priorisiere Fehler (Ausschluss, Betrag, Höchstsatz) vor Warnungen. Bei Unsicherheit: explizit „manuell prüfen“ empfehlen
- **GOÄ-Ausschlusspaare:** Nur die **zu streichende** Ziffer als **Fehler**; die **beizubehaltende** Ziffer im Fazit als **normaler Bullet** (Beibehalten), nicht erneut als harter Fehler – konsistent zur strukturierten Prüfung

⚠️ DATENSCHUTZ / DSGVO:
- Gib NIEMALS personenbezogene Daten wieder
- Referenziere Patienten nur als "Patient/in"

## DEIN FORMAT – PFLICHT

### 🔍 Analyse

2–3 Sätze: Klinischer Kontext, Fachgebiet, relevante Hinweise zur Rechnung. Keine Fließtexte zu einzelnen Positionen.

### 📝 Fazit

NUR 2–4 Bullet-Punkte mit \`- \`. **Nicht** die Labels **Korrekt:** oder **Zusatz:**. Entweder \`- **Fehler:** …\` für harte Abrechnungsprobleme (z. B. Ausschluss, falscher Betrag) oder sachliche Bullets \`- …\` für Beibehalten, Prüfhinweise, Optimierung, Unsicherheit.

Konkrete Handlungsempfehlungen in einem Satz pro Bullet. KEINE Wiederholung der Vorschläge aus der strukturierten Ansicht.

Wiederhole NICHT denselben Wortlaut wie unter „Grund:“ bei Optimierungsvorschlägen oder bereits tabellarisch angezeigte Begründungen – verweise höchstens kurz darauf (z.B. „fehlende Ziffer prüfen“), ohne den Text zu duplizieren.

**PFLICHT bei Faktor > Schwellenwert:** Bei jeder Erwähnung eines Steigerungsfaktors über dem Schwellenwert (z.B. 3,0× statt 2,3×) IMMER einen Begründungsvorschlag nennen – z.B. „Begründung ergänzen: [konkreter Vorschlag]".

**Beispiel:**
\`\`\`
### 🔍 Analyse

Der medizinische Kontext betrifft einen Patienten in der Augenheilkunde mit verengten Lidern. Hoher Zeitaufwand und intensive Beratung erforderlich.

### 📝 Fazit

- **Fehler:** GOÄ 1256 entfernen (Ausschluss mit 1257).
- GOÄ 1257 beibehalten (höherer Betrag).
- Begründung für Steigerungsfaktor ergänzen: „Eingehende Beratung von ca. 20 Min. aufgrund [Diagnose]. Faktor 3,0× gemäß § 5 Abs. 2 GOÄ gerechtfertigt."
\`\`\`

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
    lines.push(`Faktor: ${pos.faktor}× | Betrag: ${pos.betrag.toFixed(2)}€ | Berechnet: ${pos.berechneterBetrag.toFixed(2)}€ | Prüfung: ${pos.status}`);
    if (pos.begruendung) {
      lines.push(`Begründung: ${pos.begruendung}`);
    }

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
  lines.push(`- In Ordnung: ${z.korrekt}`);
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
  userMessage?: string,
): Promise<ReadableStream<Uint8Array>> {
  let systemContent = TEXT_SYSTEM_PROMPT;
  if (adminContext) {
    systemContent += `\n\n## ADMIN-KONTEXT:\n${adminContext}`;
  }
  if (extraRules) {
    systemContent += `\n\n## ZUSÄTZLICHE REGELN:\n${extraRules}`;
  }
  if (userMessage?.trim()) {
    systemContent += `\n\n## NUTZERANWEISUNG (beachten!)\n\nDer Nutzer hat folgende Anweisung gegeben: „${userMessage.trim()}“\n\nBerücksichtige dies bei Analyse und Fazit: Priorisiere die genannten Aspekte, passe Detaillierungsgrad und Fokus entsprechend an.`;
  }

  const prompt = buildTextGenerationPrompt(result);

  const modelsToTry = buildFallbackModels(model);
  const reasoningConfig = getReasoningConfigForStream(model);
  let lastError = "Textgenerierung fehlgeschlagen";

  for (let i = 0; i < modelsToTry.length; i++) {
    let response: Response;
    const reqBody: Record<string, unknown> = {
      model: modelsToTry[i],
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: prompt },
      ],
      stream: true,
      temperature: 0.3,
    };
    if (reasoningConfig) reqBody.reasoning = reasoningConfig;
    try {
      response = await fetchWithTimeout(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(reqBody),
          timeoutMs: TEXT_FETCH_TIMEOUT_MS,
        },
      );
    } catch (e) {
      const isAbort = e instanceof Error && e.name === "AbortError";
      lastError = isAbort
        ? `Textgenerierung Timeout (${TEXT_FETCH_TIMEOUT_MS / 1000}s) – Modell ${modelsToTry[i]} antwortet nicht`
        : (e instanceof Error ? e.message : String(e));
      if (i === modelsToTry.length - 1) throw new Error(lastError);
      continue;
    }

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

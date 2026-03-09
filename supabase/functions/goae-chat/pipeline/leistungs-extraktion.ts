/**
 * Step 3 – Leistungs-Extraktion
 *
 * Wandelt die NLP-Ergebnisse in konkrete medizinische Leistungen um.
 * Dieser Schritt ist DETERMINISTISCH – kein LLM-Aufruf nötig.
 * Er kombiniert die geparsten Rechnungspositionen mit den NLP-Ergebnissen.
 *
 *   ParsedRechnung + MedizinischeAnalyse → ExtrahierteLeistung[]
 */

import type {
  ParsedRechnung,
  MedizinischeAnalyse,
  ExtrahierteLeistung,
} from "./types.ts";

export function extrahiereLeistungen(
  rechnung: ParsedRechnung,
  analyse: MedizinischeAnalyse,
): ExtrahierteLeistung[] {
  const leistungen: ExtrahierteLeistung[] = [];
  const erfassteBehandlungen = new Set<string>();

  for (const pos of rechnung.positionen) {
    const matchingBehandlung = analyse.behandlungen.find(
      (b) =>
        pos.bezeichnung
          .toLowerCase()
          .includes(b.text.toLowerCase().split(" ")[0]) ||
        b.text
          .toLowerCase()
          .includes(pos.bezeichnung.toLowerCase().split(" ")[0]),
    );

    leistungen.push({
      bezeichnung: pos.bezeichnung,
      beschreibung: matchingBehandlung
        ? `${pos.bezeichnung} – ${matchingBehandlung.text} (${matchingBehandlung.typ})`
        : pos.bezeichnung,
      quellePositionNr: pos.nr,
      quelleBehandlung: matchingBehandlung?.text,
    });

    if (matchingBehandlung) {
      erfassteBehandlungen.add(matchingBehandlung.text);
    }
  }

  for (const behandlung of analyse.behandlungen) {
    if (!erfassteBehandlungen.has(behandlung.text)) {
      leistungen.push({
        bezeichnung: behandlung.text,
        beschreibung: `Erkannte Behandlung (${behandlung.typ}) – nicht auf der Rechnung`,
        quelleBehandlung: behandlung.text,
      });
    }
  }

  return leistungen;
}

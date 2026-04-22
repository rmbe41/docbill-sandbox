import type { Engine3Position } from "@/lib/engine3Result";

/** Spec 03 §5.2 — Begründungsfeld-Logik */
export interface BegruendungsVorschlag {
  text: string;
  quelle: "dokumentation" | "beispiel";
  hinweise: string[];
  istAusDokumentationAbleitbar: boolean;
}

const ESSENTIAL_HINWEISE = [
  "Konkreten Mehraufwand benennen (Zeit, Komplexität)",
  "Patientenspezifische Besonderheiten nennen",
  "Quantifizierbare Angaben (Dauer, Anzahl Messungen)",
];

/**
 * Leitet Metadaten zum angezeigten Begründungstext ab (Quelle Dokumentation vs. Beispiel).
 * `kiBody` ist der effektive Vorschlag (Variante, Fallback oder Freitext).
 */
export function buildBegruendungsVorschlag(
  p: Engine3Position,
  kiBody: string,
): BegruendungsVorschlag {
  const trimmed = kiBody.trim();
  const docHint =
    (p.quelleText?.trim().length ?? 0) >= 25 ||
    (p.begruendung?.trim().length ?? 0) > 0 ||
    (p.anmerkung?.trim().length ?? 0) > 0;
  return {
    text: trimmed,
    quelle: docHint ? "dokumentation" : "beispiel",
    hinweise: ESSENTIAL_HINWEISE,
    istAusDokumentationAbleitbar: docHint,
  };
}

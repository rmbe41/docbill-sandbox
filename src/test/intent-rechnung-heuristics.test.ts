import { describe, expect, it } from "vitest";

/**
 * Regression checks for the **no-files** branch in
 * `supabase/functions/goae-chat/intent-classifier.ts` (`classifyByHeuristics`).
 * Duplicate the Rechnungsprüfen-Vortest-Logik hier, damit CI sie ohne Deno ausführt.
 */
function noFileIndicatesRechnungPruefen(msg: string): boolean {
  const m = (msg || "").toLowerCase().trim();
  return (
    /\b(rechnung|honoraraufstellung|abrechnungsbeleg|honorarliste)\b/.test(m) &&
    (/\bprüf/.test(m) ||
      /\bkontroll/.test(m) ||
      /\bkorrigier/.test(m) ||
      /\boptimier/.test(m) ||
      /\bverbesser/.test(m) ||
      /\bfehlend/.test(m) ||
      /\bstimmt\b/.test(m) ||
      /\bkorrekt\b/.test(m))
  );
}

describe("Intent heuristics: Rechnung prüfen (ohne Datei)", () => {
  it("erkennt kurze Welcome-ähnliche Formulierung mit „prüfen“", () => {
    expect(noFileIndicatesRechnungPruefen("Rechnung prüfen")).toBe(true);
    expect(noFileIndicatesRechnungPruefen("Bitte prüfe meine Rechnung auf Optimierungspotenziale")).toBe(
      true,
    );
  });

  it("erkennt Kontroll-/Korrigier-Wortstämme", () => {
    expect(noFileIndicatesRechnungPruefen("Kannst du die Honoraraufstellung kontrollieren")).toBe(true);
  });
});

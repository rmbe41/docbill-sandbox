export type WelcomeStickyWorkflow = "rechnung_pruefen" | "leistungen_abrechnen" | "frage";

/**
 * Erkennt Welcome-Screen-Follow-ups: erster User-Turn ist der Einstiegs-Button-Text,
 * danach soll der passende Workflow stabil bleiben (kein Verlust durch Heuristik „frage“).
 */
export function inferWelcomeStickyWorkflow(
  messages: { role: string; content: string }[] | undefined,
): WelcomeStickyWorkflow | null {
  if (!messages?.length) return null;
  const userTurns = messages
    .filter((m) => m.role === "user")
    .map((m) => String((m as { content?: unknown }).content ?? "").trim());
  if (userTurns.length < 2) return null;

  const firstRaw = userTurns[0] ?? "";
  const firstNorm = firstRaw.toLowerCase().replace(/\s+/g, " ").trim();

  if (firstNorm === "leistungen abrechnen") {
    return "leistungen_abrechnen";
  }
  if (firstNorm === "rechnung prüfen") {
    return "rechnung_pruefen";
  }
  if (
    /^ich möchte eine frage stellen\.?$/.test(firstNorm) ||
    firstNorm === "goä-frage stellen" ||
    firstNorm === "goae-frage stellen"
  ) {
    return "frage";
  }

  return null;
}

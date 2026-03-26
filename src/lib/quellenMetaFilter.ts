/**
 * Entfernt `quellen`-Einträge, die keine echte Fundstelle sind, sondern Meta-Disclaimer des Modells.
 * (Synchron halten mit gleicher Logik in supabase/functions/goae-chat/frage-answer-format.ts)
 */
function isMetaQuelleDisclaimer(s: string): boolean {
  const t = s.trim().toLowerCase();
  if (!t) return true;

  const bannedPhrases = [
    "keine passende fundstelle",
    "keine konkrete fundstelle",
    "keine fundstelle im gelieferten kontext",
    "keine passende fundstelle im gelieferten kontext",
    "keine fundstelle im kontext",
    "im gelieferten kontext wurde keine",
    "im gelieferten kontext keine",
    "wurde keine quelle",
    "es wurde keine quelle",
    "keine quelle genutzt",
    "keine quelle verwendet",
    "keine quelle im kontext",
    "ohne passende fundstelle",
    "ohne fundstelle im",
    "mangels fundstelle",
  ];

  if (bannedPhrases.some((p) => t.includes(p))) return true;

  const looksLikeRealCitation =
    /\bgoä\b/.test(t) ||
    /§\s*\d/.test(t) ||
    /\bziffer\b/i.test(t) ||
    t.startsWith("docbill:") ||
    t.includes("admin-kontext") ||
    t.includes("admin-datei");

  if (looksLikeRealCitation) return false;

  if (
    (t.includes("fundstelle") || t.includes("quelle")) &&
    (t.includes("keine") || t.includes("kein ") || t.startsWith("kein ")) &&
    (t.includes("kontext") || t.includes("gefunden") || t.includes("nutz"))
  ) {
    return true;
  }

  return false;
}

export function filterExplicitQuellenEntries(entries: string[]): string[] {
  return entries
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !isMetaQuelleDisclaimer(s));
}

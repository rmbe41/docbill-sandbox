/**
 * Fragemodus: strukturierte JSON-Antwort → Markdown + Client-Event.
 * (Spiegelung der Typen in src/lib/frageAnswerStructured.ts)
 */

/** @see src/lib/quellenMetaFilter.ts — Logik synchron halten */
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

function filterExplicitQuellenEntries(entries: string[]): string[] {
  return entries
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !isMetaQuelleDisclaimer(s));
}

export type FrageAnswerStructured = {
  kurzantwort: string;
  erlaeuterung: string;
  quellen: string[];
  grenzfaelle_hinweise: string;
};

export function normalizeFrageAnswerParsed(raw: Record<string, unknown>): FrageAnswerStructured | null {
  const kurz = raw.kurzantwort;
  const erl = raw.erlaeuterung;
  let quellen = raw.quellen;
  if (typeof quellen === "string") quellen = [quellen];
  if (!Array.isArray(quellen)) quellen = [];
  const quellenStr = filterExplicitQuellenEntries(
    quellen.filter((x): x is string => typeof x === "string"),
  );
  if (typeof kurz !== "string" || typeof erl !== "string") return null;
  if (!kurz.trim() && !erl.trim()) return null;
  const grenzRaw = raw.grenzfaelle_hinweise;
  const grenz = typeof grenzRaw === "string" ? grenzRaw : "";
  return {
    kurzantwort: kurz.trim(),
    erlaeuterung: erl.trim(),
    quellen: quellenStr,
    grenzfaelle_hinweise: grenz.trim(),
  };
}

export function frageAnswerToMarkdown(a: FrageAnswerStructured): string {
  const grenz = (a.grenzfaelle_hinweise ?? "").trim();
  let out = `### Kurzantwort\n\n${a.kurzantwort}\n\n### Erläuterung\n\n${a.erlaeuterung}\n\n`;
  if (grenz) out += `### Grenzfälle und Hinweise\n\n${grenz}\n\n`;
  const quellenOut = filterExplicitQuellenEntries(a.quellen);
  if (quellenOut.length > 0) out += `*Quellen:* ${quellenOut.join(" · ")}\n`;
  return out;
}

/** Fallback wenn kein Modell zuverlässig JSON liefert: klassisches Markdown mit festen Überschriften. */
export const FRAGE_MARKDOWN_STREAM_RULES = `
## Ausgabeformat (Markdown, verbindlich)

Gib **ausschließlich Markdown** aus. **Kein** Einleitungstext vor der ersten Überschrift.

Verwende **genau** diese **###**-Überschriften für Kurzantwort, Erläuterung und ggf. Grenzfälle. **Quellen** nur **wenn** du den **gelieferten Kontext** für **konkrete** Fakten tatsächlich genutzt hast: **zuletzt**, **ohne** eigene \`###\`-Überschrift, eine **einzige** Zeile \`*Quellen:* …\` mit allen Fundstellen **in einer Zeile**, durch **„ · “** (Mittelpunkt mit Leerzeichen) getrennt – **horizontal** lesbar, **keine** vertikale Bullet-Liste. **Ohne** solche Bezüge: **keinen** \`*Quellen:*\`-Abschnitt – auch **keine** Formulierungen wie „es wurde keine Quelle genutzt“ oder „keine Fundstelle“.

Reihenfolge:

### Kurzantwort
1–3 Sätze mit der direkten Antwort.

### Erläuterung
Gründe, Konsequenzen, typische Fälle – sachlich und gut lesbar.

### Grenzfälle und Hinweise
Nur wenn sinnvoll; sonst exakt die Zeile: *Kein spezieller Hinweis.*

Wenn du den Kontext für **konkrete** Fakten genutzt hast: **abschließend** (kein \`###\` davor) **eine** Zeile \`*Quellen:* …\` – **jede** Fundstelle in derselben Zeile mit „ · “ trennen, z. B. \`*Quellen:* GOÄ § … · GOÄ-Ziffer … · DocBill: …\`. **Keine** vagen Angaben ohne §/Ziffer/Datei. **Ohne** solche Bezüge: den \`*Quellen:*\`-Abschnitt **weglassen** – **keine** erfundenen Paragraphen, **kein** Hinweis auf fehlende Quellen.
`;

/** Anweisung für genau ein JSON-Objekt als Modellausgabe (kein Markdown außerhalb). */
export const FRAGE_JSON_OUTPUT_RULES = `
## Ausgabeformat (verbindlich)

Deine **gesamte** Antwort für den Nutzer besteht aus **einem einzigen gültigen JSON-Objekt** (UTF-8). **Kein** Text vor oder nach dem JSON, **keine** Markdown-Codefences, **keine** Erklärung.

Erlaubtes Schema (alle Schlüssel **müssen** vorkommen):
- \`kurzantwort\` (string): 1–3 Sätze, direkte Antwort.
- \`erlaeuterung\` (string): Gründe, Konsequenzen, typische Fälle – sachlich, gut lesbar.
- \`quellen\` (array von strings): **Nur nicht-leer**, wenn du Inhalte aus dem **gelieferten Kontext** für **konkrete** Fakten belegst (GOÄ-Paragraf, Ziffer/Katalog, DocBill-Regelwerk-Abschnitt, Admin-Dateiname). **Jede** verwendete Fundstelle **ein** Listeneintrag, z. B. \`"GOÄ § …"\`, \`"GOÄ-Ziffer …"\`, \`"DocBill: …"\`, \`"Admin-Kontext [Dateiname]"\`. **Keine** vagen Formulierungen wie nur „nach GOÄ“ ohne §/Ziffer/Datei. **Mehrere** Bezüge → **mehrere** Einträge. **Ohne** solche konkreten Bezüge: **leeres Array** \`[]\` – **keine** Platzhalter-Einträge und **keine** Texte wie „keine Quelle“ oder „keine Fundstelle“; **keine** erfundenen Paragraphen. **Streng verboten** in \`quellen\`: jede Formulierung wie „**keine passende Fundstelle im gelieferten Kontext**“ (oder sinngleich) – **niemals**; stattdessen \`[]\`.
- \`grenzfaelle_hinweise\` (string): optionaler Text; wenn nichts Passtes – leerer String \`""\`.

Beispiele:
{"kurzantwort":"…","erlaeuterung":"…","quellen":["GOÄ § 5 Abs. 2","GOÄ-Ziffer 1 aus dem Katalog"],"grenzfaelle_hinweise":""}
{"kurzantwort":"…","erlaeuterung":"…","quellen":[],"grenzfaelle_hinweise":""}
`;

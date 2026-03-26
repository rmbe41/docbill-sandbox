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
**Max. 1–2 sehr kurze Sätze**, eine Kernaussage. Keine Aufzählungen hier.

### Erläuterung
**Pflicht:** Markdown-Liste mit \`- \`, pro Zeile genau ein Bullet. **Jede** Zeile beginnt mit **einem** der drei Typ-Präfixe (Genau-Schreibung):
- \`- **Fehler:** …\` – Regelverstöße, Ausschlüsse, klare Abrechnungsprobleme
- \`- **Zusatz:** …\` – Ergänzungen, Risiko oder „manuell prüfen“, Grenzfälle ohne harten Fehler
- \`- **Korrekt:** …\` – bestätigende oder regelkonforme Einordnung (sparsam nutzen, kein Füller)

Optional direkt nach dem Doppelpunkt ein zweites Fettdruck-Lead-in, z. B. \`- **Zusatz:** **Schwelle:** …\`. Pro Bullet vorzugsweise **ein Satz**, höchstens zwei kurze Sätze. Keine langen Fließabsätze, keine „1. … 2. …“ als durchlaufende Prosa. Meta-Fragen („Was kannst du?“): **nur Bullets** mit Typ-Präfix, ohne erzählerische Einleitung. **Unter dieser Überschrift keine weiteren** \`###\` **und keine Unterüberschriften.**

### Grenzfälle und Hinweise
Nur wenn sinnvoll; sonst exakt die Zeile: *Kein spezieller Hinweis.* Wenn Inhalt nötig: \`- \` **Listen** wie unter Erläuterung – **jede** Bullet-Zeile mit **Fehler:/Zusatz:/Korrekt:**; **keine** eigenen \`###\`.

Wenn du den Kontext für **konkrete** Fakten genutzt hast: **abschließend** (kein \`###\` davor) **eine** Zeile \`*Quellen:* …\` – **jede** Fundstelle in derselben Zeile mit „ · “ trennen, z. B. \`*Quellen:* GOÄ § … · GOÄ-Ziffer … · DocBill: …\`. **Keine** vagen Angaben ohne §/Ziffer/Datei. **Ohne** solche Bezüge: den \`*Quellen:*\`-Abschnitt **weglassen** – **keine** erfundenen Paragraphen, **kein** Hinweis auf fehlende Quellen.
`;

/** Anweisung für genau ein JSON-Objekt als Modellausgabe (kein Markdown außerhalb). */
export const FRAGE_JSON_OUTPUT_RULES = `
## Ausgabeformat (verbindlich)

Deine **gesamte** Antwort für den Nutzer besteht aus **einem einzigen gültigen JSON-Objekt** (UTF-8). **Kein** Text vor oder nach dem JSON, **keine** Markdown-Codefences, **keine** Erklärung.

Erlaubtes Schema (alle Schlüssel **müssen** vorkommen):
- \`kurzantwort\` (string): **Max. 1–2 sehr kurze Sätze**, keine Aufzählung.
- \`erlaeuterung\` (string): **Markdown-Liste** mit Zeilen \`- …\`. **Jede** Zeile **muss** mit genau einem der Präfixe \`- **Fehler:**\`, \`- **Zusatz:**\` oder \`- **Korrekt:**\` beginnen (siehe Markdown-Regeln). Optional zweites Fettdruck-Lead-in nach dem Doppelpunkt. Pro Bullet ein bis zwei kurze Sätze; **keine** langen Fließtexte. Meta-Fragen: nur typgekennzeichnete Bullets. **Keine** \`###\`-Überschriften in diesem String.
- \`quellen\` (array von strings): **Nur nicht-leer**, wenn du Inhalte aus dem **gelieferten Kontext** für **konkrete** Fakten belegst (GOÄ-Paragraf, Ziffer/Katalog, DocBill-Regelwerk-Abschnitt, Admin-Dateiname). **Jede** verwendete Fundstelle **ein** Listeneintrag, z. B. \`"GOÄ § …"\`, \`"GOÄ-Ziffer …"\`, \`"DocBill: …"\`, \`"Admin-Kontext [Dateiname]"\`. **Keine** vagen Formulierungen wie nur „nach GOÄ“ ohne §/Ziffer/Datei. **Mehrere** Bezüge → **mehrere** Einträge. **Ohne** solche konkreten Bezüge: **leeres Array** \`[]\` – **keine** Platzhalter-Einträge und **keine** Texte wie „keine Quelle“ oder „keine Fundstelle“; **keine** erfundenen Paragraphen. **Streng verboten** in \`quellen\`: jede Formulierung wie „**keine passende Fundstelle im gelieferten Kontext**“ (oder sinngleich) – **niemals**; stattdessen \`[]\`.
- \`grenzfaelle_hinweise\` (string): optional; leer \`""\` wenn nichts Passtes. Wenn Text: \`- \` **Listen** mit denselben Typ-Präfixen wie \`erlaeuterung\`; keine \`###\`. Sonst \`*Kein spezieller Hinweis.*\` ohne Bullets.

Beispiele:
{"kurzantwort":"Bei Faktor > 2,3 ist eine Begründung erforderlich.","erlaeuterung":"- **Korrekt:** Regelfall bis 2,3×.\\n- **Zusatz:** Darüber nur bei besonderem Aufwand/Schwierigkeit (§ 5 GOÄ im Kontext).\\n- **Zusatz:** Begründung konkret und dokumentationsstützbar formulieren.","quellen":["GOÄ § 5 Abs. 2","GOÄ-Ziffer 1 aus dem Katalog"],"grenzfaelle_hinweise":"- **Zusatz:** Ohne Behandlungskontext nur allgemeine Einordnung."}
{"kurzantwort":"Ich erkläre GOÄ und DocBill-Kontext; ich erstelle keine Rechnungen.","erlaeuterung":"- **Korrekt:** Einordnung von Ziffern, Faktoren, Ausschlüssen nach Kontext.\\n- **Zusatz:** Grobe PKV-/Beihilfe-Risiko-Einstufung bei Auffälligkeiten.\\n- **Zusatz:** Regelkonforme Hinweise auf dokumentierte Leistungen.\\n- **Zusatz:** Konkrete GOÄ-/Paragraphen-Fragen beantworten.","quellen":[],"grenzfaelle_hinweise":"- **Zusatz:** Keine Diagnosestellung; bei lückenhafter Doku nur allgemeine Hinweise."}
`;

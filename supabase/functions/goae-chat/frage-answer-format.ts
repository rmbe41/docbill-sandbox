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

export type KurzantwortVorschlag = { id: string; text: string };

export type FrageAnswerStructured = {
  kurzantwort: string;
  vorschlaege?: KurzantwortVorschlag[];
};

/** Entfernt Modell-Artefakte „Korrekt:“ / „Zusatz:“ — synchron zu src/lib/frageAnswerStructured.ts. */
export function stripFrageListKorrektZusatzLabels(block: string): string {
  const lines = block.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    let s = line.replace(
      /^(\s*)((?:(?:[-*+])|\d+\.)\s+)?(?:\*\*)?(Korrekt|Zusatz)(?:\*\*\s*:|:\*\*|\s*:)/i,
      "$1$2",
    );
    const normListAfterLabel = /^(\s*)([-*+])\s+(.*)$/.exec(s);
    if (normListAfterLabel) {
      s = `${normListAfterLabel[1]}${normListAfterLabel[2]} ${normListAfterLabel[3].trimStart()}`;
    } else if (s.trim()) {
      s = s.trimStart();
    }
    if (!s.trim()) {
      out.push(s);
      continue;
    }
    if (!/^\s*(?:[-*+]|\d+\.)\s/.test(s)) {
      const m = /^(\s*)(.*)$/.exec(s);
      if (m) {
        out.push(`${m[1]}- ${m[2]}`);
        continue;
      }
    }
    out.push(s);
  }
  return out.join("\n");
}

function normalizeVorschlaegeParsed(raw: unknown): KurzantwortVorschlag[] {
  if (!Array.isArray(raw)) return [];
  const out: KurzantwortVorschlag[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (typeof item === "string") {
      const t = item.trim();
      if (t) out.push({ id: `s${i}`, text: t });
      continue;
    }
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const o = item as Record<string, unknown>;
      const tid = typeof o.id === "string" ? o.id.trim() : "";
      const ttext = typeof o.text === "string" ? o.text.trim() : "";
      if (ttext) out.push({ id: tid || `s${i}`, text: ttext });
    }
  }
  return out.slice(0, 5);
}

export function normalizeFrageAnswerParsed(raw: Record<string, unknown>): FrageAnswerStructured | null {
  const kurzRaw = raw.kurzantwort;
  const kurzStr = typeof kurzRaw === "string" ? kurzRaw.trim() : "";

  const erlRaw = raw.erlaeuterung;
  const erlStr =
    typeof erlRaw === "string" ? stripFrageListKorrektZusatzLabels(erlRaw.trim()) : "";

  const grenzRaw = raw.grenzfaelle_hinweise;
  const grenzStr =
    typeof grenzRaw === "string" ? stripFrageListKorrektZusatzLabels(grenzRaw.trim()) : "";

  let quellen = raw.quellen;
  if (typeof quellen === "string") quellen = [quellen];
  if (!Array.isArray(quellen)) quellen = [];
  const quellenStr = filterExplicitQuellenEntries(
    quellen.filter((x): x is string => typeof x === "string"),
  );

  const vorschlaege = normalizeVorschlaegeParsed(raw.vorschlaege);

  const blocks: string[] = [];
  if (kurzStr) blocks.push(kurzStr);
  if (erlStr) blocks.push(erlStr);
  if (grenzStr) blocks.push(grenzStr);
  let merged = blocks.join("\n\n");
  if (quellenStr.length > 0) {
    merged += `${merged ? "\n\n" : ""}*Quellen:* ${quellenStr.join(" · ")}`;
  }
  merged = stripFrageListKorrektZusatzLabels(merged.trim());

  if (!merged.trim()) return null;

  const base: FrageAnswerStructured = { kurzantwort: merged };
  if (vorschlaege.length > 0) base.vorschlaege = vorschlaege;
  return base;
}

export function frageAnswerToMarkdown(a: FrageAnswerStructured): string {
  let out = a.kurzantwort.trim();
  if (a.vorschlaege?.length) {
    out += `\n\n### Vorschläge zur Vertiefung\n\n`;
    out += a.vorschlaege.map((v) => `- ${v.text}`).join("\n");
  }
  return out;
}

/** JSON für Direktmodus mit Kurzantworten. */
export const DIRECT_SHORT_JSON_OUTPUT_RULES = `
## Ausgabeformat Direktmodus – Kurzantworten (verbindlich)

**Kontext:** Direktmodell. Du lieferst **keine** Rechnungstabelle und keine Honoraraufstellung.

**STRENG VERBOTEN:** Zeilenanfang mit \`Korrekt:\`, \`Zusatz:\`, \`**Korrekt:**\`, \`**Zusatz:**\` (auch nach \`- \`).

Deine **gesamte** Antwort = **ein** gültiges JSON-Objekt (UTF-8). **Kein** Text außerhalb, **keine** Codefences.

**Schema (Pflichtschlüssel nur \`kurzantwort\`):**
- \`kurzantwort\` (string): **Alles** inhaltlich Relevante hier: knappe Markdown-Antwort (Absätze, optional \`- \` Bullets, höchstens **6** Bullets). Kein Gruß, keine Meta-Einleitung. Konkrete Fundstellen aus dem **mitgelieferten** Kontext optional **zuletzt** in **einer** Zeile \`*Quellen:* A · B\` (sonst weglassen).
- \`vorschlaege\` (array, optional): **0–3** Objekte \`{ "id": string, "text": string }\` — jeweils **eine** kurze Folgefrage als nächste Nutzernachricht. Stabile \`id\` (\`s0\` …). Sonst weglassen oder \`[]\`.
`;

/** Fallback: Markdown-Stream ohne JSON. */
export const FRAGE_MARKDOWN_STREAM_RULES = `
## Ausgabeformat (Markdown, verbindlich)

**STRENG VERBOTEN:** \`Korrekt:\` / \`Zusatz:\` als Zeilenanfang.

Gib **nur Markdown** aus. **Kein** Gruß vor dem ersten sachlichen Satz.

- **Struktur:** **höchstens eine** \`###\`-Überschrift (z. B. \`### Antwort\`), darunter kompakte Absätze und optional \`- \` Bullets (**höchstens 6**). Keine weiteren \`###\`.
- **Quellen:** Nur wenn du den **gelieferten** Kontext für **konkrete** Fakten nutzt: **eine** abschließende Zeile \`*Quellen:* …\` mit \` · \` getrennt. Ohne Bezug: Zeile weglassen (kein „keine Quelle“).
`;

/** JSON-Fragemodus (ein Objekt). */
export const FRAGE_JSON_OUTPUT_RULES = `
## Ausgabeformat (verbindlich)

**STRENG VERBOTEN:** \`Korrekt:\` / \`Zusatz:\` als Zeilenanfang (auch mit \`- \`).

Deine **gesamte** Antwort = **ein** gültiges JSON-Objekt (UTF-8). **Kein** Text außerhalb, **keine** Codefences.

**Schema (Pflichtschlüssel nur \`kurzantwort\`):**
- \`kurzantwort\` (string): **Alles** inhaltlich Relevante: Markdown mit kurzen Absätzen und optional \`- \` Bullets (**höchstens 6**). Keine \`###\` in diesem String nötig. Kein Gruß. Fundstellen aus dem **mitgelieferten** Kontext optional **zuletzt** als eine Zeile \`*Quellen:* …\` mit \` · \` — sonst weglassen. Keine Platzhalter-„keine Quelle“-Sätze.

Beispiel:
{"kurzantwort":"Bei Faktor über der Katalogschwelle ist eine dokumentationsgestützte Begründung nötig.\\n- Prüfe Schwellen- und Höchstfaktor der Ziffer im Katalog.\\n- Formuliere den medizinischen Mehraufwand konkret.\\n\\n*Quellen:* GOÄ § 5 Abs. 2 · GOÄ-Ziffer aus Katalogauszug"}
`;

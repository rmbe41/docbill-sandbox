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
  erlaeuterung: string;
  quellen: string[];
  grenzfaelle_hinweise: string;
  /** Optional: interaktive Folge-Prompts (Direktmodus Kurzantworten). */
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
  const vorschlaege = normalizeVorschlaegeParsed(raw.vorschlaege);
  const base: FrageAnswerStructured = {
    kurzantwort: kurz.trim(),
    erlaeuterung: stripFrageListKorrektZusatzLabels(erl.trim()),
    quellen: quellenStr,
    grenzfaelle_hinweise: stripFrageListKorrektZusatzLabels(grenz.trim()),
  };
  if (vorschlaege.length > 0) base.vorschlaege = vorschlaege;
  return base;
}

export function frageAnswerToMarkdown(a: FrageAnswerStructured): string {
  const grenz = (a.grenzfaelle_hinweise ?? "").trim();
  let out = `### Zusammenfassung\n\n${a.kurzantwort}\n\n### Erläuterung\n\n${a.erlaeuterung}\n\n`;
  if (grenz) out += `### Grenzfälle und Hinweise\n\n${grenz}\n\n`;
  const quellenOut = filterExplicitQuellenEntries(a.quellen);
  if (quellenOut.length > 0) out += `*Quellen:* ${quellenOut.join(" · ")}\n`;
  if (a.vorschlaege?.length) {
    out += `\n### Vorschläge zur Vertiefung\n\n`;
    out += a.vorschlaege.map((v) => `- ${v.text}`).join("\n");
    out += "\n";
  }
  return out;
}

/** JSON-Schema-Hinweise für Direktmodus mit Kurzantworten (ein Objekt, Felder wie Fragemodus + vorschlaege). */
export const DIRECT_SHORT_JSON_OUTPUT_RULES = `
## Ausgabeformat Direktmodus – Kurzantworten (verbindlich)

**Kontext:** Direktmodell (mit oder ohne lokales GOÄ/Admin-Kontext). Du lieferst **keine** Rechnungstabelle und keine Honoraraufstellung.

**STRENG VERBOTEN** in \`erlaeuterung\` und \`grenzfaelle_hinweise\`: \`Korrekt:\`, \`Zusatz:\`, \`**Korrekt:**\`, \`**Zusatz:**\` am Zeilenanfang.

Deine **gesamte** Antwort besteht aus **einem einzigen gültigen JSON-Objekt** (UTF-8). **Kein** Text vor oder nach dem JSON, **keine** Markdown-Codefences, **keine** Erklärung.

**Reihenfolge der inhaltlichen Logik:** Zuerste die Kernaussage in \`kurzantwort\` – **kein** Gruß, keine Meta-Einleitung („Gerne helfe ich…“) in einem separaten Satz davor; der **erste** inhaltliche Satz der Antwort steht in \`kurzantwort\`.

Erlaubtes Schema (alle Schlüssel **müssen** vorkommen):
- \`kurzantwort\` (string): **Max. 1–2 sehr kurze Sätze**, direkte Antwort. Keine Aufzählung.
- \`erlaeuterung\` (string): **Markdown-Liste** mit \`- …\`, **höchstens 5** Bullets, je Bullet höchstens zwei kurze Sätze. Keine langen Fließtexte, keine \`###\` in diesem String.
- \`quellen\` (array von strings): Wie im Fragemodus – nur bei **konkreten** Fundstellen im **mitgelieferten** Kontext (GOÄ, Katalog, Admin-Dateiname). Sonst \`[]\`. Keine Platzhalter-„keine Quelle“-Einträge.
- \`grenzfaelle_hinweise\` (string): Kurz; \`""\` wenn nichts Nötiges. Sonst \`- \` Listen wie \`erlaeuterung\`.
- \`vorschlaege\` (array): **0 bis 3** Objekte \`{ "id": string, "text": string }\`. Jeder \`text\`: **eine** kurze, konkrete Folgefrage oder nächster Schritt, den der Nutzer **als nächste Chat-Nachricht** schreiben könnte (keine Werbung, keine Duplikate der Zusammenfassung). **Stabile** \`id\` z. B. \`s0\`, \`s1\`, \`s2\`. Wenn keine passenden Vorschläge: \`[]\`.
`;

/** Fallback wenn kein Modell zuverlässig JSON liefert: klassisches Markdown mit festen Überschriften. */
export const FRAGE_MARKDOWN_STREAM_RULES = `
## Ausgabeformat (Markdown, verbindlich)

**STRENG VERBOTEN:** Zeilen, die mit \`Korrekt:\`, \`Zusatz:\`, \`**Korrekt:**\`, \`**Zusatz:**\` beginnen (auch nach \`- \` oder Einrückung). Stattdessen nur sachliche Bullets \`- …\` oder \`- **Fehler:** …\` bei echtem Regelverstoß.

Gib **ausschließlich Markdown** aus. **Kein** Einleitungstext vor der ersten Überschrift.

Verwende **genau** diese **###**-Überschriften für Kurzantwort, Erläuterung und ggf. Grenzfälle. **Quellen** nur **wenn** du den **gelieferten Kontext** für **konkrete** Fakten tatsächlich genutzt hast: **zuletzt**, **ohne** eigene \`###\`-Überschrift, eine **einzige** Zeile \`*Quellen:* …\` mit allen Fundstellen **in einer Zeile**, durch **„ · “** (Mittelpunkt mit Leerzeichen) getrennt – **horizontal** lesbar, **keine** vertikale Bullet-Liste. **Ohne** solche Bezüge: **keinen** \`*Quellen:*\`-Abschnitt – auch **keine** Formulierungen wie „es wurde keine Quelle genutzt“ oder „keine Fundstelle“.

Reihenfolge:

### Kurzantwort
**Max. 1–2 sehr kurze Sätze**, eine Kernaussage. Keine Aufzählungen hier.

### Erläuterung
**Pflicht:** Markdown-Liste mit \`- \`, pro Zeile genau ein Bullet. **Nicht** die Labels **Korrekt:** oder **Zusatz:** verwenden. Sachliche Bullets \`- …\` (ein bis zwei kurze Sätze). Nur bei **klarem Regelverstoß** optional \`- **Fehler:** …\` (Ausschluss, Verstoß, unzulässige Abrechnung).

Optional ein inhaltliches Fettdruck-Lead-in im Bullet, z. B. \`- **Schwelle:** …\` – aber **nicht** als „Zusatz:“- oder „Korrekt:“-Typ-Label. Keine langen Fließabsätze, keine „1. … 2. …“ als durchlaufende Prosa. Meta-Fragen („Was kannst du?“): **nur** solche Bullets, ohne erzählerische Einleitung. **Unter dieser Überschrift keine weiteren** \`###\` **und keine Unterüberschriften.**

### Grenzfälle und Hinweise
Nur wenn sinnvoll; sonst exakt die Zeile: *Kein spezieller Hinweis.* Wenn Inhalt nötig: \`- \` **Listen** wie unter Erläuterung (**keine** Korrekt:/Zusatz:-Labels); **keine** eigenen \`###\`.

Wenn du den Kontext für **konkrete** Fakten genutzt hast: **abschließend** (kein \`###\` davor) **eine** Zeile \`*Quellen:* …\` – **jede** Fundstelle in derselben Zeile mit „ · “ trennen, z. B. \`*Quellen:* GOÄ § … · GOÄ-Ziffer … · DocBill: …\`. **Keine** vagen Angaben ohne §/Ziffer/Datei. **Ohne** solche Bezüge: den \`*Quellen:*\`-Abschnitt **weglassen** – **keine** erfundenen Paragraphen, **kein** Hinweis auf fehlende Quellen.
`;

/** Anweisung für genau ein JSON-Objekt als Modellausgabe (kein Markdown außerhalb). */
export const FRAGE_JSON_OUTPUT_RULES = `
## Ausgabeformat (verbindlich)

**STRENG VERBOTEN** in \`erlaeuterung\` und \`grenzfaelle_hinweise\`: \`Korrekt:\`, \`Zusatz:\`, \`**Korrekt:**\`, \`**Zusatz:**\` am Zeilenanfang (auch mit \`- \`). Nur normale Bullets oder \`- **Fehler:** …\` bei Verstößen.

Deine **gesamte** Antwort für den Nutzer besteht aus **einem einzigen gültigen JSON-Objekt** (UTF-8). **Kein** Text vor oder nach dem JSON, **keine** Markdown-Codefences, **keine** Erklärung.

Erlaubtes Schema (alle Schlüssel **müssen** vorkommen):
- \`kurzantwort\` (string): **Max. 1–2 sehr kurze Sätze**, keine Aufzählung.
- \`erlaeuterung\` (string): **Markdown-Liste** mit Zeilen \`- …\`. **Keine** Präfixe **Korrekt:** oder **Zusatz:**. Zeilen entweder als sachlicher Bullet \`- Text\` oder – nur bei klarem Verstoß – \`- **Fehler:** …\`. Pro Bullet ein bis zwei kurze Sätze; **keine** langen Fließtexte. Meta-Fragen: nur solche Bullets. **Keine** \`###\`-Überschriften in diesem String.
- \`quellen\` (array von strings): **Nur nicht-leer**, wenn du Inhalte aus dem **gelieferten Kontext** für **konkrete** Fakten belegst (GOÄ-Paragraf, Ziffer/Katalog, DocBill-Regelwerk-Abschnitt, Admin-Dateiname). **Jede** verwendete Fundstelle **ein** Listeneintrag, z. B. \`"GOÄ § …"\`, \`"GOÄ-Ziffer …"\`, \`"DocBill: …"\`, \`"Admin-Kontext [Dateiname]"\`. **Keine** vagen Formulierungen wie nur „nach GOÄ“ ohne §/Ziffer/Datei. **Mehrere** Bezüge → **mehrere** Einträge. **Ohne** solche konkreten Bezüge: **leeres Array** \`[]\` – **keine** Platzhalter-Einträge und **keine** Texte wie „keine Quelle“ oder „keine Fundstelle“; **keine** erfundenen Paragraphen. **Streng verboten** in \`quellen\`: jede Formulierung wie „**keine passende Fundstelle im gelieferten Kontext**“ (oder sinngleich) – **niemals**; stattdessen \`[]\`.
- \`grenzfaelle_hinweise\` (string): optional; leer \`""\` wenn nichts Passtes. Wenn Text: \`- \` **Listen** wie \`erlaeuterung\` (ohne Korrekt:/Zusatz:); keine \`###\`. Sonst \`*Kein spezieller Hinweis.*\` ohne Bullets.

Beispiele:
{"kurzantwort":"Bei Faktor > 2,3 ist eine Begründung erforderlich.","erlaeuterung":"- Regelfall bis 2,3×.\\n- Darüber nur bei besonderem Aufwand/Schwierigkeit (§ 5 GOÄ im Kontext).\\n- Begründung konkret und dokumentationsstützbar formulieren.","quellen":["GOÄ § 5 Abs. 2","GOÄ-Ziffer 1 aus dem Katalog"],"grenzfaelle_hinweise":"- Ohne Behandlungskontext nur allgemeine Einordnung."}
{"kurzantwort":"Ich erkläre GOÄ und DocBill-Kontext; ich erstelle keine Rechnungen.","erlaeuterung":"- Ich erkläre GOÄ-Ziffern, Paragraphen, Steigerungsfaktoren, Ausschlüsse und Analogabrechnungen basierend auf dem aktuellen GOÄ-Katalog und den DocBill-Regelwerken.\\n- Ich helfe bei der Optimierung der Begründungsqualität und der korrekten Ziffernwahl, um die Abrechnung rechtssicher zu gestalten.\\n- Bei Unklarheiten oder unvollständiger Dokumentation weise ich auf fehlende Informationen hin und bewerte mögliche Risiken für die Erstattungsfähigkeit.\\n- Ich kann auch Informationen aus den bereitgestellten Admin-Wissensdateien nutzen, sofern diese relevant für die Nutzerfrage sind.","quellen":[],"grenzfaelle_hinweise":"- Ich erstelle keine medizinischen Diagnosen oder Befunde und gebe keine medizinischen Empfehlungen.\\n- Rechtsberatung kann und darf ich nicht leisten; meine Aussagen dienen der Orientierung im Rahmen der GOÄ-Vorschriften."}
`;

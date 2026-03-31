import { filterExplicitQuellenEntries } from "@/lib/quellenMetaFilter";

export type KurzantwortVorschlag = { id: string; text: string };

/** Strukturierte KI-Antwort im GOÄ-Fragemodus (persistiert in structured_content). */
export type FrageAnswerStructured = {
  kurzantwort: string;
  erlaeuterung: string;
  quellen: string[];
  grenzfaelle_hinweise: string;
  vorschlaege?: KurzantwortVorschlag[];
};

/**
 * Entfernt veraltete Listen-Labels „Korrekt:“ / „Zusatz:“ (mit/ohne **, mit/ohne „- „).
 * Logik muss mit supabase/functions/goae-chat/frage-answer-format.ts übereinstimmen.
 */
export function stripFrageListKorrektZusatzLabels(block: string): string {
  const lines = block.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    let s = line.replace(
      /^(\s*)((?:(?:[-*+])|\d+\.)\s+)?(?:\*\*)?(Korrekt|Zusatz)(?:\*\*\s*:|:\*\*|\s*:)/i,
      "$1$2",
    );
    const normList = /^(\s*)([-*+])\s+(.*)$/.exec(s);
    if (normList) {
      s = `${normList[1]}${normList[2]} ${normList[3].trimStart()}`;
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

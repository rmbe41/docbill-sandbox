import { filterExplicitQuellenEntries } from "@/lib/quellenMetaFilter";

/** Strukturierte KI-Antwort im GOÄ-Fragemodus (persistiert in structured_content). */
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

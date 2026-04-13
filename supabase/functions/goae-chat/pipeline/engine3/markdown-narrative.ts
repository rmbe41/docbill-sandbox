/**
 * Deterministischer Fließtext für den Chat (nach engine3_result), analog zur Hauptpipeline.
 */
import { rankEngine3TopVorschlaege, type Engine3Hinweis, type Engine3ResultData } from "./validate.ts";

function fmtEuro(n: number): string {
  return `${n.toFixed(2).replace(".", ",")} €`;
}

function oneLine(s: string, max: number): string {
  const t = s.replace(/\r?\n/g, " ").replace(/\*/g, "·").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function collectKnownPositionNrs(data: Engine3ResultData): Set<number> {
  const s = new Set<number>();
  for (const p of data.positionen) s.add(p.nr);
  for (const p of data.optimierungen ?? []) s.add(p.nr);
  return s;
}

function isGlobalEngine3Hinweis(h: Engine3Hinweis, known: Set<number>): boolean {
  const b = h.betrifftPositionen;
  if (!b?.length) return true;
  return b.every((nr) => !known.has(nr));
}

const narrativSchwere = (h: Engine3Hinweis) => h.schwere === "fehler" || h.schwere === "warnung";

function dedupeHinweise(hinweise: Engine3Hinweis[]): Engine3Hinweis[] {
  const out: Engine3Hinweis[] = [];
  const seen = new Set<string>();
  for (const h of hinweise) {
    const key = `${h.schwere}|${h.titel}|${h.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
  }
  return out;
}

export function buildEngine3AssistantMarkdown(data: Engine3ResultData): string {
  const knownNrs = collectKnownPositionNrs(data);
  const z = data.zusammenfassung;
  const title =
    data.modus === "rechnung_pruefung" ? "Rechnungspruefung" : "Abrechnungsvorschlaege";
  const top = rankEngine3TopVorschlaege(data);
  const primary = top[0];

  const perPositionRelevant = dedupeHinweise(
    (data.hinweise ?? []).filter((h) => narrativSchwere(h) && !!h.betrifftPositionen?.length),
  ).slice(0, 2);
  const globalRelevant = dedupeHinweise(
    (data.hinweise ?? []).filter((h) => narrativSchwere(h) && isGlobalEngine3Hinweis(h, knownNrs)),
  ).slice(0, 2);
  const relevantHinweise = dedupeHinweise([...perPositionRelevant, ...globalRelevant]).slice(0, 3);

  let md = `### ${title}\n\n`;
  md += `${data.positionen.length} Position(en), Summe ${fmtEuro(z.geschaetzteSumme)}`;
  if (z.fehler) md += `, ${z.fehler} Fehler`;
  if (z.warnungen) md += `, ${z.warnungen} Warnungen`;
  md += ".\n";

  if (primary && data.modus === "leistungen_abrechnen") {
    md += `\n**Schwerpunkt:** GOAe ${primary.ziffer} · ${fmtEuro(primary.betrag)} · Faktor ${primary.faktor} — ${oneLine(primary.bezeichnung, 120)}\n`;
  }

  if (relevantHinweise.length) {
    md += "\n";
    for (const h of relevantHinweise) {
      md += `- **${h.schwere}:** ${oneLine(h.titel, 72)} — ${oneLine(h.detail, 180)}\n`;
    }
  }

  md += "\n*Details und Aktionen in der Ergebniskarte.*\n";
  return md;
}

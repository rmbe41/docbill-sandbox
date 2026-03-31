/**
 * Deterministischer Fließtext für den Chat (nach engine3_result), analog zur Hauptpipeline.
 */
import type { Engine3Hinweis, Engine3ResultData } from "./validate.ts";

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

export function buildEngine3AssistantMarkdown(data: Engine3ResultData): string {
  const knownNrs = collectKnownPositionNrs(data);
  const modusLabel = data.modus === "rechnung_pruefung" ? "Rechnungsprüfung" : "Leistungsvorschläge";
  const z = data.zusammenfassung;
  let md = `### Engine 3 – ${modusLabel}\n\n`;
  md += `**Überblick:** ${data.positionen.length} Position(en), geschätzte Summe ${fmtEuro(z.geschaetzteSumme)}`;
  if (z.fehler) md += `, **${z.fehler} Fehler**`;
  if (z.warnungen) md += `, **${z.warnungen} Warnungen**`;
  md += ".\n\n";

  if (data.klinischerKontext?.trim()) {
    md += `**Klinischer Kontext:** ${oneLine(data.klinischerKontext, 520)}\n\n`;
  }
  if (data.fachgebiet?.trim()) {
    md += `**Fachgebiet:** ${oneLine(data.fachgebiet, 120)}\n\n`;
  }

  md += "#### Positionen\n\n";
  for (const p of data.positionen) {
    const bez = p.bezeichnung ? ` — *${oneLine(p.bezeichnung, 200)}*` : "";
    md += `- **Nr. ${p.nr} · GOÄ ${p.ziffer}** (${p.status}) · ${fmtEuro(p.betrag)} · Faktor ${p.faktor}${bez}\n`;
    if (p.quelleText?.trim()) {
      md += `  - *Quelle:* ${oneLine(p.quelleText, 380)}\n`;
    }
    const extra = [p.begruendung, p.anmerkung].filter(Boolean).join(" ");
    if (extra) md += `  - ${oneLine(extra, 420)}\n`;
    for (const h of data.hinweise ?? []) {
      if (!narrativSchwere(h) || !h.betrifftPositionen?.includes(p.nr)) continue;
      md += `  - **${h.schwere.toUpperCase()}:** ${oneLine(h.titel, 180)} — ${oneLine(h.detail, 400)}\n`;
    }
  }

  const hinweiseNarrativGlobal = (data.hinweise ?? []).filter(
    (h) => narrativSchwere(h) && isGlobalEngine3Hinweis(h, knownNrs),
  );
  if (hinweiseNarrativGlobal.length) {
    md += "\n#### Hinweise\n\n";
    for (const h of hinweiseNarrativGlobal) {
      md += `- **${h.schwere.toUpperCase()}:** ${oneLine(h.titel, 180)} — ${oneLine(h.detail, 400)}\n`;
    }
  }

  if (data.optimierungen?.length) {
    md += "\n#### Vorschläge / Optimierungen\n\n";
    for (const p of data.optimierungen) {
      const bez = p.bezeichnung ? ` — ${oneLine(p.bezeichnung, 160)}` : "";
      md += `- **Nr. ${p.nr} · GOÄ ${p.ziffer}** (${p.status}) · ${fmtEuro(p.betrag)}${bez}\n`;
      if (p.quelleText?.trim()) {
        md += `  - *Quelle:* ${oneLine(p.quelleText, 300)}\n`;
      }
      const extra = [p.begruendung, p.anmerkung].filter(Boolean).join(" ");
      if (extra) md += `  - ${oneLine(extra, 320)}\n`;
      for (const h of data.hinweise ?? []) {
        if (!narrativSchwere(h) || !h.betrifftPositionen?.includes(p.nr)) continue;
        md += `  - **${h.schwere.toUpperCase()}:** ${oneLine(h.titel, 180)} — ${oneLine(h.detail, 400)}\n`;
      }
    }
  }

  if (data.goaeStandHinweis?.trim()) {
    md += `\n*${oneLine(data.goaeStandHinweis, 400)}*\n`;
  }
  if (data.quellen?.length) {
    md += "\n#### Quellen\n\n";
    for (const q of data.quellen.slice(0, 12)) {
      const line = String(q).trim();
      if (line) md += `- ${oneLine(line, 340)}\n`;
    }
  }

  return md;
}

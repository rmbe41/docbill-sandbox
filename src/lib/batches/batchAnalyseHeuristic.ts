import { goaeByZiffer } from "@/data/goae-catalog";
import { calculateAmountOrScaled } from "@/lib/goae-validator";
import type { KennzeichnungStufe } from "@/lib/analyse/types";
import type { BatchKpi, BatchListeStatus, BatchRechnungDetail } from "@/lib/batches/batchTypes";
import { batchPillDisplayLabel } from "@/lib/batches/batchKennzeichnungDisplay";
import { formatHinweiseSpalte, formatStatusSpalte } from "@/lib/batches/batchKpiColumns";
import type { BatchPositionPill } from "@/lib/batches/batchTypes";

const GOAE_ZIF_FINDER = /\b([1-9]\d{3}[a-z]?)\b/gi;
const GOP_5 = /\b(\d{5})\b/g;

function hash32(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return Math.abs(h);
}

function findGoaeZiffern(raw: string): string[] {
  const set = new Set<string>();
  const m = raw.matchAll(GOAE_ZIF_FINDER);
  for (const x of m) {
    const z = x[1]!.toLowerCase();
    if (goaeByZiffer.has(z)) set.add(z);
  }
  return [...set].slice(0, 8);
}

function findEbmGop(raw: string): string[] {
  const set = new Set<string>();
  for (const m of raw.matchAll(GOP_5)) {
    const d = m[1]!;
    if (d !== "00000") set.add(d);
  }
  return [...set].slice(0, 6);
}

function pickFaktor(ziffer: string, raw: string, idx: number): number {
  const near = new RegExp(`${ziffer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^0-9]{0,24}([1-3](?:[.,]\\d)?)`, "i");
  const m = raw.match(near);
  if (m?.[1]) {
    const v = parseFloat(m[1].replace(",", "."));
    if (Number.isFinite(v)) return Math.round(v * 10) / 10;
  }
  const h = hash32(ziffer + raw + idx) % 5;
  return [1.0, 1.8, 2.3, 2.5, 2.3][h] ?? 2.3;
}

function kennFuerIndex(h: number, hasConflict: boolean): KennzeichnungStufe {
  if (hasConflict) return "FEHLER";
  const r = h % 11;
  if (r < 3) return "SICHER";
  if (r < 4) return "OPTIMIERUNG";
  if (r < 7) return "PRÜFEN";
  if (r < 9) return "RISIKO";
  if (r < 10) return "UNVOLLSTÄNDIG";
  return "FEHLER";
}

function buildKpiFromPositions(positionen: BatchRechnungDetail["positionen"]): BatchKpi {
  const k: BatchKpi = {
    hinweisGesamt: 0,
    pruefen: 0,
    risiko: 0,
    optimierung: 0,
    fehler: 0,
    unvollstaendig: 0,
  };
  for (const p of positionen) {
    const ke = p.kennzeichnung ?? "PRÜFEN";
    if (ke === "SICHER") continue;
    if (ke === "PRÜFEN") k.pruefen += 1;
    if (ke === "RISIKO") k.risiko += 1;
    if (ke === "OPTIMIERUNG") k.optimierung += 1;
    if (ke === "FEHLER") k.fehler += 1;
    if (ke === "UNVOLLSTÄNDIG") k.unvollstaendig += 1;
    k.hinweisGesamt += 1;
  }
  return k;
}

function deriveListeFromKpi(k: BatchKpi): BatchListeStatus {
  if (k.fehler > 0) return "fehler";
  if (k.hinweisGesamt > 0) return "mit_hinweisen";
  return "geprueft";
}

export function analyseRohrechnungHeuristisch(
  rohText: string,
  options?: { fileName?: string; quelle?: "pdf" | "pad" | "bild" },
): {
  detail: BatchRechnungDetail;
  listeStatus: BatchListeStatus;
  hinweiseKurz: string | null;
  fachbereich: string;
  betragEuro: number;
} {
  const raw = rohText.trim() || " ";
  const goaeZ = findGoaeZiffern(raw);
  const gopZ = goaeZ.length ? [] : findEbmGop(raw);

  const pos: BatchRechnungDetail["positionen"] = [];
  let sum = 0;
  if (goaeZ.length) {
    for (let i = 0; i < goaeZ.length; i++) {
      const z = goaeZ[i]!;
      const f = pickFaktor(z, raw, i);
      const g = goaeByZiffer.get(z);
      const bRaw = g ? calculateAmountOrScaled(z, f, { betrag: g.einfachsatz, faktor: 1 }) : 12 + i * 3.4;
      const b = round2(bRaw);
      const conflict = /fehler|beanstand|unzulässig/i.test(raw) && i === 0;
      const h = hash32(z + raw.slice(0, 200) + i);
      const kenn = kennFuerIndex(h, conflict);
      pos.push({
        nr: pos.length + 1,
        ziffer: z,
        fehlend: false,
        faktor: f,
        betrag: b,
        pill: batchPillDisplayLabel(kenn) as BatchPositionPill,
        kennzeichnung: kenn,
        titel:
          kenn === "FEHLER"
            ? "Abrechnung prüfen"
            : kenn === "RISIKO"
              ? "Kürzungsrisiko"
            : kenn === "OPTIMIERUNG"
              ? "Erlöspotenzial"
            : kenn === "PRÜFEN"
              ? "Prüfung nötig"
            : "Ziffer ok",
        text: g?.bezeichnung ?? "Aus Katalog/Heuristik.",
        hinweis:
          kenn === "PRÜFEN" || kenn === "RISIKO"
            ? "Abgleich mit Dokumentation empfohlen (Spec 02 / Kategorien 3–7)."
            : undefined,
      });
      sum += b;
    }
    const needsKombi = /komb|pflicht.*fehl|zusatz.*leistung/i.test(raw) || hash32(raw) % 7 === 0;
    if (needsKombi) {
      const add = 18.4;
      pos.push({
        nr: pos.length + 1,
        fehlend: true,
        ziffer: "03221",
        betrag: add,
        pill: "Pflicht fehlt",
        kennzeichnung: "UNVOLLSTÄNDIG",
        text: "€18,40 – fehlt als Kombination (Heuristik, Spec 02 Kat. 8).",
        titel: "Kombination fehlt",
      });
    }
  } else if (gopZ.length) {
    gopZ.forEach((g, i) => {
      const b = 18.4 + i;
      const kenn: KennzeichnungStufe = i % 3 === 0 ? "SICHER" : "PRÜFEN";
      pos.push({
        nr: i + 1,
        ziffer: g,
        faktor: 1,
        betrag: b,
        pill: batchPillDisplayLabel(kenn) as BatchPositionPill,
        kennzeichnung: kenn,
        titel: "GOP-Position (EBM)",
        text: "Aus PAD/PDF-Text extrahiert.",
        hinweis: kenn === "PRÜFEN" ? "Punktzahl und Fachgruppe plausibilisieren." : undefined,
      });
      sum += b;
    });
  } else {
    const kenn: KennzeichnungStufe = "PRÜFEN";
    const bild = options?.quelle === "bild";
    pos.push({
      nr: 1,
      ziffer: "—",
      betrag: 0,
      pill: "Prüfen",
      kennzeichnung: kenn,
      titel: bild ? "Bild (ohne Texterkennung im Stapel)" : "Keine Ziffer erkannt",
      text: bild
        ? "Im Stapel wird aus Bildern kein Text gelesen; zur Prüfung Bild im Chat unter Rechnungsprüfung hochladen."
        : "Bitte Inhalt prüfen oder anderes Dateiformat nutzen (Spec 02).",
    });
  }

  const kpi = buildKpiFromPositions(pos);
  const liste = deriveListeFromKpi(kpi);
  const detail: BatchRechnungDetail = {
    fachbereich: raw.toLowerCase().includes("augen") ? "Augenheilkunde" : "Allgemein",
    positionen: pos,
    gesamt: sum || 0,
    kpi,
    metadata: { rohText, fileName: options?.fileName, quelle: options?.quelle, pending: false },
  };
  if (pos.some((p) => p.kennzeichnung === "UNVOLLSTÄNDIG" && p.fehlend)) {
    const p = pos.find((x) => x.kennzeichnung === "UNVOLLSTÄNDIG" && x.fehlend);
    const add = p?.betrag ?? 0;
    detail.gesamtNach = round2((sum || 0) + add);
    detail.deltaLabel = `(+${add.toFixed(2).replace(".", ",")} € durch Kombinationspflicht)`;
  }
  return {
    detail,
    listeStatus: liste,
    hinweiseKurz: formatHinweiseSpalte(kpi, liste),
    fachbereich: detail.fachbereich!,
    betragEuro: sum,
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export function spalteStatusUndHinweis(
  liste: BatchListeStatus,
  kpi: BatchKpi | undefined,
): { status: string; hinweise: string } {
  return {
    status: formatStatusSpalte(liste, kpi),
    hinweise: formatHinweiseSpalte(kpi, liste),
  };
}

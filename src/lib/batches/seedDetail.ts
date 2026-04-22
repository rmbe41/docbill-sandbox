import type { BatchListeStatus, BatchRechnungDetail } from "@/lib/batches/batchTypes";

export function demoHinweiseKurz(status: BatchListeStatus): string {
  switch (status) {
    case "geprueft":
      return "—";
    case "mit_hinweisen":
      return "2 Optim.";
    case "fehler":
      return "1 Fehler";
    default:
      return "—";
  }
}

export function demoListeStatus(i: number): BatchListeStatus {
  const r = i % 4;
  if (r === 0 || r === 2) return "geprueft";
  if (r === 1) return "mit_hinweisen";
  if (r === 3) return "fehler";
  return "offen";
}

export function demoFachbereich(i: number): string {
  return i % 3 === 1 ? "Augenheilkunde" : "Allgemein";
}

/** Spec 03 §5.1 — Detail-Panel-Struktur (Beispielinhalte bis Anbindung an echte Pipeline) */
export function buildWireframeDetail(i: number): BatchRechnungDetail {
  if (i % 4 === 1) {
    return {
      fachbereich: "Augenheilkunde",
      positionen: [
        {
          nr: 1,
          ziffer: "1240",
          faktor: 2.3,
          betrag: 61.66,
          pill: "Sicher",
          text: "Ziffer korrekt\nFunduskopie bds., Indikation dokumentiert.",
        },
        {
          nr: 2,
          ziffer: "5855a",
          faktor: 2.3,
          betrag: 61.66,
          pill: "Prüfen",
          titel: "Analogbegründung prüfenswert",
          hinweis:
            "Die Begründung für die Analogabrechnung sollte die methodische Vergleichbarkeit explizit benennen.",
        },
        {
          nr: 3,
          fehlend: true,
          ziffer: "03221",
          betrag: 18.4,
          pill: "Pflicht fehlt",
          text: "€18,40 – fehlt als Kombination",
        },
      ],
      gesamt: 1240.5,
      gesamtNach: 1258.9,
      deltaLabel: "(+€18,40 durch Kombinationspflicht)",
    };
  }
  if (i % 4 === 3) {
    return {
      fachbereich: demoFachbereich(i),
      positionen: [
        {
          nr: 1,
          ziffer: "2000",
          faktor: 1.0,
          betrag: 12.5,
          pill: "Prüfen",
          titel: "Abrechnungsfehler",
          hinweis: "Ziffer passt nicht zur dokumentierten Leistung.",
        },
      ],
      gesamt: 2105.8,
    };
  }
  return {
    fachbereich: demoFachbereich(i),
    positionen: [
      {
        nr: 1,
        ziffer: "0150",
        faktor: 2.3,
        betrag: 45.2,
        pill: "Sicher",
        text: "Beratung – dokumentationskonform.",
      },
    ],
    gesamt: 847 + (i % 7) * 13,
  };
}

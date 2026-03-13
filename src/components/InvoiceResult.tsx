import { cn } from "@/lib/utils";
import {
  CheckIcon,
  X,
  Download,
} from "lucide-react";
import { useState, useCallback, useMemo, useEffect } from "react";

// ── Types matching pipeline output ──

interface Pruefung {
  typ: string;
  schwere: "fehler" | "warnung" | "info";
  nachricht: string;
  vorschlag?: string;
  begruendungVorschlag?: string;
  neueFaktor?: number;
  neuerBetrag?: number;
}

interface GeprueftePosition {
  nr: number;
  ziffer: string;
  bezeichnung: string;
  faktor: number;
  betrag: number;
  berechneterBetrag: number;
  status: "korrekt" | "warnung" | "fehler";
  pruefungen: Pruefung[];
  begruendung?: string;
}

interface Optimierung {
  typ: string;
  ziffer: string;
  bezeichnung: string;
  faktor: number;
  betrag: number;
  begruendung: string;
}

export interface Stammdaten {
  praxis?: { name?: string; adresse?: string; telefon?: string; email?: string; steuernummer?: string };
  patient?: { name?: string; adresse?: string; geburtsdatum?: string };
  bank?: { iban?: string; bic?: string; bankName?: string; kontoinhaber?: string };
  rechnungsnummer?: string;
  rechnungsdatum?: string;
}

export interface InvoiceResultData {
  positionen: GeprueftePosition[];
  optimierungen: Optimierung[];
  zusammenfassung: {
    gesamt: number;
    korrekt: number;
    warnungen: number;
    fehler: number;
    rechnungsSumme: number;
    korrigierteSumme: number;
    optimierungsPotenzial: number;
  };
  stammdaten?: Stammdaten;
}

// ── Unified suggestion model ──

type SuggestionDecision = "accepted" | "rejected" | "pending";

interface FlatSuggestion {
  id: string;
  kind: "korrektur" | "optimierung";
  nr?: number;
  ziffer: string;
  bezeichnung: string;
  vorschlag: string;
  vorherFaktor?: number;
  vorherBetrag?: number;
  vorherBegruendung?: string;
  nachherFaktor?: number;
  nachherBetrag?: number;
  begruendungVorschlag?: string;
  pos?: GeprueftePosition;
  pruefung?: Pruefung;
  opt?: Optimierung;
}

const FAKTOR_TOLERANZ = 0.001;
const BETRAG_TOLERANZ = 0.02;

function valuesAreEqual(
  v1: number | undefined,
  v2: number | undefined,
  tol: number,
): boolean {
  if (v1 == null && v2 == null) return true;
  if (v1 == null || v2 == null) return false;
  return Math.abs(v1 - v2) < tol;
}

/** Prüft, ob Vorher/Nachher numerisch gleich sind (keine sinnvolle Änderung). */
function suggestionHasMeaningfulNumericalChange(s: FlatSuggestion): boolean {
  if (s.kind === "optimierung") return true;
  const faktorGleich = valuesAreEqual(s.vorherFaktor, s.nachherFaktor, FAKTOR_TOLERANZ);
  const betragGleich = valuesAreEqual(s.vorherBetrag, s.nachherBetrag, BETRAG_TOLERANZ);
  return !faktorGleich || !betragGleich;
}

/** Prüft, ob ein Vorschlag tatsächlich eine Änderung vorschlägt (nicht identisch mit Rechnung). */
function isMeaningfulSuggestion(
  p: Pruefung,
  pos: GeprueftePosition,
  nachherFaktor: number,
  nachherBetrag: number,
): boolean {
  const vorherFaktor = pos.faktor;
  const vorherBetrag = pos.betrag;
  const faktorGleich = valuesAreEqual(vorherFaktor, nachherFaktor, FAKTOR_TOLERANZ);
  const betragGleich = valuesAreEqual(vorherBetrag, nachherBetrag, BETRAG_TOLERANZ);

  if (p.typ === "ausschluss") {
    const partBeforeUnd = (p.vorschlag ?? "").split(" und ")[0] || "";
    const entfernenMatch = partBeforeUnd.match(/GOÄ\s*(\d+)/);
    const entferntZiffer = entfernenMatch?.[1];
    return entferntZiffer === pos.ziffer;
  }
  return !faktorGleich || !betragGleich;
}

function buildSuggestions(data: InvoiceResultData): FlatSuggestion[] {
  const out: FlatSuggestion[] = [];
  const positionen = data?.positionen ?? [];
  const optimierungen = data?.optimierungen ?? [];
  for (const pos of positionen) {
    for (let i = 0; i < pos.pruefungen.length; i++) {
      const p = pos.pruefungen[i];
      if (p.vorschlag) {
        const nachherFaktor = p.neueFaktor ?? pos.faktor;
        const nachherBetrag = p.neuerBetrag ?? (p.typ === "betrag" ? pos.berechneterBetrag : pos.betrag);
        if (!isMeaningfulSuggestion(p, pos, nachherFaktor, nachherBetrag)) continue;
        out.push({
          id: `pos-${pos.nr}-pruef-${i}`,
          kind: "korrektur",
          nr: pos.nr,
          ziffer: pos.ziffer,
          bezeichnung: pos.bezeichnung,
          vorschlag: p.vorschlag,
          vorherFaktor: pos.faktor,
          vorherBetrag: pos.betrag,
          vorherBegruendung: pos.begruendung,
          nachherFaktor,
          nachherBetrag,
          begruendungVorschlag: p.begruendungVorschlag,
          pos,
          pruefung: p,
        });
      }
    }
  }
  for (let i = 0; i < optimierungen.length; i++) {
    const o = optimierungen[i];
    out.push({
      id: `opt-${i}`,
      kind: "optimierung",
      ziffer: o.ziffer,
      bezeichnung: o.bezeichnung,
      vorschlag: o.begruendung,
      vorherFaktor: undefined,
      vorherBetrag: undefined,
      vorherBegruendung: undefined,
      nachherFaktor: o.faktor,
      nachherBetrag: o.betrag,
      begruendungVorschlag: o.begruendung,
      opt: o,
    });
  }
  return out;
}

type PreviewRow = { nr: number; ziffer: string; bezeichnung: string; faktor: number; betrag: number; begruendung?: string; sourcePosNr?: number; sourceOptSuggestionId?: string; isPendingOpt?: boolean; pendingOptSuggestion?: FlatSuggestion };

function getSuggestionsForPreviewRow(row: PreviewRow, suggestions: FlatSuggestion[]): FlatSuggestion[] {
  if (row.isPendingOpt && row.pendingOptSuggestion) return [row.pendingOptSuggestion];
  if (row.sourcePosNr != null) return suggestions.filter((s) => s.pos?.nr === row.sourcePosNr);
  if (row.sourceOptSuggestionId) return suggestions.filter((s) => s.id === row.sourceOptSuggestionId);
  return [];
}

// ── Unified Position Card (Mobile) ──

function UnifiedPositionCard({
  row,
  suggestions,
  decisions,
  onDecision,
}: {
  row: PreviewRow;
  suggestions: FlatSuggestion[];
  decisions: Record<string, SuggestionDecision>;
  onDecision: (id: string, d: SuggestionDecision) => void;
}) {
  const anyPending = suggestions.some((s) => (decisions[s.id] ?? "pending") === "pending");
  const anyAccepted = suggestions.some((s) => decisions[s.id] === "accepted");

  return (
    <div
      className={cn(
        "rounded-lg border border-border p-3 space-y-2",
        anyPending && "bg-amber-50/50 dark:bg-amber-950/20 border-l-4 border-l-amber-400 dark:border-l-amber-500",
        anyAccepted && !anyPending && "bg-emerald-50/30 dark:bg-emerald-950/10",
      )}
    >
      <div className="flex justify-between items-start gap-2">
        <div>
          <span className="font-mono text-muted-foreground text-xs">{row.nr} · {row.ziffer}</span>
          {row.isPendingOpt && (
            <span className="ml-1 text-[10px] uppercase text-amber-600 dark:text-amber-400">+ Hinzufügen</span>
          )}
          <p className="text-sm font-medium">{row.bezeichnung}</p>
        </div>
        <div className="text-right">
          <span className="font-mono font-semibold">{row.faktor.toFixed(1).replace(".", ",")}×</span>
          <span className="font-mono font-semibold ml-1">{formatEuro(row.betrag)}</span>
        </div>
      </div>
      {row.begruendung && (
        <p className="text-xs text-muted-foreground">{row.begruendung}</p>
      )}
      {suggestions.map((s) => {
        const decision = decisions[s.id] ?? "pending";
        const isPending = decision === "pending";
        const hasVorher = s.kind === "korrektur" && (s.vorherFaktor != null || s.vorherBetrag != null);
        const hasNachher = s.nachherFaktor != null || s.nachherBetrag != null;
        const showNumericalChange = suggestionHasMeaningfulNumericalChange(s);
        return (
          <div key={s.id} className="space-y-1.5 text-xs border-t border-border/50 pt-2">
            {isPending && hasVorher && hasNachher && showNumericalChange && (
              <div className="text-muted-foreground">
                <span className="font-medium">Aktuell: </span>
                {s.vorherFaktor != null && <span className="font-mono">{s.vorherFaktor.toFixed(1).replace(".", ",")}×</span>}
                {s.vorherFaktor != null && s.vorherBetrag != null && " · "}
                {s.vorherBetrag != null && formatEuro(s.vorherBetrag)}
              </div>
            )}
            {isPending && hasNachher && showNumericalChange && (
              <div>
                <span className="font-medium text-emerald-700 dark:text-emerald-400">Vorschlag: </span>
                {s.nachherFaktor != null && <span className="font-mono font-semibold">{s.nachherFaktor.toFixed(1).replace(".", ",")}×</span>}
                {s.nachherFaktor != null && s.nachherBetrag != null && " · "}
                {s.nachherBetrag != null && <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">{formatEuro(s.nachherBetrag)}</span>}
              </div>
            )}
            {s.begruendungVorschlag && (
              <div className="p-2 rounded-md bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200/60 dark:border-emerald-800/40">
                <p className="text-[10px] uppercase font-medium text-emerald-800 dark:text-emerald-300 mb-0.5">Begründung:</p>
                <p className="leading-relaxed">{s.begruendungVorschlag}</p>
              </div>
            )}
            {isPending ? (
              <div className="flex gap-1 pt-1">
                <button
                  type="button"
                  onClick={() => onDecision(s.id, "accepted")}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  <CheckIcon className="w-3.5 h-3.5" />
                  Annehmen
                </button>
                <button
                  type="button"
                  onClick={() => onDecision(s.id, "rejected")}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-red-600 hover:bg-red-100 dark:hover:bg-red-950/50"
                >
                  <X className="w-3.5 h-3.5" />
                  Ablehnen
                </button>
              </div>
            ) : (
              <span className="text-muted-foreground text-xs">
                {decision === "accepted" ? "Angenommen" : "Abgelehnt"}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Unified Position Row (Vorschlag + Vorschau in einer Zeile) ──

function UnifiedPositionRow({
  row,
  suggestions,
  decisions,
  onDecision,
  hasBegruendungColumn,
  hasVorschlaegeColumn,
}: {
  row: PreviewRow;
  suggestions: FlatSuggestion[];
  decisions: Record<string, SuggestionDecision>;
  onDecision: (id: string, d: SuggestionDecision) => void;
  hasBegruendungColumn: boolean;
  hasVorschlaegeColumn: boolean;
}) {
  const rowSuggestions = getSuggestionsForPreviewRow(row, suggestions);
  const hasSuggestions = rowSuggestions.length > 0;
  const anyPending = rowSuggestions.some((s) => (decisions[s.id] ?? "pending") === "pending");
  const anyAccepted = rowSuggestions.some((s) => decisions[s.id] === "accepted");

  return (
    <tr
      className={cn(
        "transition-colors",
        anyPending && "bg-amber-50/50 dark:bg-amber-950/20 border-l-2 border-l-amber-400 dark:border-l-amber-500",
        anyAccepted && !anyPending && "bg-emerald-50/30 dark:bg-emerald-950/10",
        rowSuggestions.some((s) => decisions[s.id] === "rejected") && !anyPending && "opacity-75",
      )}
    >
      <td className="invoice-td text-center font-mono text-muted-foreground">{row.nr}</td>
      <td className="invoice-td font-mono font-semibold">{row.ziffer}</td>
      <td className="invoice-td">
        <div>
          {row.isPendingOpt && (
            <span className="text-[10px] uppercase font-medium text-amber-600 dark:text-amber-400 mr-1">+ Hinzufügen</span>
          )}
          {row.bezeichnung}
        </div>
      </td>
      <td className="invoice-td text-right font-mono">{row.faktor.toFixed(1).replace(".", ",")}×</td>
      <td className="invoice-td text-right font-mono">{formatEuro(row.betrag)}</td>
      {hasBegruendungColumn && (
        <td className="invoice-td text-xs text-muted-foreground max-w-[200px]">{row.begruendung ?? "—"}</td>
      )}
      {hasVorschlaegeColumn && (
      <td className="invoice-td">
        {hasSuggestions && (
          <div className="space-y-2">
            {rowSuggestions.map((s) => {
              const decision = decisions[s.id] ?? "pending";
              const isPending = decision === "pending";
              const hasVorher = s.kind === "korrektur" && (s.vorherFaktor != null || s.vorherBetrag != null);
              const hasNachher = s.nachherFaktor != null || s.nachherBetrag != null;
              const showNumericalChange = suggestionHasMeaningfulNumericalChange(s);
              return (
                <div key={s.id} className="text-xs space-y-1">
                  {isPending && hasVorher && hasNachher && showNumericalChange && (
                    <div className="text-muted-foreground line-through">
                      {s.vorherFaktor != null && `${s.vorherFaktor.toFixed(1).replace(".", ",")}× `}
                      {s.vorherBetrag != null && formatEuro(s.vorherBetrag)}
                    </div>
                  )}
                  {isPending && hasNachher && showNumericalChange && (
                    <div className="text-emerald-700 dark:text-emerald-400 font-medium">
                      {s.nachherFaktor != null && `${s.nachherFaktor.toFixed(1).replace(".", ",")}× `}
                      {s.nachherBetrag != null && formatEuro(s.nachherBetrag)}
                    </div>
                  )}
                  {s.begruendungVorschlag && (
                    <div className="p-1.5 rounded bg-emerald-50/60 dark:bg-emerald-950/20 text-[11px]">
                      {s.begruendungVorschlag}
                    </div>
                  )}
                  {isPending && (
                    <div className="flex gap-1 mt-1">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onDecision(s.id, "accepted"); }}
                        className="p-1 rounded text-emerald-600 hover:bg-emerald-100 dark:hover:bg-emerald-950/50"
                        title="Annehmen"
                      >
                        <CheckIcon className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onDecision(s.id, "rejected"); }}
                        className="p-1 rounded text-red-600 hover:bg-red-100 dark:hover:bg-red-950/50"
                        title="Ablehnen"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </td>
      )}
    </tr>
  );
}

// ── Helpers ──

function formatEuro(n: number): string {
  return n.toFixed(2).replace(".", ",") + " €";
}

// ── Main Component ──

type InvoiceResultProps = {
  data: InvoiceResultData;
  onDecisionsChange?: (decisions: Record<string, string>) => void;
  onExportSuccess?: () => void;
};

const DEFAULT_ZUSAMMENFASSUNG = {
  gesamt: 0, korrekt: 0, warnungen: 0, fehler: 0,
  rechnungsSumme: 0, korrigierteSumme: 0, optimierungsPotenzial: 0,
};

export default function InvoiceResult({ data, onDecisionsChange, onExportSuccess }: InvoiceResultProps) {
  const positionen = data?.positionen ?? [];
  const optimierungen = data?.optimierungen ?? [];
  const z = data?.zusammenfassung ?? DEFAULT_ZUSAMMENFASSUNG;
  const suggestions = useMemo(() => buildSuggestions(data), [data]);

  const [decisions, setDecisions] = useState<Record<string, SuggestionDecision>>(() => {
    const init: Record<string, SuggestionDecision> = {};
    for (const s of suggestions) init[s.id] = "pending";
    return init;
  });

  const setDecision = useCallback((id: string, decision: SuggestionDecision) => {
    setDecisions((prev) => ({ ...prev, [id]: decision }));
  }, []);

  useEffect(() => {
    onDecisionsChange?.(decisions);
  }, [decisions, onDecisionsChange]);

  const pendingCount = useMemo(
    () => suggestions.filter((s) => decisions[s.id] === "pending").length,
    [suggestions, decisions],
  );

  const acceptAll = useCallback(() => {
    setDecisions((prev) => {
      const next = { ...prev };
      for (const s of suggestions) {
        if ((next[s.id] ?? "pending") === "pending") next[s.id] = "accepted";
      }
      return next;
    });
  }, [suggestions]);

  const { previewPositions, previewSum } = useMemo(() => {
    const acceptedIds = new Set(
      suggestions.filter((s) => decisions[s.id] === "accepted").map((s) => s.id),
    );
    const positionsToRemove = new Set<number>();
    const betragOverrides = new Map<number, number>();
    const faktorOverrides = new Map<number, number>();
    const begruendungOverrides = new Map<number, string>();
    const addedOpts: { ziffer: string; bezeichnung: string; faktor: number; betrag: number; begruendung?: string; suggestionId: string }[] = [];

    for (const s of suggestions) {
      if (!acceptedIds.has(s.id)) continue;
      if (s.kind === "optimierung" && s.opt) {
        addedOpts.push({
          ziffer: s.opt.ziffer,
          bezeichnung: s.opt.bezeichnung,
          faktor: s.opt.faktor,
          betrag: s.opt.betrag,
          begruendung: s.opt.begruendung,
          suggestionId: s.id,
        });
      } else if (s.pos && s.pruefung) {
        if (s.pruefung.typ === "ausschluss") {
          positionsToRemove.add(s.pos.nr);
        } else if (s.pruefung.typ === "betrag") {
          betragOverrides.set(s.pos.nr, s.pos.berechneterBetrag);
        } else if (s.pruefung.typ === "begruendung_fehlt" && s.pruefung.begruendungVorschlag) {
          begruendungOverrides.set(s.pos.nr, s.pruefung.begruendungVorschlag);
        } else if (s.pruefung.typ === "faktor_erhoehung_empfohlen") {
          if (s.pruefung.neueFaktor != null) faktorOverrides.set(s.pos.nr, s.pruefung.neueFaktor);
          if (s.pruefung.neuerBetrag != null) betragOverrides.set(s.pos.nr, s.pruefung.neuerBetrag);
          if (s.pruefung.begruendungVorschlag) begruendungOverrides.set(s.pos.nr, s.pruefung.begruendungVorschlag);
        }
      }
    }

    const out: PreviewRow[] = [];
    let nr = 1;
    for (const pos of positionen) {
      if (positionsToRemove.has(pos.nr)) continue;
      const betrag = betragOverrides.has(pos.nr)
        ? betragOverrides.get(pos.nr)!
        : pos.betrag;
      const faktor = faktorOverrides.has(pos.nr)
        ? faktorOverrides.get(pos.nr)!
        : pos.faktor;
      const begruendung = begruendungOverrides.get(pos.nr) ?? pos.begruendung;
      out.push({
        nr: nr++,
        ziffer: pos.ziffer,
        bezeichnung: pos.bezeichnung,
        faktor,
        betrag,
        ...(begruendung && { begruendung }),
        sourcePosNr: pos.nr,
      });
    }
    for (const o of addedOpts) {
      out.push({
        nr: nr++,
        ziffer: o.ziffer,
        bezeichnung: o.bezeichnung,
        faktor: o.faktor,
        betrag: o.betrag,
        ...(o.begruendung && { begruendung: o.begruendung }),
        sourceOptSuggestionId: o.suggestionId,
      });
    }
    const sum = out.reduce((a, p) => a + p.betrag, 0);
    return { previewPositions: out, previewSum: sum };
  }, [positionen, suggestions, decisions]);

  const unifiedRows = useMemo(() => {
    const rows: PreviewRow[] = [...previewPositions];
    let nr = previewPositions.length + 1;
    for (const s of suggestions) {
      if (s.kind !== "optimierung" || !s.opt) continue;
      const decision = decisions[s.id] ?? "pending";
      if (decision !== "pending") continue;
      rows.push({
        nr: nr++,
        ziffer: s.ziffer,
        bezeichnung: s.bezeichnung,
        faktor: s.nachherFaktor ?? s.opt.faktor,
        betrag: s.nachherBetrag ?? s.opt.betrag,
        begruendung: s.opt.begruendung,
        isPendingOpt: true,
        pendingOptSuggestion: s,
      });
    }
    return rows;
  }, [previewPositions, suggestions, decisions]);

  const acceptedCount = useMemo(
    () => suggestions.filter((s) => decisions[s.id] === "accepted").length,
    [suggestions, decisions],
  );

  const handlePdfExport = useCallback(async () => {
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF();
      let y = 20;
      const margin = 14;
      const lineHeight = 5;

      const stammdaten = data.stammdaten;

      // 1. Praxis
      if (stammdaten?.praxis) {
        const p = stammdaten.praxis;
        const lines: string[] = [];
        if (p.name) lines.push(p.name);
        if (p.adresse) lines.push(p.adresse);
        if (p.telefon) lines.push(p.telefon);
        if (p.email) lines.push(p.email);
        if (p.steuernummer) lines.push(`Steuernr.: ${p.steuernummer}`);
        if (lines.length > 0) {
          doc.setFontSize(10);
          for (const line of lines) doc.text(line, margin, y), (y += lineHeight);
          y += 4;
        }
      }

      // 2. Patient
      if (stammdaten?.patient) {
        const p = stammdaten.patient;
        const lines: string[] = [];
        if (p.name) lines.push(p.name);
        if (p.adresse) lines.push(p.adresse);
        if (p.geburtsdatum) lines.push(`Geb.: ${p.geburtsdatum}`);
        if (lines.length > 0) {
          doc.setFontSize(10);
          for (const line of lines) doc.text(line, margin, y), (y += lineHeight);
          y += 4;
        }
      }

      // 3. Rechnungsnummer, Rechnungsdatum
      if (stammdaten?.rechnungsnummer || stammdaten?.rechnungsdatum) {
        doc.setFontSize(10);
        const parts: string[] = [];
        if (stammdaten.rechnungsnummer) parts.push(`Rechnungsnr.: ${stammdaten.rechnungsnummer}`);
        if (stammdaten.rechnungsdatum) parts.push(`Datum: ${stammdaten.rechnungsdatum}`);
        doc.text(parts.join("  |  "), margin, y);
        y += 8;
      }

      // 4. Tabelle: Nr | GOÄ | Bezeichnung | Faktor | Betrag | Begründung (falls vorhanden)
      const hasBegruendung = previewPositions.some((p) => p.begruendung);
      doc.setFontSize(10);
      doc.text("Nr", margin, y);
      doc.text("GOÄ", margin + 12, y);
      doc.text("Bezeichnung", margin + 28, y);
      doc.text("Faktor", margin + 130, y);
      doc.text("Betrag", margin + 155, y);
      if (hasBegruendung) doc.text("Begründung", margin + 175, y);
      y += 6;

      for (const p of previewPositions) {
        doc.text(String(p.nr), margin, y);
        doc.text(p.ziffer, margin + 12, y);
        doc.text(p.bezeichnung.length > 45 ? p.bezeichnung.slice(0, 44) + "…" : p.bezeichnung, margin + 28, y);
        doc.text(`${p.faktor.toFixed(1)}×`, margin + 130, y);
        doc.text(`${p.betrag.toFixed(2)} €`, margin + 155, y);
        if (hasBegruendung) doc.text((p.begruendung ?? "—").slice(0, 25), margin + 175, y);
        y += 5;
      }
      y += 5;

      // 5. Summe
      doc.text(`Summe: ${previewSum.toFixed(2)} €`, margin, y);
      y += 10;

      // 6. Bankverbindung
      if (stammdaten?.bank) {
        const b = stammdaten.bank;
        const lines: string[] = [];
        if (b.iban) lines.push(`IBAN: ${b.iban}`);
        if (b.bic) lines.push(`BIC: ${b.bic}`);
        if (b.bankName) lines.push(b.bankName);
        if (b.kontoinhaber) lines.push(`Kontoinhaber: ${b.kontoinhaber}`);
        if (lines.length > 0) {
          doc.setFontSize(10);
          for (const line of lines) doc.text(line, margin, y), (y += lineHeight);
        }
      }

      doc.save(`Rechnung-${new Date().toISOString().slice(0, 10)}.pdf`);
      onExportSuccess?.();
    } catch (e) {
      console.error("PDF export failed:", e);
    }
  }, [data.stammdaten, previewPositions, previewSum, onExportSuccess]);

  return (
    <div className="invoice-result space-y-6">
      {/* ── Überblick ── */}
      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground mb-3">Überblick</h2>
        <div className={cn("grid gap-2", suggestions.length > 0 ? "grid-cols-2 sm:grid-cols-5" : "grid-cols-2 sm:grid-cols-4")}>
          <SummaryCard
            label="Pos."
            value={suggestions.length > 0 ? previewPositions.length : z.gesamt}
            detail={suggestions.length > 0 && previewPositions.length !== z.gesamt ? "in Vorschau" : `${z.korrekt} korrekt`}
            variant="neutral"
          />
          <SummaryCard
            label="Warn."
            value={z.warnungen}
            variant={z.warnungen > 0 ? "warning" : "neutral"}
          />
          <SummaryCard
            label="Fehl."
            value={z.fehler}
            variant={z.fehler > 0 ? "error" : "neutral"}
          />
          {suggestions.length > 0 && (
            <SummaryCard
              label="Offen"
              value={pendingCount}
              detail={acceptedCount > 0 ? `${acceptedCount} angenommen` : undefined}
              variant={pendingCount > 0 ? "warning" : "accent"}
            />
          )}
          <BetragCard
            rechnungsSumme={z.rechnungsSumme}
            korrigierteSumme={previewSum}
            optimierungsPotenzial={z.optimierungsPotenzial}
            acceptedCount={acceptedCount}
            totalSuggestions={suggestions.length}
          />
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 mt-3 pt-3 border-t border-border text-xs text-muted-foreground">
          <span>Rechnungssumme: <strong className="text-foreground">{formatEuro(z.rechnungsSumme)}</strong></span>
          {suggestions.length > 0 && (
            <span>Vorschau-Summe: <strong className="text-emerald-600 dark:text-emerald-400">{formatEuro(previewSum)}</strong></span>
          )}
        </div>
      </section>

      {/* ── Rechnung (Vorschläge + Vorschau vereint) ── */}
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="text-sm font-semibold text-foreground">Rechnung</h2>
          <div className="flex items-center gap-2">
            {suggestions.length > 0 && pendingCount > 0 && (
              <button
                type="button"
                onClick={acceptAll}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
              >
                <CheckIcon className="w-4 h-4" />
                Alle annehmen
              </button>
            )}
            <button
              type="button"
              onClick={handlePdfExport}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-muted hover:bg-muted/80 transition-colors"
              title="Als PDF exportieren"
            >
              <Download className="w-4 h-4" />
              PDF exportieren
            </button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          {suggestions.length > 0 ? "Vorschläge direkt in der Tabelle annehmen oder ablehnen." : "Rechnungsvorschau."}
        </p>
        {/* Mobile: Cards pro Position */}
        <div className="sm:hidden space-y-2">
          {unifiedRows.map((row) => {
            const rowSuggestions = getSuggestionsForPreviewRow(row, suggestions);
            return (
              <UnifiedPositionCard
                key={row.isPendingOpt && row.pendingOptSuggestion ? row.pendingOptSuggestion.id : `row-${row.nr}-${row.ziffer}`}
                row={row}
                suggestions={rowSuggestions}
                decisions={decisions}
                onDecision={setDecision}
              />
            );
          })}
        </div>
        {/* Desktop: Einheitliche Tabelle */}
        <div className="hidden sm:block invoice-table-wrapper">
          <table className="invoice-table invoice-table-mobile">
            <thead>
              <tr>
                <th className="invoice-th text-center w-10">Nr.</th>
                <th className="invoice-th w-16">GOÄ</th>
                <th className="invoice-th">Bezeichnung</th>
                <th className="invoice-th text-right w-16">Faktor</th>
                <th className="invoice-th text-right w-20">Betrag</th>
                {unifiedRows.some((p) => p.begruendung) && (
                  <th className="invoice-th">Begründung</th>
                )}
                {suggestions.length > 0 && (
                  <th className="invoice-th w-32">Vorschläge</th>
                )}
              </tr>
            </thead>
            <tbody>
              {unifiedRows.map((row) => (
                <UnifiedPositionRow
                  key={row.isPendingOpt && row.pendingOptSuggestion ? row.pendingOptSuggestion.id : `row-${row.nr}-${row.ziffer}`}
                  row={row}
                  suggestions={suggestions}
                  decisions={decisions}
                  onDecision={setDecision}
                  hasBegruendungColumn={unifiedRows.some((p) => p.begruendung)}
                  hasVorschlaegeColumn={suggestions.length > 0}
                />
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 pt-3 border-t border-border text-sm">
          <span className="text-muted-foreground">Summe: </span>
          <strong className="text-foreground">{formatEuro(previewSum)}</strong>
        </div>
      </section>
    </div>
  );
}

// ── Betrag Card (Korrektur + Opt.) ──

function BetragCard({
  rechnungsSumme,
  korrigierteSumme,
  optimierungsPotenzial,
  acceptedCount,
  totalSuggestions,
}: {
  rechnungsSumme: number;
  korrigierteSumme: number;
  optimierungsPotenzial: number;
  acceptedCount?: number;
  totalSuggestions?: number;
}) {
  const delta = korrigierteSumme - rechnungsSumme;
  const hasKorrektur = Math.abs(delta) > 0.02;
  const hasOpt = optimierungsPotenzial > 0.01;
  const hasAccepted = (acceptedCount ?? 0) > 0 && (totalSuggestions ?? 0) > 0;

  if (hasKorrektur || hasAccepted) {
    const isReduktion = delta < 0;
    return (
      <div
        className={cn(
          "rounded-lg border p-2.5",
          isReduktion
            ? "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800"
            : "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800",
        )}
      >
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          Betrag
        </p>
        <p
          className={cn(
            "text-lg font-bold",
            isReduktion ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400",
          )}
        >
          {isReduktion ? "" : "+"}
          {formatEuro(Math.abs(delta))}
        </p>
        <p className="text-[10px] text-muted-foreground">
          {isReduktion ? "Reduktion" : hasAccepted ? "Nach Annahme" : "Korrektur"}
        </p>
      </div>
    );
  }

  if (hasOpt) {
    return (
      <div className="rounded-lg border p-2.5 bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          Betrag
        </p>
        <p className="text-lg font-bold text-emerald-700 dark:text-emerald-400">
          +{formatEuro(optimierungsPotenzial)}
        </p>
        <p className="text-[10px] text-muted-foreground">Optimierung</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border p-2.5 bg-muted/50 dark:bg-muted/30">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
        Betrag
      </p>
      <p className="text-lg font-bold text-foreground">—</p>
      <p className="text-[10px] text-muted-foreground">unverändert</p>
    </div>
  );
}

// ── Summary Card ──

function SummaryCard({
  label,
  value,
  detail,
  variant,
}: {
  label: string;
  value: number | string;
  detail?: string;
  variant: "neutral" | "warning" | "error" | "accent";
}) {
  const bgClasses = {
    neutral: "bg-muted/50 dark:bg-muted/30",
    warning: "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800",
    error: "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800",
    accent: "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800",
  }[variant];

  const valueClasses = {
    neutral: "text-foreground",
    warning: "text-amber-700 dark:text-amber-400",
    error: "text-red-700 dark:text-red-400",
    accent: "text-emerald-700 dark:text-emerald-400",
  }[variant];

  return (
    <div className={cn("rounded-lg border p-2.5", bgClasses)}>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
        {label}
      </p>
      <p className={cn("text-lg font-bold", valueClasses)}>{value}</p>
      {detail && (
        <p className="text-[10px] text-muted-foreground">{detail}</p>
      )}
    </div>
  );
}

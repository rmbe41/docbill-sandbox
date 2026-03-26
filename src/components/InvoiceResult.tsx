import { cn } from "@/lib/utils";
import { CheckIcon, X, Download } from "lucide-react";
import { generateInvoicePdf, type PdfStammdaten } from "@/lib/pdf-invoice";
import { SummaryCard } from "@/components/SummaryCard";
import { usePraxisStammdaten } from "@/hooks/usePraxisStammdaten";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useState, useCallback, useMemo, useEffect, useRef, type ReactNode } from "react";

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

export type SuggestionDecision = "accepted" | "rejected" | "pending";

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

function decisionsFromServer(
  suggestions: FlatSuggestion[],
  initial?: Record<string, string> | null,
): Record<string, SuggestionDecision> {
  const init: Record<string, SuggestionDecision> = {};
  for (const s of suggestions) {
    const raw = initial?.[s.id];
    init[s.id] =
      raw === "accepted" || raw === "rejected" || raw === "pending" ? raw : "pending";
  }
  return init;
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

/** Reine Text-/Begründungskorrektur (ohne Faktor-/Betragsänderung), z. B. fehlende GOÄ-Begründung oder Analog-Hinweis. */
function suggestionHasTextualKorrektur(s: FlatSuggestion): boolean {
  if (s.kind !== "korrektur") return false;
  const p = s.pruefung;
  if (!p || (p.typ !== "begruendung_fehlt" && p.typ !== "analog")) return false;
  return !!(p.vorschlag?.trim() || s.begruendungVorschlag?.trim());
}

const SUMMARY_TEXT_MAX = 90;

function truncateSummaryText(s: string, max = SUMMARY_TEXT_MAX): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + "…";
}

function TextualKorrekturPreview({ s }: { s: FlatSuggestion }) {
  const vor = (s.vorherBegruendung ?? "").trim() || "—";
  const nach = (s.begruendungVorschlag ?? s.vorschlag ?? "").trim();
  return (
    <div className="text-xs space-y-1 leading-snug">
      <div>
        <span className="text-[10px] uppercase text-muted-foreground font-semibold">Bisher </span>
        <span className="text-muted-foreground break-words">{vor}</span>
      </div>
      {nach ? (
        <div>
          <span className="text-[10px] uppercase text-emerald-700 dark:text-emerald-400 font-semibold">
            Vorschlag{" "}
          </span>
          <span className="text-foreground/90 break-words">{nach}</span>
        </div>
      ) : null}
    </div>
  );
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Eine Zeile der Vorschläge-Tabelle (je Prüfung pro Rechnungsposition). */
type InvoicePruefRow = {
  suggestionId: string;
  schwere: "fehler" | "warnung" | "info";
  typ: string;
  posNr: number;
  ziffer: string;
  bezeichnung: string;
  nachricht: string;
  vorschlag?: string;
};

function buildInvoicePruefRows(data: InvoiceResultData): InvoicePruefRow[] {
  const rank: Record<string, number> = { fehler: 0, warnung: 1, info: 2 };
  const out: InvoicePruefRow[] = [];
  for (const pos of data?.positionen ?? []) {
    for (let i = 0; i < pos.pruefungen.length; i++) {
      const p = pos.pruefungen[i];
      const msg = p.nachricht?.trim();
      if (!msg) continue;
      out.push({
        suggestionId: `pos-${pos.nr}-pruef-${i}`,
        schwere: p.schwere,
        typ: p.typ,
        posNr: pos.nr,
        ziffer: pos.ziffer,
        bezeichnung: pos.bezeichnung,
        nachricht: msg,
        ...(p.vorschlag?.trim() ? { vorschlag: p.vorschlag.trim() } : {}),
      });
    }
  }
  out.sort((a, b) => {
    const r = rank[a.schwere] - rank[b.schwere];
    if (r !== 0) return r;
    if (a.posNr !== b.posNr) return a.posNr - b.posNr;
    return a.suggestionId.localeCompare(b.suggestionId);
  });
  return out;
}

/** Begründungs-Box nur, wenn der Text nicht schon in der Positionszeile steht (MECE). */
function begruendungVorschlagForDisplay(
  s: FlatSuggestion,
  rowBegruendung: string | undefined,
  options?: { omitIfInDetailPanel?: boolean; row?: InvoicePruefRow },
): string | undefined {
  const v = s.begruendungVorschlag?.trim();
  if (!v) return undefined;
  if (rowBegruendung && collapseWhitespace(v) === collapseWhitespace(rowBegruendung)) {
    return undefined;
  }
  if (
    options?.omitIfInDetailPanel &&
    options.row &&
    begruendungFuerDetailPanel(options.row, s)
  ) {
    return undefined;
  }
  return s.begruendungVorschlag;
}

function textContainedInHaystack(haystack: string, needle: string): boolean {
  if (!needle.trim()) return true;
  const h = collapseWhitespace(haystack).toLowerCase();
  const n = collapseWhitespace(needle).toLowerCase();
  return h.includes(n);
}

/** Längere GOÄ-Begründung im Erläuterungs-Panel, nicht in der Hinweis-Spalte. */
function begruendungFuerDetailPanel(
  row: InvoicePruefRow,
  s: FlatSuggestion | undefined,
): string | undefined {
  const b = s?.pruefung?.begruendungVorschlag?.trim();
  if (!b) return undefined;
  if (textContainedInHaystack(row.nachricht, b)) return undefined;
  return b;
}

function einordnungFuerPruefungTyp(typ: string): string[] {
  switch (typ) {
    case "begruendung_fehlt":
      return [
        "Steigerungsgebühren über dem Regelhöchstsatz der GOÄ setzen eine nachvollziehbare, dokumentationsgestützte ärztliche Begründung voraus.",
      ];
    case "faktor_erhoehung_empfohlen":
      return [
        "Eine Anhebung bis zum Schwellen- oder Höchstfaktor soll nur erfolgen, wenn der Behandlungsablauf den Mehraufwand belegt.",
      ];
    case "hoechstsatz":
      return [
        "Gebühren oberhalb des GOÄ-Höchstfaktors erfordern eine gesonderte Vereinbarung mit dem Patienten bzw. der Patientin.",
      ];
    case "ausschluss":
      return [
        "Kombinationsverbote der GOÄ schließen eine gemeinsame Berechnung bestimmter Ziffern aus.",
      ];
    case "betrag":
      return [
        "Der Leistungsbetrag soll der GOÄ-Bewertung (Punkte, Punktwert, Faktor) entsprechen.",
      ];
    case "analog":
      return [
        "Analogziffern sind in der Abrechnung klar zu kennzeichnen.",
      ];
    case "doppelt":
      return [
        "Mehrfachabrechnung derselben Ziffer setzt eine gesonderte medizinische Indikation voraus.",
      ];
    case "schwellenwert":
      return [
        "Der Faktor liegt über dem Regelhöchstsatz; die vorliegende Begründung soll der Abrechnung inhaltlich entsprechen.",
      ];
    default:
      return [];
  }
}

function VorschlagErlaeuterungenPanel({
  rows,
  suggestionsById,
  optimierungSuggestions,
}: {
  rows: InvoicePruefRow[];
  suggestionsById: Map<string, FlatSuggestion>;
  optimierungSuggestions: FlatSuggestion[];
}) {
  const blocks: {
    key: string;
    title: string;
    handlung?: string;
    ausfuehrlicheBegruendung?: string;
    einordnung: string[];
  }[] = [];

  for (const row of rows) {
    const s = suggestionsById.get(row.suggestionId);
    const handlung = row.vorschlag?.trim();
    const einordnung = einordnungFuerPruefungTyp(row.typ);
    const ausfuehrlicheBegruendung = begruendungFuerDetailPanel(row, s);
    if (!handlung && einordnung.length === 0 && !ausfuehrlicheBegruendung) continue;
    blocks.push({
      key: row.suggestionId,
      title: `GOÄ ${row.ziffer} · Pos. ${row.posNr}`,
      ...(handlung ? { handlung } : {}),
      ...(ausfuehrlicheBegruendung ? { ausfuehrlicheBegruendung } : {}),
      einordnung,
    });
  }

  for (const s of optimierungSuggestions) {
    if (s.kind !== "optimierung" || !s.opt) continue;
    blocks.push({
      key: s.id,
      title: `GOÄ ${s.ziffer} · Zusatzposition`,
      handlung: s.opt.begruendung,
      einordnung: [
        "Ergänzungsvorschlag im Rahmen der dokumentierten Leistung; vor Abrechnung fachlich prüfen.",
      ],
    });
  }

  if (blocks.length === 0) return null;

  return (
    <section className="rounded-xl p-4 border border-border/60 bg-muted/10 dark:bg-muted/5">
      <h3 className="text-sm font-semibold text-foreground mb-3">Erläuterungen</h3>
      <div className="space-y-4">
        {blocks.map((b) => (
          <div
            key={b.key}
            className="rounded-lg border border-border/50 bg-background/40 p-3 text-xs space-y-2"
          >
            <h4 className="text-sm font-medium text-foreground">{b.title}</h4>
            {(b.handlung || b.ausfuehrlicheBegruendung) && (
              <div>
                <p className="text-[10px] uppercase text-muted-foreground font-semibold mb-0.5">
                  Erläuterung
                </p>
                <div className="space-y-2 text-foreground leading-relaxed">
                  {b.handlung && <p>{b.handlung}</p>}
                  {b.ausfuehrlicheBegruendung && <p>{b.ausfuehrlicheBegruendung}</p>}
                </div>
              </div>
            )}
            {b.einordnung.length > 0 && (
              <div>
                <p className="text-[10px] uppercase text-muted-foreground font-semibold mb-0.5">
                  Einordnung
                </p>
                <ul className="list-disc pl-4 space-y-1 text-muted-foreground leading-relaxed">
                  {b.einordnung.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
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
    if (p.schwere === "warnung") {
      return true;
    }
    const partBeforeUnd = (p.vorschlag ?? "").split(" und ")[0] || "";
    const entfernenMatch = partBeforeUnd.match(/GOÄ\s*(\d+)/);
    const entferntZiffer = entfernenMatch?.[1];
    return entferntZiffer === pos.ziffer;
  }
  if (
    (p.typ === "begruendung_fehlt" || p.typ === "analog") &&
    !!(p.vorschlag?.trim() || p.begruendungVorschlag?.trim())
  ) {
    return true;
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
        if (!isMeaningfulSuggestion(p, pos, nachherFaktor, nachherBetrag)) {
          continue;
        }
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
      vorschlag: "",
      vorherFaktor: undefined,
      vorherBetrag: undefined,
      vorherBegruendung: undefined,
      nachherFaktor: o.faktor,
      nachherBetrag: o.betrag,
      opt: o,
    });
  }
  return out;
}

type PreviewRow = {
  nr: number;
  ziffer: string;
  bezeichnung: string;
  faktor: number;
  betrag: number;
  begruendung?: string;
  sourcePosNr?: number;
  /** Pipeline-Prüfstatus der Originalposition (nicht bei reinen Zusatzpositionen). */
  pruefStatus?: GeprueftePosition["status"];
  /** Nur Ausschluss „beibehalten“-Seite, sonst keine weiteren Fehler/Warnungen außer Ausschluss-warnung. */
  ausschlussVorschlagSeite?: boolean;
  sourceOptSuggestionId?: string;
  isPendingOpt?: boolean;
  pendingOptSuggestion?: FlatSuggestion;
};

function getSuggestionsForPreviewRow(row: PreviewRow, suggestions: FlatSuggestion[]): FlatSuggestion[] {
  if (row.isPendingOpt && row.pendingOptSuggestion) return [row.pendingOptSuggestion];
  if (row.sourcePosNr != null) return suggestions.filter((s) => s.pos?.nr === row.sourcePosNr);
  if (row.sourceOptSuggestionId) return suggestions.filter((s) => s.id === row.sourceOptSuggestionId);
  return [];
}

function isAusschlussVorschlagZeile(row: Pick<InvoicePruefRow, "typ" | "schwere">): boolean {
  return row.typ === "ausschluss" && row.schwere === "warnung";
}

/** Badges in der Vorschläge-Tabelle (inkl. „Vorschlag“ bei Ausschluss-Beibehalten-Seite). */
function pruefRowBadgeClass(row: InvoicePruefRow): string {
  return cn(
    "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase whitespace-nowrap",
    row.schwere === "fehler" && "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200",
    isAusschlussVorschlagZeile(row) &&
      "bg-sky-100 text-sky-900 dark:bg-sky-950/40 dark:text-sky-200",
    (row.schwere === "warnung" || row.schwere === "info") &&
      !isAusschlussVorschlagZeile(row) &&
      "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  );
}

function pruefRowNutzerLabel(row: InvoicePruefRow): string {
  if (row.schwere === "fehler") return "Fehler";
  if (isAusschlussVorschlagZeile(row)) return "Vorschlag";
  return "Zusatz";
}

function positionStatusNutzerLabel(status: GeprueftePosition["status"]): string {
  if (status === "fehler") return "Fehler";
  if (status === "warnung") return "Zusatz";
  return "Korrekt";
}

function positionStatusBadgeClass(status: GeprueftePosition["status"]): string {
  return cn(
    "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase whitespace-nowrap",
    status === "fehler" && "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200",
    status === "warnung" && "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
    status === "korrekt" &&
      "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
  );
}

function previewRowTypDisplay(row: PreviewRow): { label: string; className: string } {
  if (row.sourceOptSuggestionId) {
    return {
      label: "Zusatz",
      className: cn(
        "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase whitespace-nowrap",
        "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
      ),
    };
  }
  if (row.ausschlussVorschlagSeite) {
    return {
      label: "Vorschlag",
      className: cn(
        "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase whitespace-nowrap",
        "bg-sky-100 text-sky-900 dark:bg-sky-950/40 dark:text-sky-200",
      ),
    };
  }
  const st = row.pruefStatus ?? "korrekt";
  return { label: positionStatusNutzerLabel(st), className: positionStatusBadgeClass(st) };
}

function PruefPreviewCell({
  row,
  s,
  decision,
}: {
  row: InvoicePruefRow;
  s: FlatSuggestion | undefined;
  decision: SuggestionDecision;
}) {
  if (s) {
    if (s.kind === "korrektur" && s.pruefung?.typ === "ausschluss") {
      if (s.pruefung.schwere === "warnung") {
        return (
          <span className="text-xs text-sky-800 dark:text-sky-200 font-medium leading-snug">
            Diese Position beibehalten; widersprüchliche GOÄ-Ziffer laut Hinweis streichen.
          </span>
        );
      }
      return (
        <span className="text-xs text-destructive font-medium">
          Position entfällt (Ausschluss)
        </span>
      );
    }
    if (
      s.kind === "korrektur" &&
      decision === "pending" &&
      suggestionHasTextualKorrektur(s) &&
      !suggestionHasMeaningfulNumericalChange(s)
    ) {
      return <TextualKorrekturPreview s={s} />;
    }
    const showNum = s.kind === "korrektur" && suggestionHasMeaningfulNumericalChange(s);
    if (
      showNum &&
      (s.vorherBetrag != null ||
        s.nachherBetrag != null ||
        (s.vorherFaktor != null && s.nachherFaktor != null))
    ) {
      return (
        <div className="text-xs space-y-0.5 tabular-nums leading-snug">
          {(s.vorherFaktor != null || s.vorherBetrag != null) && (
            <div className="text-muted-foreground line-through">
              <span className="font-medium text-foreground/80">Rechnung </span>
              {s.vorherFaktor != null && (
                <span>{s.vorherFaktor.toFixed(1).replace(".", ",")}×</span>
              )}
              {s.vorherFaktor != null && s.vorherBetrag != null && " · "}
              {s.vorherBetrag != null && formatEuro(s.vorherBetrag)}
            </div>
          )}
          {(s.nachherFaktor != null || s.nachherBetrag != null) && showNum && (
            <div className="text-emerald-700 dark:text-emerald-400 font-medium">
              <span className="text-foreground/80">Vorschau </span>
              {s.nachherFaktor != null && (
                <span>{s.nachherFaktor.toFixed(1).replace(".", ",")}×</span>
              )}
              {s.nachherFaktor != null && s.nachherBetrag != null && " · "}
              {s.nachherBetrag != null && formatEuro(s.nachherBetrag)}
            </div>
          )}
        </div>
      );
    }
    return (
      <span className="text-xs text-muted-foreground leading-snug">
        {formatSuggestionAenderungSummary(s, decision)}
      </span>
    );
  }
  if (row.vorschlag?.trim()) {
    return (
      <span className="text-xs text-muted-foreground leading-snug line-clamp-3">
        {row.vorschlag}
      </span>
    );
  }
  return <span className="text-muted-foreground text-xs">—</span>;
}

function PruefDecisionCell({
  s,
  decision,
  rowBegruendung,
  onDecision,
  pruefRow,
}: {
  s: FlatSuggestion | undefined;
  decision: SuggestionDecision;
  rowBegruendung?: string;
  onDecision: (id: string, d: SuggestionDecision) => void;
  pruefRow?: InvoicePruefRow;
}) {
  if (!s) {
    return <span className="text-xs text-muted-foreground">Kein Vorschlag</span>;
  }
  const isPending = decision === "pending";
  const begrBoxText = begruendungVorschlagForDisplay(s, rowBegruendung, {
    omitIfInDetailPanel: true,
    ...(pruefRow && { row: pruefRow }),
  });
  return (
    <div className="text-xs space-y-1 min-w-[5.5rem]">
      {begrBoxText && (
        <div className="p-1.5 rounded-md bg-emerald-50/60 dark:bg-emerald-950/20 text-[11px] leading-snug">
          {begrBoxText}
        </div>
      )}
      {isPending ? (
        <div className="flex gap-1 flex-wrap">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDecision(s.id, "accepted");
            }}
            className="inline-flex items-center gap-0.5 px-2 py-1 rounded text-[11px] font-medium bg-emerald-600 text-white hover:bg-emerald-700"
          >
            <CheckIcon className="w-3 h-3" />
            Annehmen
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDecision(s.id, "rejected");
            }}
            className="inline-flex items-center gap-0.5 px-2 py-1 rounded text-[11px] font-medium text-red-600 border border-red-200 dark:border-red-900/50 hover:bg-red-50 dark:hover:bg-red-950/40"
          >
            <X className="w-3 h-3" />
            Ablehnen
          </button>
        </div>
      ) : (
        <span className="text-muted-foreground">
          {decision === "accepted" ? "Angenommen" : "Abgelehnt"}
        </span>
      )}
    </div>
  );
}

function VorschlaegePanel({
  rows,
  suggestionsById,
  decisions,
  onDecision,
  toolbar,
  suggestionCount,
}: {
  rows: InvoicePruefRow[];
  suggestionsById: Map<string, FlatSuggestion>;
  decisions: Record<string, SuggestionDecision>;
  onDecision: (id: string, d: SuggestionDecision) => void;
  toolbar: ReactNode;
  suggestionCount: number;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h3 className="text-sm font-semibold text-foreground">Vorschläge</h3>
        <div className="flex flex-nowrap items-center gap-2 shrink-0">{toolbar}</div>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {suggestionCount > 0
            ? "Keine positionsbezogenen Prüfhinweise. Zusatzpositionen stehen in der Positionsliste unten."
            : "Keine Vorschläge zur Prüfung. Die Positionsliste unten zeigt die Vorschau."}
        </p>
      ) : (
        <>
          <div className="sm:hidden space-y-3">
            {rows.map((row) => {
              const s = suggestionsById.get(row.suggestionId);
              const dec = s ? (decisions[s.id] ?? "pending") : "pending";
              return (
                <div
                  key={row.suggestionId}
                  className={cn(
                    "rounded-lg border border-border/60 p-3 space-y-2 text-sm",
                    dec === "pending" && s && "bg-amber-50/40 dark:bg-amber-950/15",
                    dec === "accepted" && s && "bg-emerald-50/30 dark:bg-emerald-950/10",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={pruefRowBadgeClass(row)}>{pruefRowNutzerLabel(row)}</span>
                    <span className="font-mono font-semibold text-xs">GOÄ {row.ziffer}</span>
                    <span className="text-[10px] text-muted-foreground">Pos. {row.posNr}</span>
                  </div>
                  <div className="text-xs text-foreground leading-relaxed">
                    <p>{row.nachricht}</p>
                  </div>
                  <div className="pt-1 border-t border-border/50">
                    <p className="text-[10px] uppercase text-muted-foreground font-medium mb-1">Vorschau</p>
                    <PruefPreviewCell row={row} s={s} decision={dec} />
                  </div>
                  <div>
                    <p className="text-[10px] uppercase text-muted-foreground font-medium mb-1">Aufgaben</p>
                    <PruefDecisionCell
                      s={s}
                      decision={dec}
                      rowBegruendung={s?.pos?.begruendung}
                      onDecision={onDecision}
                      pruefRow={row}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="hidden sm:block invoice-table-wrapper overflow-x-auto">
            <table className="invoice-table w-full min-w-[640px]">
              <thead>
                <tr>
                  <th className="invoice-th w-[5.5rem]">Typ</th>
                  <th className="invoice-th w-16">GOÄ</th>
                  <th className="invoice-th min-w-[180px]">Hinweis</th>
                  <th className="invoice-th min-w-[140px]">Vorschau</th>
                  <th className="invoice-th min-w-[140px]">Aufgaben</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const s = suggestionsById.get(row.suggestionId);
                  const dec = s ? (decisions[s.id] ?? "pending") : "pending";
                  return (
                    <tr key={row.suggestionId}>
                      <td className="invoice-td align-top">
                        <span className={pruefRowBadgeClass(row)}>{pruefRowNutzerLabel(row)}</span>
                      </td>
                      <td className="invoice-td align-top font-mono font-semibold">{row.ziffer}</td>
                      <td className="invoice-td align-top text-xs leading-relaxed max-w-[360px]">
                        <p className="text-foreground">{row.nachricht}</p>
                      </td>
                      <td className="invoice-td align-top">
                        <PruefPreviewCell row={row} s={s} decision={dec} />
                      </td>
                      <td className="invoice-td align-top">
                        <PruefDecisionCell
                          s={s}
                          decision={dec}
                          rowBegruendung={s?.pos?.begruendung}
                          onDecision={onDecision}
                          pruefRow={row}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/** Kurzbeschreibung der Änderung je Zeile/Vorschlag (PDF/UI „Änderung“-Spalte). */
function formatSuggestionAenderungSummary(
  s: FlatSuggestion,
  decision: SuggestionDecision,
): string {
  if (decision === "rejected") return "— (Vorschlag abgelehnt)";
  if (s.kind === "optimierung") return "+ Neue Position";
  const p = s.pruefung;
  if (p?.typ === "ausschluss") {
    if (p.schwere === "warnung") {
      if (decision === "pending") return "Beibehalten · widersprüchliche Ziffer streichen (ausstehend)";
      return decision === "accepted" ? "Hinweis übernommen" : "Hinweis abgelehnt";
    }
    if (decision === "pending") return "Entfällt · von Summe ausgeschlossen (ausstehend)";
    return "Entfällt";
  }
  if (!suggestionHasMeaningfulNumericalChange(s)) {
    if (p?.typ === "begruendung_fehlt") {
      return decision === "accepted" ? "Begründung übernommen" : "Begründung ergänzen";
    }
    if (p?.typ === "analog") {
      return decision === "accepted" ? "Kennzeichnung übernommen" : "Analog-Kennzeichnung";
    }
    const v = p?.vorschlag?.trim();
    if (v) return truncateSummaryText(v);
    return "Unverändert";
  }
  const parts: string[] = [];
  if (
    s.vorherFaktor != null &&
    s.nachherFaktor != null &&
    !valuesAreEqual(s.vorherFaktor, s.nachherFaktor, FAKTOR_TOLERANZ)
  ) {
    parts.push(
      `${s.vorherFaktor.toFixed(1).replace(".", ",")} → ${s.nachherFaktor.toFixed(1).replace(".", ",")}`,
    );
  }
  if (
    s.vorherBetrag != null &&
    s.nachherBetrag != null &&
    !valuesAreEqual(s.vorherBetrag, s.nachherBetrag, BETRAG_TOLERANZ)
  ) {
    const d = s.nachherBetrag - s.vorherBetrag;
    parts.push(`${d >= 0 ? "+" : "−"}${formatEuro(Math.abs(d))}`);
  }
  return parts.join(" · ");
}

function buildExportProtocolLines(
  z: InvoiceResultData["zusammenfassung"],
  suggestions: FlatSuggestion[],
  decisions: Record<string, SuggestionDecision>,
  previewSum: number,
): string[] {
  if (suggestions.length === 0) return [];
  const lines: string[] = [
    "Dieses PDF entspricht der Vorschau in DocBill (angenommene und noch ausstehende Vorschläge; abgelehnte Vorschläge sind nicht in der Positionstabelle).",
    "",
    `Summe laut extrahierter Original-Rechnung: ${formatEuro(z.rechnungsSumme)}`,
    `Summe in diesem PDF (Vorschau): ${formatEuro(previewSum)}`,
  ];
  const delta = previewSum - z.rechnungsSumme;
  if (Math.abs(delta) > 0.02) {
    lines.push(
      `Differenz zur Original-Rechnung: ${delta >= 0 ? "+" : "−"}${formatEuro(Math.abs(delta))}`,
    );
  }
  lines.push("", "Vorschläge:");
  for (const s of suggestions) {
    const d = decisions[s.id] ?? "pending";
    const st = d === "accepted" ? "angenommen" : d === "rejected" ? "abgelehnt" : "ausstehend";
    lines.push(`• GOÄ ${s.ziffer}: ${formatSuggestionAenderungSummary(s, d)} — ${st}`);
  }
  return lines;
}

// ── Unified Position Card (Mobile) ──

function UnifiedPositionCard({
  row,
  suggestions,
  decisions,
}: {
  row: PreviewRow;
  suggestions: FlatSuggestion[];
  decisions: Record<string, SuggestionDecision>;
}) {
  const rowSuggestions = getSuggestionsForPreviewRow(row, suggestions);
  const anyPending = suggestions.some((s) => (decisions[s.id] ?? "pending") === "pending");
  const anyAccepted = suggestions.some((s) => decisions[s.id] === "accepted");
  const hasStrikeSuggestion = suggestions.some(
    (s) => s.pruefung?.typ === "ausschluss" && (decisions[s.id] ?? "pending") === "pending",
  );

  const typ = previewRowTypDisplay(row);

  return (
    <div
      className={cn(
        "rounded-lg p-3 space-y-2",
        anyPending && "bg-amber-50/50 dark:bg-amber-950/20",
        anyAccepted && !anyPending && "bg-emerald-50/30 dark:bg-emerald-950/10",
      )}
    >
      <div className={cn("flex justify-between items-start gap-2", hasStrikeSuggestion && "line-through")}>
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-0.5">
            <span className={typ.className}>{typ.label}</span>
            <span className="font-mono text-muted-foreground text-xs">{row.nr} · {row.ziffer}</span>
            {row.isPendingOpt && (
              <span className="text-[10px] uppercase text-amber-600 dark:text-amber-400">+ Hinzufügen</span>
            )}
          </div>
          <p className="text-sm font-medium">{row.bezeichnung}</p>
        </div>
        <div className="text-right">
          <span className="font-mono font-semibold">{row.faktor.toFixed(1).replace(".", ",")}×</span>
          <span className="font-mono font-semibold ml-1">{formatEuro(row.betrag)}</span>
        </div>
      </div>
      {row.begruendung && (
        <p className={cn("text-xs text-muted-foreground", hasStrikeSuggestion && "line-through")}>{row.begruendung}</p>
      )}
      {rowSuggestions.length > 0 && (
        <div className="text-xs space-y-1 rounded-md border border-border/50 bg-background/50 px-2 py-1.5">
          <p className="font-medium text-muted-foreground">Änderung</p>
          {rowSuggestions.map((s) => (
            <p key={s.id} className="text-[11px] leading-snug">
              {formatSuggestionAenderungSummary(s, decisions[s.id] ?? "pending")}
            </p>
          ))}
        </div>
      )}
      {rowSuggestions.map((s) => {
        const decision = decisions[s.id] ?? "pending";
        const isPending = decision === "pending";
        const hasVorher = s.kind === "korrektur" && (s.vorherFaktor != null || s.vorherBetrag != null);
        const hasNachher = s.nachherFaktor != null || s.nachherBetrag != null;
        const showNumericalChange = suggestionHasMeaningfulNumericalChange(s);
        return (
          <div key={s.id} className="space-y-1.5 text-xs mt-2 pt-2 first:mt-0 first:pt-0">
            {isPending && hasVorher && hasNachher && showNumericalChange && (
              <div className="text-muted-foreground line-through">
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
            {isPending && !showNumericalChange && suggestionHasTextualKorrektur(s) && (
              <TextualKorrekturPreview s={s} />
            )}
            {!isPending && (
              <span className="text-muted-foreground text-xs">
                {decision === "accepted" ? "Vorschlag angenommen" : "Vorschlag abgelehnt"}
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
  hasBegruendungColumn,
  hasAenderungColumn,
  hasVorschauZahlenColumn,
}: {
  row: PreviewRow;
  suggestions: FlatSuggestion[];
  decisions: Record<string, SuggestionDecision>;
  hasBegruendungColumn: boolean;
  hasAenderungColumn: boolean;
  hasVorschauZahlenColumn: boolean;
}) {
  const rowSuggestions = getSuggestionsForPreviewRow(row, suggestions);
  const hasSuggestions = rowSuggestions.length > 0;
  const anyPending = rowSuggestions.some((s) => (decisions[s.id] ?? "pending") === "pending");
  const anyAccepted = rowSuggestions.some((s) => decisions[s.id] === "accepted");
  const hasStrikeSuggestion = rowSuggestions.some(
    (s) => s.pruefung?.typ === "ausschluss" && (decisions[s.id] ?? "pending") === "pending",
  );
  const typ = previewRowTypDisplay(row);

  return (
    <tr
      className={cn(
        "transition-colors",
        anyPending && "bg-amber-50/50 dark:bg-amber-950/20",
        anyAccepted && !anyPending && "bg-emerald-50/30 dark:bg-emerald-950/10",
        rowSuggestions.some((s) => decisions[s.id] === "rejected") && !anyPending && "opacity-75",
      )}
    >
      <td className={cn("invoice-td text-center font-mono text-muted-foreground", hasStrikeSuggestion && "line-through")}>{row.nr}</td>
      <td className="invoice-td align-top">
        <span className={typ.className}>{typ.label}</span>
      </td>
      <td className={cn("invoice-td font-mono font-semibold", hasStrikeSuggestion && "line-through")}>{row.ziffer}</td>
      <td className="invoice-td align-top min-w-[14rem]">
        <div className={cn("break-words", hasStrikeSuggestion && "line-through")}>
          {row.isPendingOpt && (
            <span className="text-[10px] uppercase font-medium text-amber-600 dark:text-amber-400 mr-1">+ Hinzufügen</span>
          )}
          {row.bezeichnung}
        </div>
      </td>
      <td className={cn("invoice-td text-right font-mono", hasStrikeSuggestion && "line-through")}>{row.faktor.toFixed(1).replace(".", ",")}×</td>
      <td className={cn("invoice-td text-right font-mono", hasStrikeSuggestion && "line-through")}>{formatEuro(row.betrag)}</td>
      {hasBegruendungColumn && (
        <td className={cn("invoice-td text-xs text-muted-foreground max-w-[200px]", hasStrikeSuggestion && "line-through")}>{row.begruendung ?? "—"}</td>
      )}
      {hasAenderungColumn && (
        <td className="invoice-td text-xs align-top max-w-[160px]">
          {hasSuggestions ? (
            <div className="space-y-1">
              {rowSuggestions.map((s) => (
                <div key={s.id} className="leading-snug">
                  {formatSuggestionAenderungSummary(s, decisions[s.id] ?? "pending")}
                </div>
              ))}
            </div>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
      )}
      {hasVorschauZahlenColumn && (
      <td className="invoice-td align-top">
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
                  {isPending && !showNumericalChange && suggestionHasTextualKorrektur(s) && (
                    <TextualKorrekturPreview s={s} />
                  )}
                  {!isPending && (
                    <span className="text-muted-foreground">
                      {decision === "accepted" ? "Angenommen" : "Abgelehnt"}
                    </span>
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
  onDecisionsChange?: (decisions: Record<string, SuggestionDecision>) => void;
  onExportSuccess?: () => void;
  messageId?: string | null;
  initialInvoiceDecisions?: Record<string, string> | null;
  onPersistInvoiceDecisions?: (decisions: Record<string, SuggestionDecision>) => void;
};

const DEFAULT_ZUSAMMENFASSUNG = {
  gesamt: 0, korrekt: 0, warnungen: 0, fehler: 0,
  rechnungsSumme: 0, korrigierteSumme: 0, optimierungsPotenzial: 0,
};

export default function InvoiceResult({
  data,
  onDecisionsChange,
  onExportSuccess,
  messageId = null,
  initialInvoiceDecisions = null,
  onPersistInvoiceDecisions,
}: InvoiceResultProps) {
  const positionen = data?.positionen ?? [];
  const optimierungen = data?.optimierungen ?? [];
  const z = data?.zusammenfassung ?? DEFAULT_ZUSAMMENFASSUNG;
  const suggestions = useMemo(() => buildSuggestions(data), [data]);
  const invoicePruefRows = useMemo(() => buildInvoicePruefRows(data), [data]);
  const suggestionsById = useMemo(
    () => new Map(suggestions.map((s) => [s.id, s] as const)),
    [suggestions],
  );
  const optimierungSuggestions = useMemo(
    () => suggestions.filter((s) => s.kind === "optimierung"),
    [suggestions],
  );
  const hasAenderungColumn = suggestions.length > 0;
  const { praxisStammdaten } = usePraxisStammdaten();

  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [patientName, setPatientName] = useState("");
  const [patientAdresse, setPatientAdresse] = useState("");
  const [patientGeburtsdatum, setPatientGeburtsdatum] = useState("");
  const [rechnungsnummer, setRechnungsnummer] = useState(data?.stammdaten?.rechnungsnummer ?? "");
  const [rechnungsdatum, setRechnungsdatum] = useState(
    () => data?.stammdaten?.rechnungsdatum ?? new Date().toISOString().slice(0, 10)
  );
  const hasSyncedStammdaten = useRef(false);
  useEffect(() => {
    if (data?.stammdaten && !hasSyncedStammdaten.current) {
      hasSyncedStammdaten.current = true;
      if (data.stammdaten.rechnungsnummer) setRechnungsnummer(data.stammdaten.rechnungsnummer);
      if (data.stammdaten.rechnungsdatum) setRechnungsdatum(data.stammdaten.rechnungsdatum);
    }
  }, [data?.stammdaten]);

  const [decisions, setDecisions] = useState<Record<string, SuggestionDecision>>(() =>
    decisionsFromServer(suggestions, initialInvoiceDecisions),
  );

  const setDecision = useCallback((id: string, decision: SuggestionDecision) => {
    setDecisions((prev) => ({ ...prev, [id]: decision }));
  }, []);

  useEffect(() => {
    onDecisionsChange?.(decisions);
  }, [decisions, onDecisionsChange]);

  useEffect(() => {
    if (!messageId || !onPersistInvoiceDecisions) return;
    const t = window.setTimeout(() => {
      onPersistInvoiceDecisions(decisions);
    }, 450);
    return () => clearTimeout(t);
  }, [decisions, messageId, onPersistInvoiceDecisions]);

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

  const { previewPositions, previewSum, exportPositions } = useMemo(() => {
    // Preview = temporäre vorgeschlagene Wahrheit: Annahme aller → genau dieses Ergebnis
    const acceptedIds = new Set(
      suggestions.filter((s) => decisions[s.id] === "accepted").map((s) => s.id),
    );
    const pendingIds = new Set(
      suggestions.filter((s) => (decisions[s.id] ?? "pending") === "pending").map((s) => s.id),
    );
    const applyIds = new Set([...acceptedIds, ...pendingIds]);

    const positionsToRemove = new Set<number>();
    const positionsExcludedFromSum = new Set<number>();
    const betragOverrides = new Map<number, number>();
    const faktorOverrides = new Map<number, number>();
    const begruendungOverrides = new Map<number, string>();
    const addedOpts: {
      ziffer: string;
      bezeichnung: string;
      faktor: number;
      betrag: number;
      begruendung?: string;
      suggestionId: string;
      isPendingOpt?: boolean;
      pendingOptSuggestion?: FlatSuggestion;
    }[] = [];

    for (const s of suggestions) {
      if (!applyIds.has(s.id)) continue;
      const isPending = pendingIds.has(s.id);
      if (s.kind === "optimierung" && s.opt) {
        addedOpts.push({
          ziffer: s.opt.ziffer,
          bezeichnung: s.opt.bezeichnung,
          faktor: s.opt.faktor,
          betrag: s.opt.betrag,
          begruendung: s.opt.begruendung,
          suggestionId: s.id,
          ...(isPending && { isPendingOpt: true, pendingOptSuggestion: s }),
        });
      } else if (s.pos && s.pruefung) {
        if (s.pruefung.typ === "ausschluss") {
          if (isPending) {
            positionsExcludedFromSum.add(s.pos.nr);
          } else {
            positionsToRemove.add(s.pos.nr);
          }
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
      const warnPr = pos.pruefungen.filter((pr) => pr.schwere === "warnung");
      const ausschlussVorschlagSeite =
        !pos.pruefungen.some((pr) => pr.schwere === "fehler") &&
        warnPr.length > 0 &&
        warnPr.every((pr) => pr.typ === "ausschluss");
      out.push({
        nr: nr++,
        ziffer: pos.ziffer,
        bezeichnung: pos.bezeichnung,
        faktor,
        betrag,
        ...(begruendung && { begruendung }),
        sourcePosNr: pos.nr,
        pruefStatus: pos.status,
        ...(ausschlussVorschlagSeite && { ausschlussVorschlagSeite: true }),
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
        ...(o.isPendingOpt && o.pendingOptSuggestion && { isPendingOpt: true, pendingOptSuggestion: o.pendingOptSuggestion }),
      });
    }

    const sum = out.reduce((a, p) => {
      const posNr = p.sourcePosNr ?? -1;
      if (positionsExcludedFromSum.has(posNr)) return a;
      return a + p.betrag;
    }, 0);
    const exportPositions = out
      .filter((p) => !positionsExcludedFromSum.has(p.sourcePosNr ?? -1))
      .map((p, i) => ({ ...p, nr: i + 1 }));
    return { previewPositions: out, previewSum: sum, exportPositions };
  }, [positionen, suggestions, decisions]);

  const unifiedRows = useMemo(() => previewPositions, [previewPositions]);

  const acceptedCount = useMemo(
    () => suggestions.filter((s) => decisions[s.id] === "accepted").length,
    [suggestions, decisions],
  );

  const handlePdfExport = useCallback(async () => {
    try {
      const stammdaten: PdfStammdaten = {
        ...(praxisStammdaten ?? {}),
        patient:
          patientName || patientAdresse || patientGeburtsdatum
            ? {
                name: patientName || undefined,
                adresse: patientAdresse || undefined,
                geburtsdatum: patientGeburtsdatum || undefined,
              }
            : undefined,
        rechnungsnummer: rechnungsnummer || undefined,
        rechnungsdatum: rechnungsdatum || undefined,
      };
      const positions = exportPositions.map((p) => ({
        nr: p.nr,
        ziffer: p.ziffer,
        bezeichnung: p.bezeichnung,
        faktor: p.faktor,
        betrag: p.betrag,
        begruendung: p.begruendung,
      }));
      const protocolLines = buildExportProtocolLines(z, suggestions, decisions, previewSum);
      await generateInvoicePdf(positions, previewSum, stammdaten, { protocolLines });
      setExportModalOpen(false);
      onExportSuccess?.();
    } catch (e) {
      console.error("PDF export failed:", e);
    }
  }, [
    praxisStammdaten,
    patientName,
    patientAdresse,
    patientGeburtsdatum,
    rechnungsnummer,
    rechnungsdatum,
    exportPositions,
    previewSum,
    z,
    suggestions,
    decisions,
    onExportSuccess,
  ]);

  return (
    <div className="invoice-result space-y-6">
      {/* ── Überblick ── */}
      <section className="rounded-xl p-4 bg-muted/20 dark:bg-muted/10">
        <h2 className="text-sm font-semibold text-foreground mb-3">Überblick</h2>
        <div className="grid gap-2 grid-cols-2 sm:grid-cols-3">
          <SummaryCard
            label="Pos."
            value={suggestions.length > 0 ? previewPositions.length : z.gesamt}
            detail={
              suggestions.length === 0
                ? `${z.korrekt} in Ordnung`
                : [
                    previewPositions.length !== z.gesamt ? "in Vorschau" : null,
                    pendingCount > 0 ? `${pendingCount} offen` : null,
                    acceptedCount > 0 ? `${acceptedCount} angenommen` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "Vorschläge aktiv"
            }
            variant="neutral"
          />
          <PruefungOverviewSummaryCard warnungen={z.warnungen} fehler={z.fehler} />
          <BetragOverviewCard
            rechnungsSumme={z.rechnungsSumme}
            korrigierteSumme={previewSum}
            optimierungsPotenzial={z.optimierungsPotenzial}
            hasSuggestions={suggestions.length > 0}
            acceptedCount={acceptedCount}
            totalSuggestions={suggestions.length}
          />
        </div>
      </section>

      {/* ── Rechnung & Prüfung (Vorschläge, Erläuterungen, Positionsvorschau) ── */}
      <section className="rounded-xl p-4 border border-border/80 bg-muted/15 dark:bg-muted/10">
        <h2 className="text-sm font-semibold text-foreground mb-4">Rechnung & Prüfung</h2>
        <div className="space-y-6">
          <VorschlaegePanel
            rows={invoicePruefRows}
            suggestionsById={suggestionsById}
            decisions={decisions}
            onDecision={setDecision}
            suggestionCount={suggestions.length}
            toolbar={
              <>
                <button
                  type="button"
                  onClick={() => setExportModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-muted hover:bg-muted/80 transition-colors"
                  title="Als PDF exportieren"
                >
                  <Download className="w-4 h-4" />
                  PDF exportieren
                </button>
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
              </>
            }
          />

          <VorschlagErlaeuterungenPanel
            rows={invoicePruefRows}
            suggestionsById={suggestionsById}
            optimierungSuggestions={optimierungSuggestions}
          />

          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3">Rechnung</h3>
            <div className="sm:hidden space-y-2">
              {unifiedRows.map((row) => {
                const rowSuggestions = getSuggestionsForPreviewRow(row, suggestions);
                return (
                  <UnifiedPositionCard
                    key={row.isPendingOpt && row.pendingOptSuggestion ? row.pendingOptSuggestion.id : `row-${row.nr}-${row.ziffer}`}
                    row={row}
                    suggestions={rowSuggestions}
                    decisions={decisions}
                  />
                );
              })}
            </div>
            <div className="hidden sm:block invoice-table-wrapper">
              <table className="invoice-table invoice-table-mobile">
                <thead>
                  <tr>
                    <th className="invoice-th text-center w-10">Nr.</th>
                    <th className="invoice-th w-[5.5rem]">Typ</th>
                    <th className="invoice-th w-16">GOÄ-Nr</th>
                    <th className="invoice-th min-w-[14rem]">Leistung</th>
                    <th className="invoice-th text-right w-16">Faktor</th>
                    <th className="invoice-th text-right w-20">Betrag</th>
                    {unifiedRows.some((p) => p.begruendung) && (
                      <th className="invoice-th">Hinweis</th>
                    )}
                    {hasAenderungColumn && (
                      <th className="invoice-th min-w-[7rem]">Änderung</th>
                    )}
                    {suggestions.length > 0 && (
                      <th className="invoice-th w-32">Zahlen</th>
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
                      hasBegruendungColumn={unifiedRows.some((p) => p.begruendung)}
                      hasAenderungColumn={hasAenderungColumn}
                      hasVorschauZahlenColumn={suggestions.length > 0}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 pt-1 text-sm">
              <span className="text-muted-foreground">Summe: </span>
              <strong className="text-foreground">{formatEuro(previewSum)}</strong>
            </div>
          </div>
        </div>
      </section>

      <Dialog open={exportModalOpen} onOpenChange={setExportModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Rechnung als PDF exportieren</DialogTitle>
            <DialogDescription>
              Patientendaten manuell eingeben. Praxis & Bank aus Einstellungen werden übernommen.
              {(!praxisStammdaten?.praxis?.name || !praxisStammdaten?.bank?.iban) && (
                <span className="block mt-2 text-amber-600 dark:text-amber-400">
                  Praxis- und Bankdaten in den Einstellungen hinterlegen, damit die Rechnung vollständig ist.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="export-patient-name">Patient Name</Label>
              <Input
                id="export-patient-name"
                placeholder="Max Mustermann"
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="export-patient-adresse">Patient Adresse</Label>
              <Textarea
                id="export-patient-adresse"
                placeholder="Patientenstr. 1, 12345 Stadt"
                value={patientAdresse}
                onChange={(e) => setPatientAdresse(e.target.value)}
                rows={2}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="export-patient-geburtsdatum">Geburtsdatum</Label>
              <Input
                id="export-patient-geburtsdatum"
                placeholder="01.01.1980"
                value={patientGeburtsdatum}
                onChange={(e) => setPatientGeburtsdatum(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="export-rechnungsnummer">Rechnungsnummer</Label>
                <Input
                  id="export-rechnungsnummer"
                  placeholder="RE-2025-001"
                  value={rechnungsnummer}
                  onChange={(e) => setRechnungsnummer(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="export-rechnungsdatum">Rechnungsdatum</Label>
                <Input
                  id="export-rechnungsdatum"
                  type="date"
                  value={rechnungsdatum}
                  onChange={(e) => setRechnungsdatum(e.target.value)}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExportModalOpen(false)}>
              Abbrechen
            </Button>
            <Button onClick={handlePdfExport}>
              <Download className="w-4 h-4 mr-2" />
              PDF herunterladen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Überblick: Prüfung (ein SummaryCard) ──

function PruefungOverviewSummaryCard({ warnungen, fehler }: { warnungen: number; fehler: number }) {
  const total = warnungen + fehler;
  if (total === 0) {
    return <SummaryCard label="Prüfung" value="In Ordnung" variant="neutral" />;
  }
  const variant = fehler > 0 ? "error" : "warning";
  if (warnungen > 0 && fehler > 0) {
    return (
      <SummaryCard
        label="Prüfung"
        value={total}
        detail={`${warnungen} ${warnungen === 1 ? "Warnung" : "Warnungen"} · ${fehler} Fehler`}
        variant={variant}
      />
    );
  }
  if (fehler > 0) {
    return (
      <SummaryCard label="Prüfung" value={fehler} detail="Fehler" variant="error" />
    );
  }
  return (
    <SummaryCard
      label="Prüfung"
      value={warnungen}
      detail={warnungen === 1 ? "Warnung" : "Warnungen"}
      variant="warning"
    />
  );
}

// ── Überblick: Betrag (Original / Vorschau / Korrektur / Opt.) ──

function BetragOverviewCard({
  rechnungsSumme,
  korrigierteSumme,
  optimierungsPotenzial,
  hasSuggestions,
  acceptedCount,
  totalSuggestions,
}: {
  rechnungsSumme: number;
  korrigierteSumme: number;
  optimierungsPotenzial: number;
  hasSuggestions: boolean;
  acceptedCount?: number;
  totalSuggestions?: number;
}) {
  const delta = korrigierteSumme - rechnungsSumme;
  const hasKorrektur = Math.abs(delta) > 0.02;
  const hasOpt = optimierungsPotenzial > 0.01;
  const hasAccepted = (acceptedCount ?? 0) > 0 && (totalSuggestions ?? 0) > 0;

  if (hasSuggestions) {
    const isReduktion = delta < -0.02;
    const isErhoehung = delta > 0.02;
    const variant =
      isReduktion ? "error" : isErhoehung || hasAccepted ? "accent" : "neutral";
    const detailParts = [`Original ${formatEuro(rechnungsSumme)}`];
    if (hasKorrektur) {
      detailParts.push(`${isReduktion ? "−" : "+"}${formatEuro(Math.abs(delta))}`);
    }
    return (
      <SummaryCard
        label="Betrag"
        value={formatEuro(korrigierteSumme)}
        detail={detailParts.join(" · ")}
        variant={variant}
      />
    );
  }

  if (hasKorrektur || hasAccepted) {
    const isReduktion = delta < 0;
    return (
      <SummaryCard
        label="Betrag"
        value={isReduktion ? `−${formatEuro(Math.abs(delta))}` : `+${formatEuro(Math.abs(delta))}`}
        detail={isReduktion ? "Reduktion" : hasAccepted ? "Nach Annahme" : "Anpassung"}
        variant={isReduktion ? "error" : "accent"}
      />
    );
  }

  if (hasOpt) {
    return (
      <SummaryCard
        label="Betrag"
        value={`+${formatEuro(optimierungsPotenzial)}`}
        detail="Optimierungspotenzial"
        variant="accent"
      />
    );
  }

  return <SummaryCard label="Betrag" value="—" detail="unverändert" variant="neutral" />;
}

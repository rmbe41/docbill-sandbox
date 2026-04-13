import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon, ChevronDown, ChevronUp, Copy, Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { generateInvoicePdf, type PdfPosition, type PdfStammdaten } from "@/lib/pdf-invoice";
import { cn } from "@/lib/utils";
import { filterExplicitQuellenEntries } from "@/lib/quellenMetaFilter";
import type { Engine3ResultData, Engine3Position, Engine3Hinweis } from "@/lib/engine3Result";
import { usePraxisStammdaten } from "@/hooks/usePraxisStammdaten";
import { engine3ReviewRowId } from "@/lib/docbillUseCases";
import { billingRowsToTsv, downloadTextFile, type BillingExportRow } from "@/lib/export";
import type { Engine3FaktorOverridesPatch, MessageStructuredContentV1 } from "@/lib/messageStructuredContent";
import { goaeByZiffer } from "@/data/goae-catalog";
import { calculateAmountOrScaled, goaeFaktorLimits } from "@/lib/goae-validator";
import {
  buildHoechstfaktorHinweisText,
  buildSteigerungsbegruendungVorschlag,
  isFaktorUeberSchwelle,
} from "@/lib/format-goae-hinweis";

export type { Engine3ResultData } from "@/lib/engine3Result";

const HINWEISE_MAX = 8;
const TABLE_COLS = 7;
const FAKTOR_STEP = 0.1;

function applyEngine3FaktorOverride(base: Engine3Position, faktor: number): Engine3Position {
  const betrag = calculateAmountOrScaled(base.ziffer, faktor, { betrag: base.betrag, faktor: base.faktor });
  return { ...base, faktor, betrag };
}

function clampEngine3Faktor(ziffer: string, f: number): number {
  const { min, max } = goaeFaktorLimits(ziffer);
  const r = Math.round(f * 10) / 10;
  return Math.min(max, Math.max(min, r));
}

function formatFaktorDe(n: number): string {
  return String(n).replace(".", ",");
}

function parseFaktorInputString(raw: string): number | null {
  const t = raw
    .trim()
    .replace(/×/g, "")
    .replace(/\s/g, "")
    .replace(",", ".");
  if (t === "" || t === "-" || t === ".") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function Engine3FaktorControl({
  ziffer,
  faktor,
  onCommit,
}: {
  ziffer: string;
  faktor: number;
  onCommit: (value: number) => void;
}) {
  const { min: fakMin, max: fakMax } = goaeFaktorLimits(ziffer);
  const atFakMin = faktor <= fakMin + 1e-9;
  const atFakMax = faktor >= fakMax - 1e-9;
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const displayNum = draft !== null ? draft : formatFaktorDe(faktor);

  const commit = () => {
    if (draft === null) return;
    const t = draft.replace(/×/g, "").trim();
    setDraft(null);
    if (t === "") return;
    const parsed = parseFaktorInputString(t);
    if (parsed === null) return;
    onCommit(parsed);
  };

  const bump = (delta: number) => {
    setDraft(null);
    onCommit(faktor + delta);
  };

  const maxTooltip = `max. ${formatFaktorDe(fakMax)}`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="inline-flex items-center gap-1 min-w-0 cursor-default"
          onWheel={(e) => {
            e.preventDefault();
            e.stopPropagation();
            bump(e.deltaY < 0 ? FAKTOR_STEP : -FAKTOR_STEP);
          }}
        >
          <Input
            ref={inputRef}
            type="text"
            inputMode="decimal"
            aria-label="Faktor bearbeiten"
            className="h-7 w-[3.5rem] min-w-0 px-1.5 py-0 text-center font-mono tabular-nums text-xs"
            value={displayNum}
            onFocus={(e) => {
              setDraft(formatFaktorDe(faktor));
              e.currentTarget.select();
            }}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp") {
                e.preventDefault();
                bump(FAKTOR_STEP);
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                bump(-FAKTOR_STEP);
              } else if (e.key === "Enter") {
                e.preventDefault();
                commit();
                inputRef.current?.blur();
              } else if (e.key === "Escape") {
                setDraft(null);
                inputRef.current?.blur();
              }
            }}
          />
          <div className="flex flex-col justify-center shrink-0 -space-y-px">
            <button
              type="button"
              disabled={atFakMax}
              aria-label="Faktor erhöhen"
              onClick={() => bump(FAKTOR_STEP)}
              className={cn(
                "flex h-3.5 w-4 items-center justify-center rounded-t-sm text-muted-foreground/35 transition-colors",
                "hover:bg-muted/50 hover:text-muted-foreground/80",
                "disabled:pointer-events-none disabled:opacity-20",
              )}
            >
              <ChevronUp className="w-2.5 h-2.5" strokeWidth={2} />
            </button>
            <button
              type="button"
              disabled={atFakMin}
              aria-label="Faktor senken"
              onClick={() => bump(-FAKTOR_STEP)}
              className={cn(
                "flex h-3.5 w-4 items-center justify-center rounded-b-sm text-muted-foreground/35 transition-colors",
                "hover:bg-muted/50 hover:text-muted-foreground/80",
                "disabled:pointer-events-none disabled:opacity-20",
              )}
            >
              <ChevronDown className="w-2.5 h-2.5" strokeWidth={2} />
            </button>
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs font-mono tabular-nums">
        {maxTooltip}
      </TooltipContent>
    </Tooltip>
  );
}

async function copyTextToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* ignore */
  }
}

/** Abwechselnder Hintergrund pro Positionsblock (Datenzeile + ggf. Hinweiszeile). */
function positionGroupStripeClass(index: number): string {
  return index % 2 === 0 ? "bg-muted/[0.07]" : "bg-muted/[0.16]";
}

/** Hinweis-/Meta-Zeilen: keine Linien innerhalb einer Position (Trennung über Boxen + Abstand). Unten nur am Positionsende, wenn kein Folge-Block kommt. */
function trEngine3HintRowClass(hasNextGroup: boolean, isLastRowOfFragment: boolean): string {
  return isLastRowOfFragment && !hasNextGroup ? "border-b border-border/50" : "border-b-0";
}

/** Einheitliche Flächen pro Schwere/Typ (Hinweise, Faktor-Meta, Aktenboxen). */
type Engine3MessageSurface = "fehler" | "warnung" | "info" | "neutral";

function engine3MessageBoxClass(kind: Engine3MessageSurface): string {
  return cn(
    "rounded-lg border",
    kind === "fehler" &&
      "border-red-200 bg-red-50/80 dark:border-red-900/50 dark:bg-red-950/20",
    kind === "warnung" &&
      "border-amber-200 bg-amber-50/80 dark:border-amber-900/40 dark:bg-amber-950/20",
    kind === "info" && "border-border bg-muted/30",
    kind === "neutral" && "border-border/50 bg-muted/[0.11] dark:bg-muted/20",
  );
}

function engine3MessageBoxPadding(): string {
  return "px-3 py-2.5";
}

/** Innerer Copy-Paste-Block — gleiche Optik je äußerem Typ. */
function engine3CopyPasteInnerClass(kind: "fehler" | "warnung" | "neutral"): string {
  return cn(
    "rounded-md border border-solid px-2.5 py-2 text-[11px] leading-relaxed whitespace-pre-wrap select-all text-foreground",
    "bg-background/95 dark:bg-background/55",
    kind === "fehler" && "border-red-900/20 dark:border-red-300/25",
    kind === "warnung" && "border-amber-900/18 dark:border-amber-200/28",
    kind === "neutral" && "border-border/75",
  );
}

function engine3MessageSeverityTitleClass(kind: "fehler" | "warnung" | "info"): string {
  return cn(
    "text-[10px] font-semibold uppercase tracking-wide",
    kind === "fehler" && "text-red-900 dark:text-red-200",
    kind === "warnung" && "text-amber-900 dark:text-amber-200",
    kind === "info" && "text-muted-foreground",
  );
}

function engine3MessageSubLabelClass(kind: "fehler" | "warnung" | "neutral"): string {
  return cn(
    "text-[10px] font-medium uppercase tracking-wide",
    kind === "fehler" && "text-red-900/85 dark:text-red-200/90",
    kind === "warnung" && "text-amber-900/85 dark:text-amber-200/90",
    kind === "neutral" && "text-muted-foreground",
  );
}

function engine3MessageBodyClass(kind: Engine3MessageSurface): string {
  return cn(
    "text-xs leading-relaxed",
    kind === "fehler" && "text-red-950/95 dark:text-red-50",
    kind === "warnung" && "text-amber-950/95 dark:text-amber-50",
    (kind === "info" || kind === "neutral") && "text-muted-foreground",
  );
}

function engine3PositionStatusToSurface(status: Engine3Position["status"]): Engine3MessageSurface {
  if (status === "fehler") return "fehler";
  if (status === "warnung") return "warnung";
  return "neutral";
}

type Decision = "pending" | "accepted" | "rejected";

function formatEuro(n: number): string {
  return `${n.toFixed(2).replace(".", ",")} €`;
}

function statusBadgeClass(status: Engine3Position["status"]): string {
  switch (status) {
    case "fehler":
      return "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300";
    case "warnung":
      return "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200";
    case "vorschlag":
      return "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200";
    default:
      return "bg-muted text-muted-foreground";
  }
}

/** Anzeigenamen für Positions-Status (UI, nicht Rohwert aus JSON). */
function engine3PositionStatusLabel(status: Engine3Position["status"]): string {
  switch (status) {
    case "fehler":
      return "Fehler";
    case "warnung":
      return "Warnung";
    case "vorschlag":
      return "Vorschlag";
    case "korrekt":
      return "Korrekt";
    default:
      return status;
  }
}

function engine3HinweisSchwereLabel(s: Engine3Hinweis["schwere"]): string {
  switch (s) {
    case "fehler":
      return "Fehler";
    case "warnung":
      return "Warnung";
    case "info":
      return "Hinweis";
    default:
      return s;
  }
}

/** Wenn weder KI-Hinweise noch Positionsnotiz da sind: übernehmbare Entwurfsformulierung für die Akte. */
function fallbackAktennotizVorschlag(p: Engine3Position): string {
  const f = String(p.faktor).replace(".", ",");
  const euro = formatEuro(p.betrag);
  const bez = (p.bezeichnung ?? "").trim();
  return (
    `Leistung GOÄ ${p.ziffer} (${bez}) mit Faktor ${f} (Betrag ${euro}). ` +
    `Die erbrachte Leistung ist unter der dokumentierten Indikation medizinisch begründet; Umfang und zeitlicher Ablauf sind der Akte zu entnehmen. ` +
    `Bei Rückfragen des Kostenträgers Verweis auf die vorliegende Befund- und Verlaufsdokumentation.`
  );
}

/** Status-Badge nur wenn nicht korrekt (korrekt wird nicht angezeigt). */
function PositionStatusBadge({ status }: { status: Engine3Position["status"] }) {
  if (status === "korrekt") return null;
  return (
    <span className={cn("inline-block rounded px-1.5 py-0.5 text-[10px] font-medium", statusBadgeClass(status))}>
      {engine3PositionStatusLabel(status)}
    </span>
  );
}

function hinweisCardClass(h: Engine3Hinweis): string {
  const kind: Engine3MessageSurface =
    h.schwere === "fehler" ? "fehler" : h.schwere === "warnung" ? "warnung" : "info";
  return cn("list-none text-xs leading-snug", engine3MessageBoxClass(kind), engine3MessageBoxPadding());
}

function isQuelleRelevant(q: string): boolean {
  const t = q.toLowerCase();
  return t.includes("interner kontext") || t.includes("rag") || t.includes("admin") || t.includes("goä");
}

function dedupeHinweise(hinweise: Engine3Hinweis[]): Engine3Hinweis[] {
  const out: Engine3Hinweis[] = [];
  const seen = new Set<string>();
  for (const h of hinweise) {
    const key = `${h.schwere}|${h.titel}|${h.detail}|${(h.betrifftPositionen ?? []).join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
  }
  return out;
}

function rowKeyWithPrefix(prefix: string | undefined, isOpt: boolean, p: Engine3Position): string {
  return `${prefix ?? ""}${engine3ReviewRowId(isOpt, p.nr, p.ziffer)}`;
}

function initialDecisionsMap(
  data: Engine3ResultData,
  initial?: Record<string, string> | null,
  prefix?: string,
): Record<string, Decision> {
  const init: Record<string, Decision> = {};
  for (const p of data.positionen) {
    const k = rowKeyWithPrefix(prefix, false, p);
    const raw = initial?.[k];
    init[k] = raw === "accepted" || raw === "rejected" || raw === "pending" ? raw : "pending";
  }
  for (const p of data.optimierungen ?? []) {
    const k = rowKeyWithPrefix(prefix, true, p);
    const raw = initial?.[k];
    init[k] = raw === "accepted" || raw === "rejected" || raw === "pending" ? raw : "pending";
  }
  return init;
}

function positionsToPdf(rows: Engine3Position[]): PdfPosition[] {
  return rows.map((p, i) => ({
    nr: i + 1,
    ziffer: p.ziffer,
    bezeichnung: p.bezeichnung,
    faktor: p.faktor,
    betrag: p.betrag,
    begruendung: [p.begruendung, p.anmerkung].filter(Boolean).join(" · ") || undefined,
  }));
}

function toBillingRows(rows: Engine3Position[]): BillingExportRow[] {
  return rows.map((p, i) => ({
    nr: i + 1,
    ziffer: p.ziffer,
    bezeichnung: p.bezeichnung,
    faktor: p.faktor,
    betrag: p.betrag,
    quelleText: p.quelleText,
    begruendung: [p.begruendung, p.anmerkung].filter(Boolean).join(" · ") || undefined,
  }));
}

function collectKnownPositionNrs(data: Engine3ResultData): Set<number> {
  const s = new Set<number>();
  for (const p of data.positionen) s.add(p.nr);
  for (const p of data.optimierungen ?? []) s.add(p.nr);
  return s;
}

function isGlobalEngine3Hinweis(h: Engine3Hinweis, knownNrs: Set<number>): boolean {
  const b = h.betrifftPositionen;
  if (!b?.length) return true;
  return b.every((nr) => !knownNrs.has(nr));
}

type RowWithOpt = { p: Engine3Position; pBase: Engine3Position; isOpt: boolean };

type Engine3ResultProps = {
  data: Engine3ResultData;
  messageId?: string | null;
  updateMessageStructuredContent?: (
    messageId: string,
    patch: Partial<MessageStructuredContentV1>,
  ) => Promise<boolean>;
  /** Vorgefüllte Chat-Nachrichten (Export, Feedback). */
  onComposerPrompt?: (text: string) => void;
  initialEngine3Decisions?: Record<string, string> | null;
  initialEngine3FaktorOverrides?: Record<string, number> | null;
  /** Präfix für suggestionDecisions.engine3 bei mehreren Vorgängen (z. B. `case-a:`). */
  decisionKeyPrefix?: string;
};

export default function Engine3Result({
  data,
  messageId,
  updateMessageStructuredContent,
  onComposerPrompt,
  initialEngine3Decisions = null,
  initialEngine3FaktorOverrides = null,
  decisionKeyPrefix,
}: Engine3ResultProps) {
  const rowKey = useCallback(
    (isOpt: boolean, p: Engine3Position) => rowKeyWithPrefix(decisionKeyPrefix, isOpt, p),
    [decisionKeyPrefix],
  );

  const knownNrs = useMemo(() => collectKnownPositionNrs(data), [data]);
  const { praxisStammdaten } = usePraxisStammdaten();

  const [faktorOverrides, setFaktorOverrides] = useState<Record<string, number>>(() => {
    const next: Record<string, number> = {};
    for (const [k, v] of Object.entries(initialEngine3FaktorOverrides ?? {})) {
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      if (decisionKeyPrefix) {
        if (k.startsWith(decisionKeyPrefix)) next[k] = v;
      } else if (/^(pos|opt):\d+:/.test(k)) {
        next[k] = v;
      }
    }
    return next;
  });
  useEffect(() => {
    const next: Record<string, number> = {};
    for (const [k, v] of Object.entries(initialEngine3FaktorOverrides ?? {})) {
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      if (decisionKeyPrefix) {
        if (k.startsWith(decisionKeyPrefix)) next[k] = v;
      } else if (/^(pos|opt):\d+:/.test(k)) {
        next[k] = v;
      }
    }
    setFaktorOverrides(next);
  }, [data, messageId, decisionKeyPrefix, initialEngine3FaktorOverrides]);

  const allRows: RowWithOpt[] = useMemo(() => {
    const apply = (pBase: Engine3Position, isOpt: boolean) => {
      const rk = rowKeyWithPrefix(decisionKeyPrefix, isOpt, pBase);
      const o = faktorOverrides[rk];
      return o === undefined ? pBase : applyEngine3FaktorOverride(pBase, o);
    };
    return [
      ...data.positionen.map((pBase) => ({ pBase, p: apply(pBase, false), isOpt: false })),
      ...(data.optimierungen ?? []).map((pBase) => ({ pBase, p: apply(pBase, true), isOpt: true })),
    ];
  }, [data.positionen, data.optimierungen, faktorOverrides, decisionKeyPrefix]);

  const [decisions, setDecisions] = useState<Record<string, Decision>>(() =>
    initialDecisionsMap(data, initialEngine3Decisions, decisionKeyPrefix),
  );
  useEffect(() => {
    setDecisions(initialDecisionsMap(data, initialEngine3Decisions, decisionKeyPrefix));
  }, [data, messageId, initialEngine3Decisions, decisionKeyPrefix]);

  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [patientName, setPatientName] = useState("");
  const [patientAdresse, setPatientAdresse] = useState("");
  const [patientGeburtsdatum, setPatientGeburtsdatum] = useState("");
  const [rechnungsnummer, setRechnungsnummer] = useState("");
  const [rechnungsdatum, setRechnungsdatum] = useState(() => new Date().toISOString().slice(0, 10));

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectKeys, setRejectKeys] = useState<string[]>([]);
  const [rejectReason, setRejectReason] = useState("");

  const setDecision = useCallback((key: string, d: Decision) => {
    setDecisions((prev) => ({ ...prev, [key]: d }));
  }, []);

  const knownRowKeys = useMemo(
    () => allRows.map(({ p, isOpt }) => rowKey(isOpt, p)),
    [allRows, rowKey],
  );

  const persistEngine3UiState = useCallback(
    (d: Record<string, Decision>, localFaktoren: Record<string, number>) => {
      if (!messageId || !updateMessageStructuredContent) return;
      const base = initialEngine3FaktorOverrides ?? {};
      const faktorPatch: Engine3FaktorOverridesPatch = {};
      for (const rk of knownRowKeys) {
        const inLocal = Object.hasOwn(localFaktoren, rk);
        const inBase = Object.hasOwn(base, rk);
        const localVal = localFaktoren[rk];
        const baseVal = base[rk];
        if (inLocal) {
          if (!inBase || Math.abs(localVal - baseVal) > 1e-5) faktorPatch[rk] = localVal;
        } else if (inBase) {
          faktorPatch[rk] = null;
        }
      }
      void updateMessageStructuredContent(messageId, {
        suggestionDecisions: {
          engine3: Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v])),
        },
        ...(Object.keys(faktorPatch).length ? { engine3FaktorOverrides: faktorPatch } : {}),
      });
    },
    [messageId, updateMessageStructuredContent, knownRowKeys, initialEngine3FaktorOverrides],
  );

  useEffect(() => {
    if (!messageId || !updateMessageStructuredContent) return;
    const t = window.setTimeout(() => persistEngine3UiState(decisions, faktorOverrides), 450);
    return () => clearTimeout(t);
  }, [decisions, faktorOverrides, messageId, persistEngine3UiState, updateMessageStructuredContent]);

  const setFaktorForRow = useCallback((rk: string, pBase: Engine3Position, nextRaw: number) => {
    const next = clampEngine3Faktor(pBase.ziffer, nextRaw);
    setFaktorOverrides((prev) => {
      const copy = { ...prev };
      if (Math.abs(next - pBase.faktor) < 1e-5) delete copy[rk];
      else copy[rk] = next;
      return copy;
    });
  }, []);

  const acceptedRows = useMemo(
    () => allRows.filter(({ p, isOpt }) => decisions[rowKey(isOpt, p)] === "accepted"),
    [allRows, decisions, rowKey],
  );
  const pendingCount = useMemo(
    () => allRows.filter(({ p, isOpt }) => (decisions[rowKey(isOpt, p)] ?? "pending") === "pending").length,
    [allRows, decisions, rowKey],
  );

  const acceptedSum = useMemo(
    () => Math.round(acceptedRows.reduce((s, { p }) => s + p.betrag, 0) * 100) / 100,
    [acceptedRows],
  );

  const acceptAllPending = useCallback(() => {
    setDecisions((prev) => {
      const next = { ...prev };
      for (const { p, isOpt } of allRows) {
        const k = rowKey(isOpt, p);
        if (next[k] === "pending" || next[k] === undefined) next[k] = "accepted";
      }
      return next;
    });
  }, [allRows, rowKey]);

  const globalHinweise = useMemo(
    () => data.hinweise.filter((h) => isGlobalEngine3Hinweis(h, knownNrs)),
    [data.hinweise, knownNrs],
  );

  const handlePdfExport = useCallback(async () => {
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
    await generateInvoicePdf(positionsToPdf(acceptedRows.map((r) => r.p)), acceptedSum, stammdaten, {
      protocolLines: data.hinweise.slice(0, 24).map((h) => {
        const pre = h.betrifftPositionen?.length ? `Nr. ${h.betrifftPositionen.join(", ")}: ` : "";
        return `${pre}${h.schwere.toUpperCase()}: ${h.titel} — ${h.detail}`;
      }),
    });
    setExportModalOpen(false);
  }, [
    acceptedRows,
    acceptedSum,
    data.hinweise,
    patientName,
    patientAdresse,
    patientGeburtsdatum,
    rechnungsnummer,
    rechnungsdatum,
    praxisStammdaten,
  ]);

  const handleTxtExport = useCallback(() => {
    const rows = toBillingRows(acceptedRows.map((r) => r.p));
    const body = billingRowsToTsv(rows);
    const d = rechnungsdatum || new Date().toISOString().slice(0, 10);
    downloadTextFile(`docbill-positions-${d}.tsv`, body, "text/tab-separated-values;charset=utf-8");
  }, [acceptedRows, rechnungsdatum]);

  const openReject = (keys: string[]) => {
    setRejectKeys(keys);
    setRejectReason("");
    setRejectOpen(true);
  };

  const confirmReject = () => {
    const reason = rejectReason.trim() || "(kein Grund angegeben)";
    const lines = rejectKeys
      .map((k) => {
        const row = allRows.find((r) => rowKey(r.isOpt, r.p) === k);
        if (!row) return k;
        return `${row.p.nr}. GOÄ ${row.p.ziffer} — ${row.p.bezeichnung}`;
      })
      .join("\n");
    onComposerPrompt?.(
      `Ich lehne folgende Positionen aus der letzten Abrechnungsvorschau ab:\n${lines}\n\nGrund: ${reason}\n\nBitte Alternativen vorschlagen und die Liste aktualisieren.`,
    );
    setDecisions((prev) => {
      const next = { ...prev };
      for (const k of rejectKeys) next[k] = "rejected";
      return next;
    });
    setRejectOpen(false);
  };

  const title =
    data.modus === "rechnung_pruefung" ? "Rechnungspruefung" : "Abrechnungsvorschlaege";
  const { geschaetzteSumme, fehler, warnungen, anzahlPositionen } = data.zusammenfassung;
  const summaryLine = [
    `${formatEuro(geschaetzteSumme)} · ${anzahlPositionen} Position${anzahlPositionen === 1 ? "" : "en"}`,
    fehler ? `${fehler} Fehler` : null,
    warnungen ? `${warnungen} Warnungen` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const globalShown = globalHinweise.slice(0, HINWEISE_MAX);
  const globalRest = globalHinweise.length - globalShown.length;
  const quellen = filterExplicitQuellenEntries(data.quellen?.filter(Boolean) ?? []).filter(isQuelleRelevant);
  const showQuellen = quellen.length > 0;
  const primaryTopVorschlag = useMemo(() => {
    const tops = [...(data.topVorschlaege ?? [])].sort((a, b) => a.rang - b.rang);
    if (!tops.length) return null;
    return tops.find((v) => v.empfohlen) ?? tops[0];
  }, [data.topVorschlaege]);

  /** Pos. mit warnung/fehler aber ohne Begründungstext (KI soll nachliefern). */
  const autoRationaleTargets = useMemo(() => {
    const out: number[] = [];
    for (const { p } of allRows) {
      if (p.status !== "warnung" && p.status !== "fehler") continue;
      const rowHints = dedupeHinweise(data.hinweise.filter((h) => h.betrifftPositionen?.includes(p.nr)));
      const posNote = [p.begruendung, p.anmerkung].filter(Boolean).join(" · ").trim();
      if (rowHints.length > 0 || posNote.length > 0) continue;
      out.push(p.nr);
    }
    return out.sort((a, b) => a - b);
  }, [allRows, data.hinweise]);

  const autoRationaleSentRef = useRef<string>("");
  useEffect(() => {
    autoRationaleSentRef.current = "";
  }, [messageId, decisionKeyPrefix]);

  useEffect(() => {
    if (!onComposerPrompt || autoRationaleTargets.length === 0) return;
    const key = `${messageId ?? ""}:${decisionKeyPrefix ?? ""}:${autoRationaleTargets.join(",")}`;
    if (autoRationaleSentRef.current === key) return;
    autoRationaleSentRef.current = key;
    onComposerPrompt(
      `Bitte zu meiner letzten Engine-3-Tabelle für die Zeilen Pos. ${autoRationaleTargets.join(", ")} (Status warnung/fehler) **zwei bis drei fertig formulierte, direkt übernehmbare** Begründungssätze für die Patientenakte liefern (konkret zu jeder betroffenen GOÄ-Ziffer und Leistung, ohne Platzhalter).`,
    );
  }, [autoRationaleTargets, onComposerPrompt, messageId, decisionKeyPrefix]);

  const positionRowWithHints = (
    p: Engine3Position,
    pBase: Engine3Position,
    isOpt: boolean,
    rowKeyStr: string,
    groupIndex: number,
    hasNextGroup: boolean,
  ) => {
    const rk = rowKey(isOpt, p);
    const st = decisions[rk] ?? "pending";
    const stripe = positionGroupStripeClass(groupIndex);
    const cat = goaeByZiffer.get(p.ziffer);
    const hoechstFaktor = cat?.hoechstfaktor ?? 3.5;
    const ueberHoechst = p.faktor > hoechstFaktor + 1e-9;
    const showFaktorMeta = isFaktorUeberSchwelle(p.ziffer, p.faktor) || ueberHoechst;
    const steigerungText = buildSteigerungsbegruendungVorschlag({
      ziffer: p.ziffer,
      faktor: p.faktor,
      betragFormatted: formatEuro(p.betrag),
    });
    const rowHints = dedupeHinweise(
      data.hinweise
        .map((h, i) => ({ h, i }))
        .filter(({ h }) => h.betrifftPositionen?.includes(p.nr))
        .map(({ h }) => h),
    ).map((h, i) => ({ h, i }));
    const posNote = [p.begruendung, p.anmerkung].filter(Boolean).join(" · ").trim();
    const posNoteSurface = engine3PositionStatusToSurface(p.status);
    const needsAlwaysExplain = p.status === "warnung" || p.status === "fehler";
    const hasRowHints = rowHints.length > 0;
    const showVorschlagOnlyRow = !needsAlwaysExplain && !hasRowHints && p.status === "vorschlag";
    const lastTrKind: "explain" | "hints" | "vorschlag" | "faktor" | "data" = needsAlwaysExplain
      ? "explain"
      : hasRowHints
        ? "hints"
        : showVorschlagOnlyRow
          ? "vorschlag"
          : showFaktorMeta
            ? "faktor"
            : "data";
    return (
      <Fragment key={rowKeyStr}>
        {groupIndex > 0 ? (
          <tr aria-hidden className="border-0">
            <td
              colSpan={TABLE_COLS}
              className="p-0 border-b-0 border-x-0 border-t border-border/55 pt-4 bg-transparent"
            />
          </tr>
        ) : null}
        <tr
          className={cn(
            "align-top",
            lastTrKind === "data" && !hasNextGroup ? "border-b border-border/50" : "border-b-0",
            st === "rejected" && "opacity-50 line-through decoration-muted-foreground",
          )}
        >
          <td className={cn("py-2.5 pr-2 tabular-nums", stripe)}>{p.nr}</td>
          <td className={cn("py-2.5 pr-2 text-muted-foreground max-w-[200px] min-w-[100px]", stripe)}>
            {p.quelleText?.trim() ? (
              <span className="line-clamp-2" title={p.quelleText}>
                {p.quelleText}
              </span>
            ) : (
              "—"
            )}
          </td>
          <td className={cn("py-2.5 pr-2 font-mono", stripe)}>{p.ziffer}</td>
          <td className={cn("py-2.5 pr-2 max-w-[180px]", stripe)}>
            <span className="font-medium">{p.bezeichnung}</span>
          </td>
          <td className={cn("py-2.5 pr-2 align-top", stripe)}>
            <Engine3FaktorControl
              ziffer={pBase.ziffer}
              faktor={p.faktor}
              onCommit={(v) => setFaktorForRow(rk, pBase, v)}
            />
          </td>
          <td className={cn("py-2.5 pr-2 text-right whitespace-nowrap", stripe)}>{formatEuro(p.betrag)}</td>
          <td className={cn("py-2.5 pr-0 whitespace-nowrap w-[108px] min-w-[108px]", stripe)}>
            <div className="flex flex-row items-center justify-between gap-1 w-full">
              <Button
                type="button"
                variant={st === "rejected" ? "outline" : "ghost"}
                size="sm"
                className={cn(
                  "h-6 min-h-6 px-1.5 text-[10px] font-normal gap-0.5 shrink-0",
                  st === "rejected"
                    ? "border-destructive/40 text-destructive hover:bg-destructive/20"
                    : "text-muted-foreground hover:text-foreground hover:bg-destructive/15",
                )}
                onClick={() => openReject([rk])}
              >
                <X className="w-3 h-3" />
                Nein
              </Button>
              <Button
                type="button"
                variant={st === "accepted" ? "outline" : "ghost"}
                size="sm"
                className={cn(
                  "h-6 min-h-6 px-1.5 text-[10px] font-normal gap-0.5 shrink-0",
                  st === "accepted"
                    ? "border-emerald-600/35 bg-emerald-500/[0.08] text-emerald-900 dark:text-emerald-100 hover:bg-emerald-500/20"
                    : "text-muted-foreground hover:text-foreground hover:bg-emerald-500/15",
                )}
                onClick={() => setDecision(rk, "accepted")}
              >
                <CheckIcon className="w-3 h-3" />
                OK
              </Button>
            </div>
          </td>
        </tr>
        {showFaktorMeta ? (
          <tr className={trEngine3HintRowClass(hasNextGroup, lastTrKind === "faktor")}>
            <td colSpan={TABLE_COLS} className={cn("py-3 pr-2 pl-2", stripe)}>
              <div
                className={cn(
                  engine3MessageBoxClass(ueberHoechst ? "fehler" : "warnung"),
                  engine3MessageBoxPadding(),
                  "space-y-2",
                )}
              >
                {ueberHoechst ? (
                  <p className={cn("text-xs font-medium leading-snug", engine3MessageBodyClass("fehler"))}>
                    {buildHoechstfaktorHinweisText(p.ziffer, p.faktor)}
                  </p>
                ) : null}
                {isFaktorUeberSchwelle(p.ziffer, p.faktor) ? (
                  <>
                    <p className={cn("text-xs font-medium leading-snug", engine3MessageBodyClass("warnung"))}>
                      Faktor über dem Regelhöchstsatz — für die Abrechnung ist eine nachvollziehbare ärztliche Begründung
                      erforderlich.
                    </p>
                    <p className={engine3MessageSubLabelClass("warnung")}>Begründung für die Akte (copy-paste)</p>
                    <p className={engine3CopyPasteInnerClass(ueberHoechst ? "fehler" : "warnung")}>{steigerungText}</p>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="h-7 text-[11px] gap-1"
                      onClick={() => void copyTextToClipboard(steigerungText)}
                    >
                      <Copy className="w-3 h-3" />
                      Kopieren
                    </Button>
                    <p className={cn("text-[10px] leading-snug max-w-prose opacity-90", engine3MessageBodyClass("warnung"))}>
                      Konkrete Umstände (Zeitaufwand, besondere Schwierigkeit) bei Bedarf in der Akte ausformulieren; der
                      Vorschlag ist nur Rahmenformulierung.
                    </p>
                  </>
                ) : null}
              </div>
            </td>
          </tr>
        ) : null}
        {needsAlwaysExplain ? (
          <tr className={trEngine3HintRowClass(hasNextGroup, lastTrKind === "explain")}>
            <td colSpan={TABLE_COLS} className={cn("py-3 pr-2 pl-2 space-y-2.5 text-xs", stripe)}>
              <div className="flex flex-wrap items-center gap-2">
                <PositionStatusBadge status={p.status} />
              </div>
              {hasRowHints ? (
                <ul className="space-y-1.5 list-none p-0 m-0">
                  {rowHints.map(({ h, i }) => (
                    <li key={`h-inline-${i}-nr-${p.nr}`} className={hinweisCardClass(h)}>
                      <span className="font-medium text-foreground">
                        <span className="text-[10px] text-muted-foreground font-normal mr-1.5">
                          {engine3HinweisSchwereLabel(h.schwere)} ·{" "}
                        </span>
                        {h.titel}
                      </span>
                      <p className="mt-1 text-muted-foreground text-xs leading-snug">{h.detail}</p>
                    </li>
                  ))}
                </ul>
              ) : null}
              {posNote ? (
                <div
                  className={cn(
                    engine3MessageBoxClass(posNoteSurface),
                    engine3MessageBoxPadding(),
                    "whitespace-pre-wrap",
                    engine3MessageBodyClass(posNoteSurface),
                  )}
                >
                  {posNote}
                </div>
              ) : null}
              {!hasRowHints && !posNote ? (
                <div
                  className={cn(
                    engine3MessageBoxClass("warnung"),
                    engine3MessageBoxPadding(),
                    "space-y-2 mt-0.5",
                  )}
                >
                  <p className={engine3MessageSeverityTitleClass("warnung")}>Warnung</p>
                  <p className={engine3MessageBodyClass("warnung")}>
                    Es liegen keine gesonderten Begründungstexte von der KI vor. Sie können den folgenden Entwurf prüfen
                    und bei Bedarf in die Patientenakte übernehmen.
                  </p>
                  <p className={cn(engine3MessageSubLabelClass("warnung"), "pt-0.5")}>
                    Formulierungsvorschlag (copy-paste)
                  </p>
                  <p className={engine3CopyPasteInnerClass("warnung")}>{fallbackAktennotizVorschlag(p)}</p>
                </div>
              ) : null}
            </td>
          </tr>
        ) : hasRowHints ? (
          <tr className={trEngine3HintRowClass(hasNextGroup, lastTrKind === "hints")}>
            <td colSpan={TABLE_COLS} className={cn("py-2.5 pr-2 pl-2 space-y-2", stripe)}>
              {p.status !== "korrekt" ? (
                <div className="flex flex-wrap items-center gap-2">
                  <PositionStatusBadge status={p.status} />
                </div>
              ) : null}
              <ul className="space-y-2 list-none p-0 m-0">
                {rowHints.map(({ h, i }) => (
                  <li key={`h-${i}-nr-${p.nr}`} className={hinweisCardClass(h)}>
                    <span className="font-medium text-foreground">
                      <span className="text-[10px] text-muted-foreground font-normal mr-1.5">
                        {engine3HinweisSchwereLabel(h.schwere)} ·{" "}
                      </span>
                      {h.titel}
                    </span>
                    <p className="mt-1 text-muted-foreground text-xs leading-snug">{h.detail}</p>
                  </li>
                ))}
              </ul>
            </td>
          </tr>
        ) : showVorschlagOnlyRow ? (
          <tr className={trEngine3HintRowClass(hasNextGroup, lastTrKind === "vorschlag")}>
            <td colSpan={TABLE_COLS} className={cn("py-2.5 pr-2 pl-2", stripe)}>
              <div className="flex flex-wrap items-center gap-2">
                <PositionStatusBadge status={p.status} />
              </div>
            </td>
          </tr>
        ) : null}
      </Fragment>
    );
  };

  return (
    <div className="space-y-3 rounded-xl border border-border/80 bg-card/40 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary/90">{title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{summaryLine}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {acceptedRows.length} von {allRows.length} Zeilen für Export bestätigt · {pendingCount} noch offen
          </p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1"
            disabled={acceptedRows.length === 0}
            onClick={() => setExportModalOpen(true)}
          >
            <Download className="w-3.5 h-3.5" />
            PDF
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            disabled={acceptedRows.length === 0}
            onClick={() => void handleTxtExport()}
          >
            TXT
          </Button>
        </div>
      </div>

      <Dialog open={exportModalOpen} onOpenChange={setExportModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>PDF exportieren</DialogTitle>
            <DialogDescription>
              Es werden nur als „OK“ markierte Zeilen exportiert. Praxisdaten aus den Einstellungen werden übernommen.
              {(!praxisStammdaten?.praxis?.name || !praxisStammdaten?.bank?.iban) && (
                <span className="block mt-2 text-amber-600 dark:text-amber-400">
                  Praxis- und Bankdaten in den Einstellungen hinterlegen, damit die Rechnung vollständig ist.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="e3-patient-name">Patient Name</Label>
              <Input
                id="e3-patient-name"
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="e3-patient-adr">Patient Adresse</Label>
              <Textarea
                id="e3-patient-adr"
                rows={2}
                value={patientAdresse}
                onChange={(e) => setPatientAdresse(e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="e3-geb">Geburtsdatum</Label>
              <Input
                id="e3-geb"
                value={patientGeburtsdatum}
                onChange={(e) => setPatientGeburtsdatum(e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="e3-rn">Rechnungsnummer</Label>
                <Input id="e3-rn" value={rechnungsnummer} onChange={(e) => setRechnungsnummer(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="e3-rd">Rechnungsdatum</Label>
                <Input
                  id="e3-rd"
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
            <Button onClick={() => void handlePdfExport()}>
              <Download className="w-4 h-4 mr-2" />
              PDF herunterladen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Position ablehnen</DialogTitle>
            <DialogDescription>
              Grund erfassen und in den Chat übernehmen — die KI kann daraufhin Alternativen vorschlagen.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="z. B. Ziffer passt nicht zur dokumentierten Leistung …"
            rows={4}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>
              Abbrechen
            </Button>
            <Button onClick={confirmReject}>In Chat übernehmen</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {primaryTopVorschlag ? (
        <p className="text-xs text-muted-foreground border-b border-border/40 pb-2">
          <span className="font-medium text-foreground">Empfehlung: </span>
          GOÄ {primaryTopVorschlag.ziffer} · {formatEuro(primaryTopVorschlag.betrag)} · Faktor{" "}
          {String(primaryTopVorschlag.faktor).replace(".", ",")}
          <span className="block mt-0.5 line-clamp-2">{primaryTopVorschlag.bezeichnung}</span>
        </p>
      ) : null}

      <div className="overflow-x-auto">
        <p className="text-xs font-medium text-muted-foreground uppercase mb-2">Positionen</p>
        <table className="w-full text-xs border-collapse">
          <thead>
            {pendingCount > 0 ? (
              <tr className="border-b border-border/50">
                <th colSpan={6} className="p-0 border-0" aria-hidden />
                <th className="py-1.5 pr-0 text-right align-bottom font-normal min-w-[108px] w-[108px]">
                  <Button type="button" variant="secondary" size="sm" className="h-8 text-xs" onClick={acceptAllPending}>
                    Alle annehmen
                  </Button>
                </th>
              </tr>
            ) : null}
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 pr-2 w-10">Nr.</th>
              <th className="py-2 pr-2 min-w-[100px]">Quelle</th>
              <th className="py-2 pr-2">GOÄ</th>
              <th className="py-2 pr-2">Bezeichnung</th>
              <th className="py-2 pr-2">Faktor</th>
              <th className="py-2 pr-2 text-right">Betrag</th>
              <th className="py-2 pr-0 text-right min-w-[108px] w-[108px]">Aktion</th>
            </tr>
          </thead>
          <tbody>
            {allRows
              .filter(({ isOpt }) => !isOpt)
              .map(({ p, pBase, isOpt }, groupIndex, arr) =>
                positionRowWithHints(
                  p,
                  pBase,
                  isOpt,
                  `p-${p.nr}-${p.ziffer}`,
                  groupIndex,
                  groupIndex < arr.length - 1,
                ),
              )}
          </tbody>
        </table>
      </div>

      {data.optimierungen && data.optimierungen.length > 0 ? (
        <div className="overflow-x-auto">
          <p className="text-xs font-medium text-muted-foreground uppercase mb-2">Vorschläge</p>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-2 pr-2 w-10">Nr.</th>
                <th className="py-2 pr-2 min-w-[100px]">Quelle</th>
                <th className="py-2 pr-2">GOÄ</th>
                <th className="py-2 pr-2">Bezeichnung</th>
                <th className="py-2 pr-2">Faktor</th>
                <th className="py-2 pr-2 text-right">Betrag</th>
                <th className="py-2 pr-0 text-right min-w-[108px] w-[108px]">Aktion</th>
              </tr>
            </thead>
            <tbody>
              {allRows
                .filter(({ isOpt }) => isOpt)
                .map(({ p, pBase, isOpt }, groupIndex, arr) =>
                  positionRowWithHints(
                    p,
                    pBase,
                    isOpt,
                    `o-${p.nr}-${p.ziffer}`,
                    groupIndex,
                    groupIndex < arr.length - 1,
                  ),
                )}
            </tbody>
          </table>
        </div>
      ) : null}

      {globalHinweise.length > 0 ? (
        <div className="rounded-lg border border-border/70 bg-muted/10 not-prose px-3 py-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            Allgemeine Hinweise ({globalHinweise.length})
          </p>
          <ul className="space-y-2 list-none p-0 m-0">
            {globalShown.map((h, i) => (
              <li key={`global-${h.titel}-${i}`} className={hinweisCardClass(h)}>
                <span className="font-medium text-foreground text-xs">
                  <span className="text-[10px] text-muted-foreground font-normal mr-1.5">
                    {engine3HinweisSchwereLabel(h.schwere)} ·{" "}
                  </span>
                  {h.titel}
                </span>
                <p className="mt-1 text-muted-foreground text-xs leading-snug">{h.detail}</p>
              </li>
            ))}
          </ul>
          {globalRest > 0 ? (
            <p className="text-xs text-muted-foreground">… und {globalRest} weitere Hinweise</p>
          ) : null}
        </div>
      ) : null}

      {showQuellen ? (
        <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground not-prose">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Quellen</p>
          <p className="leading-relaxed">{quellen.join(" · ")}</p>
        </div>
      ) : null}
    </div>
  );
}

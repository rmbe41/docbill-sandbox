import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Lightbulb,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  CheckIcon,
  X,
} from "lucide-react";
import { useState, useCallback, useMemo } from "react";

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

function buildSuggestions(data: InvoiceResultData): FlatSuggestion[] {
  const out: FlatSuggestion[] = [];
  for (const pos of data.positionen) {
    for (let i = 0; i < pos.pruefungen.length; i++) {
      const p = pos.pruefungen[i];
      if (p.vorschlag) {
        const nachherFaktor = p.neueFaktor ?? pos.faktor;
        const nachherBetrag = p.neuerBetrag ?? (p.typ === "betrag" ? pos.berechneterBetrag : pos.betrag);
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
  for (let i = 0; i < data.optimierungen.length; i++) {
    const o = data.optimierungen[i];
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

// ── Helpers ──

function formatEuro(n: number): string {
  return n.toFixed(2).replace(".", ",") + " €";
}

function StatusBadge({ status }: { status: "korrekt" | "warnung" | "fehler" }) {
  const config = {
    korrekt: {
      icon: CheckCircle2,
      label: "Korrekt",
      classes: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400",
    },
    warnung: {
      icon: AlertTriangle,
      label: "Prüfen",
      classes: "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400",
    },
    fehler: {
      icon: XCircle,
      label: "Fehler",
      classes: "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-400",
    },
  }[status];

  const Icon = config.icon;

  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium", config.classes)}>
      <Icon className="w-3 h-3" />
      {config.label}
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      title="Vorschlag kopieren"
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? "Kopiert" : "Kopieren"}
    </button>
  );
}

// ── Suggestion Card (Mobile) ──

function SuggestionCard({
  suggestion,
  decision,
  onDecision,
}: {
  suggestion: FlatSuggestion;
  decision: SuggestionDecision;
  onDecision: (id: string, d: SuggestionDecision) => void;
}) {
  const isPending = decision === "pending";
  const hasVorher = suggestion.kind === "korrektur" && (suggestion.vorherFaktor != null || suggestion.vorherBetrag != null);
  const hasNachher = suggestion.nachherFaktor != null || suggestion.nachherBetrag != null;

  return (
    <div
      className={cn(
        "rounded-lg border border-border p-3 space-y-2",
        isPending && "bg-amber-50/50 dark:bg-amber-950/20 border-l-4 border-l-amber-400 dark:border-l-amber-500",
        decision === "accepted" && "bg-emerald-50/30 dark:bg-emerald-950/10",
        decision === "rejected" && "opacity-60",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <span className="font-mono text-muted-foreground text-xs">
            {suggestion.nr != null ? `${suggestion.nr} · ` : ""}{suggestion.ziffer}
          </span>
          <p className="text-sm font-medium truncate">{suggestion.bezeichnung}</p>
        </div>
        <span className="text-xs capitalize text-muted-foreground shrink-0">{suggestion.kind}</span>
      </div>
      <div className="space-y-1.5 text-xs">
        {hasVorher && (
          <div className="text-muted-foreground">
            <span className="font-medium">Aktuell: </span>
            {suggestion.vorherFaktor != null && (
              <span className="font-mono">{suggestion.vorherFaktor.toFixed(1).replace(".", ",")}×</span>
            )}
            {suggestion.vorherFaktor != null && suggestion.vorherBetrag != null && " · "}
            {suggestion.vorherBetrag != null && formatEuro(suggestion.vorherBetrag)}
          </div>
        )}
        {suggestion.kind === "optimierung" && (
          <div className="text-muted-foreground">— nicht abgerechnet</div>
        )}
        {hasNachher && (
          <div>
            <span className="font-medium text-emerald-700 dark:text-emerald-400">Vorschlag: </span>
            {suggestion.nachherFaktor != null && (
              <span className="font-mono font-semibold">{suggestion.nachherFaktor.toFixed(1).replace(".", ",")}×</span>
            )}
            {suggestion.nachherFaktor != null && suggestion.nachherBetrag != null && " · "}
            {suggestion.nachherBetrag != null && (
              <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                {formatEuro(suggestion.nachherBetrag)}
              </span>
            )}
          </div>
        )}
        {suggestion.begruendungVorschlag && (
          <div className="p-2 rounded bg-muted/50 dark:bg-muted/30">
            <p className="text-[10px] uppercase font-medium text-muted-foreground mb-0.5">Begründung:</p>
            <p className="leading-relaxed line-clamp-2" title={suggestion.begruendungVorschlag}>
              {suggestion.begruendungVorschlag}
            </p>
          </div>
        )}
        {!hasNachher && !suggestion.begruendungVorschlag && (
          <p className="text-muted-foreground line-clamp-2" title={suggestion.vorschlag}>
            {suggestion.vorschlag}
          </p>
        )}
      </div>
      <div className="flex items-center justify-end gap-1 pt-1 border-t border-border/50">
        {decision === "pending" ? (
          <>
            <button
              type="button"
              onClick={() => onDecision(suggestion.id, "accepted")}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
            >
              <CheckIcon className="w-3.5 h-3.5" />
              Annehmen
            </button>
            <button
              type="button"
              onClick={() => onDecision(suggestion.id, "rejected")}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-red-600 hover:bg-red-100 dark:hover:bg-red-950/50 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              Ablehnen
            </button>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">
            {decision === "accepted" ? "Angenommen" : "Abgelehnt"}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Suggestion Row (with Accept/Reject) ──

function SuggestionRow({
  suggestion,
  decision,
  onDecision,
}: {
  suggestion: FlatSuggestion;
  decision: SuggestionDecision;
  onDecision: (id: string, d: SuggestionDecision) => void;
}) {
  const isPending = decision === "pending";
  const hasVorher = suggestion.kind === "korrektur" && (suggestion.vorherFaktor != null || suggestion.vorherBetrag != null);
  const hasNachher = suggestion.nachherFaktor != null || suggestion.nachherBetrag != null;

  return (
    <tr
      className={cn(
        "transition-colors",
        isPending && "bg-amber-50/50 dark:bg-amber-950/20 border-l-2 border-l-amber-400 dark:border-l-amber-500",
        decision === "accepted" && "bg-emerald-50/30 dark:bg-emerald-950/10",
        decision === "rejected" && "opacity-60",
      )}
    >
      <td className="invoice-td text-center font-mono text-muted-foreground">
        {suggestion.nr ?? "—"}
      </td>
      <td className="invoice-td font-mono font-semibold">{suggestion.ziffer}</td>
      <td className="invoice-td">{suggestion.bezeichnung}</td>
      <td className="invoice-td">
        <span className="text-xs capitalize">{suggestion.kind}</span>
      </td>
      <td className="invoice-td text-sm">
        <div className="space-y-1">
          {hasVorher && (
            <div className="text-muted-foreground">
              <span className="text-[10px] uppercase font-medium">Aktuell:</span>
              <div className="mt-0.5">
                {suggestion.vorherFaktor != null && (
                  <span className="font-mono">{suggestion.vorherFaktor.toFixed(1).replace(".", ",")}×</span>
                )}
                {suggestion.vorherFaktor != null && suggestion.vorherBetrag != null && " · "}
                {suggestion.vorherBetrag != null && formatEuro(suggestion.vorherBetrag)}
                {suggestion.vorherBegruendung && (
                  <p className="text-xs mt-1 line-clamp-2" title={suggestion.vorherBegruendung}>
                    {suggestion.vorherBegruendung}
                  </p>
                )}
              </div>
            </div>
          )}
          {suggestion.kind === "optimierung" && (
            <div className="text-muted-foreground text-xs">— nicht abgerechnet</div>
          )}
        </div>
      </td>
      <td className="invoice-td text-sm">
        <div className="space-y-1">
          {hasNachher && (
            <div>
              <span className="text-[10px] uppercase font-medium text-emerald-700 dark:text-emerald-400">Vorschlag:</span>
              <div className="mt-0.5">
                {suggestion.nachherFaktor != null && (
                  <span className="font-mono font-semibold">{suggestion.nachherFaktor.toFixed(1).replace(".", ",")}×</span>
                )}
                {suggestion.nachherFaktor != null && suggestion.nachherBetrag != null && " · "}
                {suggestion.nachherBetrag != null && (
                  <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                    {formatEuro(suggestion.nachherBetrag)}
                  </span>
                )}
              </div>
            </div>
          )}
          {suggestion.begruendungVorschlag && (
            <div className="mt-1.5 p-2 rounded bg-muted/50 dark:bg-muted/30">
              <p className="text-[10px] uppercase font-medium text-muted-foreground mb-0.5">Begründung:</p>
              <p className="text-xs leading-relaxed line-clamp-2" title={suggestion.begruendungVorschlag}>
                {suggestion.begruendungVorschlag}
              </p>
            </div>
          )}
          {!hasNachher && !suggestion.begruendungVorschlag && (
            <p className="text-muted-foreground text-xs line-clamp-2" title={suggestion.vorschlag}>
              {suggestion.vorschlag}
            </p>
          )}
        </div>
      </td>
      <td className="invoice-td text-right">
        {decision === "pending" ? (
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onDecision(suggestion.id, "accepted"); }}
              className="p-1.5 rounded-md text-emerald-600 hover:bg-emerald-100 dark:text-emerald-400 dark:hover:bg-emerald-950/50 transition-colors"
              title="Annehmen"
            >
              <CheckIcon className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onDecision(suggestion.id, "rejected"); }}
              className="p-1.5 rounded-md text-red-600 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-950/50 transition-colors"
              title="Ablehnen"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">
            {decision === "accepted" ? "Angenommen" : "Abgelehnt"}
          </span>
        )}
      </td>
    </tr>
  );
}

// ── Position Row (expandable) ──

function PositionRow({ pos }: { pos: GeprueftePosition }) {
  const [expanded, setExpanded] = useState(
    pos.status !== "korrekt" && pos.pruefungen.length > 0,
  );
  const hasPruefungen = pos.pruefungen.length > 0;
  const betragDiff = Math.abs(pos.betrag - pos.berechneterBetrag) > 0.02;

  return (
    <>
      <tr
        className={cn(
          "group transition-colors cursor-pointer",
          pos.status === "fehler" && "bg-red-50/50 dark:bg-red-950/20",
          pos.status === "warnung" && "bg-amber-50/30 dark:bg-amber-950/10",
        )}
        onClick={() => hasPruefungen && setExpanded(!expanded)}
      >
        <td className="invoice-td text-center font-mono text-muted-foreground">
          {pos.nr}
        </td>
        <td className="invoice-td font-mono font-semibold">{pos.ziffer}</td>
        <td className="invoice-td">{pos.bezeichnung}</td>
        <td className="invoice-td text-right font-mono">{pos.faktor.toFixed(1).replace(".", ",")}×</td>
        <td className={cn("invoice-td text-right font-mono", betragDiff && "line-through text-red-500")}>
          {formatEuro(pos.betrag)}
        </td>
        {betragDiff && (
          <td className="invoice-td text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400">
            {formatEuro(pos.berechneterBetrag)}
          </td>
        )}
        {!betragDiff && <td className="invoice-td" />}
        <td className="invoice-td text-center">
          <StatusBadge status={pos.status} />
        </td>
        <td className="invoice-td text-center w-8">
          {hasPruefungen && (
            expanded
              ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
              : <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </td>
      </tr>

      {expanded && hasPruefungen && (
        <tr>
          <td colSpan={8} className="p-0">
            <div className="px-4 py-3 bg-muted/40 dark:bg-muted/20 border-t border-border/50 space-y-2">
              {pos.pruefungen.map((p, i) => (
                <div key={i} className="flex gap-2 text-xs">
                  <span className={cn(
                    "flex-shrink-0 mt-0.5",
                    p.schwere === "fehler" && "text-red-500",
                    p.schwere === "warnung" && "text-amber-500",
                    p.schwere === "info" && "text-blue-500",
                  )}>
                    {p.schwere === "fehler" ? "❌" : p.schwere === "warnung" ? "⚠️" : "ℹ️"}
                  </span>
                  <div className="flex-1 space-y-1">
                    <p className="text-foreground leading-relaxed">{p.nachricht}</p>
                    {p.vorschlag && (
                      <div className="bg-background/80 dark:bg-background/40 rounded-md p-2 border border-border/50">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-muted-foreground leading-relaxed flex-1">
                            <span className="font-semibold text-foreground">Vorschlag: </span>
                            {p.vorschlag}
                          </p>
                          <CopyButton text={p.vorschlag} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Main Component ──

export default function InvoiceResult({ data }: { data: InvoiceResultData }) {
  const { positionen, optimierungen, zusammenfassung: z } = data;
  const [optExpanded, setOptExpanded] = useState(false);

  const suggestions = useMemo(() => buildSuggestions(data), [data]);

  const [decisions, setDecisions] = useState<Record<string, SuggestionDecision>>(() => {
    const init: Record<string, SuggestionDecision> = {};
    for (const s of suggestions) init[s.id] = "pending";
    return init;
  });

  const setDecision = useCallback((id: string, decision: SuggestionDecision) => {
    setDecisions((prev) => ({ ...prev, [id]: decision }));
  }, []);

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
    const addedOpts: { ziffer: string; bezeichnung: string; faktor: number; betrag: number; begruendung?: string }[] = [];

    for (const s of suggestions) {
      if (!acceptedIds.has(s.id)) continue;
      if (s.kind === "optimierung" && s.opt) {
        addedOpts.push({
          ziffer: s.opt.ziffer,
          bezeichnung: s.opt.bezeichnung,
          faktor: s.opt.faktor,
          betrag: s.opt.betrag,
          begruendung: s.opt.begruendung,
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

    const out: { nr: number; ziffer: string; bezeichnung: string; faktor: number; betrag: number; begruendung?: string }[] = [];
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
      });
    }
    const sum = out.reduce((a, p) => a + p.betrag, 0);
    return { previewPositions: out, previewSum: sum };
  }, [positionen, suggestions, decisions]);

  const effectiveKorrigierteSumme = useMemo(() => {
    const acceptedIds = new Set(
      suggestions.filter((s) => decisions[s.id] === "accepted").map((s) => s.id),
    );
    let sum = z.rechnungsSumme;
    for (const s of suggestions) {
      if (!acceptedIds.has(s.id)) continue;
      if (s.kind === "optimierung" && s.opt) {
        sum += s.opt.betrag;
      } else if (s.pos && s.pruefung) {
        if (s.pruefung.typ === "ausschluss") {
          sum -= s.pos.betrag;
        } else if (s.pruefung.typ === "betrag") {
          sum = sum - s.pos.betrag + s.pos.berechneterBetrag;
        } else if (s.pruefung.typ === "faktor_erhoehung_empfohlen" && s.pruefung.neuerBetrag != null) {
          sum = sum - s.pos.betrag + s.pruefung.neuerBetrag;
        }
      }
    }
    return sum;
  }, [z.rechnungsSumme, suggestions, decisions]);

  const acceptedCount = useMemo(
    () => suggestions.filter((s) => decisions[s.id] === "accepted").length,
    [suggestions, decisions],
  );

  return (
    <div className="invoice-result space-y-6">
      {/* ── Überblick ── */}
      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground mb-3">Überblick</h2>
        <div className={cn("grid gap-2", suggestions.length > 0 ? "grid-cols-2 sm:grid-cols-5" : "grid-cols-2 sm:grid-cols-4")}>
          <SummaryCard
            label="Pos."
            value={z.gesamt}
            detail={`${z.korrekt} korrekt`}
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
            korrigierteSumme={effectiveKorrigierteSumme}
            optimierungsPotenzial={z.optimierungsPotenzial}
            acceptedCount={acceptedCount}
            totalSuggestions={suggestions.length}
          />
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 mt-3 pt-3 border-t border-border text-xs text-muted-foreground">
          <span>Rechnungssumme: <strong className="text-foreground">{formatEuro(z.rechnungsSumme)}</strong></span>
          {Math.abs(z.rechnungsSumme - effectiveKorrigierteSumme) > 0.02 && (
            <span>Nach Annahme: <strong className="text-emerald-600 dark:text-emerald-400">{formatEuro(effectiveKorrigierteSumme)}</strong></span>
          )}
        </div>
      </section>

      {/* ── Rechnungsvorschläge (nur wenn vorhanden) ── */}
      {suggestions.length > 0 && (
        <section className="rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <h2 className="text-sm font-semibold text-foreground">Rechnungsvorschläge</h2>
            {pendingCount > 0 && (
              <button
                type="button"
                onClick={acceptAll}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
              >
                <CheckIcon className="w-4 h-4" />
                Alle {pendingCount} Vorschläge annehmen
              </button>
            )}
          </div>
          {/* Mobile: Cards */}
          <div className="sm:hidden space-y-2">
            {suggestions.map((s) => (
              <SuggestionCard
                key={s.id}
                suggestion={s}
                decision={decisions[s.id] ?? "pending"}
                onDecision={setDecision}
              />
            ))}
          </div>
          {/* Desktop: Table with optimized column widths */}
          <div className="hidden sm:block invoice-table-wrapper">
            <table className="invoice-table invoice-table-mobile invoice-table-suggestions" style={{ tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: "4%" }} />
                <col style={{ width: "6%" }} />
                <col style={{ width: "14%" }} />
                <col style={{ width: "6%" }} />
                <col style={{ width: "18%" }} />
                <col style={{ width: "42%" }} />
                <col style={{ width: "10%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th className="invoice-th text-center">Nr.</th>
                  <th className="invoice-th">GOÄ</th>
                  <th className="invoice-th">Bezeichnung</th>
                  <th className="invoice-th">Art</th>
                  <th className="invoice-th">Aktuell</th>
                  <th className="invoice-th">Vorschlag</th>
                  <th className="invoice-th text-right">Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {suggestions.map((s) => (
                  <SuggestionRow
                    key={s.id}
                    suggestion={s}
                    decision={decisions[s.id] ?? "pending"}
                    onDecision={setDecision}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Rechnungsvorschau ── */}
      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground mb-3">Rechnungsvorschau</h2>
        <p className="text-xs text-muted-foreground mb-3">
          So würde die Rechnung nach Annahme der Vorschläge aussehen.
        </p>
        <div className="invoice-table-wrapper">
          <table className="invoice-table invoice-table-mobile">
            <thead>
              <tr>
                <th className="invoice-th text-center w-10">Nr.</th>
                <th className="invoice-th w-16">GOÄ</th>
                <th className="invoice-th">Bezeichnung</th>
                <th className="invoice-th text-right w-16">Faktor</th>
                <th className="invoice-th text-right w-20">Betrag</th>
                {previewPositions.some((p) => p.begruendung) && (
                  <th className="invoice-th">Begründung</th>
                )}
              </tr>
            </thead>
            <tbody>
              {previewPositions.map((p) => (
                <tr key={p.nr} className="transition-colors">
                  <td className="invoice-td text-center font-mono text-muted-foreground">{p.nr}</td>
                  <td className="invoice-td font-mono font-semibold">{p.ziffer}</td>
                  <td className="invoice-td">{p.bezeichnung}</td>
                  <td className="invoice-td text-right font-mono">{p.faktor.toFixed(1).replace(".", ",")}×</td>
                  <td className="invoice-td text-right font-mono">{formatEuro(p.betrag)}</td>
                  {previewPositions.some((x) => x.begruendung) && (
                    <td className="invoice-td text-xs text-muted-foreground max-w-[200px]">
                      {p.begruendung ?? "—"}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 pt-3 border-t border-border text-sm">
          <span className="text-muted-foreground">Summe: </span>
          <strong className="text-foreground">{formatEuro(previewSum)}</strong>
        </div>
      </section>

      {/* ── Geprüfte Positionen ── */}
      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground mb-3">Geprüfte Positionen</h2>
        <div className="invoice-table-wrapper">
          <table className="invoice-table invoice-table-mobile">
            <thead>
              <tr>
                <th className="invoice-th text-center w-10">Nr.</th>
                <th className="invoice-th w-16">GOÄ</th>
                <th className="invoice-th">Bezeichnung</th>
                <th className="invoice-th text-right w-16">Faktor</th>
                <th className="invoice-th text-right w-20">Betrag</th>
                <th className="invoice-th text-right w-20">Korrektur</th>
                <th className="invoice-th text-center w-20">Status</th>
                <th className="invoice-th w-8" />
              </tr>
            </thead>
            <tbody>
              {positionen.map((pos) => (
                <PositionRow key={pos.nr} pos={pos} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Optimierungspotenzial (einklappbar) ── */}
      {optimierungen.length > 0 && (
        <section className="rounded-xl border border-border bg-card overflow-hidden">
          <button
            type="button"
            onClick={() => setOptExpanded(!optExpanded)}
            className="flex items-center justify-between w-full p-4 text-left hover:bg-muted/30 transition-colors"
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Lightbulb className="w-4 h-4 text-amber-500" />
              Optimierungspotenzial ({optimierungen.length})
            </span>
            {optExpanded ? (
              <ChevronUp className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            )}
          </button>
          {optExpanded && (
            <div className="px-4 pb-4 pt-0">
              {/* Mobile: Cards */}
              <div className="sm:hidden space-y-2">
                {optimierungen.map((opt, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-border bg-muted/30 p-3 space-y-1"
                  >
                    <div className="flex justify-between items-start gap-2">
                      <span className="font-mono font-semibold">{opt.ziffer}</span>
                      <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                        +{formatEuro(opt.betrag)}
                      </span>
                    </div>
                    <p className="text-sm text-foreground">{opt.bezeichnung}</p>
                    <p className="text-xs text-muted-foreground">{opt.begruendung}</p>
                    <p className="text-xs font-mono text-muted-foreground">{opt.faktor.toFixed(1).replace(".", ",")}×</p>
                  </div>
                ))}
              </div>
              {/* Desktop: Tabelle */}
              <div className="hidden sm:block invoice-table-wrapper">
                <table className="invoice-table">
                  <thead>
                    <tr>
                      <th className="invoice-th w-16">GOÄ</th>
                      <th className="invoice-th">Bezeichnung</th>
                      <th className="invoice-th text-right w-16">Faktor</th>
                      <th className="invoice-th text-right w-20">Potenzial</th>
                      <th className="invoice-th">Begründung</th>
                    </tr>
                  </thead>
                  <tbody>
                    {optimierungen.map((opt, i) => (
                      <tr key={i}>
                        <td className="invoice-td font-mono font-semibold">{opt.ziffer}</td>
                        <td className="invoice-td">{opt.bezeichnung}</td>
                        <td className="invoice-td text-right font-mono">{opt.faktor.toFixed(1).replace(".", ",")}×</td>
                        <td className="invoice-td text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                          +{formatEuro(opt.betrag)}
                        </td>
                        <td className="invoice-td text-muted-foreground text-xs">{opt.begruendung}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}
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

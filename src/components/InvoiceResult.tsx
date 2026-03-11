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
} from "lucide-react";
import { useState, useCallback } from "react";

// ── Types matching pipeline output ──

interface Pruefung {
  typ: string;
  schwere: "fehler" | "warnung" | "info";
  nachricht: string;
  vorschlag?: string;
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

  return (
    <div className="invoice-result space-y-6">
      {/* ── Überblick ── */}
      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground mb-3">Überblick</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
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
          <BetragCard
            rechnungsSumme={z.rechnungsSumme}
            korrigierteSumme={z.korrigierteSumme}
            optimierungsPotenzial={z.optimierungsPotenzial}
          />
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 mt-3 pt-3 border-t border-border text-xs text-muted-foreground">
          <span>Rechnungssumme: <strong className="text-foreground">{formatEuro(z.rechnungsSumme)}</strong></span>
          {Math.abs(z.rechnungsSumme - z.korrigierteSumme) > 0.02 && (
            <span>Korrigiert: <strong className="text-emerald-600 dark:text-emerald-400">{formatEuro(z.korrigierteSumme)}</strong></span>
          )}
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
}: {
  rechnungsSumme: number;
  korrigierteSumme: number;
  optimierungsPotenzial: number;
}) {
  const delta = korrigierteSumme - rechnungsSumme;
  const hasKorrektur = Math.abs(delta) > 0.02;
  const hasOpt = optimierungsPotenzial > 0.01;

  if (hasKorrektur) {
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
          {isReduktion ? "Reduktion" : "Korrektur"}
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

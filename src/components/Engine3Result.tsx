import { Fragment, useCallback, useMemo } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generateInvoicePdf, type PdfPosition } from "@/lib/pdf-invoice";
import { cn } from "@/lib/utils";
import { filterExplicitQuellenEntries } from "@/lib/quellenMetaFilter";
import type { Engine3ResultData, Engine3Position, Engine3Hinweis } from "@/lib/engine3Result";

export type { Engine3ResultData } from "@/lib/engine3Result";

const HINWEISE_MAX = 8;
const TABLE_COLS = 7;

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

function hinweisCardClass(h: Engine3Hinweis): string {
  return cn(
    "rounded-lg border px-3 py-2 text-sm list-none",
    h.schwere === "fehler"
      ? "border-red-200 bg-red-50/80 dark:border-red-900/50 dark:bg-red-950/20"
      : h.schwere === "warnung"
        ? "border-amber-200 bg-amber-50/80 dark:border-amber-900/40 dark:bg-amber-950/20"
        : "border-border bg-muted/30",
  );
}

function positionsToPdf(rows: Engine3Position[]): PdfPosition[] {
  return rows.map((p) => ({
    nr: p.nr,
    ziffer: p.ziffer,
    bezeichnung: p.bezeichnung,
    faktor: p.faktor,
    betrag: p.betrag,
    begruendung: [p.begruendung, p.anmerkung].filter(Boolean).join(" · ") || undefined,
  }));
}

function collectKnownPositionNrs(data: Engine3ResultData): Set<number> {
  const s = new Set<number>();
  for (const p of data.positionen) s.add(p.nr);
  for (const p of data.optimierungen ?? []) s.add(p.nr);
  return s;
}

/** Global: kein Bezug oder alle genannten Nummern fehlen in den aktuellen Tabellen (z. B. nach Streichung). */
function isGlobalEngine3Hinweis(h: Engine3Hinweis, knownNrs: Set<number>): boolean {
  const b = h.betrifftPositionen;
  if (!b?.length) return true;
  return b.every((nr) => !knownNrs.has(nr));
}

type Engine3ResultProps = {
  data: Engine3ResultData;
};

export default function Engine3Result({ data }: Engine3ResultProps) {
  const knownNrs = useMemo(() => collectKnownPositionNrs(data), [data]);

  const globalHinweise = useMemo(
    () => data.hinweise.filter((h) => isGlobalEngine3Hinweis(h, knownNrs)),
    [data.hinweise, knownNrs],
  );

  const handlePdf = useCallback(async () => {
    const rows = [...data.positionen, ...(data.optimierungen ?? [])];
    await generateInvoicePdf(positionsToPdf(rows), data.zusammenfassung.geschaetzteSumme, null, {
      protocolLines: data.hinweise.slice(0, 24).map((h) => {
        const pre = h.betrifftPositionen?.length ? `Nr. ${h.betrifftPositionen.join(", ")}: ` : "";
        return `${pre}${h.schwere.toUpperCase()}: ${h.titel} — ${h.detail}`;
      }),
    });
  }, [data]);

  const title =
    data.modus === "rechnung_pruefung" ? "Engine 3 – Rechnungsprüfung" : "Engine 3 – Leistungsvorschläge";
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
  const quellen = filterExplicitQuellenEntries(data.quellen?.filter(Boolean) ?? []);

  const positionRowWithHints = (p: Engine3Position, rowKey: string) => {
    const rowHints = data.hinweise
      .map((h, i) => ({ h, i }))
      .filter(({ h }) => h.betrifftPositionen?.includes(p.nr));
    return (
      <Fragment key={rowKey}>
        <tr className="border-b border-border/50 align-top">
          <td className="py-2 pr-2">{p.nr}</td>
          <td className="py-2 pr-2 font-mono">{p.ziffer}</td>
          <td className="py-2 pr-2 max-w-[220px]">
            <span className="font-medium">{p.bezeichnung}</span>
          </td>
          <td className="py-2 pr-2 whitespace-nowrap">{String(p.faktor).replace(".", ",")}</td>
          <td className="py-2 pr-2 text-right whitespace-nowrap">{formatEuro(p.betrag)}</td>
          <td className="py-2 pr-2">
            <span className={cn("inline-block rounded px-1.5 py-0.5 text-[10px] font-medium", statusBadgeClass(p.status))}>
              {p.status}
            </span>
          </td>
          <td className="py-2 text-muted-foreground max-w-[260px]">
            {p.quelleText?.trim() ? (
              <span className="line-clamp-3" title={p.quelleText}>
                {p.quelleText}
              </span>
            ) : (
              "—"
            )}
          </td>
        </tr>
        {rowHints.length > 0 ? (
          <tr className="border-b border-border/50">
            <td colSpan={TABLE_COLS} className="py-2 pr-2 pl-6 bg-muted/15">
              <ul className="space-y-2">
                {rowHints.map(({ h, i }) => (
                  <li key={`h-${i}-nr-${p.nr}`} className={hinweisCardClass(h)}>
                    <span className="font-medium">{h.titel}</span>
                    <p className="mt-1 text-muted-foreground">{h.detail}</p>
                  </li>
                ))}
              </ul>
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
        </div>
        <Button type="button" variant="outline" size="sm" className="shrink-0 gap-2" onClick={() => void handlePdf()}>
          <Download className="w-4 h-4" />
          PDF
        </Button>
      </div>

      {globalHinweise.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase">Allgemeine Hinweise</p>
          <ul className="space-y-2">
            {globalShown.map((h, i) => (
              <li key={`global-${h.titel}-${i}`} className={hinweisCardClass(h)}>
                <span className="font-medium">{h.titel}</span>
                <p className="mt-1 text-muted-foreground">{h.detail}</p>
              </li>
            ))}
          </ul>
          {globalRest > 0 ? (
            <p className="text-xs text-muted-foreground">… und {globalRest} weitere Hinweise</p>
          ) : null}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <p className="text-xs font-medium text-muted-foreground uppercase mb-2">Positionen</p>
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 pr-2">Nr</th>
              <th className="py-2 pr-2">GOÄ</th>
              <th className="py-2 pr-2">Bezeichnung</th>
              <th className="py-2 pr-2">Faktor</th>
              <th className="py-2 pr-2 text-right">Betrag</th>
              <th className="py-2 pr-2">Status</th>
              <th className="py-2 min-w-[140px]">Quelle</th>
            </tr>
          </thead>
          <tbody>{data.positionen.map((p) => positionRowWithHints(p, p.nr + "-" + p.ziffer))}</tbody>
        </table>
      </div>

      {data.optimierungen && data.optimierungen.length > 0 ? (
        <div className="overflow-x-auto">
          <p className="text-xs font-medium text-muted-foreground uppercase mb-2">Vorschläge</p>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-2 pr-2">Nr</th>
                <th className="py-2 pr-2">GOÄ</th>
                <th className="py-2 pr-2">Bezeichnung</th>
                <th className="py-2 pr-2">Faktor</th>
                <th className="py-2 pr-2 text-right">Betrag</th>
                <th className="py-2 pr-2">Status</th>
                <th className="py-2 min-w-[140px]">Quelle</th>
              </tr>
            </thead>
            <tbody>{data.optimierungen.map((p) => positionRowWithHints(p, "o-" + p.nr + "-" + p.ziffer))}</tbody>
          </table>
        </div>
      ) : null}

      {quellen.length > 0 ? (
        <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-xs">
          <p className="font-medium text-muted-foreground uppercase mb-1">Quellen</p>
          <p className="text-muted-foreground">{quellen.join(" · ")}</p>
        </div>
      ) : null}
    </div>
  );
}

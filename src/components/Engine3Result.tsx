import { useCallback } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generateInvoicePdf, type PdfPosition } from "@/lib/pdf-invoice";
import { cn } from "@/lib/utils";
import type { Engine3ResultData, Engine3Position } from "@/lib/engine3Result";

export type { Engine3ResultData } from "@/lib/engine3Result";

const HINWEISE_MAX = 8;

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

type Engine3ResultProps = {
  data: Engine3ResultData;
};

export default function Engine3Result({ data }: Engine3ResultProps) {
  const handlePdf = useCallback(async () => {
    const rows = [...data.positionen, ...(data.optimierungen ?? [])];
    await generateInvoicePdf(positionsToPdf(rows), data.zusammenfassung.geschaetzteSumme, null, {
      protocolLines: data.hinweise.slice(0, 24).map(
        (h) => `${h.schwere.toUpperCase()}: ${h.titel} — ${h.detail}`,
      ),
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

  const hinweiseShown = data.hinweise.slice(0, HINWEISE_MAX);
  const hinweiseRest = data.hinweise.length - hinweiseShown.length;

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

      {data.hinweise.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase">Hinweise</p>
          <ul className="space-y-2">
            {hinweiseShown.map((h, i) => (
              <li
                key={`${h.titel}-${i}`}
                className={cn(
                  "rounded-lg border px-3 py-2 text-sm",
                  h.schwere === "fehler"
                    ? "border-red-200 bg-red-50/80 dark:border-red-900/50 dark:bg-red-950/20"
                    : h.schwere === "warnung"
                      ? "border-amber-200 bg-amber-50/80 dark:border-amber-900/40 dark:bg-amber-950/20"
                      : "border-border bg-muted/30",
                )}
              >
                <span className="font-medium">{h.titel}</span>
                <p className="mt-1 text-muted-foreground">{h.detail}</p>
              </li>
            ))}
          </ul>
          {hinweiseRest > 0 ? (
            <p className="text-xs text-muted-foreground">… und {hinweiseRest} weitere Hinweise</p>
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
              <th className="py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.positionen.map((p) => (
              <tr key={p.nr + "-" + p.ziffer} className="border-b border-border/50 align-top">
                <td className="py-2 pr-2">{p.nr}</td>
                <td className="py-2 pr-2 font-mono">{p.ziffer}</td>
                <td className="py-2 pr-2 max-w-[220px]">
                  <span className="font-medium">{p.bezeichnung}</span>
                </td>
                <td className="py-2 pr-2 whitespace-nowrap">{String(p.faktor).replace(".", ",")}</td>
                <td className="py-2 pr-2 text-right whitespace-nowrap">{formatEuro(p.betrag)}</td>
                <td className="py-2">
                  <span className={cn("inline-block rounded px-1.5 py-0.5 text-[10px] font-medium", statusBadgeClass(p.status))}>
                    {p.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
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
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.optimierungen.map((p) => (
                <tr key={"o-" + p.nr + "-" + p.ziffer} className="border-b border-border/50 align-top">
                  <td className="py-2 pr-2">{p.nr}</td>
                  <td className="py-2 pr-2 font-mono">{p.ziffer}</td>
                  <td className="py-2 pr-2 max-w-[220px]">
                    <span className="font-medium">{p.bezeichnung}</span>
                  </td>
                  <td className="py-2 pr-2 whitespace-nowrap">{String(p.faktor).replace(".", ",")}</td>
                  <td className="py-2 pr-2 text-right whitespace-nowrap">{formatEuro(p.betrag)}</td>
                  <td className="py-2">
                    <span className={cn("inline-block rounded px-1.5 py-0.5 text-[10px] font-medium", statusBadgeClass(p.status))}>
                      {p.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

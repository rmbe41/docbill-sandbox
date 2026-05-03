import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { useSandbox } from "@/lib/sandbox/sandboxStore";
import { followupSubLabel, invoiceBoardColumn } from "@/lib/sandbox/board";
import type { InsuranceType, SandboxInvoice } from "@/lib/sandbox/types";
import { ConfidenceDot, PayerChip } from "@/components/sandbox/sandboxUi";
import { SandboxInvoiceSheet } from "@/components/sandbox/SandboxInvoiceSheet";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { CircleHelp } from "lucide-react";

const COLS = [
  {
    id: "pre_visit" as const,
    title: "Zur Prüfung",
    subtitle: "Rechnungen noch änderbar",
    tooltip:
      "Noch nicht beim Kostenträger eingereicht. DocBill schlägt Diagnose- und Leistungscodes vor — Prüfung und Freigabe stehen aus. Nur hier lassen sich Codes noch anpassen.",
  },
  {
    id: "submitted" as const,
    title: "Eingereicht",
    subtitle: "Übermittelt — auf Rückmeldung wartend.",
    tooltip:
      "An den Kostenträger übermittelt, Antwort ausstehend. Keine Aktion nötig; nach Rückmeldung wandern die Karten automatisch weiter.",
  },
  {
    id: "followup" as const,
    title: "Klärung",
    subtitle: "Kostenträger hat reagiert — Handlungsbedarf.",
    tooltip:
      "Aktion erforderlich: Rückfragen zu Ziffern, Teil- oder Vollablehnung, Einspruch. Bei Ablehnung schlägt DocBill Einspruchstexte vor.",
  },
  {
    id: "paid" as const,
    title: "Endzustand",
    subtitle: "Bezahlt oder endgültig abgeschlossen.",
    tooltip:
      "Bezahlte Rechnungen (Geldeingang verbucht) und endgültig abgeschriebene Fälle. Keine Belastung der offenen Forderungen mehr.",
  },
];

export default function SandboxRechnungenPage() {
  const { state } = useSandbox();
  const [sheetInv, setSheetInv] = useState<SandboxInvoice | null>(null);
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    return state.invoices.filter((inv) => {
      const patient = state.patients.find((p) => p.id === inv.patient_id);
      const doc = state.documentations.find((d) => d.id === inv.documentation_id);
      if (!patient || !doc) return false;
      if (q.trim()) {
        const needle = q.trim().toLowerCase();
        if (
          !patient.name.toLowerCase().includes(needle) &&
          !patient.insurance_provider.toLowerCase().includes(needle) &&
          !inv.card_code_summary.toLowerCase().includes(needle) &&
          !inv.id.toLowerCase().includes(needle)
        )
          return false;
      }
      return true;
    });
  }, [state.invoices, state.patients, state.documentations, q]);

  const byCol = useMemo(() => {
    const m: Record<string, SandboxInvoice[]> = { pre_visit: [], submitted: [], followup: [], paid: [] };
    for (const inv of filtered) {
      m[invoiceBoardColumn(inv)].push(inv);
    }
    return m;
  }, [filtered]);

  const colSum = (list: SandboxInvoice[]) =>
    list.reduce((s, i) => s + i.total_amount, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 className="text-lg font-semibold tracking-tight shrink-0">Übersicht</h1>
        <div className="w-full min-w-0 sm:w-auto sm:flex-1 sm:max-w-md sm:flex sm:justify-end">
          <Input
            className="h-9 text-sm w-full sm:max-w-md"
            placeholder="Suche: Name, Code, ID…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Suche"
          />
        </div>
      </div>

      <ScrollArea className="w-full pb-3">
        <div className="flex min-w-[920px] pb-2 rounded-lg border border-border/80 bg-background shadow-sm overflow-hidden divide-x divide-border/80">
          {COLS.map((col) => {
            const list = byCol[col.id] ?? [];
            const sum = colSum(list);
            return (
              <div key={col.id} className="flex flex-1 min-w-[220px] min-h-0 flex-col bg-background">
                <div className="px-3 py-3 border-b-2 border-border/90 bg-muted/55 dark:bg-muted/40">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-start gap-1.5 cursor-help text-left">
                        <p className="text-sm font-semibold tracking-tight text-foreground">{col.title}</p>
                        <CircleHelp className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" aria-hidden />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-sm text-xs leading-snug">
                      {col.tooltip}
                    </TooltipContent>
                  </Tooltip>
                  <p className="text-[11px] font-medium text-muted-foreground mt-1 leading-snug">{col.subtitle}</p>
                  <p className="text-xs mt-2.5 tabular-nums text-foreground/90">
                    <span className="text-muted-foreground font-normal">{list.length} Karten · Summe</span>{" "}
                    <span className="font-semibold text-foreground">
                      {sum.toLocaleString("de-DE", { style: "currency", currency: "EUR" })}
                    </span>
                  </p>
                </div>
                <div className="p-2 space-y-2 min-h-[280px]">
                  {list.map((inv) => {
                    const patient = state.patients.find((p) => p.id === inv.patient_id);
                    const docDate = state.documentations.find((d) => d.id === inv.documentation_id)?.date ?? "";
                    if (!patient) return null;
                    return (
                      <InvoiceCard
                        key={inv.id}
                        invoice={inv}
                        patient={patient}
                        docDate={docDate}
                        onOpen={() => setSheetInv(inv)}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>

      <SandboxInvoiceSheet invoice={sheetInv} open={!!sheetInv} onOpenChange={(o) => !o && setSheetInv(null)} />
    </div>
  );
}

function InvoiceCard({
  invoice,
  patient,
  docDate,
  onOpen,
}: {
  invoice: SandboxInvoice;
  patient: { name: string; insurance_type: InsuranceType; insurance_provider: string };
  docDate: string;
  onOpen: () => void;
}) {
  const col = invoiceBoardColumn(invoice);
  const sub = col === "followup" ? followupSubLabel(invoice) : null;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "w-full text-left rounded-md border border-border/70 bg-card hover:bg-muted/40 transition-colors p-2.5 space-y-1.5",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium leading-tight line-clamp-2">{patient.name}</span>
        <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">{docDate}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold tabular-nums">
          {invoice.total_amount.toLocaleString("de-DE", { style: "currency", currency: "EUR" })}
        </span>
        <PayerChip type={patient.insurance_type} />
      </div>
      <p className="text-[10px] text-muted-foreground line-clamp-2 leading-tight">{patient.insurance_provider}</p>
      <div className="flex items-center justify-between gap-2 pt-0.5">
        <span className="text-[10px] text-muted-foreground line-clamp-2">{invoice.card_code_summary}</span>
        <ConfidenceDot tier={invoice.confidence_tier} percent={invoice.confidence_percent} />
      </div>
      {sub && (
        <span
          className={cn(
            "inline-block text-[9px] font-medium px-1 py-0 rounded",
            sub === "denied"
              ? "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-100"
              : "bg-amber-100 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100 dark:border dark:border-amber-800/50",
          )}
        >
          {sub === "denied" ? "Abgelehnt" : "Anfechtung"}
        </span>
      )}
    </button>
  );
}

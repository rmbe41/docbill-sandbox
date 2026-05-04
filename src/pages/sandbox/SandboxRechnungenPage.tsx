import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSandbox } from "@/lib/sandbox/sandboxStore";
import { followupSubLabel, invoiceBoardColumn } from "@/lib/sandbox/board";
import type { ConfidenceLevel, InsuranceType, SandboxInvoice } from "@/lib/sandbox/types";
import { InsurerLabelRow } from "@/components/sandbox/InsurerMark";
import { ConfidenceDot, PayerChip } from "@/components/sandbox/sandboxUi";
import { SandboxInvoiceSheet } from "@/components/sandbox/SandboxInvoiceSheet";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatSandboxDateEuropean } from "@/lib/sandbox/europeanDate";
import { ChevronDown, CircleHelp } from "lucide-react";

type BoardSortKey =
  | "doc_date_desc"
  | "doc_date_asc"
  | "amount_desc"
  | "amount_asc"
  | "patient_asc"
  | "patient_desc"
  | "confidence_desc"
  | "confidence_asc";

type InsuranceFilter = "all" | InsuranceType;

type ConfidenceFilter = "all" | ConfidenceLevel;

const SORT_OPTIONS: { value: BoardSortKey; label: string }[] = [
  { value: "doc_date_desc", label: "Datum · neu zuerst" },
  { value: "doc_date_asc", label: "Datum · alt zuerst" },
  { value: "amount_desc", label: "Betrag · hoch" },
  { value: "amount_asc", label: "Betrag · niedrig" },
  { value: "patient_asc", label: "Patient · A–Z" },
  { value: "patient_desc", label: "Patient · Z–A" },
  { value: "confidence_desc", label: "Konfidenz · hoch" },
  { value: "confidence_asc", label: "Konfidenz · niedrig" },
];

const TIER_RANK: Record<ConfidenceLevel, number> = { high: 0, medium: 1, low: 2 };

const subtleSelectTriggerSort =
  "h-10 w-[min(100%,12rem)] sm:w-[12rem] border-dashed border-border/60 bg-transparent shadow-none text-xs text-muted-foreground hover:text-foreground hover:bg-muted/20 hover:border-border px-2.5 gap-1 focus:ring-1";

const subtleFilterTrigger =
  "inline-flex h-10 shrink-0 items-center gap-1 rounded-md border border-dashed border-border/60 bg-transparent px-3 text-xs font-medium text-muted-foreground shadow-none hover:border-border hover:bg-muted/20 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

function sortSandboxInvoices(
  invoices: SandboxInvoice[],
  sortKey: BoardSortKey,
  docDateByDocId: Map<string, string>,
  patientNameByPatientId: Map<string, string>,
): SandboxInvoice[] {
  const arr = [...invoices];
  arr.sort((a, b) => {
    switch (sortKey) {
      case "doc_date_desc": {
        const da = Date.parse(docDateByDocId.get(a.documentation_id) ?? "") || 0;
        const db = Date.parse(docDateByDocId.get(b.documentation_id) ?? "") || 0;
        return db - da;
      }
      case "doc_date_asc": {
        const da = Date.parse(docDateByDocId.get(a.documentation_id) ?? "") || 0;
        const db = Date.parse(docDateByDocId.get(b.documentation_id) ?? "") || 0;
        return da - db;
      }
      case "amount_desc":
        return b.total_amount - a.total_amount;
      case "amount_asc":
        return a.total_amount - b.total_amount;
      case "patient_asc": {
        const na = patientNameByPatientId.get(a.patient_id) ?? "";
        const nb = patientNameByPatientId.get(b.patient_id) ?? "";
        return na.localeCompare(nb, "de", { sensitivity: "base" });
      }
      case "patient_desc": {
        const na = patientNameByPatientId.get(a.patient_id) ?? "";
        const nb = patientNameByPatientId.get(b.patient_id) ?? "";
        return nb.localeCompare(na, "de", { sensitivity: "base" });
      }
      case "confidence_desc":
        return TIER_RANK[a.confidence_tier] - TIER_RANK[b.confidence_tier];
      case "confidence_asc":
        return TIER_RANK[b.confidence_tier] - TIER_RANK[a.confidence_tier];
      default:
        return 0;
    }
  });
  return arr;
}

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
  const [sortKey, setSortKey] = useState<BoardSortKey>("doc_date_desc");
  const [insuranceFilter, setInsuranceFilter] = useState<InsuranceFilter>("all");
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceFilter>("all");

  const docDateByDocId = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of state.documentations) m.set(d.id, d.date);
    return m;
  }, [state.documentations]);

  const patientNameByPatientId = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of state.patients) m.set(p.id, p.name);
    return m;
  }, [state.patients]);

  const filtered = useMemo(() => {
    const base = state.invoices.filter((inv) => {
      const patient = state.patients.find((p) => p.id === inv.patient_id);
      const doc = state.documentations.find((d) => d.id === inv.documentation_id);
      if (!patient || !doc) return false;
      if (insuranceFilter !== "all" && patient.insurance_type !== insuranceFilter) return false;
      if (confidenceFilter !== "all" && inv.confidence_tier !== confidenceFilter) return false;
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
    return sortSandboxInvoices(base, sortKey, docDateByDocId, patientNameByPatientId);
  }, [
    state.invoices,
    state.patients,
    state.documentations,
    q,
    insuranceFilter,
    confidenceFilter,
    sortKey,
    docDateByDocId,
    patientNameByPatientId,
  ]);

  const byCol = useMemo(() => {
    const m: Record<string, SandboxInvoice[]> = { pre_visit: [], submitted: [], followup: [], paid: [] };
    for (const inv of filtered) {
      m[invoiceBoardColumn(inv)].push(inv);
    }
    return m;
  }, [filtered]);

  const colSum = (list: SandboxInvoice[]) =>
    list.reduce((s, i) => s + i.total_amount, 0);

  const filterActive = insuranceFilter !== "all" || confidenceFilter !== "all";

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4 lg:w-full">
        <div className="flex items-center justify-between gap-3 lg:contents">
          <h1 className="text-lg font-semibold tracking-tight shrink-0 lg:whitespace-nowrap">
            Übersicht
          </h1>
          <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-1.5 lg:ml-auto">
            <Select value={sortKey} onValueChange={(v) => setSortKey(v as BoardSortKey)}>
              <SelectTrigger className={subtleSelectTriggerSort} aria-label="Sortierung">
                <SelectValue placeholder="Sortierung" />
              </SelectTrigger>
              <SelectContent align="end" className="max-h-72">
                {SORT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value} className="text-xs">
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <DropdownMenu>
              <DropdownMenuTrigger type="button" className={subtleFilterTrigger} aria-label="Filter">
                <span>Filter</span>
                {filterActive && (
                  <span className="tabular-nums text-[10px] font-semibold text-foreground/80" aria-hidden>
                    ●
                  </span>
                )}
                <ChevronDown className="h-3.5 w-3.5 opacity-50" aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[13rem]">
                <DropdownMenuLabel className="text-[11px] font-semibold text-muted-foreground">
                  Kostenträger
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={insuranceFilter}
                  onValueChange={(v) => setInsuranceFilter(v as InsuranceFilter)}
                >
                  <DropdownMenuRadioItem value="all" className="text-xs">
                    Alle Kassenarten
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="GKV" className="text-xs">
                    GKV
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="PKV" className="text-xs">
                    PKV
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="self" className="text-xs">
                    Selbstzahler
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[11px] font-semibold text-muted-foreground">
                  Konfidenz
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={confidenceFilter}
                  onValueChange={(v) => setConfidenceFilter(v as ConfidenceFilter)}
                >
                  <DropdownMenuRadioItem value="all" className="text-xs">
                    Alle Konfidenz
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="high" className="text-xs">
                    Hoch
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="medium" className="text-xs">
                    Mittel
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="low" className="text-xs">
                    Niedrig
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <Input
          className="h-10 w-full text-sm lg:flex-1 lg:min-w-[12rem] lg:max-w-none"
          placeholder="Suche: Name, Code, ID…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Suche"
        />
      </div>

      <ScrollArea className="w-full pb-3">
        <div className="flex min-w-0 w-full min-h-[280px] pb-2 rounded-lg border border-border/80 bg-background shadow-sm overflow-hidden divide-x divide-border/80">
          {COLS.map((col) => {
            const list = byCol[col.id] ?? [];
            const sum = colSum(list);
            return (
              <div key={col.id} className="flex flex-1 min-w-[220px] min-h-0 flex-col bg-background">
                <div className="px-3 py-3 border-b-2 border-border/90">
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
        <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
          {formatSandboxDateEuropean(docDate)}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold tabular-nums">
          {invoice.total_amount.toLocaleString("de-DE", { style: "currency", currency: "EUR" })}
        </span>
        <PayerChip type={patient.insurance_type} />
      </div>
      <InsurerLabelRow
        name={patient.insurance_provider}
        textClassName="text-[10px] text-muted-foreground line-clamp-2 leading-tight"
      />
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

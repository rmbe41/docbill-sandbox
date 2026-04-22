import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { goaeByZiffer } from "@/data/goae-catalog";
import { calculateAmountOrScaled } from "@/lib/goae-validator";
import type { Engine3Position } from "@/lib/engine3Result";
import { GoaeFaktorBegruendungBlock } from "@/components/GoaeFaktorBegruendungPanel";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ChevronDown } from "lucide-react";
import AppHeader from "@/components/AppHeader";
import ConversationSidebar from "@/components/ConversationSidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useBatches, fetchBatchRechnungen, fetchBatchFaelle } from "@/hooks/useBatches";
import { runBulkAktion } from "@/lib/batches/applyBulk";
import {
  persistBatchRechnungDetailMutation,
  persistRejectAllForRechnung,
} from "@/lib/batches/persistBatchRechnungDetail";
import type { BatchPositionPersistAction } from "@/lib/batches/persistBatchRechnungDetail";
import { usePraxisStammdaten } from "@/hooks/usePraxisStammdaten";
import { useToast } from "@/hooks/use-toast";
import { DocbillKiDisclaimerFooter } from "@/components/DocbillKiDisclaimerFooter";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import type { Batch, BatchFall } from "@/lib/batches/batchTypes";
import {
  mergeBatchRechnungenIntoOneFall,
  splitBatchRechnungToNewFall,
} from "@/lib/batches/batchFallMutations";
import { parseZusammenfassung } from "@/lib/batches/batchTypes";
import type { BatchRechnungRow } from "@/lib/batches/batchTypes";
import type { BulkAktion } from "@/lib/batches/bulkAktion";
import { formatBulkAcceptToastDescription } from "@/lib/batches/bulkAcceptToast";
import { formatStatusSpalte } from "@/lib/batches/batchKpiColumns";
import { kennFromLegacyPill, batchPillDisplayLabel } from "@/lib/batches/batchKennzeichnungDisplay";
import { isPflicht, isPruefbar } from "@/lib/batches/detailMutations";
import type { KennzeichnungStufe } from "@/lib/analyse/types";

function formatEuro2(n: number): string {
  return n.toLocaleString("de-DE", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });
}

function kennBorderClass(kenn: KennzeichnungStufe): string {
  switch (kenn) {
    case "SICHER":
      return "border-emerald-500/35 bg-emerald-500/[0.06]";
    case "OPTIMIERUNG":
      return "border-blue-500/35 bg-blue-500/[0.08]";
    case "PRÜFEN":
      return "border-amber-500/35 bg-amber-500/[0.06]";
    case "RISIKO":
      return "border-orange-500/35 bg-orange-500/[0.08]";
    case "FEHLER":
      return "border-red-500/40 bg-red-500/[0.08]";
    case "UNVOLLSTÄNDIG":
      return "border-violet-500/40 bg-violet-500/[0.08]";
    default:
      return "border-border";
  }
}

function rowListStatusLabel(r: BatchRechnungRow): string {
  return formatStatusSpalte(r.listeStatus, r.detail.kpi);
}

const LISTE_PRIO: BatchRechnungRow["listeStatus"][] = ["fehler", "mit_hinweisen", "offen", "geprueft"];

function worstFallListeStatus(children: BatchRechnungRow[]): BatchRechnungRow["listeStatus"] {
  for (const s of LISTE_PRIO) {
    if (children.some((c) => c.listeStatus === s)) return s;
  }
  return "geprueft";
}

export default function BatchDetailPage() {
  const { batchId } = useParams<{ batchId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { list, loading: listLoading, refresh: refreshBatches, canWriteBatches } = useBatches();
  const { praxisStammdaten } = usePraxisStammdaten();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [rows, setRows] = useState<BatchRechnungRow[]>([]);
  const [faelle, setFaelle] = useState<BatchFall[]>([]);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [fallActionLoading, setFallActionLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [panelId, setPanelId] = useState<string | null>(null);
  const [listFocusId, setListFocusId] = useState<string | null>(null);
  const [filterAlle, setFilterAlle] = useState<"alle" | "hinweise" | "fehler" | "offen">("alle");
  const [filterHinweis, setFilterHinweis] = useState<"alle" | "mit" | "ohne">("alle");
  const [filterStatus, setFilterStatus] = useState<"alle" | BatchRechnungRow["listeStatus"]>("alle");
  const [search, setSearch] = useState("");
  const [detailSaving, setDetailSaving] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState<{ nr: number; draft: string } | null>(null);
  const [begruendungOverrides, setBegruendungOverrides] = useState<Record<string, string>>({});
  const [goaeFaktorLocal, setGoaeFaktorLocal] = useState<Record<string, { faktor: number; betrag: number }>>({});

  const praxisName = praxisStammdaten?.praxis?.name?.trim() || "Praxis";

  useEffect(() => {
    if (!batchId) return;
    const fromList = list.find((b) => b.id === batchId);
    if (fromList) setBatch(fromList);
  }, [batchId, list]);

  const loadBatchPage = useCallback(async () => {
    if (!batchId) return;
    const [data, falleData, rowRes] = await Promise.all([
      fetchBatchRechnungen(batchId),
      fetchBatchFaelle(batchId),
      supabase.from("batches").select("*").eq("id", batchId).maybeSingle(),
    ]);
    setRows(data);
    setFaelle(falleData);
    const row = rowRes.data;
    if (row) {
      const r = row as {
        id: string;
        user_id: string;
        organisation_id: string;
        name: string;
        created_at: string;
        updated_at: string;
        rechnungen_count: number;
        faelle_count?: number;
        verarbeitet_count?: number;
        status: string;
        zusammenfassung: unknown;
      };
      const fc =
        typeof r.faelle_count === "number" && Number.isFinite(r.faelle_count)
          ? r.faelle_count
          : falleData.length || r.rechnungen_count;
      setBatch({
        id: r.id,
        name: r.name,
        organisationId: r.organisation_id,
        erstelltVon: r.user_id,
        erstelltAm: r.created_at,
        aktualisiertAm: r.updated_at,
        faelleCount: fc,
        rechnungenCount: r.rechnungen_count,
        verarbeitetCount: r.verarbeitet_count ?? 0,
        status: r.status as Batch["status"],
        zusammenfassung: parseZusammenfassung(r.zusammenfassung as Parameters<typeof parseZusammenfassung>[0]),
      });
    }
  }, [batchId]);

  useEffect(() => {
    void loadBatchPage();
  }, [loadBatchPage]);

  useEffect(() => {
    setAdjustOpen(null);
  }, [panelId]);

  useEffect(() => {
    setBegruendungOverrides({});
    setGoaeFaktorLocal({});
  }, [panelId]);

  useEffect(() => {
    if (!batchId || batch?.status !== "processing") return;
    const id = setInterval(() => {
      void loadBatchPage();
    }, 1000);
    return () => clearInterval(id);
  }, [batchId, batch?.status, loadBatchPage]);

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return faelle
      .map((fall) => {
        const children = rows
          .filter((r) => r.fallId === fall.id)
          .filter((r) => {
            if (q) {
              const file = r.detail.metadata?.fileName?.toLowerCase() ?? "";
              const fl = fall.label.toLowerCase();
              if (
                !r.patientIdLabel.toLowerCase().includes(q) &&
                !file.includes(q) &&
                !fl.includes(q)
              )
                return false;
            }
            if (filterAlle === "hinweise" && r.listeStatus !== "mit_hinweisen") return false;
            if (filterAlle === "fehler" && r.listeStatus !== "fehler") return false;
            if (filterAlle === "offen" && r.listeStatus !== "offen") return false;
            if (filterHinweis === "mit" && (r.hinweiseKurz === "—" || !r.hinweiseKurz)) return false;
            if (filterHinweis === "ohne" && r.hinweiseKurz && r.hinweiseKurz !== "—") return false;
            if (filterStatus !== "alle" && r.listeStatus !== filterStatus) return false;
            return true;
          })
          .sort((a, b) => a.sortOrder - b.sortOrder);
        return { fall, children };
      })
      .filter((g) => g.children.length > 0);
  }, [faelle, rows, search, filterAlle, filterHinweis, filterStatus]);

  const filteredRows = useMemo(() => filteredGroups.flatMap((g) => g.children), [filteredGroups]);

  useEffect(() => {
    if (!listFocusId) return;
    if (!filteredRows.some((r) => r.id === listFocusId)) {
      setListFocusId(filteredRows[0]?.id ?? null);
    }
  }, [filteredRows, listFocusId]);

  const listIndex = panelId ? filteredRows.findIndex((r) => r.id === panelId) : -1;
  const panelRow = listIndex >= 0 ? filteredRows[listIndex] : null;

  const toggleSel = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runBulk = useCallback(
    async (aktion: BulkAktion) => {
      if (
        (aktion.type === "accept_all" || aktion.type === "accept_selected") &&
        !canWriteBatches
      ) {
        toast({
          title: "Keine Berechtigung",
          description: "Im Nur-Lese-Modus können Sie keine Vorschläge übernehmen.",
          variant: "destructive",
        });
        return;
      }
      const r = await runBulkAktion(aktion);
      if (r.rechnungCount === 0) {
        toast({ title: "Nichts zu tun", description: "Keine passenden Rechnungen.", variant: "destructive" });
        return;
      }
      if (aktion.type === "accept_all" || aktion.type === "accept_selected") {
        toast({
          title: "Vorschläge übernommen",
          description: formatBulkAcceptToastDescription(r),
        });
      } else {
        toast({
          title: "Export",
          description: `${r.rechnungCount} Rechnung(en) heruntergeladen.`,
        });
      }
      void loadBatchPage();
      void refreshBatches();
    },
    [toast, loadBatchPage, refreshBatches, canWriteBatches],
  );

  const acceptAllSelected = () => {
    if (!canWriteBatches) {
      toast({
        title: "Keine Berechtigung",
        description: "Im Nur-Lese-Modus können Sie keine Vorschläge übernehmen.",
        variant: "destructive",
      });
      return;
    }
    const ids = [...selected];
    if (ids.length === 0) {
      toast({ title: "Keine Auswahl", description: "Bitte Rechnungen in der Liste markieren." });
      return;
    }
    void runBulk({ type: "accept_selected", batchId: batchId ?? "", rechnungIds: ids });
  };

  const exportSelected = () => {
    const ids = [...selected];
    if (ids.length === 0) {
      toast({ title: "Keine Auswahl" });
      return;
    }
    void runBulk({
      type: "export_selected",
      batchId: batchId ?? "",
      rechnungIds: ids,
      optionen: { exportFormat: "pdf", includeBegruendungen: true, includeHinweise: true },
    });
  };

  const openPanel = (id: string) => {
    setListFocusId(id);
    setPanelId(id);
  };
  const closePanel = () => setPanelId(null);

  const runDetailMutation = useCallback(
    async (rechnungId: string, action: BatchPositionPersistAction) => {
      if (!batchId) return;
      if (!canWriteBatches) {
        toast({
          title: "Keine Berechtigung",
          description: "Im Nur-Lese-Modus können Sie keine Änderungen speichern.",
          variant: "destructive",
        });
        return;
      }
      setDetailSaving(true);
      try {
        const r = await persistBatchRechnungDetailMutation(batchId, rechnungId, action);
        if (!r.ok) {
          toast({
            title: "Aktion nicht möglich",
            description: "error" in r ? r.error : "Unbekannter Fehler",
            variant: "destructive",
          });
          return;
        }
        toast({ title: "Gespeichert" });
        await loadBatchPage();
        void refreshBatches();
      } finally {
        setDetailSaving(false);
      }
    },
    [batchId, loadBatchPage, refreshBatches, toast, canWriteBatches],
  );

  const focusRowByDelta = (delta: number) => {
    if (filteredRows.length === 0) return;
    if (panelId) {
      const cur = filteredRows.findIndex((r) => r.id === panelId);
      if (cur < 0) return;
      const next = Math.min(filteredRows.length - 1, Math.max(0, cur + delta));
      const id = filteredRows[next]?.id;
      if (id) {
        setPanelId(id);
        setListFocusId(id);
      }
      return;
    }
    const cur = listFocusId ? filteredRows.findIndex((r) => r.id === listFocusId) : -1;
    const next =
      cur < 0
        ? delta > 0
          ? 0
          : filteredRows.length - 1
        : Math.min(filteredRows.length - 1, Math.max(0, cur + delta));
    const id = filteredRows[next]?.id;
    if (id) setListFocusId(id);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t?.closest("input, textarea, select")) return;
      if (detailSaving) return;
      if (e.key === "Escape") {
        e.preventDefault();
        closePanel();
        return;
      }
      if (e.key === "j") {
        e.preventDefault();
        focusRowByDelta(1);
        return;
      }
      if (e.key === "k") {
        e.preventDefault();
        focusRowByDelta(-1);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (panelId) return;
        const id = listFocusId ?? filteredRows[0]?.id;
        if (id) openPanel(id);
        return;
      }
      if (e.key === "a" && panelRow) {
        if (!canWriteBatches) return;
        e.preventDefault();
        void runBulk({ type: "accept_all", batchId: batchId ?? "", rechnungIds: [panelRow.id] });
        return;
      }
      if (e.key === "r" && panelRow && batchId) {
        if (!canWriteBatches) return;
        e.preventDefault();
        void (async () => {
          setDetailSaving(true);
          try {
            const r = await persistRejectAllForRechnung(batchId, panelRow.id);
            if (r.ok === false) {
              toast({ title: "Ablehnen nicht möglich", description: r.error, variant: "destructive" });
              return;
            }
            toast({
              title: "Vorschläge abgelehnt",
              description: `${r.abgelehntCount} offene Hinweis/Vorschlag-Position(en) verworfen und gespeichert.`,
            });
            await loadBatchPage();
            void refreshBatches();
          } finally {
            setDetailSaving(false);
          }
        })();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    panelId,
    panelRow,
    batchId,
    filteredRows,
    listFocusId,
    runBulk,
    toast,
    detailSaving,
    loadBatchPage,
    refreshBatches,
    canWriteBatches,
  ]);

  const geprueft = rows.filter((r) => r.listeStatus === "geprueft").length;
  const hinweise = rows.filter((r) => r.listeStatus === "mit_hinweisen").length;
  const offen = rows.filter((r) => r.listeStatus === "offen").length;

  if (!batchId) return null;

  return (
    <div className="min-h-dvh flex flex-col bg-background">
      <ConversationSidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        collapsed={sidebarCollapsed}
        onCollapsedChange={setSidebarCollapsed}
        onSettings={() => navigate("/settings")}
        onProfile={() => navigate("/", { state: { openProfile: true } })}
      />
      <div
        className={cn(
          "flex-1 flex flex-col min-h-0 transition-[margin] duration-200 ease-in-out",
          sidebarCollapsed ? "md:ml-[3.6rem]" : "md:ml-48",
        )}
      >
        <header className="shrink-0 border-b border-border/60 bg-background/95">
          <AppHeader onToggleSidebar={() => setSidebarOpen((v) => !v)} viewType="chat" />
        </header>

        <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
          <div
            className={cn(
              "flex-1 overflow-y-auto min-w-0 p-4 md:p-6",
              panelId ? "md:max-w-[min(28rem,40vw)] md:border-r border-border/60" : "",
            )}
          >
            <Button type="button" variant="ghost" size="sm" className="mb-4 gap-1 -ml-2" onClick={() => navigate("/batches")}>
              <ArrowLeft className="w-4 h-4" />
              Alle Stapel
            </Button>

            {listLoading && !batch ? (
              <p className="text-muted-foreground text-sm">Laden…</p>
            ) : batch ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                  <div>
                    <h1 className="text-lg font-semibold leading-tight">
                      {praxisName} – {batch.name}
                    </h1>
                    {!canWriteBatches ? (
                      <p className="mt-2 text-xs text-muted-foreground rounded-md border border-border/80 bg-muted/40 px-3 py-2 max-w-xl">
                        Nur-Lese-Zugriff: Sie können Stapel ansehen und exportieren, aber keine Vorschläge übernehmen
                        oder bearbeiten.
                      </p>
                    ) : null}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mt-2"
                          disabled={!canWriteBatches}
                        >
                          Alle annehmen <ChevronDown className="w-4 h-4 ml-1" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuItem
                          onClick={() => void runBulk({ type: "accept_all", batchId: batch.id, rechnungIds: [] })}
                        >
                          Alle Vorschläge im Stapel
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" variant="secondary" size="sm" className="mt-2 ml-1">
                          Export ▾
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuItem
                          onClick={() =>
                            void runBulk({
                              type: "export_all",
                              batchId: batch.id,
                              rechnungIds: [],
                              optionen: { exportFormat: "csv", includeBegruendungen: true, includeHinweise: true },
                            })
                          }
                        >
                          CSV
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            void runBulk({
                              type: "export_all",
                              batchId: batch.id,
                              rechnungIds: [],
                              optionen: { exportFormat: "pdf", includeBegruendungen: true, includeHinweise: true },
                            })
                          }
                        >
                          PDF
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            void runBulk({
                              type: "export_all",
                              batchId: batch.id,
                              rechnungIds: [],
                              optionen: { exportFormat: "pad", includeBegruendungen: true, includeHinweise: true },
                            })
                          }
                        >
                          PAD
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                {batch.status === "processing" ? (
                  <div className="mb-4 rounded-lg border border-amber-500/35 bg-amber-500/[0.07] px-3 py-2 text-sm text-foreground">
                    <p className="font-medium">Verarbeitung läuft</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Rechnung{" "}
                      {Math.max(1, Math.min(batch.rechnungenCount, batch.verarbeitetCount || 0))} von{" "}
                      {batch.rechnungenCount} wird geprüft…
                    </p>
                    <div className="mt-2 h-2 w-full max-w-sm rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-amber-500/90 transition-all duration-300"
                        style={{
                          width: `${batch.rechnungenCount > 0 ? Math.min(100, (100 * batch.verarbeitetCount) / batch.rechnungenCount) : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                ) : null}

                <div className="text-sm text-muted-foreground space-y-1 mb-4 border-b border-border/50 pb-4">
                  <p>
                    {batch.faelleCount} Fälle · {batch.rechnungenCount} Unterlagen │ {geprueft} geprüft │ {hinweise}{" "}
                    mit Hinweisen │ {offen} offen
                  </p>
                  <p>
                    Gesamtbetrag: {formatEuro2(batch.zusammenfassung.gesamtbetrag)} │ Optimierungspotenzial: +
                    {formatEuro2(batch.zusammenfassung.optimierungspotenzial)}
                  </p>
                </div>

                <DocbillKiDisclaimerFooter className="not-prose mb-4" />

                <div className="flex flex-wrap gap-2 items-center mb-3">
                  <Select value={filterAlle} onValueChange={(v) => setFilterAlle(v as typeof filterAlle)}>
                    <SelectTrigger className="w-[130px] h-9 text-xs">
                      <SelectValue placeholder="Filter" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="alle">Alle</SelectItem>
                      <SelectItem value="hinweise">Mit Hinweisen</SelectItem>
                      <SelectItem value="fehler">Fehler</SelectItem>
                      <SelectItem value="offen">Offen</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={filterHinweis} onValueChange={(v) => setFilterHinweis(v as typeof filterHinweis)}>
                    <SelectTrigger className="w-[140px] h-9 text-xs">
                      <SelectValue placeholder="Hinweise" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="alle">Hinweise: alle</SelectItem>
                      <SelectItem value="mit">Mit Hinweisen</SelectItem>
                      <SelectItem value="ohne">Ohne Hinweise</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v as typeof filterStatus)}>
                    <SelectTrigger className="w-[120px] h-9 text-xs">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="alle">Status: alle</SelectItem>
                      <SelectItem value="geprueft">Geprüft</SelectItem>
                      <SelectItem value="mit_hinweisen">Hinweise</SelectItem>
                      <SelectItem value="fehler">Fehler</SelectItem>
                      <SelectItem value="offen">Offen</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    className="h-9 max-w-[200px] text-xs"
                    placeholder="Suche Pat-ID / Datei / Fall…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>

                <div className="flex flex-wrap gap-2 mb-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="text-xs h-8"
                    disabled={!canWriteBatches || fallActionLoading || selected.size < 2}
                    onClick={() => {
                      void (async () => {
                        setFallActionLoading(true);
                        try {
                          const r = await mergeBatchRechnungenIntoOneFall([...selected]);
                          if (r.ok === false) {
                            toast({ title: "Zusammenführen nicht möglich", description: r.error, variant: "destructive" });
                            return;
                          }
                          toast({ title: "Fälle zusammengeführt", description: "Unterlagen liegen jetzt in einem Fall." });
                          setSelected(new Set());
                          await loadBatchPage();
                          void refreshBatches();
                        } finally {
                          setFallActionLoading(false);
                        }
                      })();
                    }}
                  >
                    Ausgewählte zu einem Fall
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-xs h-8"
                    disabled={!canWriteBatches || fallActionLoading || selected.size !== 1}
                    onClick={() => {
                      void (async () => {
                        const only = [...selected][0];
                        if (!only) return;
                        setFallActionLoading(true);
                        try {
                          const r = await splitBatchRechnungToNewFall(only);
                          if (r.ok === false) {
                            toast({ title: "Teilen nicht möglich", description: r.error, variant: "destructive" });
                            return;
                          }
                          toast({ title: "Neuer Fall", description: "Unterlage wurde in einen eigenen Fall verschoben." });
                          setSelected(new Set());
                          await loadBatchPage();
                          void refreshBatches();
                        } finally {
                          setFallActionLoading(false);
                        }
                      })();
                    }}
                  >
                    Unterlage in neuen Fall
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-xs h-8 text-muted-foreground"
                    disabled
                    title="Gebündelte KI-Prüfung aller Unterlagen eines Falls (z. B. wie im Chat) ist für eine spätere Version vorgesehen."
                  >
                    Fall KI-prüfen (demnächst)
                  </Button>
                </div>

                <div className="rounded-lg border border-border/80 overflow-hidden text-xs">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="bg-muted/40 text-left text-muted-foreground border-b border-border">
                        <th className="py-2 pl-2 w-8" />
                        <th className="py-2 pr-2">Pat-ID / Unterlage</th>
                        <th className="py-2 pr-2">Betrag</th>
                        <th className="py-2 pr-2">Status</th>
                        <th className="py-2 pr-2">Hinweise</th>
                        <th className="py-2 pr-2">Aktion</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredGroups.map(({ fall, children }) => {
                        const w = worstFallListeStatus(children);
                        const sum = children.reduce((s, c) => s + c.betragEuro, 0);
                        return (
                          <Fragment key={fall.id}>
                            <tr className="bg-muted/35 border-b border-border/60">
                              <td colSpan={6} className="py-2 px-2 text-[11px]">
                                <span className="font-semibold text-foreground">Fall: {fall.label}</span>
                                <span className="text-muted-foreground ml-2">
                                  {children.length} Unterlage(n) · Summe {formatEuro2(sum)} ·{" "}
                                  {formatStatusSpalte(w, undefined)}
                                </span>
                              </td>
                            </tr>
                            {children.map((r) => (
                              <tr
                                key={r.id}
                                className={cn(
                                  "border-b border-border/50 hover:bg-muted/20 cursor-pointer",
                                  panelId === r.id && "bg-primary/10",
                                  listFocusId === r.id && "ring-1 ring-inset ring-primary/30",
                                )}
                                onClick={() => openPanel(r.id)}
                              >
                                <td className="py-2 pl-2" onClick={(e) => e.stopPropagation()}>
                                  <Checkbox
                                    checked={selected.has(r.id)}
                                    onCheckedChange={() => toggleSel(r.id)}
                                    aria-label={`Auswahl ${r.patientIdLabel}`}
                                  />
                                </td>
                                <td className="py-2 pr-2">
                                  <span className="font-mono">{r.patientIdLabel}</span>
                                  {r.detail.metadata?.fileName ? (
                                    <span className="block text-[10px] text-muted-foreground truncate max-w-[14rem]">
                                      {r.detail.metadata.fileName}
                                    </span>
                                  ) : null}
                                </td>
                                <td className="py-2 pr-2 tabular-nums">{formatEuro2(r.betragEuro)}</td>
                                <td className="py-2 pr-2">{rowListStatusLabel(r)}</td>
                                <td className="py-2 pr-2">{r.hinweiseKurz ?? "—"}</td>
                                <td className="py-2 pr-2">
                                  <Button type="button" variant="secondary" size="sm" className="h-7 text-[10px]">
                                    Details
                                  </Button>
                                </td>
                              </tr>
                            ))}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="flex flex-wrap items-center gap-3 mt-4 text-sm">
                  <span>Ausgewählt: {selected.size}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!canWriteBatches}
                    onClick={acceptAllSelected}
                  >
                    Alle Vorschläge annehmen
                  </Button>
                  <Button type="button" size="sm" onClick={exportSelected}>
                    Exportieren
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground mt-3">
                  Tastatur: j/k Navigation in der Liste
                  {canWriteBatches ? " · a Annehmen · r Ablehnen" : ""} · Enter Details · Esc Panel schließen
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Stapel nicht gefunden.</p>
            )}
          </div>

          {panelId && panelRow ? (
            <aside className="flex flex-1 flex-col min-w-0 bg-muted/10 border-t md:border-t-0 md:border-l border-border/60 overflow-y-auto max-h-[55vh] md:max-h-none">
              <div className="p-6 space-y-4 max-w-3xl">
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/50 pb-3">
                  <p className="text-base font-semibold">
                    {panelRow.patientIdLabel}{" "}
                    <span className="text-muted-foreground font-normal">│</span>{" "}
                    {panelRow.fachbereich ?? "Fachbereich"}{" "}
                    <span className="text-muted-foreground font-normal">│</span>{" "}
                    {formatEuro2(panelRow.betragEuro)}
                  </p>
                </div>

                {panelRow.detail.positionen.map((pos) => {
                  const kenn = pos.kennzeichnung ?? kennFromLegacyPill(pos.pill);
                  const isGop = pos.ziffer && /^\d{5}$/.test(String(pos.ziffer).replace(/\D/g, "").slice(0, 5));
                  const zKey = (pos.ziffer ?? "").toLowerCase();
                  const gCat = goaeByZiffer.get(zKey);
                  const goaeRowKey = `${panelRow.id}-pos-${pos.nr}`;
                  const fl = goaeFaktorLocal[goaeRowKey];
                  const fEff = fl?.faktor ?? pos.faktor ?? 1;
                  const bEff =
                    gCat && pos.ziffer
                      ? calculateAmountOrScaled(pos.ziffer, fEff, { betrag: gCat.einfachsatz, faktor: 1 })
                      : (pos.betrag ?? 0);
                  const pE3: Engine3Position = {
                    nr: pos.nr,
                    ziffer: pos.ziffer ?? zKey,
                    bezeichnung: pos.titel ?? pos.text?.slice(0, 220) ?? "",
                    faktor: fEff,
                    betrag: bEff,
                    status: "warnung",
                    quelleText: panelRow.detail.metadata?.rohText,
                    begruendung: pos.hinweis,
                  };
                  return (
                  <div key={pos.nr} className="space-y-2">
                    {pos.fehlend ? (
                      <p className="text-sm font-medium text-muted-foreground">Pos. {pos.nr}: (fehlend)</p>
                    ) : (
                      <p className="text-sm font-medium">
                        Pos. {pos.nr}: {isGop ? "GOP" : "GOÄ"} {pos.ziffer} │ {pos.faktor != null ? `${String(pos.faktor).replace(".", ",")}x` : "—"} │{" "}
                        {pos.betrag != null ? formatEuro2(pos.betrag) : "—"}
                      </p>
                    )}
                    <div
                      className={cn(
                        "rounded-lg border px-3 py-2 text-xs space-y-2",
                        kennBorderClass(kenn),
                      )}
                    >
                      <p className="font-semibold">
                        [{batchPillDisplayLabel(kenn)}] {pos.titel ?? (pos.fehlend ? `GOP ${pos.ziffer}` : "Ziffer korrekt")}
                      </p>
                      {pos.text ? <p className="whitespace-pre-wrap text-muted-foreground">{pos.text}</p> : null}
                      {pos.hinweis ? (
                        <>
                          <p className="text-muted-foreground font-medium">Hinweis:</p>
                          <p className="text-muted-foreground">{pos.hinweis}</p>
                        </>
                      ) : null}
                      <div className="flex flex-wrap gap-2 pt-1">
                        {isPruefbar(pos) ? (
                          <>
                            <Button
                              size="sm"
                              className="h-7 text-[10px]"
                              disabled={!canWriteBatches || detailSaving}
                              onClick={(ev) => {
                                ev.stopPropagation();
                                void runDetailMutation(panelRow.id, { kind: "accept_pruefen", nr: pos.nr });
                              }}
                            >
                              Annehmen
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[10px]"
                              disabled={!canWriteBatches || detailSaving}
                              onClick={(ev) => {
                                ev.stopPropagation();
                                setAdjustOpen({
                                  nr: pos.nr,
                                  draft: [pos.titel, pos.hinweis, pos.text].filter(Boolean).join("\n\n").trim(),
                                });
                              }}
                            >
                              Anpassen
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-[10px]"
                              disabled={!canWriteBatches || detailSaving}
                              onClick={(ev) => {
                                ev.stopPropagation();
                                void runDetailMutation(panelRow.id, { kind: "reject_pruefen", nr: pos.nr });
                              }}
                            >
                              Ablehnen
                            </Button>
                          </>
                        ) : null}
                        {isPflicht(pos) && pos.fehlend ? (
                          <>
                            <Button
                              size="sm"
                              className="h-7 text-[10px]"
                              disabled={!canWriteBatches || detailSaving}
                              onClick={(ev) => {
                                ev.stopPropagation();
                                void runDetailMutation(panelRow.id, { kind: "add_pflicht", nr: pos.nr });
                              }}
                            >
                              Hinzufügen
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[10px]"
                              disabled={!canWriteBatches || detailSaving}
                              onClick={(ev) => {
                                ev.stopPropagation();
                                void runDetailMutation(panelRow.id, { kind: "ignore_pflicht", nr: pos.nr });
                              }}
                            >
                              Ignorieren
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </div>
                    {!isGop && gCat && pos.faktor != null ? (
                      <GoaeFaktorBegruendungBlock
                        p={pE3}
                        pBase={pE3}
                        rowKey={goaeRowKey}
                        beispieleTriple={[]}
                        begruendungOverrides={begruendungOverrides}
                        setBegruendungOverrides={setBegruendungOverrides}
                        onRegenerateBegruendung={() => {
                          setBegruendungOverrides((prev) => ({ ...prev, [goaeRowKey]: "" }));
                        }}
                        onFaktorCommit={(v) => {
                          const g0 = goaeByZiffer.get((pos.ziffer ?? "").toLowerCase());
                          const nb =
                            g0 && pos.ziffer
                              ? calculateAmountOrScaled(pos.ziffer, v, { betrag: g0.einfachsatz, faktor: 1 })
                              : (pos.betrag ?? 0);
                          setGoaeFaktorLocal((p0) => ({
                            ...p0,
                            [goaeRowKey]: { faktor: v, betrag: nb },
                          }));
                        }}
                        readOnly={!canWriteBatches}
                        className="max-w-full"
                      />
                    ) : null}
                  </div>
                );
                })}

                {panelRow.detail.gesamtNach != null ? (
                  <div className="border-t border-border pt-4 text-sm space-y-1">
                    <p>
                      Gesamt: {formatEuro2(panelRow.detail.gesamt)} → {formatEuro2(panelRow.detail.gesamtNach)}
                    </p>
                    {panelRow.detail.deltaLabel ? (
                      <p className="text-muted-foreground text-xs">{panelRow.detail.deltaLabel}</p>
                    ) : null}
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2 pt-4 border-t border-border">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={listIndex <= 0}
                    onClick={() => focusRowByDelta(-1)}
                  >
                    ← Vorherige
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={listIndex < 0 || listIndex >= filteredRows.length - 1}
                    onClick={() => focusRowByDelta(1)}
                  >
                    Nächste →
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!canWriteBatches}
                    onClick={() => void runBulk({ type: "accept_all", batchId: batchId ?? "", rechnungIds: [panelRow.id] })}
                  >
                    Alle Vorschläge annehmen
                  </Button>
                </div>
              </div>
            </aside>
          ) : null}
        </div>
      </div>

      <Dialog
        open={adjustOpen !== null}
        onOpenChange={(open) => {
          if (!open) setAdjustOpen(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Hinweis anpassen</DialogTitle>
          </DialogHeader>
          <Textarea
            value={adjustOpen?.draft ?? ""}
            readOnly={!canWriteBatches}
            onChange={(e) =>
              setAdjustOpen((prev) => (prev ? { ...prev, draft: e.target.value } : null))
            }
            rows={8}
            className="text-sm min-h-[160px]"
            placeholder="Eigene Begründung oder Korrektur …"
          />
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setAdjustOpen(null)}>
              Abbrechen
            </Button>
            <Button
              type="button"
              disabled={!canWriteBatches || detailSaving || !panelRow || !adjustOpen}
              onClick={() => {
                if (!panelRow || !adjustOpen) return;
                const { nr, draft } = adjustOpen;
                setAdjustOpen(null);
                void runDetailMutation(panelRow.id, { kind: "adjust_pruefen", nr, text: draft });
              }}
            >
              Übernehmen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

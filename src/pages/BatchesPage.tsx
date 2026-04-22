import { useState, useCallback, useRef, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Layers, Plus, Trash2 } from "lucide-react";
import AppHeader from "@/components/AppHeader";
import ConversationSidebar from "@/components/ConversationSidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useBatches } from "@/hooks/useBatches";
import { usePraxisStammdaten } from "@/hooks/usePraxisStammdaten";
import { useToast } from "@/hooks/use-toast";
import { DocbillKiDisclaimerFooter } from "@/components/DocbillKiDisclaimerFooter";
import { cn } from "@/lib/utils";
import type { BulkAktion } from "@/lib/batches/bulkAktion";
import { runBulkAktion } from "@/lib/batches/applyBulk";
import { estimatePadRechnungCount } from "@/lib/batches/padInvoiceEstimate";
import { formatBulkAcceptToastDescription } from "@/lib/batches/bulkAcceptToast";
import {
  isBatchPlanInputFile,
  patLabelFromText,
  planBatchInvoicesFromFiles,
  type GeplanteRechnungEingabe,
} from "@/lib/batches/planBatchInvoicesFromFiles";
import { mergePlanIndices, normalizeFallKeys, suggestFallKeysFromPlan } from "@/lib/batches/batchFallGrouping";

const MAX_BATCH_FILES = 500;
const ACCEPT_BATCH = ".pdf,.pad,application/pdf,image/jpeg,image/png,image/webp,image/gif";

function formatEuro2(n: number): string {
  return n.toLocaleString("de-DE", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });
}

export default function BatchesPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { praxisStammdaten } = usePraxisStammdaten();
  const { list, loading, refresh, deleteBatch, createBatchFromFiles, canWriteBatches, organisationId } = useBatches();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [batchName, setBatchName] = useState("");
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [planPreview, setPlanPreview] = useState<GeplanteRechnungEingabe[] | null>(null);
  const [fallKey, setFallKey] = useState<number[]>([]);
  const [selectedPlanIdx, setSelectedPlanIdx] = useState<Set<number>>(() => new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    if (uploadFiles.length === 0) {
      setPlanPreview(null);
      setFallKey([]);
      setSelectedPlanIdx(new Set());
      return;
    }
    void planBatchInvoicesFromFiles(uploadFiles).then((plan) => {
      if (cancelled) return;
      setPlanPreview(plan);
      setFallKey((prev) => (prev.length === plan.length ? prev : suggestFallKeysFromPlan(plan)));
      setSelectedPlanIdx(new Set());
    });
    return () => {
      cancelled = true;
    };
  }, [uploadFiles]);

  const praxisName = praxisStammdaten?.praxis?.name?.trim() || "Praxis";

  const runBulk = useCallback(
    async (aktion: BulkAktion) => {
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
          description: `${r.rechnungCount} Rechnung(en) im gewählten Format heruntergeladen.`,
        });
      }
      void refresh();
    },
    [toast, refresh],
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    addFiles(Array.from(e.dataTransfer.files));
  };

  const addFiles = (incoming: File[]) => {
    const allowed = incoming.filter(isBatchPlanInputFile);
    const cap = Math.max(0, MAX_BATCH_FILES - uploadFiles.length);
    const slice = allowed.slice(0, cap);
    if (slice.length < allowed.length) {
      toast({
        title: "Limit",
        description: `Es können höchstens ${MAX_BATCH_FILES} Dateien pro Stapel verarbeitet werden.`,
        variant: "destructive",
      });
    }
    if (allowed.length < incoming.length) {
      toast({
        title: "Einige Dateien übersprungen",
        description: "Nur PDF, PAD und Bilder (z. B. JPG, PNG) sind im Stapel erlaubt.",
      });
    }
    setUploadFiles((prev) => [...prev, ...slice]);
  };

  const submitCreate = async () => {
    const name = batchName.trim();
    if (!name) {
      toast({ title: "Name fehlt", description: "Bitte einen Batch-Namen eingeben.", variant: "destructive" });
      return;
    }
    if (uploadFiles.length === 0) {
      toast({
        title: "Keine Dateien",
        description: "Bitte PDFs, Bilder oder eine PAD-Datei hinzufügen.",
        variant: "destructive",
      });
      return;
    }
    let totalInvoices = 0;
    for (const f of uploadFiles) {
      if (f.name.toLowerCase().endsWith(".pad")) totalInvoices += await estimatePadRechnungCount(f);
      else totalInvoices += 1;
    }
    if (totalInvoices > MAX_BATCH_FILES) {
      toast({
        title: "Zu viele Rechnungen",
        description: `Nach Aufteilung der PAD-Datei(en) würden ${totalInvoices} Rechnungen entstehen (Maximum ${MAX_BATCH_FILES}).`,
        variant: "destructive",
      });
      return;
    }
    const planReady = planPreview ?? (await planBatchInvoicesFromFiles(uploadFiles, 0));
    if (planReady.length === 0) {
      toast({ title: "Keine Unterlagen", description: "Planung lieferte keine Zeilen.", variant: "destructive" });
      return;
    }
    const fk = fallKey.length === planReady.length ? fallKey : suggestFallKeysFromPlan(planReady);
    const id = await createBatchFromFiles(name, uploadFiles, fk);
    if (!id) {
      toast({ title: "Fehler", description: "Batch konnte nicht angelegt werden.", variant: "destructive" });
      return;
    }
    setCreateOpen(false);
    setBatchName("");
    setUploadFiles([]);
    toast({ title: "Stapel angelegt", description: name });
    navigate(`/batches/${id}`);
  };

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
        <main className="flex-1 overflow-y-auto p-4 md:p-8 max-w-5xl mx-auto w-full">
          <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
            <div>
              <h1 className="text-xl font-semibold flex items-center gap-2">
                <Layers className="w-6 h-6" />
                Stapel (Batches)
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Dauerhaft gespeichert — jederzeit öffnen, durchsuchen und exportieren.
              </p>
            </div>
            <Button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="gap-2"
              disabled={!canWriteBatches}
              title={
                !canWriteBatches
                  ? !organisationId
                    ? "Stapel erfordert eine Organisationszugehörigkeit (Eintrag im Team der Praxis / Klinik)."
                    : "Nur Organisations-Admin oder Manager können Stapel anlegen."
                  : undefined
              }
            >
              <Plus className="w-4 h-4" />
              Neuer Stapel
            </Button>
          </div>

          {loading ? (
            <p className="text-muted-foreground text-sm">Laden…</p>
          ) : list.length === 0 ? (
            <p className="text-sm text-muted-foreground border border-dashed border-border rounded-xl p-8 text-center">
              {canWriteBatches
                ? `Noch keine Stapel. Über „Neuer Stapel“ bis zu ${MAX_BATCH_FILES} PDFs oder eine PAD-Datei importieren.`
                : "Noch keine Stapel. (Zum Anlegen fehlt die Berechtigung: Admin oder Manager.)"}
            </p>
          ) : (
            <>
            <div className="rounded-lg border border-border/80 overflow-x-auto">
              <table className="w-full border-collapse min-w-[720px] text-sm">
                <thead>
                  <tr className="bg-muted/40 text-left text-muted-foreground border-b border-border text-xs">
                    <th className="py-2.5 pl-3 pr-2 min-w-[12rem]">Stapel</th>
                    <th className="py-2.5 pr-2 whitespace-nowrap">Rechn.</th>
                    <th className="py-2.5 pr-2 min-w-[7rem]">Verarbeitung</th>
                    <th className="py-2.5 pr-2 min-w-[14rem]">Kennzahlen</th>
                    <th className="py-2.5 pr-2 text-right">Gesamtbetrag</th>
                    <th className="py-2.5 pr-2 text-right">Opt.-Potenzial</th>
                    <th className="py-2.5 pr-3 text-right">Aktionen</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((b) => {
                    const z = b.zusammenfassung;
                    const isProc = b.status === "processing";
                    return (
                      <tr key={b.id} className="border-b border-border/50 hover:bg-muted/20">
                        <td className="py-2.5 pl-3 pr-2 align-top">
                          <Link to={`/batches/${b.id}`} className="font-medium text-foreground hover:underline block">
                            {praxisName} – {b.name}
                          </Link>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            {b.status === "processing"
                              ? "wird geprüft"
                              : b.status === "partial"
                                ? "abgeschlossen (mit Hinweisen)"
                                : "abgeschlossen"}
                          </p>
                        </td>
                        <td className="py-2.5 pr-2 align-top tabular-nums text-xs">
                          {b.faelleCount} Fälle
                          <span className="text-muted-foreground block">{b.rechnungenCount} Unt.</span>
                        </td>
                        <td className="py-2.5 pr-2 align-top text-xs">
                          {isProc ? (
                            <span>
                              {b.verarbeitetCount} / {b.rechnungenCount}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-2.5 pr-2 align-top text-xs text-muted-foreground">
                          {z.geprueft} gepr. · {z.mitHinweisen} Hinw. · {z.mitFehlern} Fehl. · {z.offen} offen
                        </td>
                        <td className="py-2.5 pr-2 align-top text-right tabular-nums text-xs">
                          {formatEuro2(z.gesamtbetrag)}
                        </td>
                        <td className="py-2.5 pr-2 align-top text-right tabular-nums text-xs">+{formatEuro2(z.optimierungspotenzial)}</td>
                        <td className="py-2.5 pr-3 align-top text-right">
                          <div className="flex flex-wrap items-center justify-end gap-1">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-8 text-xs"
                                  disabled={!canWriteBatches}
                                >
                                  Annehmen ▾
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={() => void runBulk({ type: "accept_all", batchId: b.id, rechnungIds: [] })}
                                  disabled={!canWriteBatches}
                                >
                                  Alle Vorschläge
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button type="button" variant="secondary" size="sm" className="h-8 text-xs">
                                  Export ▾
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={() =>
                                    void runBulk({
                                      type: "export_all",
                                      batchId: b.id,
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
                                      batchId: b.id,
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
                                      batchId: b.id,
                                      rechnungIds: [],
                                      optionen: { exportFormat: "pad", includeBegruendungen: true, includeHinweise: true },
                                    })
                                  }
                                >
                                  PAD
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              title={
                                canWriteBatches ? "Stapel löschen" : "Nur Admin oder Manager können löschen."
                              }
                              disabled={!canWriteBatches}
                              onClick={async () => {
                                if (!confirm("Diesen Stapel wirklich löschen?")) return;
                                const ok = await deleteBatch(b.id);
                                if (ok) toast({ title: "Gelöscht" });
                                else toast({ title: "Fehler", variant: "destructive" });
                              }}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <DocbillKiDisclaimerFooter className="not-prose max-w-4xl" />
            </>
          )}
        </main>
      </div>

      <Dialog
        open={createOpen}
        onOpenChange={(o) => {
          setCreateOpen(o);
          if (!o) {
            setBatchName("");
            setUploadFiles([]);
            setPlanPreview(null);
            setFallKey([]);
            setSelectedPlanIdx(new Set());
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Neuer Stapel</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="batch-name">Name</Label>
              <Input
                id="batch-name"
                value={batchName}
                onChange={(e) => setBatchName(e.target.value)}
                placeholder='z. B. "Quartalsabrechnung Q1/2026"'
              />
            </div>
            <div
              className="rounded-xl border-2 border-dashed border-border/80 p-6 text-center text-sm text-muted-foreground cursor-pointer hover:bg-muted/30 transition-colors"
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
              onClick={() => fileRef.current?.click()}
              role="presentation"
            >
              PDFs, Bilder (JPG, PNG, …) oder eine PAD-Datei (bis zu {MAX_BATCH_FILES} Dateien) per Drag & Drop oder
              Klick. Einzelne Rechnungen in PAD-Dateien werden heuristisch getrennt; pro Bild entsteht eine
              Listenzeile (Texterkennung im Stapel nicht, siehe Hinweis nach dem Anlegen).
              {uploadFiles.length > 0 ? (
                <p className="mt-2 text-foreground font-medium">{uploadFiles.length} Datei(en) ausgewählt</p>
              ) : null}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT_BATCH}
              multiple
              className="hidden"
              onChange={(e) => {
                const f = e.target.files;
                if (f?.length) addFiles(Array.from(f));
                e.target.value = "";
              }}
            />
            {planPreview && planPreview.length > 0 ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    {new Set(normalizeFallKeys(fallKey)).size} Fälle · {planPreview.length} Unterlagen. Gleiche
                    Pat-ID im Text wird vorbelegt; Sie können Zeilen markieren und zusammenführen.
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="text-xs h-8"
                    disabled={selectedPlanIdx.size < 2}
                    onClick={() => {
                      setFallKey((fk) => mergePlanIndices(fk, [...selectedPlanIdx]));
                      setSelectedPlanIdx(new Set());
                    }}
                  >
                    Ausgewählte zu einem Fall
                  </Button>
                </div>
                <div className="rounded-md border border-border/80 overflow-x-auto max-h-48 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/40 text-muted-foreground text-left border-b border-border">
                        <th className="py-1.5 pl-2 w-8" />
                        <th className="py-1.5 pr-2">Datei</th>
                        <th className="py-1.5 pr-2">Quelle</th>
                        <th className="py-1.5 pr-2">Pat.-Vorschau</th>
                        <th className="py-1.5 pr-2">Fall</th>
                      </tr>
                    </thead>
                    <tbody>
                      {planPreview.map((p, idx) => {
                        const nk = normalizeFallKeys(fallKey);
                        const g = nk[idx] ?? 0;
                        return (
                          <tr key={`${p.fileName}-${idx}`} className="border-b border-border/50">
                            <td className="py-1.5 pl-2">
                              <Checkbox
                                checked={selectedPlanIdx.has(idx)}
                                onCheckedChange={() => {
                                  setSelectedPlanIdx((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(idx)) next.delete(idx);
                                    else next.add(idx);
                                    return next;
                                  });
                                }}
                                aria-label={`Zeile ${idx + 1}`}
                              />
                            </td>
                            <td className="py-1.5 pr-2 max-w-[10rem] truncate" title={p.fileName}>
                              {p.fileName}
                            </td>
                            <td className="py-1.5 pr-2 uppercase">{p.quelle}</td>
                            <td className="py-1.5 pr-2 font-mono">{patLabelFromText(p.rohText, idx)}</td>
                            <td className="py-1.5 pr-2">Fall {g + 1}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
              Abbrechen
            </Button>
            <Button type="button" onClick={() => void submitCreate()}>
              Anlegen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

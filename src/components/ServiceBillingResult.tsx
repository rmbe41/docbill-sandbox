import { useState, useCallback } from "react";
import { Copy, ClipboardCheck, Download, CheckIcon, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { generateInvoicePdf, type PdfStammdaten } from "@/lib/pdf-invoice";
import { usePraxisStammdaten } from "@/hooks/usePraxisStammdaten";
import { SummaryCard } from "@/components/SummaryCard";

export interface ServiceBillingPosition {
  ziffer: string;
  bezeichnung: string;
  faktor: number;
  betrag: number;
  begruendung?: string;
  leistung: string;
  konfidenz: "hoch" | "mittel" | "niedrig";
}

export interface ServiceBillingSummary {
  gesamt: number;
  avg_factor: number;
  steigerungen: number;
  compliance_score?: number;
}

export interface SachkostenPosition {
  bezeichnung: string;
  betrag: number;
}

export interface ServiceBillingResultData {
  vorschlaege: ServiceBillingPosition[];
  optimierungen?: ServiceBillingPosition[];
  sachkosten?: SachkostenPosition[];
  summary?: ServiceBillingSummary;
  klinischerKontext: string;
  fachgebiet: string;
}

function formatEuro(n: number): string {
  return `${n.toFixed(2).replace(".", ",")} €`;
}

type ServiceBillingResultProps = {
  data: ServiceBillingResultData;
};

type Decision = "pending" | "accepted" | "rejected";

const getKey = (v: ServiceBillingPosition, isOpt = false) =>
  (isOpt ? "opt-" : "") + v.ziffer + "|" + v.leistung;

const ServiceBillingResult = ({ data }: ServiceBillingResultProps) => {
  const allItems = [
    ...data.vorschlaege.map((v) => ({ ...v, isOpt: false })),
    ...(data.optimierungen ?? []).map((v) => ({ ...v, isOpt: true })),
  ];
  const [decisions, setDecisions] = useState<Record<string, Decision>>(() => {
    const init: Record<string, Decision> = {};
    for (const v of data.vorschlaege) init[getKey(v, false)] = "pending";
    for (const v of data.optimierungen ?? []) init[getKey(v, true)] = "pending";
    return init;
  });
  const [copied, setCopied] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [patientName, setPatientName] = useState("");
  const [patientAdresse, setPatientAdresse] = useState("");
  const [patientGeburtsdatum, setPatientGeburtsdatum] = useState("");
  const [rechnungsnummer, setRechnungsnummer] = useState("");
  const [rechnungsdatum, setRechnungsdatum] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const { praxisStammdaten } = usePraxisStammdaten();

  const setDecision = useCallback((key: string, decision: Decision) => {
    setDecisions((prev) => ({ ...prev, [key]: decision }));
  }, []);

  const acceptAll = useCallback(() => {
    setDecisions((prev) => {
      const next = { ...prev };
      for (const v of data.vorschlaege) next[getKey(v, false)] = "accepted";
      for (const v of data.optimierungen ?? []) next[getKey(v, true)] = "accepted";
      return next;
    });
  }, [data.vorschlaege, data.optimierungen]);

  const acceptedPositions = allItems.filter(
    (item) => (decisions[getKey(item, item.isOpt)] ?? "pending") === "accepted"
  );
  const pendingCount = allItems.filter(
    (item) => (decisions[getKey(item, item.isOpt)] ?? "pending") === "pending"
  ).length;
  const rejectedCount = allItems.length - acceptedPositions.length - pendingCount;
  const sachkostenSumme = (data.sachkosten ?? []).reduce((sum, s) => sum + s.betrag, 0);
  const totalBetrag = acceptedPositions.reduce((sum, p) => sum + p.betrag, 0) + sachkostenSumme;

  const copyToClipboard = useCallback(async () => {
    const lines = acceptedPositions.map(
      (p) =>
        `${p.ziffer}\t${p.bezeichnung}\t${p.faktor.toFixed(1).replace(".", ",")}×\t${formatEuro(p.betrag)}`
    );
    const sachLines = (data.sachkosten ?? []).map(
      (s) => `Sachkosten\t${s.bezeichnung}\t-\t${formatEuro(s.betrag)}`
    );
    const allLines = [...lines, ...sachLines];
    const text = `${allLines.join("\n")}\n\nSumme: ${formatEuro(totalBetrag)}`;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [acceptedPositions, data.sachkosten, totalBetrag]);

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
    const goaePositions = acceptedPositions.map(({ isOpt, ...p }) => ({
      nr: 0,
      ziffer: p.ziffer,
      bezeichnung: p.bezeichnung,
      faktor: p.faktor,
      betrag: p.betrag,
      begruendung: p.begruendung,
    }));
    const sachkostenPositions = (data.sachkosten ?? []).map((s) => ({
      nr: 0,
      ziffer: "Sachk.",
      bezeichnung: s.bezeichnung,
      faktor: 0,
      betrag: s.betrag,
      begruendung: undefined as string | undefined,
    }));
    const positions = [...goaePositions, ...sachkostenPositions].map((p, i) => ({
      ...p,
      nr: i + 1,
    }));
    await generateInvoicePdf(positions, totalBetrag, stammdaten);
    setExportModalOpen(false);
  }, [
    praxisStammdaten,
    patientName,
    patientAdresse,
    patientGeburtsdatum,
    rechnungsnummer,
    rechnungsdatum,
    acceptedPositions,
    data.sachkosten,
    totalBetrag,
  ]);

  if (data.vorschlaege.length === 0 && (data.sachkosten?.length ?? 0) === 0) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        Keine abrechenbaren Leistungen erkannt. Bitte beschreiben Sie die erbrachten
        Leistungen genauer oder laden Sie einen Behandlungsbericht hoch.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ── Überblick ── */}
      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground mb-3">Überblick</h2>
        <div className="grid gap-2 grid-cols-2 sm:grid-cols-5">
          <SummaryCard
            label="Vorschl."
            value={allItems.length}
            variant="neutral"
          />
          <SummaryCard
            label="Angenommen"
            value={acceptedPositions.length}
            variant={pendingCount === 0 && rejectedCount === 0 ? "accent" : "neutral"}
          />
          <SummaryCard
            label="Ausstehend"
            value={pendingCount}
            variant={pendingCount > 0 ? "warning" : "neutral"}
          />
          <SummaryCard
            label="Abgelehnt"
            value={rejectedCount}
            variant={rejectedCount > 0 ? "warning" : "neutral"}
          />
          <SummaryCard
            label="Summe"
            value={formatEuro(totalBetrag)}
            variant="accent"
          />
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 mt-3 pt-3 border-t border-border text-xs text-muted-foreground">
          <span>Summe (ausgewählt): <strong className="text-foreground">{formatEuro(totalBetrag)}</strong></span>
          {data.summary && (
            <>
              <span>Summe (Vorschl.): <strong className="text-foreground">{formatEuro(data.summary.gesamt)}</strong></span>
              <span>Ø Faktor: <strong className="text-foreground">{data.summary.avg_factor.toFixed(1).replace(".", ",")}×</strong></span>
              <span>Steigerungen: <strong className="text-foreground">{data.summary.steigerungen}</strong></span>
              {data.summary.compliance_score != null && (
                <span>Compliance: <strong className="text-foreground">{(data.summary.compliance_score * 100).toFixed(0)}%</strong></span>
              )}
            </>
          )}
        </div>
        {data.summary?.compliance_score != null && data.summary.compliance_score < 0.9 && (
          <div className="mt-2 p-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-200">
            Hinweis: Compliance-Score unter 90 %. Bitte prüfen Sie Ausschlussziffern und Begründungen vor der Abrechnung.
          </div>
        )}
      </section>

      {/* ── GOÄ-Vorschläge ── */}
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="text-sm font-semibold text-foreground">GOÄ-Vorschläge</h2>
          <button
            type="button"
            onClick={() => setExportModalOpen(true)}
            disabled={acceptedPositions.length === 0 && (data.sachkosten?.length ?? 0) === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-muted hover:bg-muted/80 transition-colors disabled:opacity-50 disabled:pointer-events-none"
            title="Als PDF exportieren"
          >
            <Download className="w-4 h-4" />
            PDF exportieren
          </button>
        </div>

        {/* Alle annehmen – prominent über den Zeilen */}
        {pendingCount > 0 && (
          <div className="mb-3 p-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
            <button
              type="button"
              onClick={acceptAll}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
            >
              <CheckIcon className="w-4 h-4" />
              Alle annehmen
            </button>
          </div>
        )}

        <p className="text-xs text-muted-foreground mb-3">
          Jede Zeile: Annehmen oder Ablehnen wählen.
        </p>

        {/* Hauptvorschläge */}
        <h3 className="text-xs font-medium text-muted-foreground mb-2">Erkannte Leistungen</h3>
        <div className="space-y-2">
          {data.vorschlaege.map((v) => {
            const key = getKey(v, false);
            const decision = decisions[key] ?? "pending";
            const isAccepted = decision === "accepted";
            const isPending = decision === "pending";
            return (
              <div
                key={key}
                className={cn(
                  "rounded-lg border p-3 transition-colors",
                  isAccepted && "border-border bg-emerald-50/30 dark:bg-emerald-950/10",
                  isPending && "border-amber-400 dark:border-amber-500 bg-amber-50/50 dark:bg-amber-950/20",
                  decision === "rejected" && "border-border opacity-75"
                )}
              >
                <div className="flex justify-between items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-xs text-muted-foreground">
                        {v.ziffer}
                      </span>
                      {v.konfidenz === "mittel" && (
                        <span className="text-[10px] uppercase text-amber-600 dark:text-amber-400">
                          unsicher
                        </span>
                      )}
                      {v.konfidenz === "niedrig" && (
                        <span className="text-[10px] uppercase text-amber-600 dark:text-amber-400">
                          Begründung prüfen
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-medium truncate">{v.bezeichnung}</p>
                    {v.begruendung && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {v.begruendung}
                      </p>
                    )}
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <span className="font-mono text-xs text-muted-foreground">
                      {v.faktor.toFixed(1).replace(".", ",")}×
                    </span>
                    <span className="font-mono font-semibold ml-1">{formatEuro(v.betrag)}</span>
                  </div>
                </div>
                <div className="flex gap-1 pt-2 mt-2 border-t border-border/50">
                  <button
                    type="button"
                    onClick={() => setDecision(key, "accepted")}
                    className={cn(
                      "inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium",
                      isAccepted
                        ? "bg-emerald-600 text-white hover:bg-emerald-700"
                        : "text-emerald-600 hover:bg-emerald-100 dark:hover:bg-emerald-950/50"
                    )}
                  >
                    <CheckIcon className="w-3.5 h-3.5" />
                    Annehmen
                  </button>
                  <button
                    type="button"
                    onClick={() => setDecision(key, "rejected")}
                    className={cn(
                      "inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium",
                      decision === "rejected"
                        ? "text-red-600 bg-red-50 dark:bg-red-950/30"
                        : "text-red-600 hover:bg-red-100 dark:hover:bg-red-950/50"
                    )}
                  >
                    <X className="w-3.5 h-3.5" />
                    Ablehnen
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Sachkosten */}
        {(data.sachkosten?.length ?? 0) > 0 && (
          <>
            <h3 className="text-xs font-medium text-muted-foreground mt-4 mb-2">Sachkosten</h3>
            <div className="space-y-2">
              {data.sachkosten!.map((s, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-border bg-muted/20 p-3"
                >
                  <div className="flex justify-between items-center">
                    <p className="text-sm font-medium">{s.bezeichnung}</p>
                    <span className="font-mono font-semibold">{formatEuro(s.betrag)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Sachkosten werden zur Gesamtsumme addiert.
                  </p>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Zusätzliche Ziffern (Optimierungen) */}
        {(data.optimierungen?.length ?? 0) > 0 && (
          <>
            <h3 className="text-xs font-medium text-muted-foreground mt-4 mb-2">Zusätzliche Ziffern</h3>
            <div className="space-y-2">
              {data.optimierungen!.map((v) => {
                const key = getKey(v, true);
                const decision = decisions[key] ?? "pending";
                const isAccepted = decision === "accepted";
                const isPending = decision === "pending";
                return (
                  <div
                    key={key}
                    className={cn(
                      "rounded-lg border p-3 transition-colors",
                      isAccepted && "border-border bg-emerald-50/30 dark:bg-emerald-950/10",
                      isPending && "border-amber-400 dark:border-amber-500 bg-amber-50/50 dark:bg-amber-950/20",
                      decision === "rejected" && "border-border opacity-75"
                    )}
                  >
                    <div className="flex justify-between items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2">
                          <span className="font-mono text-xs text-muted-foreground">
                            {v.ziffer}
                          </span>
                        </div>
                        <p className="text-sm font-medium truncate">{v.bezeichnung}</p>
                        {v.begruendung && (
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                            {v.begruendung}
                          </p>
                        )}
                      </div>
                      <div className="flex-shrink-0 text-right">
                        <span className="font-mono text-xs text-muted-foreground">
                          {v.faktor.toFixed(1).replace(".", ",")}×
                        </span>
                        <span className="font-mono font-semibold ml-1">{formatEuro(v.betrag)}</span>
                      </div>
                    </div>
                    <div className="flex gap-1 pt-2 mt-2 border-t border-border/50">
                      <button
                        type="button"
                        onClick={() => setDecision(key, "accepted")}
                        className={cn(
                          "inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium",
                          isAccepted
                            ? "bg-emerald-600 text-white hover:bg-emerald-700"
                            : "text-emerald-600 hover:bg-emerald-100 dark:hover:bg-emerald-950/50"
                        )}
                      >
                        <CheckIcon className="w-3.5 h-3.5" />
                        Annehmen
                      </button>
                      <button
                        type="button"
                        onClick={() => setDecision(key, "rejected")}
                        className={cn(
                          "inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium",
                          decision === "rejected"
                            ? "text-red-600 bg-red-50 dark:bg-red-950/30"
                            : "text-red-600 hover:bg-red-100 dark:hover:bg-red-950/50"
                        )}
                      >
                        <X className="w-3.5 h-3.5" />
                        Ablehnen
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        <div className="mt-3 pt-3 border-t border-border flex items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">
            {acceptedPositions.length} von {allItems.length} angenommen
          </span>
          <strong className="font-mono font-semibold">{formatEuro(totalBetrag)}</strong>
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={copyToClipboard}
          disabled={acceptedPositions.length === 0 && (data.sachkosten?.length ?? 0) === 0}
        >
          {copied ? (
            <>
              <ClipboardCheck className="w-4 h-4 mr-2" />
              Kopiert
            </>
          ) : (
            <>
              <Copy className="w-4 h-4 mr-2" />
              Auswahl kopieren
            </>
          )}
        </Button>
      </div>

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

      {data.klinischerKontext && (
        <p className="text-xs text-muted-foreground border-t border-border pt-2">
          <span className="font-medium">Kontext:</span> {data.klinischerKontext}
        </p>
      )}
    </div>
  );
};

export default ServiceBillingResult;

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

export interface ServiceBillingResultData {
  vorschlaege: ServiceBillingPosition[];
  klinischerKontext: string;
  fachgebiet: string;
}

function formatEuro(n: number): string {
  return `${n.toFixed(2).replace(".", ",")} €`;
}

type ServiceBillingResultProps = {
  data: ServiceBillingResultData;
};

type Decision = "accepted" | "rejected";

const ServiceBillingResult = ({ data }: ServiceBillingResultProps) => {
  const getKey = (v: ServiceBillingPosition) => v.ziffer + "|" + v.leistung;
  const [decisions, setDecisions] = useState<Record<string, Decision>>(() => {
    const init: Record<string, Decision> = {};
    for (const v of data.vorschlaege) init[getKey(v)] = "accepted";
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
      for (const v of data.vorschlaege) next[getKey(v)] = "accepted";
      return next;
    });
  }, [data.vorschlaege]);

  const acceptedPositions = data.vorschlaege.filter(
    (v) => (decisions[getKey(v)] ?? "accepted") === "accepted"
  );
  const rejectedCount = data.vorschlaege.length - acceptedPositions.length;
  const totalBetrag = acceptedPositions.reduce((sum, p) => sum + p.betrag, 0);

  const copyToClipboard = useCallback(async () => {
    const lines = acceptedPositions.map(
      (p) =>
        `${p.ziffer}\t${p.bezeichnung}\t${p.faktor.toFixed(1).replace(".", ",")}×\t${formatEuro(p.betrag)}`
    );
    const text = `${lines.join("\n")}\n\nSumme: ${formatEuro(totalBetrag)}`;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [acceptedPositions, totalBetrag]);

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
    const positions = acceptedPositions.map((p, i) => ({
      nr: i + 1,
      ziffer: p.ziffer,
      bezeichnung: p.bezeichnung,
      faktor: p.faktor,
      betrag: p.betrag,
      begruendung: p.begruendung,
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
    totalBetrag,
  ]);

  if (data.vorschlaege.length === 0) {
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
        <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
          <SummaryCard
            label="Vorschl."
            value={data.vorschlaege.length}
            variant="neutral"
          />
          <SummaryCard
            label="Angenommen"
            value={acceptedPositions.length}
            variant={rejectedCount === 0 ? "accent" : "neutral"}
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
          <span>Summe: <strong className="text-foreground">{formatEuro(totalBetrag)}</strong></span>
        </div>
      </section>

      {/* ── GOÄ-Vorschläge ── */}
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="text-sm font-semibold text-foreground">GOÄ-Vorschläge</h2>
          <div className="flex items-center gap-2">
            {rejectedCount > 0 && (
              <button
                type="button"
                onClick={acceptAll}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
              >
                <CheckIcon className="w-4 h-4" />
                Alle annehmen
              </button>
            )}
            <button
              type="button"
              onClick={() => setExportModalOpen(true)}
              disabled={acceptedPositions.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-muted hover:bg-muted/80 transition-colors disabled:opacity-50 disabled:pointer-events-none"
              title="Als PDF exportieren"
            >
              <Download className="w-4 h-4" />
              PDF exportieren
            </button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Vorschläge direkt annehmen oder ablehnen.
        </p>
        <div className="space-y-2">
          {data.vorschlaege.map((v) => {
            const key = getKey(v);
            const decision = decisions[key] ?? "accepted";
            const isAccepted = decision === "accepted";
            return (
              <div
                key={key}
                className={cn(
                  "rounded-lg border border-border p-3 transition-colors",
                  isAccepted
                    ? "bg-emerald-50/30 dark:bg-emerald-950/10"
                    : "opacity-75"
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
                      !isAccepted
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
        <div className="mt-3 pt-3 border-t border-border flex items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">
            {acceptedPositions.length} von {data.vorschlaege.length} angenommen
          </span>
          <strong className="font-mono font-semibold">{formatEuro(totalBetrag)}</strong>
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={copyToClipboard}
          disabled={acceptedPositions.length === 0}
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
              Patient und Rechnungsdaten eingeben. Praxis & Bank aus Einstellungen werden übernommen.
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

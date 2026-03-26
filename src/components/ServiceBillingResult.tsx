import { useState, useCallback, useEffect, type ReactElement } from "react";
import { Download, CheckIcon, X } from "lucide-react";
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
import {
  isFaktorUeberSchwelle,
  stripDuplicateBegruendungPrefix,
  formatBegruendungFuerPdf,
} from "@/lib/format-goae-hinweis";

export interface ServiceBillingPosition {
  ziffer: string;
  bezeichnung: string;
  faktor: number;
  betrag: number;
  begruendung?: string;
  leistung: string;
  konfidenz: "hoch" | "mittel" | "niedrig";
  /** Auszug aus dem dokumentierten/behandelten Leistungstext (Herkunft der Zuordnung) */
  quelleBeschreibung?: string;
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
  messageId?: string | null;
  initialServiceDecisions?: Record<string, string> | null;
  onDecisionsChange?: (decisions: Record<string, string>) => void;
  onPersistServiceDecisions?: (decisions: Record<string, Decision>) => void;
};

type Decision = "pending" | "accepted" | "rejected";

const getKey = (v: ServiceBillingPosition, isOpt = false) =>
  (isOpt ? "opt-" : "") + v.ziffer + "|" + v.leistung;

function initialServiceDecisionsMap(
  data: ServiceBillingResultData,
  initial?: Record<string, string> | null,
): Record<string, Decision> {
  const init: Record<string, Decision> = {};
  for (const v of data.vorschlaege) {
    const k = getKey(v, false);
    const raw = initial?.[k];
    init[k] = raw === "accepted" || raw === "rejected" || raw === "pending" ? raw : "pending";
  }
  for (const v of data.optimierungen ?? []) {
    const k = getKey(v, true);
    const raw = initial?.[k];
    init[k] = raw === "accepted" || raw === "rejected" || raw === "pending" ? raw : "pending";
  }
  return init;
}

function formatFaktorDisplay(f: number): string {
  return f.toFixed(1).replace(".", ",");
}

const QUELLE_MAX_LEN = 220;

function truncateQuelle(s: string): string {
  const t = s.trim();
  if (t.length <= QUELLE_MAX_LEN) return t;
  return t.slice(0, QUELLE_MAX_LEN - 1).trimEnd() + "…";
}

function normalizeLeistungLabel(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Keine zweite Zeile, wenn der Quelltext nur die GOÄ-Bezeichnung wiederholt (ggf. + Typ in Klammern). */
function quelleOhneRedundanz(quelle: string, goaeBezeichnung: string): string | undefined {
  const q = quelle.trim();
  const g = goaeBezeichnung.trim();
  if (!q) return undefined;
  const nq = normalizeLeistungLabel(q);
  const ng = normalizeLeistungLabel(g);
  if (nq === ng) return undefined;
  const m = q.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (m) {
    const base = m[1].trim();
    const typ = m[2].trim();
    if (normalizeLeistungLabel(base) === ng) {
      return typ ? `(${typ})` : undefined;
    }
  }
  return q;
}

function hinweisZelleInhalt(v: ServiceBillingPosition): ReactElement | null {
  const text = v.begruendung?.trim();
  if (!text) return null;
  const steigerung = isFaktorUeberSchwelle(v.ziffer, v.faktor);
  const body = steigerung ? stripDuplicateBegruendungPrefix(text) : text;
  if (steigerung) {
    return (
      <span className="block leading-snug text-foreground/90">
        <span className="font-medium text-foreground">Begründung: </span>
        {body}
      </span>
    );
  }
  return <span className="text-foreground/90 leading-snug block">{body}</span>;
}

function leistungUnterzeile(v: ServiceBillingPosition): string | undefined {
  const b = v.bezeichnung?.trim() ?? "";
  const qRaw = v.quelleBeschreibung?.trim();
  if (qRaw) {
    const compact = quelleOhneRedundanz(qRaw, b);
    if (!compact) return undefined;
    return truncateQuelle(compact);
  }
  const l = v.leistung?.trim();
  if (!l) return undefined;
  const compact = quelleOhneRedundanz(l, b);
  if (!compact) return undefined;
  return truncateQuelle(compact);
}

function ServiceBillingPositionsTable({
  positions,
  isOpt,
  decisions,
  setDecision,
}: {
  positions: ServiceBillingPosition[];
  isOpt: boolean;
  decisions: Record<string, Decision>;
  setDecision: (key: string, decision: Decision) => void;
}) {
  if (positions.length === 0) return null;
  return (
    <div className="invoice-table-wrapper overflow-x-auto">
      <table className="invoice-table min-w-[46rem] w-full">
        <thead>
          <tr>
            <th className="invoice-th w-20">GOÄ-Nr</th>
            <th className="invoice-th min-w-[14rem]">Leistung</th>
            <th className="invoice-th text-right w-16">Faktor</th>
            <th className="invoice-th min-w-[8rem]">Hinweis</th>
            <th className="invoice-th text-right w-24">Betrag</th>
            <th className="invoice-th w-36">Aktion</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((v) => {
            const key = getKey(v, isOpt);
            const decision = decisions[key] ?? "pending";
            const isAccepted = decision === "accepted";
            const isPending = decision === "pending";
            const unterzeile = leistungUnterzeile(v);
            return (
              <tr
                key={key}
                className={cn(
                  "transition-colors",
                  isAccepted && "bg-emerald-50/40 dark:bg-emerald-950/15",
                  isPending && "bg-amber-50/40 dark:bg-amber-950/15",
                  decision === "rejected" && "opacity-75",
                )}
              >
                <td className="invoice-td font-mono font-semibold align-top">{v.ziffer}</td>
                <td className="invoice-td align-top">
                  <span className="text-sm font-medium text-foreground block break-words">{v.bezeichnung}</span>
                  {unterzeile && (
                    <span className="text-xs text-muted-foreground mt-0.5 block leading-snug">
                      {unterzeile}
                    </span>
                  )}
                  {isOpt && (
                    <span className="text-[10px] uppercase font-medium text-amber-600 dark:text-amber-400 mt-0.5 inline-block">
                      Zusatzposition
                    </span>
                  )}
                </td>
                <td className="invoice-td text-right font-mono align-top whitespace-nowrap">
                  {formatFaktorDisplay(v.faktor)}×
                </td>
                <td className="invoice-td text-xs text-muted-foreground align-top max-w-[14rem]">
                  <div className="space-y-1">
                    {hinweisZelleInhalt(v) ?? (
                      <span className="text-muted-foreground/80">—</span>
                    )}
                  </div>
                </td>
                <td className="invoice-td text-right font-mono font-semibold align-top whitespace-nowrap">
                  {formatEuro(v.betrag)}
                </td>
                <td className="invoice-td align-top">
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      onClick={() => setDecision(key, "accepted")}
                      className={cn(
                        "inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium",
                        isAccepted
                          ? "bg-emerald-600 text-white hover:bg-emerald-700"
                          : "text-emerald-600 hover:bg-emerald-100 dark:hover:bg-emerald-950/50",
                      )}
                    >
                      <CheckIcon className="w-3.5 h-3.5 shrink-0" />
                      Annehmen
                    </button>
                    <button
                      type="button"
                      onClick={() => setDecision(key, "rejected")}
                      className={cn(
                        "inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium",
                        decision === "rejected"
                          ? "text-red-600 bg-red-50 dark:bg-red-950/30"
                          : "text-red-600 hover:bg-red-100 dark:hover:bg-red-950/50",
                      )}
                    >
                      <X className="w-3.5 h-3.5 shrink-0" />
                      Ablehnen
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const ServiceBillingResult = ({
  data,
  messageId = null,
  initialServiceDecisions = null,
  onDecisionsChange,
  onPersistServiceDecisions,
}: ServiceBillingResultProps) => {
  const allItems = [
    ...data.vorschlaege.map((v) => ({ ...v, isOpt: false })),
    ...(data.optimierungen ?? []).map((v) => ({ ...v, isOpt: true })),
  ];
  const [decisions, setDecisions] = useState<Record<string, Decision>>(() =>
    initialServiceDecisionsMap(data, initialServiceDecisions),
  );
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

  useEffect(() => {
    if (!onDecisionsChange) return;
    onDecisionsChange(
      Object.fromEntries(Object.entries(decisions).map(([k, v]) => [k, v])),
    );
  }, [decisions, onDecisionsChange]);

  useEffect(() => {
    if (!messageId || !onPersistServiceDecisions) return;
    const t = window.setTimeout(() => {
      onPersistServiceDecisions(decisions);
    }, 450);
    return () => clearTimeout(t);
  }, [decisions, messageId, onPersistServiceDecisions]);

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
      begruendung: formatBegruendungFuerPdf(p.ziffer, p.faktor, p.begruendung),
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
      <div className="rounded-lg bg-muted/30 p-4 text-sm text-muted-foreground">
        Keine abrechenbaren Leistungen erkannt. Bitte beschreiben Sie die erbrachten
        Leistungen genauer oder laden Sie einen Behandlungsbericht hoch.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ── Überblick ── */}
      <section className="rounded-xl p-4 bg-muted/20 dark:bg-muted/10">
        <h2 className="text-sm font-semibold text-foreground mb-3">Überblick</h2>
        <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
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
        {data.summary?.compliance_score != null && data.summary.compliance_score < 0.9 && (
          <div className="mt-2 p-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 text-xs text-amber-800 dark:text-amber-200">
            Hinweis: Compliance-Score unter 90 %. Bitte prüfen Sie Ausschlussziffern und Begründungen vor der Abrechnung.
          </div>
        )}
      </section>

      {/* ── Vorschläge ── */}
      <section className="rounded-xl p-4 bg-muted/20 dark:bg-muted/10">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="text-sm font-semibold text-foreground">Vorschläge</h2>
          <div className="flex flex-nowrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setExportModalOpen(true)}
              disabled={acceptedPositions.length === 0 && (data.sachkosten?.length ?? 0) === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-muted hover:bg-muted/80 transition-colors disabled:opacity-50 disabled:pointer-events-none shrink-0"
              title="Als PDF exportieren"
            >
              <Download className="w-4 h-4 shrink-0" />
              PDF exportieren
            </button>
            {pendingCount > 0 && (
              <button
                type="button"
                onClick={acceptAll}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 transition-colors shrink-0"
              >
                <CheckIcon className="w-4 h-4 shrink-0" />
                Alle annehmen
              </button>
            )}
          </div>
        </div>

        <p className="text-xs text-muted-foreground mb-3">
          Die GOÄ-Zuordnung bezieht sich auf Ihren eingegebenen Text bzw. den Inhalt des hochgeladenen
          Dokuments. Jede Zeile: Annehmen oder Ablehnen wählen.
        </p>

        {/* Hauptvorschläge */}
        <h3 className="text-xs font-medium text-muted-foreground mb-2">Erkannte Leistungen</h3>
        <ServiceBillingPositionsTable
          positions={data.vorschlaege}
          isOpt={false}
          decisions={decisions}
          setDecision={setDecision}
        />

        {/* Sachkosten */}
        {(data.sachkosten?.length ?? 0) > 0 && (
          <>
            <h3 className="text-xs font-medium text-muted-foreground mt-4 mb-2">Sachkosten</h3>
            <div className="space-y-2">
              {data.sachkosten!.map((s, i) => (
                <div
                  key={i}
                  className="rounded-lg bg-muted/20 p-3"
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
            <ServiceBillingPositionsTable
              positions={data.optimierungen!}
              isOpt
              decisions={decisions}
              setDecision={setDecision}
            />
          </>
        )}

        <div className="mt-4 pt-1 flex items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">
            {acceptedPositions.length} von {allItems.length} angenommen
          </span>
          <strong className="font-mono font-semibold">{formatEuro(totalBetrag)}</strong>
        </div>
      </section>

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
        <p className="text-xs text-muted-foreground mt-2 pt-1">
          <span className="font-medium">Kontext:</span> {data.klinischerKontext}
        </p>
      )}
    </div>
  );
};

export default ServiceBillingResult;

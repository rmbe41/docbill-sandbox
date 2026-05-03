import { useMemo, useState, useEffect, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useSandbox } from "@/lib/sandbox/sandboxStore";
import { invoicePresentationPatch } from "@/lib/sandbox/invoicePresentation";
import { BILLING_CASES } from "@/lib/sandbox/billingCases";
import { SANDBOX_CONSENT_LABEL, type HighlightSnippet } from "@/lib/sandbox/types";
import {
  germanLabelForSandboxDocField,
  sandboxHighlightsForCode,
} from "@/lib/sandbox/billingEvidence";
import { CodePickerDialog, type CodePickerKind } from "@/components/sandbox/CodePickerDialog";
import { SendInvoiceDialog } from "@/components/sandbox/SendInvoiceDialog";
import { InsurerLabelRow } from "@/components/sandbox/InsurerMark";
import { PayerChip, SandboxGoaePositionBlock } from "@/components/sandbox/sandboxUi";
import { serviceItemGoae } from "@/lib/sandbox/sandboxTariff";
import { Check } from "lucide-react";
import { formatSandboxDateEuropean } from "@/lib/sandbox/europeanDate";

export default function SandboxReviewPage() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const navigate = useNavigate();
  const { state, patchInvoice, patchDocumentation } = useSandbox();

  const invoice = state.invoices.find((i) => i.id === invoiceId);
  const doc = invoice ? state.documentations.find((d) => d.id === invoice.documentation_id) : undefined;
  const patient = invoice ? state.patients.find((p) => p.id === invoice.patient_id) : undefined;

  const [pickerKind, setPickerKind] = useState<CodePickerKind | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [acceptedLines, setAcceptedLines] = useState<Set<string>>(() => new Set());

  const highlights = useMemo(() => {
    if (!doc?.case_id) return [] as HighlightSnippet[];
    return BILLING_CASES.find((c) => c.id === doc.case_id)?.highlights ?? [];
  }, [doc?.case_id]);

  if (!invoice || !doc || !patient) {
    return (
      <div className="text-sm text-muted-foreground">
        Rechnung nicht gefunden.{" "}
        <Link to="/sandbox/rechnungen" className="text-primary underline">
          Zum Board
        </Link>
      </div>
    );
  }
  const isStatutory = invoice.billing_basis === "statutory";
  const isProposed = invoice.status === "proposed";

  const lineKeyList = useMemo(() => {
    if (isStatutory) return invoice.service_items_ebm.map((r) => `ebm:${r.code}`);
    return invoice.service_items_goae.map((_, i) => `goae:${i}`);
  }, [isStatutory, invoice.service_items_ebm, invoice.service_items_goae]);

  const lineKeysSig = lineKeyList.join("\x1e");

  useEffect(() => {
    if (!isProposed) return;
    setAcceptedLines(new Set());
  }, [invoice.id, lineKeysSig, isProposed]);

  const applyPresentation = (next: typeof invoice) => {
    patchInvoice(invoice.id, invoicePresentationPatch(next));
  };

  const addPick = (row: {
    code: string;
    label: string;
    factor?: number;
    amount?: number;
    amount_eur?: number;
    points?: number;
  }) => {
    if (pickerKind === "goae" && row.factor != null) {
      const built = serviceItemGoae(row.code, row.factor);
      if (!built) return;
      const service_items_goae = [...invoice.service_items_goae, built];
      const next = { ...invoice, service_items_goae };
      patchInvoice(invoice.id, { service_items_goae });
      applyPresentation(next);
    } else if (pickerKind === "ebm") {
      const service_items_ebm = [
        ...invoice.service_items_ebm,
        { code: row.code, label: row.label, points: row.points, amount_eur: row.amount_eur },
      ];
      const next = { ...invoice, service_items_ebm };
      patchInvoice(invoice.id, { service_items_ebm });
      applyPresentation(next);
    }
  };

  const approve = () => {
    patchInvoice(invoice.id, {
      status: "approved",
      timeline: [...invoice.timeline, { ts: new Date().toISOString(), event: "Freigegeben", actor: "Dr. A. Linsen" }],
    });
    patchDocumentation(doc.id, { status: "invoiced" });
    setSendOpen(true);
  };

  return (
    <div className="flex flex-col gap-4 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Abrechnungsvorschlag</h1>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/sandbox/rechnungen">Abbrechen</Link>
          </Button>
          {invoice.status === "approved" ? (
            <Button type="button" size="sm" onClick={() => setSendOpen(true)}>
              Versenden
            </Button>
          ) : invoice.status === "proposed" ? (
            <Button type="button" size="sm" onClick={approve}>
              Freigeben
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 min-h-[calc(100vh-220px)]">
        <ScrollArea className="rounded-lg border border-border/80 bg-background shadow-sm h-[min(70vh,640px)] lg:h-auto">
          <div className="p-4 text-sm space-y-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Patient</p>
              <p className="font-medium">{patient.name}</p>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <PayerChip type={patient.insurance_type} />
                <InsurerLabelRow name={patient.insurance_provider} textClassName="text-xs text-muted-foreground" />
                <span className="text-xs text-muted-foreground tabular-nums">VN {patient.insurance_number}</span>
              </div>
              {(patient.street || patient.postal_code || patient.city) && (
                <p className="text-xs text-muted-foreground mt-2 leading-snug">
                  {[patient.street, [patient.postal_code, patient.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")}
                </p>
              )}
              {(patient.phone || patient.phone_alt || patient.email) && (
                <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                  {patient.phone && <p>Tel.: {patient.phone}</p>}
                  {patient.phone_alt && <p>Tel. alt.: {patient.phone_alt}</p>}
                  {patient.email && <p>E-Mail: {patient.email}</p>}
                </div>
              )}
              {patient.consent_status != null && (
                <p className="text-xs text-muted-foreground mt-1">
                  Einwilligung: {SANDBOX_CONSENT_LABEL[patient.consent_status]}
                </p>
              )}
              <p className="text-xs text-muted-foreground mt-1 tabular-nums">{formatSandboxDateEuropean(doc.date)}</p>
            </div>
            <Separator />
            <DocBlock title="Anamnese" text={doc.anamnesis} highlights={highlights.filter((h) => h.field === "anamnesis")} />
            <DocBlock title="Befund" text={doc.findings} highlights={highlights.filter((h) => h.field === "findings")} />
            <DocBlock title="Diagnose" text={doc.diagnosis_text} highlights={highlights.filter((h) => h.field === "diagnosis_text")} />
            <DocBlock title="Therapie" text={doc.therapy} highlights={highlights.filter((h) => h.field === "therapy")} />
          </div>
        </ScrollArea>

        <div className="flex flex-col rounded-lg border border-border/80 bg-background shadow-sm min-h-[min(70vh,640px)]">
          <div className="p-4 border-b border-border/70">
            <div className="flex flex-wrap items-center justify-between gap-2 gap-y-2">
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <InsurerLabelRow name={patient.insurance_provider} textClassName="text-xs text-muted-foreground" />
                <span className="text-xs text-muted-foreground tabular-nums shrink-0">VN {patient.insurance_number}</span>
              </div>
              <PayerChip type={patient.insurance_type} />
            </div>
          </div>

          <ScrollArea className="flex-1 p-4">
            <div className="space-y-6 text-sm">
              {isStatutory ? (
                <div>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 mb-2">
                    <p className="text-xs font-medium text-muted-foreground shrink-0">EBM (GKV)</p>
                    {isProposed && lineKeyList.length > 0 ? (
                      <p className="text-xs text-muted-foreground leading-snug text-end min-w-0 flex-1 basis-[10rem]">
                        Für die Freigabe: Alle Positionen bestätigen – einzeln mit „Annehmen“ oder auf einmal mit „Alle annehmen“.
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap justify-end gap-2 mb-2">
                    <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setPickerKind("ebm")}>
                      Hinzufügen
                    </Button>
                    {isProposed && lineKeyList.length > 0 ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => setAcceptedLines(new Set(lineKeyList))}
                      >
                        Alle annehmen
                      </Button>
                    ) : null}
                  </div>
                  <ul className="space-y-2">
                    {invoice.service_items_ebm.map((r, i) => {
                      const key = `ebm:${r.code}`;
                      const ok = acceptedLines.has(key);
                      const evidenceLinks = sandboxHighlightsForCode(highlights, r.code);
                      return (
                        <li key={`ebm-${i}-${r.code}`} className="border border-border/60 rounded-md p-2 text-xs">
                          <div className="flex justify-between gap-2 items-start">
                            <div className="min-w-0 flex-1 space-y-0.5">
                              <p className="min-w-0 leading-snug">
                                <span className="font-mono">{r.code}</span> {r.label}
                              </p>
                              <LineDocEvidence hints={evidenceLinks} />
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="tabular-nums text-muted-foreground">
                                {(r.amount_eur ?? 0).toLocaleString("de-DE", { style: "currency", currency: "EUR" })}
                              </span>
                              {isProposed ? (
                                <Button
                                  variant={ok ? "secondary" : "outline"}
                                  size="sm"
                                  className="h-7 px-2 text-[10px] gap-1"
                                  type="button"
                                  onClick={() =>
                                    setAcceptedLines((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(key)) next.delete(key);
                                      else next.add(key);
                                      return next;
                                    })
                                  }
                                  title={ok ? "Annehmung zurücknehmen" : "Position annehmen"}
                                >
                                  {ok ? <Check className="h-3 w-3" /> : null}
                                  {ok ? "Angenommen" : "Annehmen"}
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : (
                <div>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 mb-2">
                    <p className="text-xs font-medium text-muted-foreground shrink-0">GOÄ (Privat / Selbstzahler)</p>
                    {isProposed && lineKeyList.length > 0 ? (
                      <p className="text-xs text-muted-foreground leading-snug text-end min-w-0 flex-1 basis-[10rem]">
                        Für die Freigabe: Alle Positionen bestätigen – einzeln mit „Annehmen“ oder auf einmal mit „Alle annehmen“.
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap justify-end gap-2 mb-2">
                    <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setPickerKind("goae")}>
                      Hinzufügen
                    </Button>
                    {isProposed && lineKeyList.length > 0 ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => setAcceptedLines(new Set(lineKeyList))}
                      >
                        Alle annehmen
                      </Button>
                    ) : null}
                  </div>
                  <ul className="space-y-2">
                    {invoice.service_items_goae.map((r, idx) => {
                      const key = `goae:${idx}`;
                      const ok = acceptedLines.has(key);
                      const evidenceLinks = sandboxHighlightsForCode(highlights, r.code);
                      return (
                        <li key={`${r.code}-${idx}`} className="border border-border/60 rounded-md p-2 text-xs">
                          <div className="flex justify-between gap-2 items-start">
                            <div className="min-w-0 flex-1">
                              <SandboxGoaePositionBlock
                                row={r}
                                docEvidence={<LineDocEvidence hints={evidenceLinks} />}
                              />
                            </div>
                            <div className="flex flex-col items-end gap-2 shrink-0">
                              <span className="tabular-nums">{r.amount.toLocaleString("de-DE", { style: "currency", currency: "EUR" })}</span>
                              {isProposed ? (
                                <Button
                                  variant={ok ? "secondary" : "outline"}
                                  size="sm"
                                  className="h-7 px-2 text-[10px] gap-1"
                                  type="button"
                                  onClick={() =>
                                    setAcceptedLines((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(key)) next.delete(key);
                                      else next.add(key);
                                      return next;
                                    })
                                  }
                                  title={ok ? "Annehmung zurücknehmen" : "Position annehmen"}
                                >
                                  {ok ? <Check className="h-3 w-3" /> : null}
                                  {ok ? "Angenommen" : "Annehmen"}
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          </ScrollArea>

          <div className="p-4 border-t border-border/70 bg-muted/20">
            <div className="text-xs text-muted-foreground tabular-nums text-right w-full">
              Summe{" "}
              <span className="text-lg font-semibold text-foreground inline-block ml-2">
                {invoice.total_amount.toLocaleString("de-DE", { style: "currency", currency: "EUR" })}
              </span>
            </div>
          </div>
        </div>
      </div>

      <CodePickerDialog kind={pickerKind ?? "goae"} open={pickerKind !== null} onOpenChange={(o) => !o && setPickerKind(null)} onPick={addPick} />

      <SendInvoiceDialog invoice={invoice} open={sendOpen} onOpenChange={setSendOpen} onSent={() => navigate("/sandbox/rechnungen")} />
    </div>
  );
}

function LineDocEvidence({ hints }: { hints: HighlightSnippet[] }) {
  return (
    <div className="text-[10px] leading-snug space-y-0.5">
      {hints.length > 0 ? (
        <ul className="text-muted-foreground space-y-0.5 pl-0">
          {hints.map((h, hi) => (
            <li key={`${h.field}-${hi}-${h.ref}-${h.snippet.slice(0, 12)}`}>
              <span className="text-foreground/90">{germanLabelForSandboxDocField(h.field)}:</span> „{h.snippet}“
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground italic">Keine dokumentierte Ableitung im Demo-Datensatz.</p>
      )}
    </div>
  );
}

function DocBlock({ title, text, highlights }: { title: string; text: string; highlights: HighlightSnippet[] }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground mb-1">{title}</p>
      <p className="leading-relaxed whitespace-pre-wrap">
        <Highlighted text={text} snippets={highlights} />
      </p>
    </div>
  );
}

function Highlighted({ text, snippets }: { text: string; snippets: HighlightSnippet[] }) {
  if (!snippets.length) return <>{text}</>;
  const parts: ReactNode[] = [];
  let cursor = 0;
  const positions = snippets
    .map((s) => ({ ...s, i: text.indexOf(s.snippet) }))
    .filter((s) => s.i >= 0)
    .sort((a, b) => a.i - b.i);

  for (const s of positions) {
    if (s.i > cursor) parts.push(text.slice(cursor, s.i));
    parts.push(
      <mark key={`${s.ref}-${s.i}`} className="bg-primary/15 dark:bg-primary/25 text-foreground px-0.5 rounded ring-1 ring-border/60" title={`Ziffer ${s.ref}`}>
        {s.snippet}
      </mark>,
    );
    cursor = s.i + s.snippet.length;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { useSandbox } from "@/lib/sandbox/sandboxStore";
import { invoicePresentationPatch } from "@/lib/sandbox/invoicePresentation";
import { BILLING_CASES } from "@/lib/sandbox/billingCases";
import type { HighlightSnippet } from "@/lib/sandbox/types";
import { CodePickerDialog, type CodePickerKind } from "@/components/sandbox/CodePickerDialog";
import { SendInvoiceDialog } from "@/components/sandbox/SendInvoiceDialog";
import { PayerChip } from "@/components/sandbox/sandboxUi";
import { Trash2 } from "lucide-react";

export default function SandboxReviewPage() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const navigate = useNavigate();
  const { state, patchInvoice, patchDocumentation, rejectProposal } = useSandbox();

  const invoice = state.invoices.find((i) => i.id === invoiceId);
  const doc = invoice ? state.documentations.find((d) => d.id === invoice.documentation_id) : undefined;
  const patient = invoice ? state.patients.find((p) => p.id === invoice.patient_id) : undefined;

  const [pickerKind, setPickerKind] = useState<CodePickerKind | null>(null);
  const [sendOpen, setSendOpen] = useState(false);

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

  const applyPresentation = (next: typeof invoice) => {
    patchInvoice(invoice.id, invoicePresentationPatch(next));
  };

  const removeIcd = (code: string) => {
    const diagnosis_codes = invoice.diagnosis_codes.filter((d) => d.code !== code);
    const next = { ...invoice, diagnosis_codes };
    patchInvoice(invoice.id, { diagnosis_codes });
    applyPresentation(next);
  };

  const removeEbm = (code: string) => {
    const service_items_ebm = invoice.service_items_ebm.filter((x) => x.code !== code);
    const next = { ...invoice, service_items_ebm };
    patchInvoice(invoice.id, { service_items_ebm });
    applyPresentation(next);
  };

  const removeGoae = (code: string) => {
    const service_items_goae = invoice.service_items_goae.filter((x) => x.code !== code);
    const next = { ...invoice, service_items_goae };
    patchInvoice(invoice.id, { service_items_goae });
    applyPresentation(next);
  };

  const addPick = (row: {
    code: string;
    label: string;
    factor?: number;
    amount?: number;
    amount_eur?: number;
    points?: number;
  }) => {
    if (pickerKind === "goae" && row.factor != null && row.amount != null) {
      const service_items_goae = [...invoice.service_items_goae, { code: row.code, label: row.label, factor: row.factor, amount: row.amount }];
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

  const reject = () => {
    rejectProposal(invoice.id);
    navigate("/sandbox/dokumentationen");
  };

  return (
    <div className="flex flex-col gap-4 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Abrechnungsvorschlag — Review</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Links Doku (read-only), rechts Vorschlag mit EBM und GOÄ. Änderungen werden lokal gespeichert.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to="/sandbox/rechnungen">Schließen</Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 min-h-[calc(100vh-220px)]">
        <ScrollArea className="rounded-lg border border-border/80 bg-background shadow-sm h-[min(70vh,640px)] lg:h-auto">
          <div className="p-4 text-sm space-y-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Patient:in</p>
              <p className="font-medium">{patient.name}</p>
              <p className="text-xs text-muted-foreground mt-1">{doc.date}</p>
            </div>
            <Separator />
            <DocBlock title="Anamnese" text={doc.anamnesis} highlights={highlights.filter((h) => h.field === "anamnesis")} />
            <DocBlock title="Befund" text={doc.findings} highlights={highlights.filter((h) => h.field === "findings")} />
            <DocBlock title="Diagnose" text={doc.diagnosis_text} highlights={highlights.filter((h) => h.field === "diagnosis_text")} />
            <DocBlock title="Therapie" text={doc.therapy} highlights={highlights.filter((h) => h.field === "therapy")} />
          </div>
        </ScrollArea>

        <div className="flex flex-col rounded-lg border border-border/80 bg-background shadow-sm min-h-[min(70vh,640px)]">
          <div className="p-4 border-b border-border/70 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <PayerChip type={patient.insurance_type} />
              <span className="text-xs text-muted-foreground">{patient.insurance_provider}</span>
              <span className="text-xs text-muted-foreground tabular-nums">VN {patient.insurance_number}</span>
            </div>
          </div>

          <ScrollArea className="flex-1 p-4">
            <div className="space-y-6 text-sm">
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">ICD-10</p>
                <p className="text-[11px] text-muted-foreground leading-snug mb-2">
                  Strukturierte Diagnosecodes für Abrechnung, Kostenträger-Rückmeldungen und die Zuordnung zu EBM/GOÄ. In der Akte links bleibt der
                  Freitext; die Codes schlägt der Prototyp erst im Abrechnungsvorschlag vor.
                </p>
                <ul className="space-y-2">
                  {invoice.diagnosis_codes.map((d) => (
                    <li key={d.code} className="flex flex-wrap gap-2 items-start justify-between border border-border/60 rounded-md p-2">
                      <div className="min-w-0">
                        <span className="font-mono text-xs">{d.code}</span>{" "}
                        <span className="text-xs">{d.label}</span>
                        <p className="text-[11px] text-muted-foreground mt-1">{d.rationale}</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <ConfidenceBadge c={d.confidence} />
                        <Button variant="ghost" size="icon" className="h-8 w-8" type="button" onClick={() => removeIcd(d.code)} aria-label="Entfernen">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className="text-xs font-medium text-muted-foreground">EBM (GKV-Leistungen)</p>
                  <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setPickerKind("ebm")}>
                    Hinzufügen
                  </Button>
                </div>
                <ul className="space-y-2">
                  {invoice.service_items_ebm.map((r) => (
                    <li key={r.code} className="flex justify-between gap-2 border border-border/60 rounded-md p-2 text-xs">
                      <span className="min-w-0">
                        <span className="font-mono">{r.code}</span> {r.label}
                      </span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="tabular-nums text-muted-foreground">
                          {(r.amount_eur ?? 0).toLocaleString("de-DE", { style: "currency", currency: "EUR" })}
                        </span>
                        <Button variant="ghost" size="icon" className="h-7 w-7" type="button" onClick={() => removeEbm(r.code)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className="text-xs font-medium text-muted-foreground">GOÄ (Referenz / privatärztliche Parallelrechnung)</p>
                  <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setPickerKind("goae")}>
                    Hinzufügen
                  </Button>
                </div>
                <ul className="space-y-2">
                  {invoice.service_items_goae.map((r) => (
                    <li key={r.code} className="flex justify-between gap-2 border border-border/60 rounded-md p-2 text-xs">
                      <span className="min-w-0">
                        <span className="font-mono">{r.code}</span> {r.label}{" "}
                        <span className="text-muted-foreground">Faktor {r.factor}</span>
                      </span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="tabular-nums">{r.amount.toLocaleString("de-DE", { style: "currency", currency: "EUR" })}</span>
                        <Button variant="ghost" size="icon" className="h-7 w-7" type="button" onClick={() => removeGoae(r.code)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </ScrollArea>

          <div className="p-4 border-t border-border/70 flex flex-wrap items-center justify-between gap-3 bg-muted/20">
            <div className="text-xs text-muted-foreground">
              Summe{" "}
              <span className="text-lg font-semibold text-foreground tabular-nums ml-2">
                {invoice.total_amount.toLocaleString("de-DE", { style: "currency", currency: "EUR" })}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={reject}>
                Ablehnen
              </Button>
              {invoice.status === "approved" ? (
                <Button type="button" size="sm" onClick={() => setSendOpen(true)}>
                  Versenden
                </Button>
              ) : (
                <Button type="button" size="sm" onClick={approve} disabled={invoice.status !== "proposed"}>
                  Freigeben
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      <CodePickerDialog kind={pickerKind ?? "goae"} open={pickerKind !== null} onOpenChange={(o) => !o && setPickerKind(null)} onPick={addPick} />

      <SendInvoiceDialog invoice={invoice} open={sendOpen} onOpenChange={setSendOpen} onSent={() => navigate("/sandbox/rechnungen")} />
    </div>
  );
}

function ConfidenceBadge({ c }: { c: "high" | "medium" | "low" }) {
  const label = c === "high" ? "Hoch" : c === "medium" ? "Mittel" : "Niedrig";
  const variant: "default" | "secondary" | "destructive" =
    c === "high" ? "default" : c === "medium" ? "secondary" : "destructive";
  return (
    <Badge variant={variant} className="text-[10px] font-normal">
      {label}
    </Badge>
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
      <mark key={`${s.ref}-${s.i}`} className="bg-primary/15 dark:bg-primary/25 text-foreground px-0.5 rounded ring-1 ring-border/60" title={`Zuordnung ${s.ref}`}>
        {s.snippet}
      </mark>,
    );
    cursor = s.i + s.snippet.length;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

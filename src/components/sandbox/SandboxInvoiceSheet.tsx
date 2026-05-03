import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useSandbox } from "@/lib/sandbox/sandboxStore";
import type { SandboxInvoice } from "@/lib/sandbox/types";
import { InsurerLabelRow } from "@/components/sandbox/InsurerMark";
import { ConfidenceDot, PayerChip, SandboxGoaePositionBlock } from "@/components/sandbox/sandboxUi";
import { terminalSubLabel } from "@/lib/sandbox/board";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useState } from "react";
import { SendInvoiceDialog } from "@/components/sandbox/SendInvoiceDialog";

export function SandboxInvoiceSheet({
  invoice,
  open,
  onOpenChange,
}: {
  invoice: SandboxInvoice | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const navigate = useNavigate();
  const { state, patchInvoice } = useSandbox();
  const [revertOpen, setRevertOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);

  if (!invoice) return null;

  const patient = state.patients.find((p) => p.id === invoice.patient_id);
  const doc = state.documentations.find((d) => d.id === invoice.documentation_id);

  const confirmRevertSent = () => {
    patchInvoice(invoice.id, {
      status: "approved",
      timeline: [
        ...invoice.timeline,
        {
          ts: new Date().toISOString(),
          event: "Zurück zu Freigegeben",
          actor: "Nutzer",
        },
      ],
    });
    setRevertOpen(false);
    onOpenChange(false);
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-xl flex flex-col gap-0 p-0">
          <SheetHeader className="p-6 pb-4 border-b border-border/80 text-left space-y-1">
            <SheetTitle className="text-base">{patient?.name ?? "Patient:in"}</SheetTitle>
            <SheetDescription className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              {patient && <PayerChip type={patient.insurance_type} />}
              {patient && (
                <InsurerLabelRow
                  name={patient.insurance_provider}
                  textClassName="text-muted-foreground max-w-[220px] truncate text-xs"
                />
              )}
              {patient && (
                <span className="text-muted-foreground tabular-nums">VN {patient.insurance_number}</span>
              )}
              <span className="text-muted-foreground">{doc?.date}</span>
              <ConfidenceDot tier={invoice.confidence_tier} percent={invoice.confidence_percent} />
              <span className="tabular-nums font-medium">{invoice.total_amount.toLocaleString("de-DE", { style: "currency", currency: "EUR" })}</span>
            </SheetDescription>
          </SheetHeader>

          <ScrollArea className="flex-1 px-6 py-4">
            <div className="space-y-4 text-sm">
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Status</p>
                <p>{invoice.status}</p>
                {invoiceBoardTerminal(invoice) && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {terminalSubLabel(invoice) === "paid"
                      ? "Bezahlt"
                      : terminalSubLabel(invoice) === "denied"
                        ? "Abgelehnt"
                        : "Anfechtung"}
                  </p>
                )}
              </div>

              <Separator />

              {invoice.billing_basis === "statutory" ? (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">EBM (GKV)</p>
                  <ul className="space-y-1 text-xs">
                    {invoice.service_items_ebm.map((r) => (
                      <li key={r.code}>
                        <span className="font-mono">{r.code}</span> {r.label}
                        {r.amount_eur != null && (
                          <span className="text-muted-foreground tabular-nums">
                            {" "}
                            · {r.amount_eur.toLocaleString("de-DE", { style: "currency", currency: "EUR" })}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">GOÄ (Privat / Selbstzahler)</p>
                  <ul className="space-y-2 text-xs">
                    {invoice.service_items_goae.map((r, idx) => (
                      <li key={`${r.code}-${idx}`} className="border-b border-border/40 pb-2 last:border-0 last:pb-0">
                        <SandboxGoaePositionBlock row={r} />
                        <p className="mt-1 text-muted-foreground tabular-nums">
                          {r.amount.toLocaleString("de-DE", { style: "currency", currency: "EUR" })}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <Separator />

              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Timeline</p>
                <ul className="space-y-2 text-xs">
                  {[...invoice.timeline].reverse().map((e, i) => (
                    <li key={`${e.ts}-${i}`} className="border-l-2 border-muted pl-2">
                      <span className="text-muted-foreground">{new Date(e.ts).toLocaleString("de-DE")}</span>
                      <br />
                      {e.event} · {e.actor}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </ScrollArea>

          <div className="p-4 border-t border-border/80 flex flex-wrap gap-2 bg-muted/20">
            {invoice.status === "proposed" && (
              <Button size="sm" onClick={() => navigate(`/sandbox/review/${invoice.id}`)}>
                Zur Review
              </Button>
            )}
            {invoice.status === "approved" && (
              <Button size="sm" onClick={() => setSendOpen(true)}>
                Rechnung versenden
              </Button>
            )}
            {invoice.status === "sent" && (
              <Button variant="outline" size="sm" onClick={() => setRevertOpen(true)}>
                Zurück zur Freigabe…
              </Button>
            )}
            {invoiceBoardTerminal(invoice) && (
              <Button variant="ghost" size="sm" className="text-xs" asChild>
                <Link to="/sandbox/dokumentationen">Zur Dokumentation</Link>
              </Button>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={revertOpen} onOpenChange={setRevertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Versand zurücknehmen?</AlertDialogTitle>
            <AlertDialogDescription>
              Die Rechnung wird wieder auf „Freigegeben“ gesetzt. Es erfolgt keine echte Übermittlung.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRevertSent}>Zurücksetzen</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SendInvoiceDialog invoice={invoice} open={sendOpen} onOpenChange={setSendOpen} onSent={() => onOpenChange(false)} />
    </>
  );
}

function invoiceBoardTerminal(inv: SandboxInvoice) {
  return inv.status === "paid" || inv.status === "denied" || inv.status === "appealed";
}

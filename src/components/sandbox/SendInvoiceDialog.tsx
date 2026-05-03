import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import type { SandboxInvoice } from "@/lib/sandbox/types";
import { useSandbox } from "@/lib/sandbox/sandboxStore";

export function SendInvoiceDialog({
  invoice,
  open,
  onOpenChange,
  onSent,
}: {
  invoice: SandboxInvoice;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSent?: () => void;
}) {
  const { patchInvoice } = useSandbox();
  const [via, setVia] = useState("kv");

  const send = () => {
    const labels: Record<string, string> = {
      kv: "KV-Abrechnung",
      pkv: "PKV per Brief",
      email: "Patient:in per E-Mail",
    };
    patchInvoice(invoice.id, {
      status: "sent",
      sent_via: labels[via] ?? via,
      timeline: [
        ...invoice.timeline,
        {
          ts: new Date().toISOString(),
          event: `Versendet — ${labels[via]}`,
                  actor: "System",
        },
      ],
    });
    toast.success("Rechnung als versendet markiert.");
    onOpenChange(false);
    onSent?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rechnung versenden</DialogTitle>
          <DialogDescription>
            Es wird keine echte Übermittlung ausgelöst — nur ein Versandweg wird gespeichert.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2 space-y-3">
          <p className="text-xs text-muted-foreground">
            Summe:{" "}
            <strong className="text-foreground tabular-nums">
              {invoice.total_amount.toLocaleString("de-DE", { style: "currency", currency: "EUR" })}
            </strong>
          </p>
          <RadioGroup value={via} onValueChange={setVia} className="space-y-2">
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="kv" id="kv" />
              <Label htmlFor="kv" className="font-normal cursor-pointer">
                KV-Abrechnung
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="pkv" id="pkv" />
              <Label htmlFor="pkv" className="font-normal cursor-pointer">
                PKV per Brief
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="email" id="email" />
              <Label htmlFor="email" className="font-normal cursor-pointer">
                Patient:in per E-Mail
              </Label>
            </div>
          </RadioGroup>
        </div>

        <DialogFooter>
          <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button type="button" onClick={send}>
            Senden
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import goaeMock from "@/data/sandbox/goae-mock.json";
import ebmMock from "@/data/sandbox/ebm-mock.json";

const OW = 12.7404 / 100;

export type CodePickerKind = "goae" | "ebm";

export function CodePickerDialog({
  kind,
  open,
  onOpenChange,
  onPick,
}: {
  kind: CodePickerKind;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPick: (row: { code: string; label: string; factor?: number; amount?: number; amount_eur?: number; points?: number }) => void;
}) {
  const rows = useMemo(() => {
    if (kind === "goae") return goaeMock as { code: string; label: string; defaultEuro?: number }[];
    return ebmMock as { code: string; label: string; points?: number }[];
  }, [kind]);

  const handlePick = (code: string) => {
    const r = rows.find((x) => x.code === code);
    if (!r) return;
    if (kind === "goae") {
      const g = r as { code: string; label: string; defaultEuro?: number };
      const factor = 2.3;
      const base = g.defaultEuro ?? 15;
      const amount = Math.round(base * factor * 100) / 100;
      onPick({ code: g.code, label: g.label, factor, amount });
    } else {
      const e = r as { code: string; label: string; points?: number };
      const pts = e.points ?? 100;
      const amount_eur = Math.round(pts * OW * 100) / 100;
      onPick({ code: e.code, label: e.label, points: pts, amount_eur });
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle>{kind === "goae" ? "GOÄ-Ziffer hinzufügen" : "EBM-Ziffer hinzufügen"}</DialogTitle>
        </DialogHeader>
        <Command className="rounded-none border-0">
          <CommandInput placeholder="Suche nach Code oder Text…" className="border-t border-border/80" />
          <CommandList className="max-h-[min(60vh,380px)]">
            <CommandEmpty>Kein Treffer.</CommandEmpty>
            <CommandGroup heading={kind === "goae" ? "GOÄ (Katalog)" : "EBM (Katalog)"}>
              {rows.map((r) => (
                <CommandItem key={r.code} value={`${r.code} ${r.label}`} onSelect={() => handlePick(r.code)}>
                  <span className="font-mono text-xs mr-2">{r.code}</span>
                  <span className="truncate">{r.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

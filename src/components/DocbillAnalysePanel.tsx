import type { DocbillAnalyseV1 } from "@/lib/analyse/types";
import { KENNZEICHNUNG_PILL } from "@/lib/analyse/pillStyles";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import { useState } from "react";

const STATUS_RING: Record<string, string> = {
  ok: "border-emerald-500/40",
  warnung: "border-amber-500/50",
  fehler: "border-red-500/50",
  optimierung: "border-blue-500/50",
};

function statusLabel(s: string): string {
  switch (s) {
    case "ok":
      return "OK";
    case "warnung":
      return "Hinweis";
    case "fehler":
      return "Fehler";
    case "optimierung":
      return "Optimierung";
    default:
      return s;
  }
}

export function DocbillAnalysePanel({ data }: { data: DocbillAnalyseV1 }) {
  const [open, setOpen] = useState<Record<number, boolean>>(() => {
    const o: Record<number, boolean> = {};
    data.kategorien.forEach((k) => {
      o[k.kategorie] = k.items.length > 0;
    });
    return o;
  });

  return (
    <div className="rounded-lg border border-border/80 bg-muted/15 not-prose space-y-2">
      <div className="px-3 pt-3 pb-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">Pflichtanalyse</h3>
          <span className="text-[11px] text-muted-foreground uppercase tracking-wide">
            Modus {data.mode} · {data.regelwerk === "EBM" ? "EBM" : "GOÄ"}
          </span>
        </div>
      </div>

      <div className="px-2 pb-2 space-y-1">
        {data.kategorien.map((kat) => {
          const isOpen = open[kat.kategorie] ?? false;
          const ring = STATUS_RING[kat.status] ?? "border-border/60";
          return (
            <Collapsible
              key={kat.kategorie}
              open={isOpen}
              onOpenChange={(v) => setOpen((prev) => ({ ...prev, [kat.kategorie]: v }))}
            >
              <div
                className={cn(
                  "rounded-md border bg-background/60 overflow-hidden",
                  ring,
                )}
              >
                <CollapsibleTrigger className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-xs hover:bg-muted/40">
                  <ChevronDown
                    className={cn("h-3.5 w-3.5 shrink-0 transition-transform", isOpen && "rotate-180")}
                  />
                  <span className="font-medium text-foreground">
                    {kat.kategorie}. {kat.titel}
                  </span>
                  <span className="ml-auto text-[10px] text-muted-foreground">{statusLabel(kat.status)}</span>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-3 pb-2 pt-0 space-y-2 border-t border-border/40">
                    {kat.items.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground py-1.5">Keine Einträge.</p>
                    ) : (
                      kat.items.map((it, idx) => (
                        <div key={idx} className="text-[11px] space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className={cn(
                                "inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium",
                                KENNZEICHNUNG_PILL[it.kennzeichnung]?.className ?? "bg-muted text-foreground",
                              )}
                            >
                              {KENNZEICHNUNG_PILL[it.kennzeichnung]?.label ?? it.kennzeichnung}
                            </span>
                            <span className="font-mono text-foreground/90">{it.ziffer}</span>
                            {it.euroBetrag != null && (
                              <span className="text-muted-foreground">
                                {it.euroBetrag.toFixed(2).replace(".", ",")} €
                              </span>
                            )}
                          </div>
                          <p className="text-foreground/90 leading-snug">{it.text}</p>
                        </div>
                      ))
                    )}
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          );
        })}
      </div>

      {data.dualOptions.length > 0 && (
        <div className="px-3 pb-3 border-t border-border/50 pt-2 space-y-2">
          <p className="text-xs font-medium">Alternativen (Unsicherheit)</p>
          {data.dualOptions.map((d, i) => (
            <div key={i} className="rounded-md border border-border/70 bg-muted/30 px-2.5 py-2 text-[11px] space-y-1.5">
              <p className="text-muted-foreground">{d.erklaerung}</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <span>
                  A: <span className="font-mono">{d.primaer.ziffer}</span> —{" "}
                  {d.primaer.euroBetrag.toFixed(2).replace(".", ",")} €
                </span>
                <span>
                  B: <span className="font-mono">{d.alternativ.ziffer}</span> —{" "}
                  {d.alternativ.euroBetrag.toFixed(2).replace(".", ",")} €
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

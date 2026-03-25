import { useEffect, useState } from "react";
import { Check, Circle, Loader2, Minus, X } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { cn } from "@/lib/utils";

export type ContextUploadStepId =
  | "pick"
  | "detect_type"
  | "read_raw"
  | "extract_text"
  | "validate_text"
  | "prepare_preview"
  | "send"
  | "chunk"
  | "embed"
  | "store_pdf"
  | "db_file"
  | "db_chunks"
  | "refresh_list"
  | "done";

export type ContextMigrateStepId = "migrate_run" | "migrate_list";

export type ContextUploadStepStatus = "pending" | "active" | "done" | "skipped" | "error";

export const CONTEXT_UPLOAD_STEPS: {
  id: ContextUploadStepId;
  label: string;
  description?: string;
}[] = [
  { id: "pick", label: "Unterlage ausgewählt" },
  { id: "detect_type", label: "Dateityp erkannt (PDF, Text, …)" },
  { id: "read_raw", label: "Dateiinhalt lesen" },
  { id: "extract_text", label: "Text extrahieren" },
  { id: "validate_text", label: "Text geprüft (nicht leer)" },
  {
    id: "prepare_preview",
    label: "Vorschau vorbereiten (PDF im Speicher)",
    description: "Entfällt bei reinen Textdateien.",
  },
  { id: "send", label: "An DocBill-Server senden" },
  { id: "chunk", label: "In Suchsegmente zerlegen" },
  { id: "embed", label: "Einbettungen berechnen" },
  {
    id: "store_pdf",
    label: "PDF für Vorschau speichern",
    description: "Nur bei PDF mit Speicherabbild; sonst entfällt der Schritt.",
  },
  { id: "db_file", label: "Datei-Eintrag speichern" },
  { id: "db_chunks", label: "Suchindex-Einträge speichern" },
  { id: "refresh_list", label: "Kontextliste aktualisieren" },
  { id: "done", label: "Für die KI verfügbar" },
];

export const CONTEXT_UPLOAD_STEP_ORDER = CONTEXT_UPLOAD_STEPS.map((s) => s.id);

const UPLOAD_PHASES: { value: string; label: string; ids: ContextUploadStepId[] }[] = [
  {
    value: "einlesen",
    label: "Einlesen (Gerät)",
    ids: ["pick", "detect_type", "read_raw", "extract_text", "validate_text", "prepare_preview"],
  },
  {
    value: "indexierung",
    label: "Indexierung (Server)",
    ids: ["send", "chunk", "embed", "store_pdf", "db_file", "db_chunks"],
  },
  {
    value: "abschluss",
    label: "Abschluss",
    ids: ["refresh_list", "done"],
  },
];

export const CONTEXT_MIGRATE_STEPS: { id: ContextMigrateStepId; label: string }[] = [
  { id: "migrate_run", label: "Bestehende Dateien indexieren (Chunks & Embeddings)" },
  { id: "migrate_list", label: "Index-Status in der Liste aktualisieren" },
];

export const CONTEXT_MIGRATE_STEP_ORDER = CONTEXT_MIGRATE_STEPS.map((s) => s.id);

function phaseStats(
  stepStates: Record<string, ContextUploadStepStatus>,
  ids: readonly string[],
): { total: number; doneCount: number; hasActive: boolean; hasError: boolean } {
  let doneCount = 0;
  let hasActive = false;
  let hasError = false;
  for (const id of ids) {
    const s = stepStates[id] ?? "pending";
    if (s === "done" || s === "skipped") doneCount++;
    if (s === "active") hasActive = true;
    if (s === "error") hasError = true;
  }
  return { total: ids.length, doneCount, hasActive, hasError };
}

export function createInitialUploadStepStates(): Record<ContextUploadStepId, ContextUploadStepStatus> {
  return Object.fromEntries(
    CONTEXT_UPLOAD_STEP_ORDER.map((id) => [id, "pending" as const]),
  ) as Record<ContextUploadStepId, ContextUploadStepStatus>;
}

export function createInitialMigrateStepStates(): Record<ContextMigrateStepId, ContextUploadStepStatus> {
  return Object.fromEntries(
    CONTEXT_MIGRATE_STEP_ORDER.map((id) => [id, "pending" as const]),
  ) as Record<ContextMigrateStepId, ContextUploadStepStatus>;
}

/** Nach einer Server-„progress“-Zeile: vorheriger aktiver Schritt fertig, gemeldeter Schritt fertig, nächster aktiv. */
export function applyStreamProgressToSteps(
  prev: Record<ContextUploadStepId, ContextUploadStepStatus>,
  step: string,
  skipped?: boolean,
): Record<ContextUploadStepId, ContextUploadStepStatus> {
  const id = step as ContextUploadStepId;
  if (!CONTEXT_UPLOAD_STEP_ORDER.includes(id)) return prev;
  const next = { ...prev } as Record<ContextUploadStepId, ContextUploadStepStatus>;
  for (const k of CONTEXT_UPLOAD_STEP_ORDER) {
    if (next[k] === "active") next[k] = "done";
  }
  next[id] = skipped ? "skipped" : "done";
  const idx = CONTEXT_UPLOAD_STEP_ORDER.indexOf(id);
  const after = CONTEXT_UPLOAD_STEP_ORDER[idx + 1];
  if (after) next[after] = "active";
  return next;
}

/** Letzten als „active“ markierten Schritt auf „error“ setzen (bei Fehler). */
export function markMigrateActiveAsError(
  prev: Record<ContextMigrateStepId, ContextUploadStepStatus>,
): Record<ContextMigrateStepId, ContextUploadStepStatus> {
  const next = { ...prev } as Record<ContextMigrateStepId, ContextUploadStepStatus>;
  for (const k of CONTEXT_MIGRATE_STEP_ORDER) {
    if (next[k] === "active") {
      next[k] = "error";
      return next;
    }
  }
  return next;
}

export function markActiveStepAsError(
  prev: Record<ContextUploadStepId, ContextUploadStepStatus>,
): Record<ContextUploadStepId, ContextUploadStepStatus> {
  const next = { ...prev } as Record<ContextUploadStepId, ContextUploadStepStatus>;
  for (const k of CONTEXT_UPLOAD_STEP_ORDER) {
    if (next[k] === "active") {
      next[k] = "error";
      return next;
    }
  }
  for (let i = CONTEXT_UPLOAD_STEP_ORDER.length - 1; i >= 0; i--) {
    const k = CONTEXT_UPLOAD_STEP_ORDER[i];
    if (next[k] === "pending") {
      next[k] = "error";
      return next;
    }
  }
  return next;
}

/**
 * Schrittliste für ein bereits gespeichertes Kontext-Dokument ableiten
 * (nicht protokolliert beim Upload – sinnvolle Rekonstruktion aus Dateiname, Speicherpfad und RAG-Status).
 */
export function buildStepStatesForStoredContextFile(
  filename: string,
  isRagIndexed: boolean,
  storagePath?: string | null,
): Record<ContextUploadStepId, ContextUploadStepStatus> {
  const steps = createInitialUploadStepStates();
  const isPdf = filename.toLowerCase().endsWith(".pdf");
  const local: ContextUploadStepId[] = ["pick", "detect_type", "read_raw", "extract_text", "validate_text"];
  for (const id of local) {
    steps[id] = "done";
  }
  steps.prepare_preview = isPdf ? "done" : "skipped";
  steps.send = "done";
  steps.db_file = "done";
  steps.refresh_list = "done";
  if (isPdf) {
    steps.store_pdf = storagePath ? "done" : "skipped";
  } else {
    steps.store_pdf = "skipped";
  }

  if (isRagIndexed) {
    steps.chunk = "done";
    steps.embed = "done";
    steps.db_chunks = "done";
    steps.done = "done";
    return steps;
  }

  steps.chunk = "pending";
  steps.embed = "pending";
  steps.db_chunks = "pending";
  steps.done = "pending";
  return steps;
}

type ContextUploadProgressProps = {
  filename: string;
  /** Upload checklist (default) */
  variant?: "upload" | "migrate";
  stepStates:
    | Record<ContextUploadStepId, ContextUploadStepStatus>
    | Record<ContextMigrateStepId, ContextUploadStepStatus>;
  startedAt: number | null;
  /** Hinweistext unter dem Dateinamen (z. B. rekonstruierter Stand). */
  historicalNote?: string;
};

const StepIcon = ({ status }: { status: ContextUploadStepStatus }) => {
  switch (status) {
    case "done":
      return <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden />;
    case "active":
      return <Loader2 className="w-4 h-4 text-accent animate-spin shrink-0" aria-hidden />;
    case "skipped":
      return <Minus className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden />;
    case "error":
      return <X className="w-4 h-4 text-destructive shrink-0" aria-hidden />;
    default:
      return <Circle className="w-4 h-4 text-muted-foreground/50 shrink-0" aria-hidden />;
  }
};

function PhaseTriggerSummary({
  doneCount,
  total,
  hasActive,
  hasError,
}: {
  doneCount: number;
  total: number;
  hasActive: boolean;
  hasError: boolean;
}) {
  if (hasActive) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground font-normal tabular-nums shrink-0">
        <Loader2 className="w-3.5 h-3.5 text-accent animate-spin" aria-hidden />
        läuft…
      </span>
    );
  }
  if (hasError) {
    return (
      <span className="text-xs text-destructive font-normal shrink-0" aria-live="polite">
        Fehler
      </span>
    );
  }
  return (
    <span className="text-xs text-muted-foreground font-normal tabular-nums shrink-0">
      {doneCount}/{total} erledigt
    </span>
  );
}

const ContextUploadProgress = ({
  filename,
  variant = "upload",
  stepStates,
  startedAt,
  historicalNote,
}: ContextUploadProgressProps) => {
  const [elapsed, setElapsed] = useState(0);
  const flatStates = stepStates as Record<string, ContextUploadStepStatus>;

  useEffect(() => {
    if (startedAt == null) return;
    const tick = () => setElapsed((Date.now() - startedAt) / 1000);
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [startedAt]);

  const renderStepRow = (def: { id: string; label: string; description?: string }) => {
    const status = flatStates[def.id] ?? "pending";
    return (
      <li key={def.id} className="flex gap-2.5 items-start min-w-0">
        <span className="mt-0.5">
          <StepIcon status={status} />
        </span>
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "text-sm leading-snug",
              status === "pending" && "text-muted-foreground",
              status === "active" && "text-foreground font-medium",
              status === "done" && "text-foreground",
              status === "skipped" && "text-muted-foreground italic",
              status === "error" && "text-destructive font-medium",
            )}
          >
            {def.label}
            {status === "skipped" && variant === "upload" && def.id === "prepare_preview" && " (kein PDF)"}
            {status === "skipped" && variant === "upload" && def.id === "store_pdf" && " (entfällt)"}
          </p>
          {"description" in def && def.description && status === "active" && (
            <p className="text-[10px] text-muted-foreground mt-0.5">{def.description}</p>
          )}
        </div>
      </li>
    );
  };

  return (
    <div className="rounded-lg border border-accent/20 bg-accent/5 px-4 py-3 space-y-2" aria-live="polite">
      <div className="flex items-start justify-between gap-2 min-w-0">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {variant === "migrate" ? "RAG-Migration" : "Kontext-Upload"}
          </p>
          <p className="text-sm font-medium text-foreground truncate mt-0.5" title={filename}>
            {filename}
          </p>
        </div>
        {startedAt != null && (
          <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
            {elapsed.toFixed(1).replace(".", ",")} s
          </span>
        )}
      </div>
      {historicalNote ? (
        <p className="text-[11px] text-muted-foreground leading-snug -mt-1">{historicalNote}</p>
      ) : null}

      {variant === "upload" ? (
        <Accordion
          type="multiple"
          defaultValue={["einlesen", "indexierung", "abschluss"]}
          className="w-full border-t border-border/60"
        >
          {UPLOAD_PHASES.map((phase) => {
            const stats = phaseStats(flatStates, phase.ids);
            const defs = phase.ids
              .map((id) => CONTEXT_UPLOAD_STEPS.find((s) => s.id === id))
              .filter((d): d is (typeof CONTEXT_UPLOAD_STEPS)[number] => d != null);
            return (
              <AccordionItem key={phase.value} value={phase.value} className="border-border/60">
                <AccordionTrigger className="py-3 text-sm hover:no-underline [&[data-state=open]]:pb-2 gap-2">
                  <span className="flex flex-1 items-center justify-between gap-2 min-w-0 text-left">
                    <span className="font-medium text-foreground truncate">{phase.label}</span>
                    <PhaseTriggerSummary
                      doneCount={stats.doneCount}
                      total={stats.total}
                      hasActive={stats.hasActive}
                      hasError={stats.hasError}
                    />
                  </span>
                </AccordionTrigger>
                <AccordionContent className="pb-3 pt-0">
                  <ul className="space-y-2.5 pl-0.5">{defs.map((def) => renderStepRow(def))}</ul>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      ) : (
        <Accordion
          type="single"
          collapsible
          defaultValue="migration"
          className="w-full border-t border-border/60"
        >
          <AccordionItem value="migration" className="border-border/60 border-b-0">
            <AccordionTrigger className="py-3 text-sm hover:no-underline [&[data-state=open]]:pb-2 gap-2">
              <span className="flex flex-1 items-center justify-between gap-2 min-w-0 text-left">
                <span className="font-medium text-foreground truncate">Ablauf</span>
                {(() => {
                  const stats = phaseStats(flatStates, CONTEXT_MIGRATE_STEP_ORDER);
                  return (
                    <PhaseTriggerSummary
                      doneCount={stats.doneCount}
                      total={stats.total}
                      hasActive={stats.hasActive}
                      hasError={stats.hasError}
                    />
                  );
                })()}
              </span>
            </AccordionTrigger>
            <AccordionContent className="pb-3 pt-0">
              <ul className="space-y-2.5 pl-0.5">{CONTEXT_MIGRATE_STEPS.map((def) => renderStepRow(def))}</ul>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}
    </div>
  );
};

export default ContextUploadProgress;

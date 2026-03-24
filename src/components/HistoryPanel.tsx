import { useState } from "react";
import { Trash2, Pencil, FileText, Loader2, ListOrdered, CircleCheck, XCircle, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Conversation } from "@/hooks/useConversations";
import type { BackgroundJobRow, ConversationRunInfo } from "@/hooks/useBackgroundJobQueue";
import { isToday, isYesterday } from "date-fns";

function groupByDate(conversations: Conversation[]) {
  const today: Conversation[] = [];
  const yesterday: Conversation[] = [];
  const earlier: Conversation[] = [];
  for (const c of conversations) {
    const d = new Date(c.updated_at);
    if (isToday(d)) today.push(c);
    else if (isYesterday(d)) yesterday.push(c);
    else earlier.push(c);
  }
  return { today, yesterday, earlier };
}

function convTitle(conversations: Conversation[], conversationId: string) {
  return conversations.find((c) => c.id === conversationId)?.title ?? "Gespräch";
}

export type HistoryPanelProps = {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  jobs: BackgroundJobRow[];
  runStates: Record<string, ConversationRunInfo>;
  onCancelQueuedJob: (jobId: string) => void;
  layout: "page" | "sidebar";
};

const HistoryPanel = ({
  conversations,
  activeId,
  onSelect,
  onDelete,
  onRename,
  jobs,
  runStates,
  onCancelQueuedJob,
  layout,
}: HistoryPanelProps) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const compact = layout === "sidebar";

  const startEdit = (conv: Conversation) => {
    setEditingId(conv.id);
    setEditValue(conv.title);
  };

  const saveEdit = () => {
    if (editingId && editValue.trim()) {
      onRename(editingId, editValue.trim());
    }
    setEditingId(null);
    setEditValue("");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValue("");
  };

  const running = jobs.filter((j) => j.status === "running");
  const queued = jobs.filter((j) => j.status === "queued");
  const recentDone = jobs
    .filter((j) => j.status === "completed")
    .sort((a, b) => (b.finished_at ?? "").localeCompare(a.finished_at ?? ""))
    .slice(0, compact ? 8 : 12);

  const JobRow = ({
    job,
    variant,
  }: {
    job: BackgroundJobRow;
    variant: "running" | "queued" | "done";
  }) => (
    <div
      key={job.id}
      className={cn(
        "flex items-start gap-2 text-sm transition-colors rounded-lg border border-border/40",
        compact ? "px-2 py-2" : "px-3 py-2.5 gap-3",
        activeId === job.conversation_id ? "bg-muted/80" : "bg-muted/5 hover:bg-muted/40",
      )}
    >
      <button
        type="button"
        className="flex-1 min-w-0 text-left"
        onClick={() => onSelect(job.conversation_id)}
      >
        <p className="truncate font-medium text-xs sm:text-sm">{convTitle(conversations, job.conversation_id)}</p>
        {variant === "running" &&
          (runStates[job.conversation_id]?.pipelineStep?.label || job.progress_label) && (
            <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin shrink-0" />
              <span className="truncate">
                {runStates[job.conversation_id]?.pipelineStep?.label ?? job.progress_label}
              </span>
            </p>
          )}
        {variant === "queued" && (
          <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
            <ListOrdered className="w-3 h-3 shrink-0" />
            Warteschlange
          </p>
        )}
        {variant === "done" && job.payload?.assistantPreview && (
          <p className="text-[10px] sm:text-xs text-muted-foreground/90 mt-1 line-clamp-2">
            {job.payload.assistantPreview}
          </p>
        )}
      </button>
      {variant === "queued" && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 sm:h-8 sm:w-8 shrink-0"
          title="Aus Warteschlange entfernen"
          onClick={(e) => {
            e.stopPropagation();
            void onCancelQueuedJob(job.id);
          }}
        >
          <Ban className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
        </Button>
      )}
    </div>
  );

  const sectionLabel = compact
    ? "text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 mb-2 pl-0.5"
    : "text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60 mb-3 pl-1";

  const Section = ({ label, items }: { label: string; items: Conversation[] }) =>
    items.length === 0 ? null : (
      <div className={cn(compact ? "mb-4 last:mb-0" : "mb-8 last:mb-0")}>
        <p className={sectionLabel}>{label}</p>
        <div
          className={cn(
            "rounded-lg divide-y divide-border/50 bg-muted/10 dark:bg-muted/5",
            compact && "border border-border/30",
          )}
        >
          {items.map((conv) => (
            <div
              key={conv.id}
              className={cn(
                "group flex items-center gap-2 cursor-pointer text-sm transition-colors",
                compact ? "px-2 py-2" : "gap-3 px-3 py-2.5",
                activeId === conv.id
                  ? "bg-muted/80 text-foreground"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              )}
              onClick={() => editingId !== conv.id && onSelect(conv.id)}
            >
              <div className="flex-1 min-w-0">
                {editingId === conv.id ? (
                  <Input
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={saveEdit}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEdit();
                      if (e.key === "Escape") cancelEdit();
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className={cn("text-sm", compact ? "h-7" : "h-8")}
                    autoFocus
                  />
                ) : (
                  <div className="min-w-0 flex-1">
                    <p className={cn("truncate font-medium", compact ? "text-xs" : "text-sm")}>{conv.title}</p>
                    {conv.source_filename && (
                      <p className="truncate text-[10px] sm:text-xs text-muted-foreground/80 mt-0.5 flex items-center gap-1">
                        <FileText className="w-3 h-3 flex-shrink-0" />
                        {conv.source_filename}
                      </p>
                    )}
                  </div>
                )}
              </div>
              {editingId !== conv.id && (
                <div
                  className={cn(
                    "flex items-center gap-0.5 flex-shrink-0",
                    compact ? "opacity-100" : "opacity-0 group-hover:opacity-100 transition-opacity",
                  )}
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn("hover:bg-transparent", compact ? "h-7 w-7" : "h-8 w-8")}
                    onClick={(e) => {
                      e.stopPropagation();
                      startEdit(conv);
                    }}
                    title="Umbenennen"
                  >
                    <Pencil className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn("hover:bg-transparent", compact ? "h-7 w-7" : "h-8 w-8")}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(conv.id);
                    }}
                    title="Löschen"
                  >
                    <Trash2 className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-destructive" />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );

  const { today, yesterday, earlier } = groupByDate(conversations);
  const failed = jobs.filter((j) => j.status === "failed" || j.status === "cancelled").length;

  const jobSectionTitle = compact
    ? "text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 px-0.5"
    : "text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60 pl-1";

  return (
    <div className={cn("space-y-4", !compact && "space-y-8")}>
      {(running.length > 0 || queued.length > 0 || recentDone.length > 0) && (
        <div className={cn(!compact && "space-y-6")}>
          <p className={jobSectionTitle}>{compact ? "Aufgaben" : "Hintergrund-Aufgaben"}</p>
          {running.length > 0 && (
            <div className={cn("space-y-1.5", compact && "mt-2")}>
              {!compact && (
                <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5" />
                  Läuft
                </p>
              )}
              <div className="space-y-1.5">{running.map((j) => <JobRow key={j.id} job={j} variant="running" />)}</div>
            </div>
          )}
          {queued.length > 0 && (
            <div className={cn("space-y-1.5", compact && "mt-2")}>
              {!compact && (
                <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <ListOrdered className="w-3.5 h-3.5" />
                  Warteschlange
                </p>
              )}
              <div className="space-y-1.5">{queued.map((j) => <JobRow key={j.id} job={j} variant="queued" />)}</div>
            </div>
          )}
          {recentDone.length > 0 && (
            <div className={cn("space-y-1.5", compact && "mt-2")}>
              {!compact && (
                <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <CircleCheck className="w-3.5 h-3.5" />
                  Zuletzt fertig
                </p>
              )}
              {compact && (
                <p className="text-[10px] font-medium text-muted-foreground/80 px-0.5">Zuletzt fertig</p>
              )}
              <div className="space-y-1.5">{recentDone.map((j) => <JobRow key={j.id} job={j} variant="done" />)}</div>
            </div>
          )}
        </div>
      )}

      {failed > 0 && (
        <p className="text-[10px] sm:text-xs text-muted-foreground flex items-center gap-1.5 pl-0.5">
          <XCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{failed} abgebrochen/fehlgeschlagen</span>
        </p>
      )}

      <div>
        <p className={cn(sectionLabel, "mb-2")}>{compact ? "Verlauf" : "Alle Gespräche"}</p>
        {conversations.length === 0 ? (
          <p className="text-xs text-muted-foreground/80 text-center py-8">Noch keine Chats</p>
        ) : (
          <>
            <Section label="Heute" items={today} />
            <Section label="Gestern" items={yesterday} />
            <Section label="Älter" items={earlier} />
          </>
        )}
      </div>
    </div>
  );
};

export default HistoryPanel;

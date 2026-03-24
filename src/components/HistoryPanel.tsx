import { useMemo, useState } from "react";
import {
  Trash2,
  Pencil,
  FileText,
  Loader2,
  ListOrdered,
  CircleCheck,
  XCircle,
  Ban,
  MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Conversation } from "@/hooks/useConversations";
import type { BackgroundJobRow, ConversationRunInfo } from "@/hooks/useBackgroundJobQueue";
import { isToday, isYesterday } from "date-fns";

const SIDEBAR_CHAT_PAGE = 10;

function resolveConversationJobVisual(
  convId: string,
  jobs: BackgroundJobRow[],
  runStates: Record<string, ConversationRunInfo>,
): "running" | "queued" | "done" | "failed" | "idle" {
  const convJobs = jobs.filter((j) => j.conversation_id === convId);
  if (convJobs.some((j) => j.status === "running") || runStates[convId]?.isRunning) return "running";
  if (convJobs.some((j) => j.status === "queued")) return "queued";
  if (convJobs.some((j) => j.status === "failed" || j.status === "cancelled")) return "failed";
  if (convJobs.some((j) => j.status === "completed")) return "done";
  return "idle";
}

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

/** Cursor-style relative time: XXm (minutes), XXh (hours), XXd (days), then short date. */
function formatRelativeShort(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const t = d.getTime();
  if (Number.isNaN(t)) return "";
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d`;
  const w = Math.floor(days / 7);
  if (w < 8) return `${w}w`;
  return new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short" }).format(d);
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
  const [sidebarChatVisibleCount, setSidebarChatVisibleCount] = useState(SIDEBAR_CHAT_PAGE);
  const compact = layout === "sidebar";

  const sortedChatsForSidebar = useMemo(() => {
    if (!compact) return [];
    return [...conversations].sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    );
  }, [compact, conversations]);

  const visibleSidebarChats = useMemo(() => {
    if (!compact) return [];
    const cap = Math.min(sidebarChatVisibleCount, sortedChatsForSidebar.length);
    return sortedChatsForSidebar.slice(0, cap);
  }, [compact, sortedChatsForSidebar, sidebarChatVisibleCount]);

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
  }) => {
    const jobTimeIso =
      variant === "done"
        ? job.finished_at
        : variant === "running"
          ? job.started_at ?? job.created_at
          : job.created_at;

    if (compact) {
      return (
        <div
          className={cn(
            "grid min-w-0 w-full grid-cols-[1rem_minmax(0,1fr)_auto_minmax(2.75rem,max-content)] items-start gap-x-1.5 rounded-lg px-2 py-2 text-sm transition-colors",
            activeId === job.conversation_id
              ? "bg-muted/70 dark:bg-muted/35"
              : "bg-muted/25 dark:bg-muted/15 hover:bg-muted/45 dark:hover:bg-muted/25",
          )}
        >
          <div className="flex w-4 shrink-0 justify-center pt-0.5" aria-hidden>
            {variant === "running" && (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            )}
            {variant === "queued" && <ListOrdered className="h-3.5 w-3.5 text-muted-foreground" />}
            {variant === "done" && <CircleCheck className="h-3.5 w-3.5 text-muted-foreground" />}
          </div>
          <button
            type="button"
            className="min-w-0 overflow-hidden text-left"
            onClick={() => onSelect(job.conversation_id)}
          >
            <p className="truncate text-xs font-medium text-foreground">
              {convTitle(conversations, job.conversation_id)}
            </p>
            {variant === "running" &&
              (runStates[job.conversation_id]?.pipelineStep?.label || job.progress_label) && (
                <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                  {runStates[job.conversation_id]?.pipelineStep?.label ?? job.progress_label}
                </p>
              )}
            {variant === "queued" && (
              <p className="mt-0.5 truncate text-[10px] text-muted-foreground">Warteschlange</p>
            )}
            {variant === "done" && job.payload?.assistantPreview && (
              <p className="mt-1 line-clamp-2 break-words text-[10px] text-muted-foreground/90">
                {job.payload.assistantPreview}
              </p>
            )}
          </button>
          <div className="flex shrink-0 justify-end pt-0.5">
            {variant === "queued" && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                title="Aus Warteschlange entfernen"
                onClick={(e) => {
                  e.stopPropagation();
                  void onCancelQueuedJob(job.id);
                }}
              >
                <Ban className="h-3 w-3" />
              </Button>
            )}
          </div>
          <span
            className="w-full pt-0.5 text-right text-[10px] font-medium tabular-nums text-foreground/55 whitespace-nowrap"
            title={jobTimeIso ?? undefined}
          >
            {formatRelativeShort(jobTimeIso) || "–"}
          </span>
        </div>
      );
    }

    return (
      <div
        className={cn(
          "flex items-start gap-3 text-sm transition-colors rounded-lg px-3 py-2.5",
          activeId === job.conversation_id ? "bg-muted/80" : "bg-muted/20 dark:bg-muted/10 hover:bg-muted/40",
        )}
      >
        <button
          type="button"
          className="flex-1 min-w-0 text-left"
          onClick={() => onSelect(job.conversation_id)}
        >
          <p className="truncate font-medium text-sm">{convTitle(conversations, job.conversation_id)}</p>
          {variant === "running" &&
            (runStates[job.conversation_id]?.pipelineStep?.label || job.progress_label) && (
              <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                <span className="truncate">
                  {runStates[job.conversation_id]?.pipelineStep?.label ?? job.progress_label}
                </span>
              </p>
            )}
          {variant === "queued" && (
            <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
              <ListOrdered className="w-3 h-3 shrink-0" />
              Warteschlange
            </p>
          )}
          {variant === "done" && job.payload?.assistantPreview && (
            <p className="text-xs text-muted-foreground/90 mt-1 line-clamp-2">{job.payload.assistantPreview}</p>
          )}
        </button>
        {variant === "queued" && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            title="Aus Warteschlange entfernen"
            onClick={(e) => {
              e.stopPropagation();
              void onCancelQueuedJob(job.id);
            }}
          >
            <Ban className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
    );
  };

  const sectionLabel = compact
    ? "text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 mb-2 pl-0.5"
    : "text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60 mb-3 pl-1";

  const ConversationStatusGlyph = ({
    visual,
  }: {
    visual: ReturnType<typeof resolveConversationJobVisual>;
  }) => (
    <div className="flex w-4 shrink-0 justify-center pt-0.5" aria-hidden>
      {visual === "running" && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      {visual === "queued" && <ListOrdered className="h-3.5 w-3.5 text-muted-foreground" />}
      {visual === "done" && <CircleCheck className="h-3.5 w-3.5 text-muted-foreground" />}
      {visual === "failed" && <XCircle className="h-3.5 w-3.5 text-destructive/80" />}
      {visual === "idle" && <MessageSquare className="h-3.5 w-3.5 text-muted-foreground/55" />}
    </div>
  );

  const ConversationRow = ({ conv }: { conv: Conversation }) => {
    const jobVisual = resolveConversationJobVisual(conv.id, jobs, runStates);
    return (
    <div
      className={cn(
        "group cursor-pointer text-sm transition-colors rounded-lg",
        compact
          ? "flex min-w-0 w-full items-start gap-1.5 px-2 py-2 bg-muted/25 dark:bg-muted/15 hover:bg-muted/45 dark:hover:bg-muted/25"
          : "flex items-start gap-2 px-3 py-2.5 bg-muted/20 dark:bg-muted/10 hover:bg-muted/40",
        activeId === conv.id
          ? compact
            ? "bg-muted/70 dark:bg-muted/35 text-foreground"
            : "bg-muted/80 text-foreground"
          : !compact && "text-muted-foreground hover:text-foreground",
      )}
      onClick={() => editingId !== conv.id && onSelect(conv.id)}
    >
      {compact ? (
        editingId === conv.id ? (
          <Input
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={saveEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveEdit();
              if (e.key === "Escape") cancelEdit();
            }}
            onClick={(e) => e.stopPropagation()}
            className="h-7 min-w-0 w-full text-sm"
            autoFocus
          />
        ) : (
          <div className="grid min-w-0 w-full grid-cols-[1rem_minmax(0,1fr)_minmax(2.75rem,max-content)_auto] items-start gap-x-1.5">
            <ConversationStatusGlyph visual={jobVisual} />
            <div className="min-w-0 overflow-hidden">
              <p className="truncate text-xs font-medium text-foreground">{conv.title}</p>
              {conv.source_filename && (
                <p className="mt-0.5 flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground/80">
                  <FileText className="h-3 w-3 shrink-0" />
                  <span className="min-w-0 truncate">{conv.source_filename}</span>
                </p>
              )}
            </div>
            <span
              className="w-full text-right text-[10px] font-medium tabular-nums text-foreground/55 whitespace-nowrap"
              title={conv.updated_at}
            >
              {formatRelativeShort(conv.updated_at) || "–"}
            </span>
            <div className="flex items-center justify-end gap-0.5">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 hover:bg-transparent"
                onClick={(e) => {
                  e.stopPropagation();
                  startEdit(conv);
                }}
                title="Umbenennen"
              >
                <Pencil className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 hover:bg-transparent"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(conv.id);
                }}
                title="Löschen"
              >
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            </div>
          </div>
        )
      ) : (
        <>
          <ConversationStatusGlyph visual={jobVisual} />
          <div className="min-w-0 flex-1">
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
                className="h-8 text-sm"
                autoFocus
              />
            ) : (
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{conv.title}</p>
                {conv.source_filename && (
                  <p className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-muted-foreground/80">
                    <FileText className="h-3 w-3 shrink-0" />
                    <span className="min-w-0 truncate">{conv.source_filename}</span>
                  </p>
                )}
              </div>
            )}
          </div>
          {editingId !== conv.id && (
            <div className="flex shrink-0 items-center gap-0.5 self-center opacity-0 transition-opacity group-hover:opacity-100">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 hover:bg-transparent"
                onClick={(e) => {
                  e.stopPropagation();
                  startEdit(conv);
                }}
                title="Umbenennen"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 hover:bg-transparent"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(conv.id);
                }}
                title="Löschen"
              >
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
    );
  };

  const Section = ({ label, items }: { label: string; items: Conversation[] }) =>
    items.length === 0 ? null : (
      <div className={cn(compact ? "mb-4 last:mb-0" : "mb-8 last:mb-0")}>
        <p className={sectionLabel}>{label}</p>
        <div className="space-y-1.5">
          {items.map((conv) => (
            <ConversationRow key={conv.id} conv={conv} />
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
    <div className={cn("min-w-0 space-y-4", !compact && "space-y-8")}>
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
                <p className="text-[10px] font-medium text-muted-foreground/80 px-0.5">Abgeschlossen</p>
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
        <p className={cn(sectionLabel, "mb-2")}>{compact ? "Chats" : "Alle Gespräche"}</p>
        {conversations.length === 0 ? (
          <p className="text-xs text-muted-foreground/80 text-center py-8">Noch keine Chats</p>
        ) : compact ? (
          <>
            <div className="min-w-0 space-y-1.5">
              {visibleSidebarChats.map((conv) => (
                <ConversationRow key={conv.id} conv={conv} />
              ))}
            </div>
            {(sidebarChatVisibleCount < sortedChatsForSidebar.length ||
              sidebarChatVisibleCount > SIDEBAR_CHAT_PAGE) && (
              <div className="mt-2 flex w-full items-center justify-between gap-2">
                <div className="min-w-0 flex-1 flex justify-start">
                  {sidebarChatVisibleCount > SIDEBAR_CHAT_PAGE && (
                    <button
                      type="button"
                      className="py-1.5 text-left text-xs text-muted-foreground hover:text-foreground rounded-md hover:bg-muted/45 transition-colors px-1 -mx-1"
                      onClick={() =>
                        setSidebarChatVisibleCount((n) => Math.max(n - SIDEBAR_CHAT_PAGE, SIDEBAR_CHAT_PAGE))
                      }
                    >
                      ...weniger
                    </button>
                  )}
                </div>
                <div className="min-w-0 flex-1 flex justify-end">
                  {sidebarChatVisibleCount < sortedChatsForSidebar.length && (
                    <button
                      type="button"
                      className="py-1.5 text-right text-xs text-muted-foreground hover:text-foreground rounded-md hover:bg-muted/45 transition-colors px-1 -mx-1"
                      onClick={() =>
                        setSidebarChatVisibleCount((n) =>
                          Math.min(n + SIDEBAR_CHAT_PAGE, sortedChatsForSidebar.length),
                        )
                      }
                    >
                      ...mehr
                    </button>
                  )}
                </div>
              </div>
            )}
          </>
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

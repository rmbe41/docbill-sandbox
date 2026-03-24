import { useEffect, useMemo, useState } from "react";
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
  Archive,
  ArchiveRestore,
  MoreHorizontal,
  Mail,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { Conversation } from "@/hooks/useConversations";
import type { BackgroundJobRow, ConversationRunInfo } from "@/hooks/useBackgroundJobQueue";
import { isToday, isYesterday } from "date-fns";

const SIDEBAR_CHAT_PAGE = 10;

/** Visible title in lists; legacy DB default treated as empty. */
export function conversationListTitleDisplay(title: string | null | undefined): string | null {
  const t = (title ?? "").trim();
  if (!t || t === "Neues Gespräch") return null;
  return t;
}

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

function convTitleForJobs(conversations: Conversation[], conversationId: string): string | null {
  const raw = conversations.find((c) => c.id === conversationId)?.title;
  return conversationListTitleDisplay(raw);
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
  onArchive?: (id: string) => void | Promise<void>;
  onRestore?: (id: string) => void | Promise<void>;
  onMarkUnread?: (id: string) => void | Promise<void>;
  acknowledgedJobIds?: Set<string>;
  onAcknowledgeJob?: (jobId: string) => void;
  /** Desktop: tab bar rendered in AgentsSidebar header; pass with onSidebarTabChange */
  sidebarTab?: "chats" | "archive";
  onSidebarTabChange?: (tab: "chats" | "archive") => void;
  hideCompactTabBar?: boolean;
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
  onArchive,
  onRestore,
  onMarkUnread,
  acknowledgedJobIds,
  onAcknowledgeJob,
  sidebarTab: sidebarTabProp,
  onSidebarTabChange,
  hideCompactTabBar,
}: HistoryPanelProps) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [sidebarChatVisibleCount, setSidebarChatVisibleCount] = useState(SIDEBAR_CHAT_PAGE);
  const [internalSidebarTab, setInternalSidebarTab] = useState<"chats" | "archive">("chats");
  const compact = layout === "sidebar";
  const tabControlled =
    sidebarTabProp !== undefined && onSidebarTabChange !== undefined;
  const sidebarTab = tabControlled ? sidebarTabProp : internalSidebarTab;
  const setSidebarTab = tabControlled ? onSidebarTabChange : setInternalSidebarTab;

  useEffect(() => {
    if (compact) setSidebarChatVisibleCount(SIDEBAR_CHAT_PAGE);
  }, [compact, sidebarTab]);

  const nonArchived = useMemo(
    () => conversations.filter((c) => !c.archived_at),
    [conversations],
  );
  const archivedOnly = useMemo(
    () => conversations.filter((c) => c.archived_at),
    [conversations],
  );

  const conversationsForPage = nonArchived;

  const sortedChatsForSidebar = useMemo(() => {
    if (!compact) return [];
    const pool = sidebarTab === "chats" ? nonArchived : archivedOnly;
    return [...pool].sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    );
  }, [compact, nonArchived, archivedOnly, sidebarTab]);

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
    if (editingId) {
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
  const recentDone = jobs
    .filter((j) => j.status === "completed")
    .sort((a, b) => (b.finished_at ?? "").localeCompare(a.finished_at ?? ""))
    .slice(0, compact ? 8 : 12);

  /** Avoid listing the same conversation twice (JobRow + ConversationRow in the chat list). */
  const nonArchivedChatIds = useMemo(() => new Set(nonArchived.map((c) => c.id)), [nonArchived]);
  const runningInJobSectionOnly = useMemo(
    () => running.filter((j) => !nonArchivedChatIds.has(j.conversation_id)),
    [running, nonArchivedChatIds],
  );
  const recentDoneInJobSectionOnly = useMemo(
    () => recentDone.filter((j) => !nonArchivedChatIds.has(j.conversation_id)),
    [recentDone, nonArchivedChatIds],
  );

  const showJobSection = !compact || sidebarTab === "chats";

  const hasJobBlock =
    !compact &&
    showJobSection &&
    (runningInJobSectionOnly.length > 0 || recentDoneInJobSectionOnly.length > 0);

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

    const titleDisplay = convTitleForJobs(conversations, job.conversation_id);

    const handleJobOpen = () => {
      onAcknowledgeJob?.(job.id);
      onSelect(job.conversation_id);
    };

    const convForJob = conversations.find((c) => c.id === job.conversation_id);
    const jobRowActionsActive = Boolean(convForJob && !convForJob.archived_at);

    return (
      <div
        className={cn(
          "flex items-start gap-3 text-sm transition-colors rounded-lg border px-3 py-2.5",
          activeId === job.conversation_id
            ? "border-border bg-foreground/[0.115] text-foreground dark:border-border dark:bg-muted/88"
            : "border-transparent bg-muted/20 text-muted-foreground hover:border-border/80 hover:bg-foreground/[0.065] hover:text-foreground dark:border-transparent dark:bg-muted/10 dark:hover:border-border/70 dark:hover:bg-muted/52",
        )}
      >
        <button type="button" className="flex-1 min-w-0 text-left" onClick={handleJobOpen}>
          <p className="truncate font-medium text-sm">{titleDisplay ?? "\u00a0"}</p>
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
    <div
      className="flex w-4 shrink-0 justify-center pt-0.5 text-muted-foreground transition-colors group-hover:text-foreground/85"
      aria-hidden
    >
      {visual === "running" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {visual === "queued" && <ListOrdered className="h-3.5 w-3.5" />}
      {visual === "done" && <CircleCheck className="h-3.5 w-3.5" />}
      {visual === "failed" && <XCircle className="h-3.5 w-3.5 text-destructive/80 group-hover:text-destructive" />}
      {visual === "idle" && <MessageSquare className="h-3.5 w-3.5 opacity-70 group-hover:opacity-100" />}
    </div>
  );

  type RowMode = "page" | "compact-active" | "compact-archived";

  const ConversationRow = ({ conv, rowMode }: { conv: Conversation; rowMode: RowMode }) => {
    const jobVisual = resolveConversationJobVisual(conv.id, jobs, runStates);
    const titleDisplay = conversationListTitleDisplay(conv.title);
    const queuedJobId = jobs.find((j) => j.conversation_id === conv.id && j.status === "queued")?.id;

    return (
      <div
        className={cn(
          "group cursor-pointer text-sm transition-colors rounded-lg border",
          rowMode !== "page" &&
            "flex min-w-0 w-full items-start gap-1.5 px-2 py-2",
          rowMode === "page" && "flex items-start gap-2 px-3 py-2.5",
          activeId === conv.id
            ? "border-border bg-foreground/[0.115] text-foreground dark:border-border dark:bg-muted/88"
            : rowMode !== "page"
              ? "border-transparent text-muted-foreground hover:border-border/80 hover:bg-foreground/[0.065] hover:text-foreground focus-within:border-border/80 focus-within:bg-foreground/[0.065] dark:border-transparent dark:hover:border-border/70 dark:hover:bg-muted/52 dark:focus-within:border-border/70 dark:focus-within:bg-muted/52"
              : "border-transparent bg-muted/20 text-muted-foreground hover:border-border/80 hover:bg-foreground/[0.065] hover:text-foreground dark:border-transparent dark:bg-muted/10 dark:hover:border-border/70 dark:hover:bg-muted/52",
        )}
        onClick={() => editingId !== conv.id && onSelect(conv.id)}
      >
        {rowMode === "page" ? (
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
                  <p
                    className="truncate text-sm font-medium min-h-[1.25rem]"
                    aria-label={titleDisplay || "Unbenannter Chat"}
                  >
                    {titleDisplay ?? "\u00a0"}
                  </p>
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
                {queuedJobId && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 hover:bg-transparent"
                    title="Aus Warteschlange entfernen"
                    onClick={(e) => {
                      e.stopPropagation();
                      void onCancelQueuedJob(queuedJobId);
                    }}
                  >
                    <Ban className="h-3.5 w-3.5" />
                  </Button>
                )}
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
        ) : editingId === conv.id ? (
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
          <div className="grid min-w-0 w-full grid-cols-[1rem_minmax(0,1fr)_minmax(4.75rem,auto)] items-start gap-x-1.5">
            <ConversationStatusGlyph visual={jobVisual} />
            <div className="min-w-0 overflow-hidden">
              <div className="min-w-0 flex-1">
                <p
                  className="truncate text-xs font-medium min-h-[1rem] text-foreground"
                  aria-label={titleDisplay || "Unbenannter Chat"}
                >
                  {titleDisplay ?? "\u00a0"}
                </p>
                {conv.source_filename && (
                  <p className="mt-0.5 flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground/80">
                    <FileText className="h-3 w-3 shrink-0" />
                    <span className="min-w-0 truncate">{conv.source_filename}</span>
                  </p>
                )}
              </div>
            </div>
            <div className="relative flex h-4 min-w-[4.75rem] shrink-0 items-center justify-end self-start pt-0.5">
              <div
                className={cn(
                  "flex items-center justify-end gap-1 transition-opacity duration-150",
                  "group-hover:opacity-0 group-hover:pointer-events-none group-focus-within:opacity-0 group-focus-within:pointer-events-none",
                )}
                title={conv.updated_at}
              >
                <span className="text-right text-[10px] font-medium tabular-nums text-foreground/55 whitespace-nowrap transition-colors group-hover:text-foreground/85">
                  {formatRelativeShort(conv.updated_at) || "–"}
                </span>
                {conv.marked_unread && (
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500"
                    aria-label="Ungelesen"
                  />
                )}
              </div>
              <div
                className={cn(
                  "absolute inset-y-0 right-1 flex items-center gap-px opacity-0 transition-opacity duration-150",
                  "group-hover:opacity-100 group-focus-within:opacity-100",
                  "pointer-events-none group-hover:pointer-events-auto group-focus-within:pointer-events-auto",
                )}
              >
                {rowMode === "compact-active" && queuedJobId && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0 text-muted-foreground/55 hover:bg-muted/18 hover:text-foreground dark:text-muted-foreground/50 dark:hover:bg-muted/22 dark:hover:text-foreground"
                    title="Aus Warteschlange entfernen"
                    onClick={(e) => {
                      e.stopPropagation();
                      void onCancelQueuedJob(queuedJobId);
                    }}
                  >
                    <Ban className="h-2.5 w-2.5" />
                  </Button>
                )}
                {rowMode === "compact-active" && onArchive && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0 text-muted-foreground/55 hover:bg-muted/18 hover:text-foreground dark:text-muted-foreground/50 dark:hover:bg-muted/22 dark:hover:text-foreground"
                    title="Archivieren"
                    onClick={(e) => {
                      e.stopPropagation();
                      void Promise.resolve(onArchive(conv.id));
                    }}
                  >
                    <Archive className="h-2.5 w-2.5" />
                  </Button>
                )}
                {rowMode === "compact-archived" && onRestore && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0 text-muted-foreground/55 hover:bg-muted/18 hover:text-foreground dark:text-muted-foreground/50 dark:hover:bg-muted/22 dark:hover:text-foreground"
                    title="Wiederherstellen"
                    onClick={(e) => {
                      e.stopPropagation();
                      void Promise.resolve(onRestore(conv.id));
                    }}
                  >
                    <ArchiveRestore className="h-2.5 w-2.5" />
                  </Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0 text-muted-foreground/55 hover:bg-muted/18 hover:text-foreground dark:text-muted-foreground/50 dark:hover:bg-muted/22 dark:hover:text-foreground"
                      title="Mehr"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreHorizontal className="h-2.5 w-2.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48" onClick={(e) => e.stopPropagation()}>
                    {rowMode === "compact-active" && (
                      <>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            startEdit(conv);
                          }}
                        >
                          <Pencil className="mr-2 h-3.5 w-3.5" />
                          Umbenennen
                        </DropdownMenuItem>
                        {onMarkUnread && (
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              void Promise.resolve(onMarkUnread(conv.id));
                            }}
                          >
                            <Mail className="mr-2 h-3.5 w-3.5" />
                            Als ungelesen markieren
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          className="text-destructive data-[highlighted]:bg-destructive/12 data-[highlighted]:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDelete(conv.id);
                          }}
                        >
                          <Trash2 className="mr-2 h-3.5 w-3.5" />
                          Löschen
                        </DropdownMenuItem>
                      </>
                    )}
                    {rowMode === "compact-archived" && (
                      <DropdownMenuItem
                        className="text-destructive data-[highlighted]:bg-destructive/12 data-[highlighted]:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(conv.id);
                        }}
                      >
                        <Trash2 className="mr-2 h-3.5 w-3.5" />
                        Löschen
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>
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
            <ConversationRow key={conv.id} conv={conv} rowMode="page" />
          ))}
        </div>
      </div>
    );

  const { today, yesterday, earlier } = groupByDate(conversationsForPage);
  const failed = jobs.filter((j) => j.status === "failed" || j.status === "cancelled").length;

  const jobSectionTitle =
    "text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60 pl-1";

  const showFailedBanner = showJobSection && failed > 0 && !compact;

  const chatsListPagination =
    (sidebarChatVisibleCount < sortedChatsForSidebar.length ||
      sidebarChatVisibleCount > SIDEBAR_CHAT_PAGE) && (
      <div className="mt-2 flex w-full items-center justify-between gap-2 px-3">
        <div className="min-w-0 flex-1 flex justify-start">
          {sidebarChatVisibleCount > SIDEBAR_CHAT_PAGE && (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md border border-transparent px-2 py-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:border-border/55 hover:bg-muted/12 hover:text-foreground dark:hover:bg-muted/18"
              onClick={() =>
                setSidebarChatVisibleCount((n) => Math.max(n - SIDEBAR_CHAT_PAGE, SIDEBAR_CHAT_PAGE))
              }
            >
              <ChevronUp className="h-3 w-3 shrink-0" aria-hidden />
              Weniger
            </button>
          )}
        </div>
        <div className="min-w-0 flex-1 flex justify-end">
          {sidebarChatVisibleCount < sortedChatsForSidebar.length && (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md border border-transparent px-2 py-2 text-right text-xs font-medium text-muted-foreground transition-colors hover:border-border/55 hover:bg-muted/12 hover:text-foreground dark:hover:bg-muted/18"
              onClick={() =>
                setSidebarChatVisibleCount((n) => Math.min(n + SIDEBAR_CHAT_PAGE, sortedChatsForSidebar.length))
              }
            >
              Mehr
              <ChevronDown className="h-3 w-3 shrink-0" aria-hidden />
            </button>
          )}
        </div>
      </div>
    );

  return (
    <div className={cn("min-w-0 space-y-4", !compact && "space-y-8")}>
      {compact && !hideCompactTabBar && (
        <div className="flex min-w-0 gap-1.5">
          <button
            type="button"
            className={cn(
              "flex-1 rounded-lg border py-1.5 text-xs font-medium shadow-none transition-colors",
              sidebarTab === "chats"
                ? "border-border bg-foreground/[0.115] text-foreground dark:border-border dark:bg-muted/88"
                : "border-border/55 text-muted-foreground hover:border-border/80 hover:bg-foreground/[0.065] hover:text-foreground dark:border-border/50 dark:hover:border-border/70 dark:hover:bg-muted/52 dark:hover:text-foreground",
            )}
            onClick={() => setSidebarTab("chats")}
          >
            Chats
          </button>
          <button
            type="button"
            className={cn(
              "flex-1 rounded-lg border py-1.5 text-xs font-medium shadow-none transition-colors",
              sidebarTab === "archive"
                ? "border-border bg-foreground/[0.115] text-foreground dark:border-border dark:bg-muted/88"
                : "border-border/55 text-muted-foreground hover:border-border/80 hover:bg-foreground/[0.065] hover:text-foreground dark:border-border/50 dark:hover:border-border/70 dark:hover:bg-muted/52 dark:hover:text-foreground",
            )}
            onClick={() => setSidebarTab("archive")}
          >
            Archiv
          </button>
        </div>
      )}

      {!compact ? (
        <>
          {hasJobBlock && (
            <div className="space-y-6">
              <p className={jobSectionTitle}>Chats</p>
              {runningInJobSectionOnly.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                    <Loader2 className="w-3.5 h-3.5" />
                    Läuft
                  </p>
                  <div className="space-y-1.5">
                    {runningInJobSectionOnly.map((j) => (
                      <JobRow key={j.id} job={j} variant="running" />
                    ))}
                  </div>
                </div>
              )}
              {recentDoneInJobSectionOnly.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                    <CircleCheck className="w-3.5 h-3.5" />
                    Zuletzt fertig
                  </p>
                  <div className="space-y-1.5">
                    {recentDoneInJobSectionOnly.map((j) => (
                      <JobRow key={j.id} job={j} variant="done" />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {showFailedBanner && (
            <p className="text-[10px] sm:text-xs text-muted-foreground flex items-center gap-1.5 pl-0.5">
              <XCircle className="w-3.5 h-3.5 shrink-0" />
              <span>{failed} abgebrochen/fehlgeschlagen</span>
            </p>
          )}
          <div>
            {conversationsForPage.length === 0 ? (
              <p className="text-xs text-muted-foreground/80 text-center py-8">Noch keine Chats</p>
            ) : (
              <>
                <Section label="Heute" items={today} />
                <Section label="Gestern" items={yesterday} />
                <Section label="Älter" items={earlier} />
              </>
            )}
          </div>
        </>
      ) : sidebarTab === "chats" ? (
        <div>
          {nonArchived.length === 0 ? (
            <p className="text-xs text-muted-foreground/80 text-center py-8">Noch keine Chats</p>
          ) : (
            <>
              <div className="min-w-0 space-y-1.5">
                {visibleSidebarChats.map((conv) => (
                  <ConversationRow key={conv.id} conv={conv} rowMode="compact-active" />
                ))}
              </div>
              {chatsListPagination}
            </>
          )}
        </div>
      ) : (
        <>
          {archivedOnly.length === 0 ? (
            <p className="text-xs text-muted-foreground/80 text-center py-8">Archiv ist leer</p>
          ) : (
            <>
              <div className="min-w-0 space-y-1.5">
                {visibleSidebarChats.map((conv) => (
                  <ConversationRow key={conv.id} conv={conv} rowMode="compact-archived" />
                ))}
              </div>
              {chatsListPagination}
            </>
          )}
        </>
      )}
    </div>
  );
};

export default HistoryPanel;

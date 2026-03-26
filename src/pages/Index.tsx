import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import AppHeader from "@/components/AppHeader";
import ChatBubble, { type ChatMessage } from "@/components/ChatBubble";
import ChatInput, {
  CHAT_COMPOSER_DOCK_BELOW_CARD,
  CHAT_COMPOSER_DOCK_BOTTOM_PAD,
  CHAT_COMPOSER_DOCK_TOP_PAD,
  CHAT_COMPOSER_OUTER_HEIGHT_CLASS,
  type ChatInputHandle,
} from "@/components/ChatInput";
import AnalysisStopwatch from "@/components/AnalysisStopwatch";
import PipelineProgress from "@/components/PipelineProgress";
import WelcomeScreen from "@/components/WelcomeScreen";
import ConversationSidebar from "@/components/ConversationSidebar";
import AgentsSidebar from "@/components/AgentsSidebar";
import HistoryPanel from "@/components/HistoryPanel";
import SettingsContent from "@/components/SettingsContent";
import ProfileContent from "@/components/ProfileContent";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useConversations } from "@/hooks/useConversations";
import { useAcknowledgedJobs } from "@/hooks/useAcknowledgedJobs";
import { useBackgroundJobQueue } from "@/hooks/useBackgroundJobQueue";
import type { GuidedWorkflowKind } from "@/lib/guidedWorkflow";
import { supabase } from "@/integrations/supabase/client";
import { getModelInfo, AVAILABLE_MODELS, MODEL_TAG_LABELS, MODEL_TAG_TOOLTIPS, type ModelTag } from "@/data/models";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useKeyboardShortcutPrefs } from "@/hooks/useKeyboardShortcutPrefs";
import { loadKeyboardShortcutPrefs, matchShortcutToken, formatModCombo } from "@/lib/keyboardShortcutPrefs";

function findInvoiceReviewSourcePdfForMessage(
  messages: ChatMessage[],
  index: number,
): { previewUrl: string; name: string } | null {
  const msg = messages[index];
  if (msg.role !== "assistant" || (!msg.invoiceResult && !msg.engine3Result)) return null;
  for (let i = index - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") break;
    if (messages[i].role !== "user") continue;
    const pdf = messages[i].attachments?.find(
      (a) =>
        Boolean(a.previewUrl) &&
        (a.type === "application/pdf" || a.name.toLowerCase().endsWith(".pdf")),
    );
    if (pdf?.previewUrl) return { previewUrl: pdf.previewUrl, name: pdf.name };
  }
  return null;
}

const Index = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [mainView, setMainView] = useState<"chat" | "settings" | "profile">("chat");
  const location = useLocation();
  const navigate = useNavigate();
  const [agentsSheetOpen, setAgentsSheetOpen] = useState(false);
  const [freeExhaustedDialogOpen, setFreeExhaustedDialogOpen] = useState(false);
  const [freeExhaustedErrorDetails, setFreeExhaustedErrorDetails] = useState<string | null>(null);
  const [pendingAttachmentPicker, setPendingAttachmentPicker] = useState(false);
  const chatInputRef = useRef<ChatInputHandle>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const { user, isAdmin } = useAuth();
  const { prefs: shortcutPrefs } = useKeyboardShortcutPrefs();
  const [userSettings, setUserSettings] = useState<{ selected_model: string | null; custom_rules: string | null; engine_type: string | null }>({ selected_model: null, custom_rules: null, engine_type: null });
  const [globalSettings, setGlobalSettings] = useState<{ default_model: string; default_rules: string; default_engine: string }>({ default_model: "openrouter/free", default_rules: "", default_engine: "simple" });
  const [settingsInitialTab, setSettingsInitialTab] = useState<"user" | "display" | "global" | undefined>(undefined);
  const [settingsOpenSeq, setSettingsOpenSeq] = useState(0);
  const settingsPanelHydration = useMemo(
    () => ({ global: globalSettings, user: userSettings }),
    [globalSettings, userSettings],
  );
  const [sessionModelOverride, setSessionModelOverride] = useState<string | null>(null);
  /** Bumps on „Neuer Chat“ so WelcomeScreen remounts and fade-in runs again. */
  const [emptyChatAnimKey, setEmptyChatAnimKey] = useState(0);

  const {
    conversations,
    activeConversationId,
    setActiveConversationId,
    createConversation,
    loadMessages,
    saveMessage,
    updateMessageStructuredContent,
    deleteConversation,
    deleteAllArchivedConversations,
    updateTitle,
    updateSourceFilename,
    fetchConversations,
    archiveConversation,
    archiveAllNonArchivedConversations,
    restoreConversation,
    markConversationUnread,
    markConversationRead,
  } = useConversations();

  const { acknowledgedSet, acknowledge } = useAcknowledgedJobs(user?.id);

  const loadSettings = useCallback(async () => {
    if (!user) return;
    const { data: gData } = await supabase.from("global_settings").select("*").limit(1).single();
    if (gData) setGlobalSettings({
      default_model: gData.default_model,
      default_rules: gData.default_rules,
      default_engine: (gData as { default_engine?: string }).default_engine ?? "simple",
    });
    const { data: uData } = await supabase.from("user_settings").select("*").eq("user_id", user.id).maybeSingle();
    if (uData) setUserSettings({
      selected_model: uData.selected_model,
      custom_rules: uData.custom_rules,
      engine_type: (uData as { engine_type?: string | null }).engine_type ?? null,
    });
  }, [user]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    const st = location.state as { openProfile?: boolean } | null;
    if (st?.openProfile) {
      setMainView("profile");
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.pathname, location.state, navigate]);

  useEffect(() => {
    if (mainView !== "settings" || !isAdmin) return;
    if (settingsInitialTab !== undefined) return;
    setSettingsInitialTab("global");
  }, [mainView, isAdmin, settingsInitialTab]);

  const effectiveModel = sessionModelOverride ?? userSettings.selected_model ?? globalSettings.default_model;

  const onFreeModelsExhausted = useCallback((details: string | null) => {
    setFreeExhaustedErrorDetails(details);
    setFreeExhaustedDialogOpen(true);
  }, []);

  const {
    jobs,
    runStates,
    enqueueSend,
    activeRunInfo,
    isConversationBusy,
    stopBackgroundForActiveConversation,
    cancelQueuedJob,
    mergeMessagesWithLiveStream,
  } = useBackgroundJobQueue({
    user,
    toast,
    activeConversationId,
    setActiveConversationId,
    createConversation,
    saveMessage,
    loadMessages,
    updateSourceFilename,
    updateTitle,
    fetchConversations,
    userSettings,
    globalSettings,
    effectiveModel,
    setMessages,
    onFreeModelsExhausted,
  });

  const isChatBusy = isConversationBusy(activeConversationId);
  const pipelineStep = activeRunInfo?.pipelineStep ?? null;
  const analysisStartTime = activeRunInfo?.analysisStartTime ?? null;

  const shortcutsBlockRef = useRef({
    mainView,
    isChatBusy,
    freeExhaustedDialogOpen,
    agentsSheetOpen,
  });
  shortcutsBlockRef.current = {
    mainView,
    isChatBusy,
    freeExhaustedDialogOpen,
    agentsSheetOpen,
  };

  const handleStop = useCallback(() => {
    void stopBackgroundForActiveConversation();
  }, [stopBackgroundForActiveConversation]);

  const sendMessage = useCallback(
    async (
      content: string,
      files?: File[],
      guided?: { workflow: GuidedWorkflowKind; phase: "collect" },
    ) => {
      await enqueueSend(content, files, guided);
    },
    [enqueueSend],
  );

  const saveUserModel = useCallback(
    async (model: string | null) => {
      if (!user) {
        setSessionModelOverride(model);
        return;
      }
      const { data: existing } = await supabase
        .from("user_settings")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      const payload = { selected_model: model, updated_at: new Date().toISOString() };
      if (existing) {
        await supabase.from("user_settings").update(payload).eq("id", existing.id);
      } else {
        await supabase.from("user_settings").insert({ user_id: user.id, selected_model: model });
      }
      setUserSettings((prev) => ({ ...prev, selected_model: model }));
      toast({ title: "Gespeichert", description: "Modell wurde aktualisiert." });
    },
    [user, toast]
  );

  const handleModelSelect = useCallback(
    (value: string) => {
      if (value === "__global__") {
        saveUserModel(null);
      } else {
        saveUserModel(value);
      }
    },
    [saveUserModel]
  );

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isChatBusy, pipelineStep]);

  // Load messages when selecting a conversation (from Agents-/History-Panel)
  const handleSelectConversation = useCallback(
    async (id: string) => {
      setActiveConversationId(id);
      setSidebarOpen(false);
      setAgentsSheetOpen(false);
      setMainView("chat");
      const merged = await mergeMessagesWithLiveStream(id);
      setMessages(merged);
      void markConversationRead(id);
    },
    [mergeMessagesWithLiveStream, setActiveConversationId, markConversationRead]
  );

  const handleNewConversation = useCallback(async () => {
    setEmptyChatAnimKey((k) => k + 1);
    setMessages([]);
    setSidebarOpen(false);
    setAgentsSheetOpen(false);
    setMainView("chat");
    const focusComposer = () =>
      requestAnimationFrame(() => chatInputRef.current?.focusComposer());
    if (user) {
      const id = await createConversation("Neues Gespräch");
      if (id) {
        setActiveConversationId(id);
        focusComposer();
        return;
      }
    }
    setActiveConversationId(null);
    void fetchConversations();
    focusComposer();
  }, [user, createConversation, setActiveConversationId, fetchConversations]);

  const handleDeleteConversation = useCallback(
    async (id: string) => {
      await deleteConversation(id);
      if (activeConversationId === id) {
        setMessages([]);
      }
    },
    [deleteConversation, activeConversationId]
  );

  const handleDeleteAllArchived = useCallback(async () => {
    const wasViewingArchived =
      activeConversationId != null &&
      conversations.some((c) => c.id === activeConversationId && c.archived_at != null);
    await deleteAllArchivedConversations();
    if (wasViewingArchived) setMessages([]);
  }, [
    activeConversationId,
    conversations,
    deleteAllArchivedConversations,
  ]);

  const handleArchiveAllChats = useCallback(async () => {
    const wasActiveNonArchived =
      activeConversationId != null &&
      conversations.some((c) => c.id === activeConversationId && !c.archived_at);
    await archiveAllNonArchivedConversations();
    if (wasActiveNonArchived) {
      setActiveConversationId(null);
      setMessages([]);
    }
  }, [
    activeConversationId,
    conversations,
    archiveAllNonArchivedConversations,
    setActiveConversationId,
  ]);

  const handleRenameConversation = useCallback(
    async (id: string, title: string) => {
      await updateTitle(id, title);
    },
    [updateTitle]
  );

  const handleArchiveConversation = useCallback(
    async (id: string) => {
      await archiveConversation(id);
      if (activeConversationId === id) {
        setActiveConversationId(null);
        setMessages([]);
      }
    },
    [archiveConversation, activeConversationId, setActiveConversationId, setMessages],
  );

  const handleSettings = useCallback(() => {
    setSettingsInitialTab(isAdmin ? "global" : undefined);
    setSettingsOpenSeq((n) => n + 1);
    setMainView("settings");
  }, [isAdmin]);

  const handleProfile = useCallback(() => {
    setMainView("profile");
  }, []);

  useLayoutEffect(() => {
    if (mainView === "chat" && pendingAttachmentPicker) {
      setPendingAttachmentPicker(false);
      queueMicrotask(() => chatInputRef.current?.openAttachmentPicker());
    }
  }, [mainView, pendingAttachmentPicker]);

  useEffect(() => {
    const isForeignFormField = (): boolean => {
      const active = document.activeElement;
      if (!active || !(active instanceof HTMLElement)) return false;
      const t = active.tagName;
      if (t !== "INPUT" && t !== "TEXTAREA" && t !== "SELECT") return false;
      if (t === "TEXTAREA" && active.getAttribute("data-composer-chat") === "true") return false;
      return true;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const s = shortcutsBlockRef.current;
      if (s.freeExhaustedDialogOpen || s.agentsSheetOpen) return;
      if (document.documentElement.hasAttribute("data-docbill-capture-shortcut")) return;

      const prefs = loadKeyboardShortcutPrefs();

      if (e.key === "Escape") {
        if (!prefs.escapeStopsAnalysis || !s.isChatBusy) return;
        e.preventDefault();
        handleStop();
        return;
      }

      if (!(e.metaKey || e.ctrlKey || e.altKey)) return;

      if (matchShortcutToken(e, prefs.keys.newChat)) {
        e.preventDefault();
        handleNewConversation();
        return;
      }
      if (matchShortcutToken(e, prefs.keys.settings)) {
        e.preventDefault();
        handleSettings();
        return;
      }
      if (matchShortcutToken(e, prefs.keys.help)) {
        e.preventDefault();
        setSettingsInitialTab("user");
        setSettingsOpenSeq((n) => n + 1);
        setMainView("settings");
        return;
      }
      if (matchShortcutToken(e, prefs.keys.upload) && !isForeignFormField()) {
        e.preventDefault();
        if (s.mainView !== "chat") {
          setMainView("chat");
          setPendingAttachmentPicker(true);
        } else {
          chatInputRef.current?.openAttachmentPicker();
        }
        return;
      }
      if (matchShortcutToken(e, prefs.keys.stop) && s.isChatBusy) {
        e.preventDefault();
        handleStop();
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [handleNewConversation, handleSettings, handleStop]);

  const historyPanelProps = {
    conversations,
    activeId: activeConversationId,
    onSelect: (id: string) => void handleSelectConversation(id),
    onDelete: handleDeleteConversation,
    onRename: handleRenameConversation,
    jobs,
    runStates,
    onCancelQueuedJob: cancelQueuedJob,
    onArchive: handleArchiveConversation,
    onRestore: restoreConversation,
    onMarkUnread: markConversationUnread,
    acknowledgedJobIds: acknowledgedSet,
    onAcknowledgeJob: acknowledge,
    onDeleteAllArchived: handleDeleteAllArchived,
    onArchiveAllChats: handleArchiveAllChats,
  };

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar: fixed overlay, expands over content */}
      <ConversationSidebar
        onSettings={handleSettings}
        onProfile={handleProfile}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        collapsed={sidebarCollapsed}
        onCollapsedChange={setSidebarCollapsed}
      />

      <div
        className={cn(
          "flex-1 flex flex-col min-w-0 relative transition-[margin] duration-200 ease-in-out",
          sidebarCollapsed ? "md:ml-[3.6rem] md:mr-72" : "md:ml-48 md:mr-72",
        )}
      >
        <header className="absolute top-0 right-0 left-0 z-50 md:right-72">
          <AppHeader
            onToggleSidebar={() => setSidebarOpen((v) => !v)}
            onOpenAgentsSheet={() => setAgentsSheetOpen(true)}
            viewType={mainView}
            onBack={mainView !== "chat" ? () => setMainView("chat") : undefined}
            onOpenProfile={handleProfile}
          />
        </header>

        <div
          ref={scrollRef}
          className={cn(
            "flex-1 overflow-y-auto pt-14 min-h-0 [scrollbar-gutter:stable]",
            mainView === "chat" ? "pb-44 sm:pb-40" : "pb-24"
          )}
        >
          {mainView === "chat" && (
            messages.length === 0 ? (
              <div
                key={emptyChatAnimKey}
                className="motion-reduce:animate-none animate-fade-in min-h-[40vh] flex flex-col"
              >
                <WelcomeScreen
                  onPick={(pick) =>
                    sendMessage(pick.text, undefined, {
                      workflow: pick.workflow,
                      phase: "collect",
                    })
                  }
                />
              </div>
            ) : (
              <div className="max-w-6xl mx-auto px-4 pt-6 pb-16 space-y-4 min-h-[40vh]">
                <ErrorBoundary>
                  {messages.map((msg, idx) => (
                    <ChatBubble
                      key={msg.id}
                      message={msg}
                      conversationId={activeConversationId}
                      updateMessageStructuredContent={updateMessageStructuredContent}
                      invoiceReviewSourcePdf={findInvoiceReviewSourcePdfForMessage(messages, idx)}
                      feedbackSessionMeta={{
                        model: effectiveModel,
                        engine: userSettings.engine_type ?? globalSettings.default_engine,
                      }}
                      feedbackPriorMessages={messages.slice(Math.max(0, idx - 8), idx + 1).map((m) => ({
                        role: m.role,
                        content: m.content,
                      }))}
                    />
                  ))}
                  {isChatBusy && analysisStartTime != null && (
                    pipelineStep ? (
                      <PipelineProgress
                        step={pipelineStep.step}
                        totalSteps={pipelineStep.totalSteps}
                        label={pipelineStep.label}
                        startTime={analysisStartTime}
                      />
                    ) : (
                      <AnalysisStopwatch startTime={analysisStartTime} />
                    )
                  )}
                </ErrorBoundary>
              </div>
            )
          )}
          {mainView === "settings" && (
            <div className="pb-16">
              <SettingsContent
                onSettingsSaved={loadSettings}
                initialTab={settingsInitialTab}
                openSeq={settingsOpenSeq}
                chatSettingsHydration={settingsPanelHydration}
              />
            </div>
          )}
          {mainView === "profile" && (
            <div className="pb-16">
              <ProfileContent />
            </div>
          )}
        </div>

        {mainView === "chat" && (
          <div
            className={cn(
              "fixed bottom-0 left-0 right-0 z-50 pointer-events-none transition-[left,right] duration-200 ease-in-out",
              sidebarCollapsed ? "md:left-[3.6rem] md:right-72" : "md:left-48 md:right-72",
            )}
          >
            <div
              className={cn(
                "max-w-3xl mx-auto w-full px-4 pointer-events-auto",
                CHAT_COMPOSER_DOCK_TOP_PAD,
                CHAT_COMPOSER_DOCK_BOTTOM_PAD,
              )}
            >
              <ChatInput
                ref={chatInputRef}
                onSend={sendMessage}
                isLoading={isChatBusy}
                onStop={handleStop}
                attachmentShortcutHint={formatModCombo(shortcutPrefs.keys.upload)}
                stopShortcutHint={formatModCombo(shortcutPrefs.keys.stop)}
                draftConversationId={activeConversationId}
              />
              <div className={cn("flex items-center justify-between gap-3", CHAT_COMPOSER_DOCK_BELOW_CARD)}>
                <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground/80 shrink min-w-0 px-2.5 py-1 rounded-md bg-muted">
                  <AlertTriangle className="w-3 h-3 shrink-0 text-muted-foreground/80" />
                  KI-generierte Ergebnisse vor Verwendung fachlich prüfen!
                </p>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        "shrink-0 inline-flex items-center gap-1.5 text-[10px] text-muted-foreground/90 hover:text-foreground transition-colors",
                        "px-2.5 py-1 rounded-md bg-muted hover:bg-muted/90 border border-transparent"
                      )}
                      title="Modell auswählen"
                    >
                      {(() => {
                        const { label, isFree, pricePerInvoice } = getModelInfo(effectiveModel);
                        const pillText = isFree ? "Free" : pricePerInvoice ?? "Pay";
                        return (
                          <>
                            <span className="truncate max-w-[120px]">{label}</span>
                            <span
                              className={cn(
                                "shrink-0 text-[9px] font-medium",
                                isFree && "text-emerald-600 dark:text-emerald-400",
                                pricePerInvoice === "~0.05€" && "text-slate-600 dark:text-slate-400",
                                pricePerInvoice === "~0.15€" && "text-amber-600 dark:text-amber-400",
                                pricePerInvoice === "~0.40€" && "text-rose-600 dark:text-rose-400",
                                !isFree && !pricePerInvoice && "text-amber-600 dark:text-amber-400"
                              )}
                            >
                              {pillText}
                            </span>
                            <ChevronDown className="w-3 h-3 opacity-60 shrink-0" />
                          </>
                        );
                      })()}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="max-h-[280px] overflow-y-auto w-64">
                    <DropdownMenuRadioGroup
                      value={
                        (user && userSettings.selected_model === null) || (!user && sessionModelOverride === null)
                          ? "__global__"
                          : effectiveModel
                      }
                      onValueChange={handleModelSelect}
                    >
                      <DropdownMenuLabel className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider py-1">
                        Modell
                      </DropdownMenuLabel>
                      <DropdownMenuRadioItem value="__global__">
                        <span className="text-muted-foreground">Globaler Standard</span>
                      </DropdownMenuRadioItem>
                      <DropdownMenuSeparator />
                      {AVAILABLE_MODELS.map((m) => (
                        <DropdownMenuRadioItem key={m.value} value={m.value} className="min-w-0">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="flex items-center justify-between gap-2 min-w-0 w-full cursor-pointer">
                                <span className="font-medium truncate">{m.label}</span>
                                <span className={cn(
                                  "text-[9px] font-medium px-1.5 py-0.5 rounded shrink-0",
                                  m.isFree && "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
                                  !m.isFree && m.pricePerInvoice === "~0.05€" && "bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300",
                                  !m.isFree && m.pricePerInvoice === "~0.15€" && "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
                                  !m.isFree && m.pricePerInvoice === "~0.40€" && "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
                                  !m.isFree && !m.pricePerInvoice && "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                                )}>
                                  {m.isFree ? "Free" : m.pricePerInvoice ?? "Pay"}
                                </span>
                              </div>
                            </TooltipTrigger>
                            {m.tags && m.tags.length > 0 ? (
                              <TooltipContent side="left" align="start" sideOffset={8} collisionPadding={16} className="max-w-[280px] z-[100]">
                                <div className="space-y-2 text-sm">
                                  {m.tags.map((tag: ModelTag) => (
                                    <div key={tag}>
                                      <span className="font-medium">{MODEL_TAG_LABELS[tag]}:</span>{" "}
                                      {MODEL_TAG_TOOLTIPS[tag]}
                                    </div>
                                  ))}
                                </div>
                              </TooltipContent>
                            ) : (
                              <TooltipContent side="left" align="start" sideOffset={8} collisionPadding={16} className="max-w-[280px] z-[100]">
                                <div className="space-y-2 text-sm">
                                  <div>
                                    <span className="font-medium">Nur Text:</span>{" "}
                                    Keine Dokument- oder Bildverarbeitung. Für reine Chat-Anfragen ohne Upload geeignet.
                                  </div>
                                </div>
                              </TooltipContent>
                            )}
                          </Tooltip>
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>
        )}
      </div>

      <AlertDialog open={freeExhaustedDialogOpen} onOpenChange={(open) => {
        setFreeExhaustedDialogOpen(open);
        if (!open) setFreeExhaustedErrorDetails(null);
      }}>
        <AlertDialogContent className="max-h-[90vh] overflow-x-hidden overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>Kostenlose Modelle nicht verfügbar</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 min-w-0">
                <p>
                  Die ausgewählten kostenlosen Modelle konnten die Anfrage nicht verarbeiten.
                  Möchten Sie auf ein kostenpflichtiges Modell wechseln?
                </p>
                {freeExhaustedErrorDetails && (
                  <div className="mt-2 min-w-0">
                    <span className="text-xs font-medium">Fehlerdetails:</span>
                    <div className="mt-1 rounded-md border border-border bg-muted/50 p-3 overflow-hidden">
                      <pre className="text-xs overflow-auto max-h-32 whitespace-pre-wrap break-all font-mono">
                        {freeExhaustedErrorDetails}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setSettingsInitialTab(isAdmin ? "global" : undefined);
                setSettingsOpenSeq((n) => n + 1);
                setMainView("settings");
                setSidebarOpen(true);
              }}
            >
              Zu Einstellungen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AgentsSidebar onNew={handleNewConversation} {...historyPanelProps} />

      <Sheet open={agentsSheetOpen} onOpenChange={setAgentsSheetOpen}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 bg-muted/50 p-0 shadow-none dark:bg-muted/20 sm:max-w-72 [&>button]:top-3"
        >
          <ScrollArea className="min-h-0 min-w-0 flex-1 bg-muted/50 dark:bg-muted/20">
            <div className="min-w-0 pl-2 pr-3.5 pt-2 pb-4">
              <HistoryPanel {...historyPanelProps} layout="sidebar" />
            </div>
          </ScrollArea>
          <div
            className={cn(
              "shrink-0 pl-2 pr-3.5 bg-muted/50 transition-colors hover:bg-muted/40 dark:bg-muted/20 dark:hover:bg-muted/28",
              CHAT_COMPOSER_DOCK_TOP_PAD,
              CHAT_COMPOSER_DOCK_BOTTOM_PAD,
            )}
          >
            <Button
              type="button"
              variant="ghost"
              className={cn(
                "group w-full inline-flex items-center justify-center gap-2.5 rounded-xl px-3 text-sm font-medium text-foreground shadow-none",
                "transition-[background-color,border-color,transform,color] duration-200 ease-out",
                "active:scale-[0.99]",
                CHAT_COMPOSER_OUTER_HEIGHT_CLASS,
                "border border-border/80 bg-foreground/[0.065] dark:border-border/70 dark:bg-muted/52",
                "hover:border-border hover:bg-foreground/[0.115] hover:!text-foreground dark:hover:border-border dark:hover:bg-muted/88",
                "active:border-border active:bg-foreground/[0.115] active:text-foreground dark:active:border-border dark:active:bg-muted/88",
                "[&_svg]:size-5 [&_svg]:opacity-90 [&_svg]:transition-transform [&_svg]:duration-200 [&_svg]:ease-out [&_svg]:group-hover:scale-105 [&_svg]:group-hover:opacity-100",
              )}
              onClick={handleNewConversation}
            >
              <Plus className="shrink-0" />
              Neuer Chat
            </Button>
            <div className={CHAT_COMPOSER_DOCK_BELOW_CARD} aria-hidden />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default Index;

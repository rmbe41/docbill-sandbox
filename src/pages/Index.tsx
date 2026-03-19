import { useState, useRef, useEffect, useCallback } from "react";
import AppHeader from "@/components/AppHeader";
import ChatBubble, { type ChatMessage } from "@/components/ChatBubble";
import ChatInput from "@/components/ChatInput";
import TypingIndicator from "@/components/TypingIndicator";
import PipelineProgress from "@/components/PipelineProgress";
import WelcomeScreen from "@/components/WelcomeScreen";
import ConversationSidebar from "@/components/ConversationSidebar";
import HistoryView from "@/components/HistoryView";
import SettingsContent from "@/components/SettingsContent";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useConversations } from "@/hooks/useConversations";
import { supabase } from "@/integrations/supabase/client";
import { getModelInfo, AVAILABLE_MODELS } from "@/data/models";
import type { InvoiceResultData } from "@/components/InvoiceResult";
import type { ServiceBillingResultData } from "@/components/ServiceBillingResult";
import { cn } from "@/lib/utils";
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

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/goae-chat`;

const Index = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [mainView, setMainView] = useState<"chat" | "history" | "settings">("chat");
  const [freeExhaustedDialogOpen, setFreeExhaustedDialogOpen] = useState(false);
  const [freeExhaustedErrorDetails, setFreeExhaustedErrorDetails] = useState<string | null>(null);
  const [pipelineStep, setPipelineStep] = useState<{
    step: number;
    totalSteps: number;
    label: string;
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const abortRequestedRef = useRef(false);
  const { toast } = useToast();

  const handleStop = useCallback(() => {
    abortRequestedRef.current = true;
    abortControllerRef.current?.abort();
    setPipelineStep(null);
    setIsLoading(false);
  }, []);
  const { user } = useAuth();
  const [userSettings, setUserSettings] = useState<{ selected_model: string | null; custom_rules: string | null; engine_type: string | null }>({ selected_model: null, custom_rules: null, engine_type: null });
  const [globalSettings, setGlobalSettings] = useState<{ default_model: string; default_rules: string; default_engine: string }>({ default_model: "openrouter/free", default_rules: "", default_engine: "complex" });
  const [settingsInitialTab, setSettingsInitialTab] = useState<"user" | "display" | "global" | undefined>(undefined);
  const [sessionModelOverride, setSessionModelOverride] = useState<string | null>(null);

  const {
    conversations,
    activeConversationId,
    setActiveConversationId,
    createConversation,
    loadMessages,
    saveMessage,
    deleteConversation,
    updateTitle,
    updateSourceFilename,
    fetchConversations,
  } = useConversations();

  const loadSettings = useCallback(async () => {
    if (!user) return;
    const { data: gData } = await supabase.from("global_settings").select("*").limit(1).single();
    if (gData) setGlobalSettings({
      default_model: gData.default_model,
      default_rules: gData.default_rules,
      default_engine: (gData as { default_engine?: string }).default_engine ?? "complex",
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

  const effectiveModel = sessionModelOverride ?? userSettings.selected_model ?? globalSettings.default_model;

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
  }, [messages, isLoading, pipelineStep]);

  // Load messages when selecting a conversation (from HistoryView)
  const handleSelectConversation = useCallback(
    async (id: string) => {
      setActiveConversationId(id);
      setSidebarOpen(false);
      setMainView("chat");
      const dbMessages = await loadMessages(id);
      setMessages(
        dbMessages.map((m) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          content: m.content,
        }))
      );
    },
    [loadMessages, setActiveConversationId]
  );

  const handleNewConversation = useCallback(() => {
    setActiveConversationId(null);
    setMessages([]);
    setSidebarOpen(false);
    setMainView("chat");
  }, [setActiveConversationId]);

  const handleDeleteConversation = useCallback(
    async (id: string) => {
      await deleteConversation(id);
      if (activeConversationId === id) {
        setMessages([]);
      }
    },
    [deleteConversation, activeConversationId]
  );

  const handleRenameConversation = useCallback(
    async (id: string, title: string) => {
      await updateTitle(id, title);
    },
    [updateTitle]
  );

  const handleSettings = useCallback(() => {
    setSettingsInitialTab(undefined);
    setMainView("settings");
  }, []);

  const handleHistory = useCallback(() => {
    setMainView("history");
  }, []);


  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const sendMessage = useCallback(
    async (content: string, files?: File[]) => {
      const attachments = files?.map((f) => ({
        name: f.name,
        type: f.type,
        previewUrl:
          f.type.startsWith("image/") || f.type === "application/pdf"
            ? URL.createObjectURL(f)
            : undefined,
      }));
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content,
        attachments,
      };

      setMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);

      // Ensure we have a conversation
      let convId = activeConversationId;
      if (!convId) {
        const title = content.slice(0, 60) || "Neues Gespräch";
        convId = await createConversation(title);
        if (convId) setActiveConversationId(convId);
      }

      // Save user message to DB
      if (convId) {
        await saveMessage(convId, "user", content);
        // Store first file name for history display
        if (files && files.length > 0) {
          await updateSourceFilename(convId, files[0].name);
        }
      }

      let filePayloads: { name: string; type: string; data: string }[] = [];
      if (files && files.length > 0) {
        filePayloads = await Promise.all(
          files.map(async (f) => ({
            name: f.name,
            type: f.type,
            data: await fileToBase64(f),
          }))
        );
      }

      const apiMessages = [...messages, userMsg].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
      const lastInvoiceResult = lastAssistant?.invoiceResult;
      const lastServiceResult = lastAssistant?.serviceBillingResult;

      let assistantContent = "";
      let invoiceData: InvoiceResultData | undefined;
      let serviceBillingData: ServiceBillingResultData | undefined;

      const upsertAssistant = (chunk: string) => {
        assistantContent += chunk;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant") {
            return prev.map((m, i) =>
              i === prev.length - 1
                ? { ...m, content: assistantContent, invoiceResult: invoiceData, serviceBillingResult: serviceBillingData }
                : m
            );
          }
          return [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "assistant" as const,
              content: assistantContent,
              invoiceResult: invoiceData,
              serviceBillingResult: serviceBillingData,
            },
          ];
        });
      };

      try {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

        if (!supabaseUrl || !supabaseKey) {
          setTimeout(() => {
            upsertAssistant("⚠️ **Backend nicht verbunden.**");
            setIsLoading(false);
          }, 1500);
          return;
        }

        abortRequestedRef.current = false;
        const controller = new AbortController();
        abortControllerRef.current = controller;
        const timeoutId = setTimeout(() => controller.abort(), 180_000); // 3 min – verhindert endloses Warten bei hängender Verbindung
        const resp = await fetch(CHAT_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify({
            messages: apiMessages,
            files: filePayloads.length > 0 ? filePayloads : undefined,
            model: effectiveModel,
            engine_type: userSettings.engine_type ?? globalSettings.default_engine,
            extra_rules: [globalSettings.default_rules, userSettings.custom_rules].filter(Boolean).join("\n\n"),
            ...(lastInvoiceResult && {
              last_invoice_result: { pruefung: lastInvoiceResult },
            }),
            ...(lastServiceResult && {
              last_service_result: {
                vorschlaege: lastServiceResult.vorschlaege,
                optimierungen: lastServiceResult.optimierungen,
                klinischerKontext: lastServiceResult.klinischerKontext,
                fachgebiet: lastServiceResult.fachgebiet,
              },
            }),
          }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        abortControllerRef.current = null;


        if (resp.status === 429) {
          toast({ title: "Rate Limit", description: "Zu viele Anfragen.", variant: "destructive" });
          setIsLoading(false);
          return;
        }
        if (resp.status === 402) {
          toast({ title: "Credits erschöpft", description: "Bitte laden Sie Ihre Credits auf oder wählen Sie ein kostenloses Modell (Einstellungen).", variant: "destructive" });
          setIsLoading(false);
          return;
        }
        if (!resp.ok) {
          let errMsg = "Die Anfrage konnte nicht verarbeitet werden.";
          let errBody: { error?: string; code?: string } = {};
          try {
            errBody = await resp.json();
            if (errBody?.error) errMsg = errBody.error;
          } catch {
            errMsg = resp.status === 401 ? "Nicht autorisiert. Prüfen Sie die Supabase-Konfiguration." : errMsg;
          }
          if (errBody?.code === "FREE_MODELS_EXHAUSTED") {
            const parts = [errBody?.error, errBody?.details].filter(Boolean) as string[];
            setFreeExhaustedErrorDetails(parts.length ? parts.join("\n\n") : null);
            setFreeExhaustedDialogOpen(true);
          } else {
            toast({ title: "Fehler", description: errMsg, variant: "destructive" });
          }
          setIsLoading(false);
          return;
        }
        if (!resp.body) throw new Error("Stream failed");

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let textBuffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          textBuffer += decoder.decode(value, { stream: true });

          let newlineIndex: number;
          while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
            let line = textBuffer.slice(0, newlineIndex);
            textBuffer = textBuffer.slice(newlineIndex + 1);
            if (line.endsWith("\r")) line = line.slice(0, -1);
            if (line.startsWith(":") || line.trim() === "") continue;
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6).trim();
            if (jsonStr === "[DONE]") break;
            try {
              const parsed = JSON.parse(jsonStr);

              // Pipeline / Service billing progress events
              if (parsed.type === "pipeline_progress" || parsed.type === "service_billing_progress") {
                const step = parsed.step ?? 1;
                const total = parsed.totalSteps ?? 6;
                setPipelineStep({
                  step,
                  totalSteps: total,
                  label: parsed.label,
                });
                // #region agent log
                fetch('http://127.0.0.1:7350/ingest/d67df62b-428b-4fab-8921-97d904601338',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d48d1e'},body:JSON.stringify({sessionId:'d48d1e',location:'Index.tsx:progress_received',message:'Progress event received',data:{step,totalSteps:total,label:parsed.label},timestamp:Date.now(),hypothesisId:'A'})}).catch(()=>{});
                // #endregion
                continue;
              }

              // Pipeline result (structured data → render InvoiceResult component)
              // Support both formats: { pruefung, stammdaten } and legacy (data = pruefung directly)
              if (parsed.type === "pipeline_result") {
                setPipelineStep(null);
                const raw = parsed.data as { pruefung?: InvoiceResultData; stammdaten?: InvoiceResultData["stammdaten"] } | InvoiceResultData;
                const pruefung = "pruefung" in raw && raw.pruefung ? raw.pruefung : (raw as InvoiceResultData);
                const stammdaten = "stammdaten" in raw ? raw.stammdaten : undefined;
                invoiceData = {
                  positionen: pruefung?.positionen ?? [],
                  optimierungen: pruefung?.optimierungen ?? [],
                  zusammenfassung: pruefung?.zusammenfassung ?? {
                    gesamt: 0, korrekt: 0, warnungen: 0, fehler: 0,
                    rechnungsSumme: 0, korrigierteSumme: 0, optimierungsPotenzial: 0,
                  },
                  ...(stammdaten && { stammdaten }),
                };
                upsertAssistant("");
                continue;
              }

              // Pipeline error
              if (parsed.type === "pipeline_error") {
                setPipelineStep(null);
                upsertAssistant(`\n\n❌ **Pipeline-Fehler:** ${parsed.error}`);
                if (parsed.code === "FREE_MODELS_EXHAUSTED") {
                  setFreeExhaustedErrorDetails(parsed.error ?? parsed.details ?? null);
                  setFreeExhaustedDialogOpen(true);
                }
                continue;
              }

              // Service billing result
              if (parsed.type === "service_billing_result") {
                setPipelineStep(null);
                serviceBillingData = parsed.data as ServiceBillingResultData;
                upsertAssistant("");
                continue;
              }

              // Service billing error
              if (parsed.type === "service_billing_error") {
                setPipelineStep(null);
                upsertAssistant(`\n\n❌ **Fehler:** ${parsed.error}`);
                continue;
              }

              // OpenRouter mid-stream error (e.g. provider disconnect)
              if (parsed.error) {
                const errMsg = parsed.error?.message ?? parsed.error;
                upsertAssistant(`\n\n❌ **Stream-Fehler:** ${typeof errMsg === "string" ? errMsg : JSON.stringify(errMsg)}`);
                continue;
              }

              // Standard OpenRouter streaming content
              const c = parsed.choices?.[0]?.delta?.content as string | undefined;
              if (c) upsertAssistant(c);
            } catch {
              textBuffer = line + "\n" + textBuffer;
              break;
            }
          }
        }

        setPipelineStep(null);

        // Save assistant message to DB and update message id for feedback
        if (convId && assistantContent) {
          const savedId = await saveMessage(convId, "assistant", assistantContent);
          if (savedId) {
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.role === "assistant") {
                return prev.map((m, i) => (i === prev.length - 1 ? { ...m, id: savedId } : m));
              }
              return prev;
            });
          }
          await fetchConversations();
        }
      } catch (e) {
        console.error("sendMessage error:", e);
        // #region agent log
        fetch('http://127.0.0.1:7350/ingest/d67df62b-428b-4fab-8921-97d904601338',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'518e10'},body:JSON.stringify({sessionId:'518e10',location:'Index.tsx:sendMessage_catch',message:'sendMessage error',data:{error:e instanceof Error?e.message:String(e),name:e instanceof Error?e.name:undefined},timestamp:Date.now(),hypothesisId:'E'})}).catch(()=>{});
        // #endregion
        const isAbort = e instanceof Error && e.name === "AbortError";
        if (isAbort && abortRequestedRef.current) {
          // User aborted – keine Notification
        } else {
          const errMsg = isAbort
            ? "Die Verbindung hat zu lange gedauert (Timeout). Bitte erneut versuchen."
            : (e instanceof Error ? e.message : "Die Anfrage konnte nicht verarbeitet werden.");
          toast({ title: "Fehler", description: errMsg, variant: "destructive" });
        }
      } finally {
        abortControllerRef.current = null;
        setIsLoading(false);
      }
    },
    [messages, toast, activeConversationId, createConversation, saveMessage, updateSourceFilename, setActiveConversationId, userSettings, globalSettings, fetchConversations, effectiveModel]
  );

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar: fixed overlay, expands over content */}
      <ConversationSidebar
        onNew={handleNewConversation}
        onHistory={handleHistory}
        onSettings={handleSettings}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        collapsed={sidebarCollapsed}
        onCollapsedChange={setSidebarCollapsed}
      />

      <div
        className={cn(
          "flex-1 flex flex-col min-w-0 relative transition-[margin] duration-200 ease-in-out",
          sidebarCollapsed ? "md:ml-12" : "md:ml-40"
        )}
      >
        <header className="absolute top-0 right-0 left-0 z-50">
          <AppHeader
            onToggleSidebar={() => setSidebarOpen((v) => !v)}
            viewType={mainView}
            onBack={mainView !== "chat" ? () => setMainView("chat") : undefined}
          />
        </header>

        <div
          ref={scrollRef}
          className={cn(
            "flex-1 overflow-y-auto pt-14 min-h-0",
            mainView === "chat" ? "pb-44 sm:pb-40" : "pb-24"
          )}
        >
          {mainView === "chat" && (
            messages.length === 0 ? (
              <WelcomeScreen onSuggestionClick={(text) => sendMessage(text)} />
            ) : (
              <div className="max-w-6xl mx-auto px-4 pt-6 pb-16 space-y-4 min-h-[40vh]">
                <ErrorBoundary>
                  {messages.map((msg) => (
                    <ChatBubble
                      key={msg.id}
                      message={msg}
                      conversationId={activeConversationId}
                    />
                  ))}
                  {isLoading && pipelineStep && (
                    <PipelineProgress
                      step={pipelineStep.step}
                      totalSteps={pipelineStep.totalSteps}
                      label={pipelineStep.label}
                    />
                  )}
                  {isLoading && !pipelineStep && <TypingIndicator />}
                </ErrorBoundary>
              </div>
            )
          )}
          {mainView === "history" && (
            <HistoryView
              conversations={conversations}
              activeId={activeConversationId}
              onSelect={handleSelectConversation}
              onDelete={handleDeleteConversation}
              onRename={handleRenameConversation}
            />
          )}
          {mainView === "settings" && (
            <div className="pb-16">
              <SettingsContent onSettingsSaved={loadSettings} initialTab={settingsInitialTab} />
            </div>
          )}
        </div>

        {mainView === "chat" && (
          <div
            className={cn(
              "fixed bottom-0 left-0 right-0 z-50 pointer-events-none transition-[left] duration-200 ease-in-out",
              sidebarCollapsed ? "md:left-12" : "md:left-40"
            )}
          >
            <div className="max-w-3xl mx-auto w-full px-4 pb-10 pointer-events-auto">
              <ChatInput onSend={sendMessage} isLoading={isLoading} onStop={handleStop} />
              <div className="mt-1.5 flex items-center justify-between gap-3">
                <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground/80 shrink min-w-0 px-2.5 py-1 rounded-full bg-muted">
                  <AlertTriangle className="w-3 h-3 shrink-0 text-muted-foreground/80" />
                  Alle Ergebnisse müssen vor der Verwendung fachlich geprüft werden.
                </p>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        "shrink-0 inline-flex items-center gap-1.5 text-[10px] text-muted-foreground/90 hover:text-foreground transition-colors",
                        "px-2.5 py-1 rounded-full bg-muted hover:bg-muted/90 border border-transparent"
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
                        <DropdownMenuRadioItem key={m.value} value={m.value} className="flex items-center gap-2">
                          <span className="font-medium truncate min-w-0">{m.label}</span>
                          <span
                            className={cn(
                              "text-[9px] font-medium px-1.5 py-0.5 rounded shrink-0",
                              m.isFree && "text-emerald-600 dark:text-emerald-400",
                              !m.isFree && m.pricePerInvoice === "~0.05€" && "text-slate-600 dark:text-slate-400",
                              !m.isFree && m.pricePerInvoice === "~0.15€" && "text-amber-600 dark:text-amber-400",
                              !m.isFree && m.pricePerInvoice === "~0.40€" && "text-rose-600 dark:text-rose-400",
                              !m.isFree && !m.pricePerInvoice && "text-amber-600 dark:text-amber-400"
                            )}
                          >
                            {m.isFree ? "Free" : m.pricePerInvoice ?? "Pay"}
                          </span>
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
                setMainView("settings");
                setSidebarOpen(true);
              }}
            >
              Zu Einstellungen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Index;

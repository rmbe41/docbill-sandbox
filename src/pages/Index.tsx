import { useState, useRef, useEffect, useCallback } from "react";
import AppHeader from "@/components/AppHeader";
import ChatBubble, { type ChatMessage } from "@/components/ChatBubble";
import ChatInput from "@/components/ChatInput";
import TypingIndicator from "@/components/TypingIndicator";
import PipelineProgress from "@/components/PipelineProgress";
import WelcomeScreen from "@/components/WelcomeScreen";
import ConversationSidebar from "@/components/ConversationSidebar";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useConversations } from "@/hooks/useConversations";
import { supabase } from "@/integrations/supabase/client";
import { parsePositionsFromText, validatePositions } from "@/lib/goae-validator";
import type { InvoiceResultData } from "@/components/InvoiceResult";

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/goae-chat`;

const Index = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pipelineStep, setPipelineStep] = useState<{
    step: number;
    totalSteps: number;
    label: string;
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const { user } = useAuth();
  const [userSettings, setUserSettings] = useState<{ selected_model: string | null; custom_rules: string | null }>({ selected_model: null, custom_rules: null });
  const [globalSettings, setGlobalSettings] = useState<{ default_model: string; default_rules: string }>({ default_model: "openrouter/free", default_rules: "" });

  const {
    conversations,
    activeConversationId,
    setActiveConversationId,
    createConversation,
    loadMessages,
    saveMessage,
    deleteConversation,
    fetchConversations,
  } = useConversations();

  useEffect(() => {
    if (!user) return;
    const loadSettings = async () => {
      const { data: gData } = await supabase.from("global_settings").select("*").limit(1).single();
      if (gData) setGlobalSettings({ default_model: gData.default_model, default_rules: gData.default_rules });
      const { data: uData } = await supabase.from("user_settings").select("*").eq("user_id", user.id).maybeSingle();
      if (uData) setUserSettings({ selected_model: uData.selected_model, custom_rules: uData.custom_rules });
    };
    loadSettings();
  }, [user]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading, pipelineStep]);

  // Load messages when selecting a conversation
  const handleSelectConversation = useCallback(
    async (id: string) => {
      setActiveConversationId(id);
      setSidebarOpen(false);
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
        previewUrl: f.type.startsWith("image/") ? URL.createObjectURL(f) : undefined,
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

      let assistantContent = "";
      let invoiceData: InvoiceResultData | undefined;

      const upsertAssistant = (chunk: string) => {
        assistantContent += chunk;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant") {
            return prev.map((m, i) =>
              i === prev.length - 1
                ? { ...m, content: assistantContent, invoiceResult: invoiceData }
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

        const resp = await fetch(CHAT_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify({
            messages: apiMessages,
            files: filePayloads.length > 0 ? filePayloads : undefined,
            model: userSettings.selected_model || globalSettings.default_model,
            extra_rules: [globalSettings.default_rules, userSettings.custom_rules].filter(Boolean).join("\n\n"),
          }),
        });

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
          try {
            const errBody = await resp.json();
            if (errBody?.error) errMsg = errBody.error;
          } catch {
            errMsg = resp.status === 401 ? "Nicht autorisiert. Prüfen Sie die Supabase-Konfiguration." : errMsg;
          }
          toast({ title: "Fehler", description: errMsg, variant: "destructive" });
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

              // Pipeline progress events
              if (parsed.type === "pipeline_progress") {
                setPipelineStep({
                  step: parsed.step,
                  totalSteps: parsed.totalSteps,
                  label: parsed.label,
                });
                continue;
              }

              // Pipeline result (structured data → render InvoiceResult component)
              if (parsed.type === "pipeline_result") {
                setPipelineStep(null);
                invoiceData = parsed.data as InvoiceResultData;
                upsertAssistant("");
                continue;
              }

              // Pipeline error
              if (parsed.type === "pipeline_error") {
                setPipelineStep(null);
                upsertAssistant(`\n\n❌ **Pipeline-Fehler:** ${parsed.error}`);
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

        // Post-response validation: parse GOÄ positions and validate deterministically
        if (assistantContent) {
          const positions = parsePositionsFromText(assistantContent);
          if (positions.length > 0) {
            const validationResults = validatePositions(positions);
            if (validationResults.length > 0) {
              const warnings = validationResults
                .map((r) => `- ${r.severity === "error" ? "❌" : "⚠️"} ${r.message}`)
                .join("\n");
              const validationNote = `\n\n---\n\n## 🔍 Automatische Validierung\n\n${warnings}`;
              assistantContent += validationNote;
              setMessages((prev) => {
                const last = prev[prev.length - 1];
                if (last?.role === "assistant") {
                  return prev.map((m, i) =>
                    i === prev.length - 1 ? { ...m, content: assistantContent } : m
                  );
                }
                return prev;
              });
            }
          }
        }

        // Save assistant message to DB
        if (convId && assistantContent) {
          await saveMessage(convId, "assistant", assistantContent);
          await fetchConversations();
        }
      } catch (e) {
        console.error(e);
        toast({ title: "Fehler", description: "Die Anfrage konnte nicht verarbeitet werden.", variant: "destructive" });
      } finally {
        setIsLoading(false);
      }
    },
    [messages, toast, activeConversationId, createConversation, saveMessage, setActiveConversationId, userSettings, globalSettings, fetchConversations]
  );

  return (
    <div className="flex flex-col h-screen bg-background">
      <ConversationSidebar
        conversations={conversations}
        activeId={activeConversationId}
        onSelect={handleSelectConversation}
        onNew={handleNewConversation}
        onDelete={handleDeleteConversation}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <AppHeader onToggleHistory={() => setSidebarOpen((v) => !v)} />

      <div ref={scrollRef} className="flex-1 overflow-y-auto pb-44 sm:pb-40">
        {messages.length === 0 ? (
          <WelcomeScreen onSuggestionClick={(text) => sendMessage(text)} />
        ) : (
          <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
            {messages.map((msg) => (
              <ChatBubble key={msg.id} message={msg} />
            ))}
            {isLoading && pipelineStep && (
              <PipelineProgress
                step={pipelineStep.step}
                totalSteps={pipelineStep.totalSteps}
                label={pipelineStep.label}
              />
            )}
            {isLoading && !pipelineStep && <TypingIndicator />}
          </div>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-50 pointer-events-none">
        <div className="max-w-3xl mx-auto w-full px-4 pb-10 pointer-events-auto">
          <ChatInput onSend={sendMessage} isLoading={isLoading} />
        </div>
      </div>
    </div>
  );
};

export default Index;

import { useState, useRef, useEffect, useCallback } from "react";
import AppHeader from "@/components/AppHeader";
import ChatBubble, { type ChatMessage } from "@/components/ChatBubble";
import ChatInput from "@/components/ChatInput";
import TypingIndicator from "@/components/TypingIndicator";
import WelcomeScreen from "@/components/WelcomeScreen";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/goae-chat`;

const Index = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const { user } = useAuth();
  const [userSettings, setUserSettings] = useState<{ selected_model: string | null; custom_rules: string | null }>({ selected_model: null, custom_rules: null });
  const [globalSettings, setGlobalSettings] = useState<{ default_model: string; default_rules: string }>({ default_model: "google/gemini-2.5-flash", default_rules: "" });

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
  }, [messages, isLoading]);

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const sendMessage = useCallback(
    async (content: string, files?: File[]) => {
      // Build preview URLs for images
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

      // Convert files to base64 for the API
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

      // Build API messages
      const apiMessages = [...messages, userMsg].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      let assistantContent = "";

      const upsertAssistant = (chunk: string) => {
        assistantContent += chunk;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant") {
            return prev.map((m, i) =>
              i === prev.length - 1
                ? { ...m, content: assistantContent }
                : m
            );
          }
          return [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "assistant" as const,
              content: assistantContent,
            },
          ];
        });
      };

      try {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

        if (!supabaseUrl || !supabaseKey) {
          // Fallback demo response when no backend
          setTimeout(() => {
            upsertAssistant(
              "⚠️ **Backend nicht verbunden.** Bitte aktivieren Sie Lovable Cloud, damit der KI-Assistent funktioniert.\n\nIn der Zwischenzeit sehen Sie hier eine Demo-Antwort:\n\n" +
              "Für die beschriebenen Leistungen empfehle ich folgende GOÄ-Ziffern:\n\n" +
              "| Ziffer | Bezeichnung | Punkte |\n|--------|-------------|--------|\n" +
              "| 1 | Beratung | 80 |\n| 5 | Symptombezogene Untersuchung | 80 |\n\n" +
              "💡 **Tipp:** Verbinden Sie das Backend für echte KI-basierte Abrechnungsberatung."
            );
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
          toast({ title: "Rate Limit", description: "Zu viele Anfragen. Bitte warten Sie einen Moment.", variant: "destructive" });
          setIsLoading(false);
          return;
        }
        if (resp.status === 402) {
          toast({ title: "Credits erschöpft", description: "Bitte laden Sie Ihre Credits auf.", variant: "destructive" });
          setIsLoading(false);
          return;
        }
        if (!resp.ok || !resp.body) throw new Error("Stream failed");

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
              const c = parsed.choices?.[0]?.delta?.content as string | undefined;
              if (c) upsertAssistant(c);
            } catch {
              textBuffer = line + "\n" + textBuffer;
              break;
            }
          }
        }
      } catch (e) {
        console.error(e);
        toast({ title: "Fehler", description: "Die Anfrage konnte nicht verarbeitet werden.", variant: "destructive" });
      } finally {
        setIsLoading(false);
      }
    },
    [messages, toast]
  );

  return (
    <div className="flex flex-col h-screen bg-background">
      <AppHeader />

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <WelcomeScreen onSuggestionClick={(text) => sendMessage(text)} />
        ) : (
          <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
            {messages.map((msg) => (
              <ChatBubble key={msg.id} message={msg} />
            ))}
            {isLoading && <TypingIndicator />}
          </div>
        )}
      </div>

      <div className="max-w-5xl mx-auto w-full">
        <ChatInput onSend={sendMessage} isLoading={isLoading} />
      </div>
    </div>
  );
};

export default Index;

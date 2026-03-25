import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import {
  mergeStructuredContent,
  parseMessageStructured,
  type MessageStructuredContentV1,
} from "@/lib/messageStructuredContent";

export type Conversation = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  source_filename: string | null;
  archived_at: string | null;
  marked_unread: boolean;
};

export type DbMessage = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  structured_content?: Json | null;
};

export const useConversations = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchConversations = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("conversations")
      .select("*")
      .order("updated_at", { ascending: false });
    if (data) {
      setConversations(
        (data as Conversation[]).map((c) => ({
          ...c,
          archived_at: c.archived_at ?? null,
          marked_unread: c.marked_unread ?? false,
        })),
      );
    }
  }, [user]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  const createConversation = useCallback(
    async (title: string): Promise<string | null> => {
      if (!user) return null;
      const { data, error } = await supabase
        .from("conversations")
        .insert({ user_id: user.id, title })
        .select("id")
        .single();
      if (error || !data) return null;
      await fetchConversations();
      return data.id;
    },
    [user, fetchConversations]
  );

  const loadMessages = useCallback(
    async (conversationId: string): Promise<DbMessage[]> => {
      const { data } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });
      return (data as DbMessage[]) ?? [];
    },
    []
  );

  const saveMessage = useCallback(
    async (
      conversationId: string,
      role: "user" | "assistant",
      content: string,
      structured?: MessageStructuredContentV1 | null,
    ): Promise<string | null> => {
      const { data, error } = await supabase
        .from("messages")
        .insert({
          conversation_id: conversationId,
          role,
          content,
          ...(structured != null ? { structured_content: structured as unknown as Json } : {}),
        })
        .select("id")
        .single();
      if (error || !data) return null;
      return data.id;
    },
    [],
  );

  const updateMessageStructuredContent = useCallback(
    async (messageId: string, patch: Partial<MessageStructuredContentV1>): Promise<boolean> => {
      const { data: row, error: fetchErr } = await supabase
        .from("messages")
        .select("structured_content")
        .eq("id", messageId)
        .maybeSingle();
      if (fetchErr || !row) return false;
      const prev = parseMessageStructured(row.structured_content);
      const next = mergeStructuredContent(prev, patch);
      const { error } = await supabase
        .from("messages")
        .update({ structured_content: next as unknown as Json })
        .eq("id", messageId);
      return !error;
    },
    [],
  );

  const deleteConversation = useCallback(
    async (id: string) => {
      await supabase.from("conversations").delete().eq("id", id);
      if (activeConversationId === id) setActiveConversationId(null);
      await fetchConversations();
    },
    [activeConversationId, fetchConversations]
  );

  const updateTitle = useCallback(
    async (id: string, title: string) => {
      await supabase.from("conversations").update({ title }).eq("id", id);
      await fetchConversations();
    },
    [fetchConversations]
  );

  const updateSourceFilename = useCallback(
    async (id: string, filename: string) => {
      await supabase.from("conversations").update({ source_filename: filename }).eq("id", id);
      await fetchConversations();
    },
    [fetchConversations]
  );

  const archiveConversation = useCallback(
    async (id: string) => {
      if (!user) return;
      const { error } = await supabase
        .from("conversations")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", id)
        .eq("user_id", user.id);
      if (error) {
        toast({
          title: "Archivieren fehlgeschlagen",
          description: error.message,
          variant: "destructive",
        });
        return;
      }
      await fetchConversations();
    },
    [user, fetchConversations, toast]
  );

  const restoreConversation = useCallback(
    async (id: string) => {
      if (!user) return;
      const { error } = await supabase
        .from("conversations")
        .update({ archived_at: null })
        .eq("id", id)
        .eq("user_id", user.id);
      if (error) {
        toast({
          title: "Wiederherstellen fehlgeschlagen",
          description: error.message,
          variant: "destructive",
        });
        return;
      }
      await fetchConversations();
    },
    [user, fetchConversations, toast]
  );

  const markConversationUnread = useCallback(
    async (id: string) => {
      await supabase.from("conversations").update({ marked_unread: true }).eq("id", id);
      await fetchConversations();
    },
    [fetchConversations]
  );

  const markConversationRead = useCallback(
    async (id: string) => {
      await supabase.from("conversations").update({ marked_unread: false }).eq("id", id);
      await fetchConversations();
    },
    [fetchConversations]
  );

  return {
    conversations,
    activeConversationId,
    setActiveConversationId,
    createConversation,
    loadMessages,
    saveMessage,
    updateMessageStructuredContent,
    deleteConversation,
    updateTitle,
    updateSourceFilename,
    fetchConversations,
    archiveConversation,
    restoreConversation,
    markConversationUnread,
    markConversationRead,
  };
};

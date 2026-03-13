import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type Conversation = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

export type DbMessage = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export const useConversations = () => {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchConversations = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("conversations")
      .select("*")
      .order("updated_at", { ascending: false });
    if (data) setConversations(data);
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
    async (conversationId: string, role: "user" | "assistant", content: string): Promise<string | null> => {
      const { data, error } = await supabase
        .from("messages")
        .insert({ conversation_id: conversationId, role, content })
        .select("id")
        .single();
      if (error || !data) return null;
      return data.id;
    },
    []
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

  return {
    conversations,
    activeConversationId,
    setActiveConversationId,
    createConversation,
    loadMessages,
    saveMessage,
    deleteConversation,
    updateTitle,
    fetchConversations,
  };
};

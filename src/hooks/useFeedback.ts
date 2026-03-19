import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

const FEEDBACK_URL = import.meta.env.DEV
  ? `/api/supabase/functions/v1/feedback`
  : `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/feedback`;
const HISTORY_KEY = "docbill_feedback_history";
const HISTORY_LIMIT = 10;
const EXPERT_THRESHOLD = 10;

export type FeedbackRating = 1 | -1;
export type InquiryReason = "A" | "B" | "C";

export function useFeedback() {
  const sendFeedback = useCallback(
    async (payload: {
      message_id: string;
      conversation_id: string;
      response_content: string;
      rating: FeedbackRating;
      metadata?: { decisions?: Record<string, string>; inquiry_reason?: InquiryReason | null };
    }): Promise<boolean> => {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const res = await fetch(FEEDBACK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: token ? `Bearer ${token}` : `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          ...payload,
          timestamp: new Date().toISOString(),
        }),
      });

      if (!res.ok) {
        console.error("Feedback failed:", await res.text());
        return false;
      }

      // Update localStorage for saturation logic
      const history = getFeedbackHistory();
      history.push(payload.rating);
      if (history.length > HISTORY_LIMIT) history.shift();
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));

      return true;
    },
    []
  );

  const isExpertMode = useCallback((): boolean => {
    const history = getFeedbackHistory();
    if (history.length < EXPERT_THRESHOLD) return false;
    return history.every((r) => r === 1);
  }, []);

  return { sendFeedback, isExpertMode };
}

function getFeedbackHistory(): number[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.slice(-HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}

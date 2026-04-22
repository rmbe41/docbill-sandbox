import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface RlFeedbackContext {
  model?: string;
  engine?: string;
  user_messages?: { role: string; content: string }[];
  structured_snapshot?: unknown;
  truncated?: boolean;
}

interface FeedbackPayload {
  message_id: string;
  conversation_id: string;
  response_content: string;
  rating: 1 | -1;
  metadata?: {
    decisions?: Record<string, string>;
    inquiry_reason?: "A" | "B" | "C" | null;
    /** Spec 02 — Vorschlag-Feedback */
    vorschlag_id?: string;
    feedback_kind?: "thumb" | "vorschlag";
    aktion?: "accepted" | "rejected" | "modified";
    fachgebiet?: string;
    modified_to?: string;
  };
  timestamp?: string;
  rl_context?: RlFeedbackContext | null;
}

const MAX_RECORD_BYTES = 512_000;
/** Langer Chat-/Markdown-Text allein kann das JSON sonst > max sprengen. */
const MAX_RESPONSE_CONTENT_CHARS = 350_000;

function utf8ByteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    let authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      const apikey = req.headers.get("apikey");
      if (apikey) authHeader = `Bearer ${apikey}`;
    }
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Authorization required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = (await req.json()) as FeedbackPayload;
    let { message_id, conversation_id, response_content, rating, metadata, timestamp, rl_context } = body;

    if (!message_id || !conversation_id || typeof response_content !== "string" || (rating !== 1 && rating !== -1)) {
      return new Response(
        JSON.stringify({ error: "Invalid payload: message_id, conversation_id, response_content, rating (+1|-1) required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (response_content.length > MAX_RESPONSE_CONTENT_CHARS) {
      response_content =
        response_content.slice(0, MAX_RESPONSE_CONTENT_CHARS) + "\n…[truncated]";
    }

    const sbUrl = Deno.env.get("SUPABASE_URL");
    const sbKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!sbUrl || !sbKey) {
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let user_id: string | null = null;
    try {
      const token = authHeader.replace("Bearer ", "");
      const parts = token.split(".");
      if (parts.length === 3) {
        const payload = JSON.parse(atob(parts[1]));
        user_id = payload?.sub ?? null;
      }
    } catch {
      // Continue without user_id
    }

    let record: Record<string, unknown> = {
      message_id,
      conversation_id,
      user_id,
      response_content,
      rating,
      metadata: metadata ?? { decisions: {}, inquiry_reason: null },
      timestamp: timestamp ?? new Date().toISOString(),
      rl_context: rl_context ?? null,
    };

    let line = JSON.stringify(record) + "\n";
    if (utf8ByteLength(line) > MAX_RECORD_BYTES && record.rl_context) {
      const slim: RlFeedbackContext = {
        model: (record.rl_context as RlFeedbackContext).model,
        engine: (record.rl_context as RlFeedbackContext).engine,
        truncated: true,
      };
      record = { ...record, rl_context: slim };
      line = JSON.stringify(record) + "\n";
    }
    if (utf8ByteLength(line) > MAX_RECORD_BYTES) {
      record = { ...record, rl_context: null };
      line = JSON.stringify(record) + "\n";
    }
    if (utf8ByteLength(line) > MAX_RECORD_BYTES) {
      const rc = record.response_content as string;
      const cap = Math.max(8_000, Math.floor(rc.length * (MAX_RECORD_BYTES / utf8ByteLength(line)) - 10_000));
      record = {
        ...record,
        response_content:
          rc.length > cap ? rc.slice(0, cap) + "\n…[truncated-hard]" : rc,
        rl_context: null,
      };
      line = JSON.stringify(record) + "\n";
    }
    if (utf8ByteLength(line) > MAX_RECORD_BYTES) {
      return new Response(
        JSON.stringify({ error: "Payload too large", maxBytes: MAX_RECORD_BYTES }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const jsonlLine = line;
    const date = new Date().toISOString().slice(0, 10);
    const uuid = crypto.randomUUID();
    const path = `${date}/${uuid}.json`;

    const supabase = createClient(sbUrl, sbKey);
    const { error } = await supabase.storage
      .from("feedback")
      .upload(path, new Blob([jsonlLine]), {
        contentType: "application/json",
        upsert: false,
      });

    if (error) {
      console.error("Storage upload failed:", error);
      return new Response(
        JSON.stringify({ error: "Failed to store feedback", details: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ ok: true, path }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("Feedback error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface FeedbackPayload {
  message_id: string;
  conversation_id: string;
  response_content: string;
  rating: 1 | -1;
  metadata?: {
    decisions?: Record<string, string>;
    inquiry_reason?: "A" | "B" | "C" | null;
  };
  timestamp?: string;
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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Authorization required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = (await req.json()) as FeedbackPayload;
    const { message_id, conversation_id, response_content, rating, metadata, timestamp } = body;

    if (!message_id || !conversation_id || typeof response_content !== "string" || (rating !== 1 && rating !== -1)) {
      return new Response(
        JSON.stringify({ error: "Invalid payload: message_id, conversation_id, response_content, rating (+1|-1) required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
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

    const record = {
      message_id,
      conversation_id,
      user_id,
      response_content,
      rating,
      metadata: metadata ?? { decisions: {}, inquiry_reason: null },
      timestamp: timestamp ?? new Date().toISOString(),
    };

    const jsonlLine = JSON.stringify(record) + "\n";
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

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "jsr:@supabase/supabase-js@2/cors";

import { buildChatSelectiveCatalogMarkdown } from "./goae-catalog-json.ts";
import { GOAE_PARAGRAPHEN } from "./goae-paragraphen.ts";
import { GOAE_ANALOGE_BEWERTUNG, GOAE_BEGRUENDUNGEN, GOAE_ABSCHNITTE } from "./goae-regeln.ts";
import { runPipeline } from "./pipeline/orchestrator.ts";
import { runSimplePipeline } from "./pipeline/simple-orchestrator.ts";
import { runServiceBillingAsStream } from "./pipeline/service-billing-orchestrator.ts";
import { extrahiereOptimizeFor } from "./pipeline/input-parser.ts";
import { classifyByHeuristics, classifyIntent } from "./intent-classifier.ts";
import { buildFallbackModels, isRetryableModelStatus, resolveModel, isFreeModel, getReasoningConfigForStream } from "./model-resolver.ts";
import {
  loadRelevantAdminContext,
  buildPipelineQuery,
  buildFrageAdminRagQuery,
  type LastResultContext,
} from "./admin-context.ts";
import {
  FRAGE_JSON_OUTPUT_RULES,
  FRAGE_MARKDOWN_STREAM_RULES,
  frageAnswerToMarkdown,
  normalizeFrageAnswerParsed,
  type FrageAnswerStructured,
} from "./frage-answer-format.ts";

// ---------------------------------------------------------------------------
// System-Prompt: reiner Frage-/Erklär-Modus (ohne Dokument-Upload, kein Rechnungsvorschlag)
// ---------------------------------------------------------------------------

const FRAGE_MODUS_CORE = `
## Modus: GOÄ-Frage und Einordnung (kein Rechnungsvorschlag)

Der Nutzer stellt eine **informativ erklärende** Frage. Du lieferst **keine** Rechnung, keinen „Rechnungsvorschlag“ und keine tabellarische Positionsliste wie bei einer Honorarabrechnung.

### Inhaltliche Logik
- **Kurzantwort:** 1–3 Sätze mit der direkten Antwort.
- **Erläuterung:** Gründe, Konsequenzen, typische Fälle – sachlich und gut lesbar.
- **Quellen:** **Nur**, wenn du Inhalte aus dem **gelieferten Kontext** für **konkrete** Fakten nutzt – dann **jede** verwendete Fundstelle **explizit** und **konkret** (GOÄ § aus Kontext, GOÄ-Ziffer/Bezeichnung, DocBill-Regelwerk-Abschnitt, Admin-Dateiname). **Mehrere** Bezüge → **alle** nennen. Keine vagen Formulierungen wie nur „nach GOÄ“ ohne §/Ziffer/Datei. **Ohne** solche Bezüge: **keinen** Quellen-Abschnitt (bei JSON: \`quellen: []\`) – **nicht** erwähnen, dass keine Quelle genutzt wurde; **keine** erfundenen Paragraphen.
- **Grenzfälle:** Unsicherheiten, fehlender Kontext oder wann Fachrat nötig ist – im vorgesehenen Ausgabefeld (siehe Formatregeln unten).

### Sprache und Darstellung
- Auf **Deutsch**.
- Euro-Beträge mit 2 Dezimalstellen, sofern du Beträge aus dem Kontext nennst.
- **Keine** „Rechnungsvorschlag“-Tabelle oder tabellarisches Abrechnungslayout.
- **Tabellen** nur als Fließtext oder Aufzählung – kein Rechnungslayout.
- Wenn die Frage **explizit** den **Rechenweg für einen Betrag** betrifft: höchstens **eine** knappe Rechenzeile (Punkte × Punktwert × Faktor) mit Verweis auf **Katalogwerte aus dem Kontext** – ohne Wort „Rechnungsvorschlag“.
`;

function buildFrageSystemPrompt(
  messages: { role: string; content: unknown }[],
  outputMode: "json" | "markdown_stream",
): string {
  const goaeKatalogMarkdown = buildChatSelectiveCatalogMarkdown(messages, 100);
  const formatBlock = outputMode === "json" ? FRAGE_JSON_OUTPUT_RULES : FRAGE_MARKDOWN_STREAM_RULES;
  return `${FRAGE_MODUS_CORE}

${formatBlock}

Du bist GOÄ-DocBill. In diesem Modus **erklärst und ordnest du ein** – du erstellst **keine** Abrechnung oder Rechnungsoptimierung als Tabelle.

DEINE KERNKOMPETENZEN (Fragemodus):
- Verständliche Antworten zu GOÄ-Ziffern, Abschnitten, Ausschlüssen und Faktoren
- Einordnung von Regeln (Begründungen, Schwellenwerte) im Rahmen des gelieferten Kontexts
- Fokus auf Augenheilkunde, aber alle Fachgebiete nachvollziehbar erklären
- **Admin-Wissensdateien:** Steht im gelieferten Kontext ein Abschnitt **„ADMIN-KONTEXT“** mit Text aus hochgeladenen Dateien und beantwortet dieser Text die Nutzerfrage (auch **ohne** GOÄ-Bezug, z.B. allgemeine Fakten): dann antworte **auf Basis dieses Texts** und gib die **Quelle konkret** an (z. B. Admin-Dateiname laut Kontext). Eine ablehnende Antwort nur deshalb, weil das Thema „nicht GOÄ“ ist, ist **unzulässig**, solange die Fakten im mitgelieferten Admin-Text stehen.

WICHTIGE REGELN:
- Beziehe dich auf den im Kontext genannten GOÄ-Stand (z.B. Katalog 2026)
- Empfehle keine rechtswidrigen Abrechnungspraktiken
- Bei Unklarheiten: nach fehlendem klinischen Kontext fragen oder Grenzen der Antwort benennen
- Antworte IMMER auf Deutsch

⚠️ DATENSCHUTZ / DSGVO:
- Gib NIEMALS personenbezogene Daten in deiner Antwort wieder
- Referenziere Patienten nur als "Patient/in"

⚠️ PFLICHT: Du darfst NICHTS erfinden. Agiere ausschließlich im Rahmen deines Kontextwissens (GOÄ-Katalog, Paragraphen, Regeln, Admin-Kontext). Keine Ziffern oder Beträge, die nicht in deinem Kontext stehen.

QUELLEN DEINES WISSENS bei Fragen wie "Woher beziehst du dein Wissen?":
Dein GOÄ-Wissen stammt aus dem **lokalen DocBill-Kontext**, NICHT aus Wikipedia oder allgemeinem Training:
- **GOÄ-Katalog**: Ziffern, Bezeichnungen, Punktwerte
- **GOÄ-Paragraphen**: Rechtliche Grundlagen
- **GOÄ-Regeln**: Analoge Bewertung, Begründungen, Abschnitte
- **Globale Regeln**: Vom Administrator vorgegebene Guardrails
- **Persönliche Regeln**: Nutzerspezifische Zusatzregeln
- **Admin-Kontext-Dateien**: Vom Admin hochgeladene .txt/.md/.csv
Erwähne NICHT Wikipedia, allgemeines Internet oder generelles Modell-Training.

DEIN GOÄ-WISSEN:

${GOAE_PARAGRAPHEN}

${GOAE_ABSCHNITTE}

${goaeKatalogMarkdown}

${GOAE_ANALOGE_BEWERTUNG}

${GOAE_BEGRUENDUNGEN}`;
}

function buildFrageSystemContent(
  messages: { role: string; content: string }[],
  adminContext: string,
  extraRules: string | undefined,
  outputMode: "json" | "markdown_stream",
): string {
  const ambiguous: { role: string; content: unknown }[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  let systemContent = buildFrageSystemPrompt(ambiguous, outputMode) + adminContext;
  if (extraRules) {
    systemContent += `\n\n## ZUSÄTZLICHE REGELN (vom Administrator/Nutzer konfiguriert):\n${extraRules}`;
  }
  return systemContent;
}

function synthesizeFrageSseStream(structured: FrageAnswerStructured, markdown: string): ReadableStream {
  const encoder = new TextEncoder();
  const chunkSize = 120;
  return new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "frage_structured", data: structured })}\n\n`),
      );
      for (let i = 0; i < markdown.length; i += chunkSize) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              choices: [{ delta: { content: markdown.slice(i, i + chunkSize) } }],
            })}\n\n`,
          ),
        );
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

async function tryFrageStructuredCompletion(
  apiMessages: unknown[],
  modelTry: string,
  apiKey: string,
  reasoningConfig: ReturnType<typeof getReasoningConfigForStream>,
): Promise<FrageAnswerStructured | null> {
  const body: Record<string, unknown> = {
    model: modelTry,
    messages: apiMessages,
    stream: false,
    response_format: { type: "json_object" },
  };
  if (reasoningConfig) body.reasoning = reasoningConfig;

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) return null;

  const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string") return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content.trim()) as Record<string, unknown>;
  } catch {
    return null;
  }

  return normalizeFrageAnswerParsed(parsed);
}

// ---------------------------------------------------------------------------
// Admin-Kontext (RAG-basiert)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Chat-Modus (reguläre Fragen ohne Dokument-Upload)
// ---------------------------------------------------------------------------

// #region agent log
function debugCcb4cf(
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown>,
) {
  const payload = {
    sessionId: "631fa3",
    hypothesisId,
    location,
    message,
    data: { ...data, runId: (data as { runId?: string }).runId ?? "repro-1" },
    timestamp: Date.now(),
  };
  console.log(
    `[DOCBILL_INSTRUMENTATION] hypothesisId=${hypothesisId} location=${location} message=${message}`,
  );
  console.log("[DOCBILL_INSTRUMENTATION_JSON]", JSON.stringify(payload));
  console.error("DOCBILL_DEBUG_CCB4CF", JSON.stringify(payload));
  fetch("http://127.0.0.1:7350/ingest/dc9c2cfd-e812-42c5-8db7-14893d1ca961", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "631fa3" },
    body: JSON.stringify(payload),
  }).catch(() => {});
}
// #endregion

async function handleChatMode(
  messages: { role: string; content: string }[],
  model: string,
  extraRules: string | undefined,
  adminContext: string,
  apiKey: string,
): Promise<Response> {
  const systemJson = buildFrageSystemContent(messages, adminContext, extraRules, "json");
  const systemStream = buildFrageSystemContent(messages, adminContext, extraRules, "markdown_stream");

  // #region agent log
  debugCcb4cf("H3", "goae-chat/handleChatMode:systemBuilt", "system prompt composition", {
    systemLen: systemJson.length,
    frageBaseLen: systemJson.length - adminContext.length - (extraRules ? extraRules.length + 80 : 0),
    adminLen: adminContext.length,
    adminIdx: systemJson.indexOf("ADMIN-KONTEXT"),
    systemHasCatKnowledge: /cat\s*knowledge/i.test(systemJson),
    systemHasKatze: /\bkatze\b/i.test(systemJson.toLowerCase()),
  });
  // #endregion

  const userTail = messages.map((msg) => ({ role: msg.role, content: msg.content }));
  const apiMessagesJson: unknown[] = [{ role: "system", content: systemJson }, ...userTail];
  const apiMessagesStream: unknown[] = [{ role: "system", content: systemStream }, ...userTail];

  const modelsToTry = buildFallbackModels(model);
  const reasoningConfig = getReasoningConfigForStream(model);

  for (let i = 0; i < modelsToTry.length; i++) {
    const structured = await tryFrageStructuredCompletion(
      apiMessagesJson,
      modelsToTry[i],
      apiKey,
      reasoningConfig,
    );
    if (structured) {
      const md = frageAnswerToMarkdown(structured);
      return new Response(synthesizeFrageSseStream(structured, md), {
        headers: { "Content-Type": "text/event-stream" },
      });
    }
  }

  for (let i = 0; i < modelsToTry.length; i++) {
    const body: Record<string, unknown> = {
      model: modelsToTry[i],
      messages: apiMessagesStream,
      stream: true,
    };
    if (reasoningConfig) body.reasoning = reasoningConfig;
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );

    if (response.ok) {
      return new Response(response.body, {
        headers: { "Content-Type": "text/event-stream" },
      });
    }

    if (!isRetryableModelStatus(response.status) || i === modelsToTry.length - 1) {
      const errResp = await handleApiError(response);
      const errData = (await errResp.json()) as { error?: string };
      const isFree = isFreeModel(model);
      const isLastModel = i === modelsToTry.length - 1;
      const errBody: Record<string, unknown> = { error: errData.error ?? "AI-Gateway Fehler" };
      if (isFree && isLastModel) {
        errBody.code = "FREE_MODELS_EXHAUSTED";
        errBody.details = `Letztes versuchtes Modell: ${modelsToTry[i]}. HTTP-Status: ${response.status}.`;
      }
      return new Response(JSON.stringify(errBody), {
        status: errResp.status,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  const isFree = isFreeModel(model);
  return new Response(
    JSON.stringify({
      error: "AI-Gateway Fehler: Kein Modell verfügbar.",
      code: isFree ? "FREE_MODELS_EXHAUSTED" : undefined,
    }),
    { status: 500, headers: { "Content-Type": "application/json" } },
  );
}

// ---------------------------------------------------------------------------
// Fehlerbehandlung
// ---------------------------------------------------------------------------

async function handleApiError(response: Response): Promise<Response> {
  if (response.status === 429) {
    return new Response(
      JSON.stringify({ error: "Rate Limit erreicht. Bitte warten Sie einen Moment." }),
      { status: 429, headers: { "Content-Type": "application/json" } },
    );
  }
  if (response.status === 402) {
    return new Response(
      JSON.stringify({ error: "Credits erschöpft. Bitte laden Sie Credits auf." }),
      { status: 402, headers: { "Content-Type": "application/json" } },
    );
  }

  const t = await response.text();
  console.error("AI gateway error:", response.status, t);

  let errMsg = "AI-Gateway Fehler";
  try {
    const parsed = JSON.parse(t);
    const e = parsed?.error;
    if (typeof e === "object" && e?.message) errMsg = e.message;
    else if (typeof e === "string") errMsg = e;
    else if (parsed?.detail) errMsg = String(parsed.detail);
    else if (parsed?.message) errMsg = String(parsed.message);
  } catch {
    /* use fallback */
  }

  if (errMsg === "AI-Gateway Fehler") {
    const hints: Record<number, string> = {
      401: "OpenRouter API-Key ungültig. Prüfen Sie OPENROUTER_API_KEY in Supabase Secrets.",
      403: "Anfrage von Moderation blockiert.",
      408: "Zeitüberschreitung. Bitte erneut versuchen.",
      502: "Modell-Anbieter vorübergehend nicht erreichbar.",
      503: "Kein Modell-Anbieter verfügbar. Anderes Modell wählen.",
    };
    errMsg = hints[response.status] ?? `OpenRouter Fehler (${response.status}).`;
  }

  return new Response(
    JSON.stringify({ error: errMsg }),
    { status: 500, headers: { "Content-Type": "application/json" } },
  );
}

// ---------------------------------------------------------------------------
// Entry Point
// ---------------------------------------------------------------------------

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    // Suche in Dashboard: Edge Functions → goae-chat → Logs nach DOCBILL_INSTRUMENTATION oder hypothesisId=
    console.log(
      "[DOCBILL_INSTRUMENTATION] hypothesisId=H_req_start location=goae-chat/serve message=inbound_request",
    );
    console.error("DOCBILL_INSTRUMENTATION_84BF6E goae-chat request");
    const { messages, files, model, extra_rules, engine_type, last_invoice_result, last_service_result } = await req.json();

    const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
    const keyExists = typeof OPENROUTER_API_KEY === "string";
    const keyNonEmpty = keyExists && OPENROUTER_API_KEY.trim().length > 0;
    if (!keyNonEmpty) {
      console.error("[goae-chat] OPENROUTER_API_KEY:", keyExists ? "leer" : "nicht gesetzt");
      const hint = keyExists
        ? "OPENROUTER_API_KEY ist leer. Bitte Wert im Supabase Dashboard prüfen."
        : "OPENROUTER_API_KEY fehlt. Mit CLI setzen: supabase secrets set OPENROUTER_API_KEY=sk-or-v1-...";
      return new Response(
        JSON.stringify({ error: hint }),
        {
          status: 503,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const requestedModel = model || "openrouter/free";
    const resolvedModel = resolveModel(requestedModel);
    const hasFiles = files && files.length > 0;
    const userMessage = (messages?.[messages.length - 1]?.content as string) || "";

    const lastResult: LastResultContext | undefined =
      last_invoice_result || last_service_result
        ? { last_invoice_result: last_invoice_result, last_service_result: last_service_result }
        : undefined;

    const getAdminContext = async (result?: { medizinischeAnalyse?: unknown; pruefung?: unknown }) => {
      const fullQuery = buildPipelineQuery(userMessage, result, lastResult);
      const mergeQuery =
        result != null ? fullQuery : buildFrageAdminRagQuery(messages, userMessage, fullQuery);
      const vectorQuery = result != null ? fullQuery : (userMessage.trim() || mergeQuery);
      // #region agent log
      {
        const h5Payload = {
          sessionId: "631fa3",
          hypothesisId: "H5",
          location: "goae-chat/index.ts:getAdminContext",
          message: "ragQuery resolution",
          data: {
            isPipeline: result != null,
            userMessageLen: userMessage.length,
            userMessageHead: userMessage.slice(0, 160),
            mergeQueryHead: mergeQuery.slice(0, 240),
            vectorQueryHead: vectorQuery.slice(0, 240),
            vectorDiffersFromMerge: mergeQuery !== vectorQuery,
            fullQueryHead: fullQuery.slice(0, 240),
          },
          timestamp: Date.now(),
          runId: "post-fix",
        };
        console.log(
          "[DOCBILL_INSTRUMENTATION] hypothesisId=H5 location=goae-chat/index.ts:getAdminContext message=ragQuery_resolution",
        );
        console.log("[DOCBILL_INSTRUMENTATION_JSON]", JSON.stringify(h5Payload));
        fetch("http://127.0.0.1:7350/ingest/dc9c2cfd-e812-42c5-8db7-14893d1ca961", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "631fa3" },
          body: JSON.stringify(h5Payload),
        }).catch(() => {});
      }
      // #endregion
      // #region agent log
      {
        const recentUser = (messages ?? [])
          .filter((m) => m.role === "user")
          .map((m) => String((m as { content?: unknown }).content ?? ""))
          .slice(-5);
        const concat = recentUser.join("\n").toLowerCase();
        const hLastPayload = {
          sessionId: "631fa3",
          hypothesisId: "H_last_turn_only",
          location: "goae-chat/index.ts:getAdminContext:recentVsRag",
          message: "RAG query vs recent user turns (cat knowledge)",
          data: {
            onlyLastMsgAsMerge: mergeQuery === userMessage.trim(),
            recentUserTurns: recentUser.length,
            mergeLen: mergeQuery.length,
            vectorLen: vectorQuery.length,
            lastUserHead: userMessage.slice(0, 120),
            mergeQueryHead: mergeQuery.slice(0, 200),
            historyHasCatCue: /\bcat\b|katze|katzen|kater|cats\b/.test(concat),
            historyHasKnowledgeCue: /knowledge|\bwissensdatei\b|\bwissen\b|kenntnis/.test(concat),
            historyTail: concat.slice(-400),
          },
          timestamp: Date.now(),
          runId: "post-fix",
        };
        console.log(
          "[DOCBILL_INSTRUMENTATION] hypothesisId=H_last_turn_only location=goae-chat/index.ts:getAdminContext message=recentVsRag",
        );
        console.log("[DOCBILL_INSTRUMENTATION_JSON]", JSON.stringify(hLastPayload));
        fetch("http://127.0.0.1:7350/ingest/dc9c2cfd-e812-42c5-8db7-14893d1ca961", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "631fa3" },
          body: JSON.stringify(hLastPayload),
        }).catch(() => {});
      }
      // #endregion
      return loadRelevantAdminContext(
        mergeQuery,
        OPENROUTER_API_KEY,
        result != null ? undefined : { vectorQuery },
      );
    };

    // Intent-Klassifikation: Bei Dateien nur dann überspringen, wenn klar Rechnungsprüfung und keine Akte-/Abrechnungs-Vorschläge
    const msg = (userMessage || "").toLowerCase().trim();
    const serviceBillingCue =
      /\b(was kann|welche ziffer|welche goä|goä-ziffer|leistungsliste|patientenakte|\bakte\b|befundbericht|befunde?\b|arztbrief|ambulanzbrief|op-bericht|erbrachte leistungen|rechnungsvorschlag|aus dem dokument|aus der liste)\b/.test(
        msg,
      ) ||
      (/\b(abrechnen|vorschlagen|vorschlag)\b/.test(msg) &&
        !/\b(prüf|kontroll|stimmt|korrekt|rechnung|beleg|honoraraufstellung)\b/.test(msg));
    const longLeistungWithoutInvoiceWording =
      msg.length > 60 &&
      /abrechnen|was kann|leistung|durchgeführt|erbracht/.test(msg) &&
      !/prüfen|kontroll/.test(msg);
    const needsClassifier =
      !hasFiles ||
      msg.length <= 100 ||
      serviceBillingCue ||
      longLeistungWithoutInvoiceWording;

    let intentResult = needsClassifier
      ? await classifyIntent(
          { userMessage, hasFiles: !!hasFiles, recentMessages: messages },
          OPENROUTER_API_KEY,
          resolvedModel,
        )
      : { workflow: "rechnung_pruefen" as const, confidence: "hoch" as const };

    let intent = intentResult.workflow;
    if (!hasFiles && intent === "leistungen_abrechnen") {
      const h = classifyByHeuristics({
        userMessage,
        hasFiles: !!hasFiles,
        recentMessages: messages,
      });
      if (h === "frage") intent = "frage";
    }

    // #region agent log
    debugCcb4cf("H2", "goae-chat/index.ts:intentFinal", "routing intent", {
      intent,
      hasFiles: !!hasFiles,
      userHead: userMessage.slice(0, 160),
    });
    // #endregion

    // #region agent log
    {
      const _dbgPayload = {
        sessionId: "631fa3",
        hypothesisId: "H_route",
        location: "goae-chat/index.ts:intentRoute",
        message: "intent routing",
        data: {
          intent,
          hasFiles: !!hasFiles,
          engine_type: engine_type ?? "",
          serviceBillingLoadsAdminContext: intent === "leistungen_abrechnen",
        },
        timestamp: Date.now(),
        runId: "repro-1",
      };
      console.log(
        "[DOCBILL_INSTRUMENTATION] hypothesisId=H_route location=goae-chat/index.ts:intentRoute message=intent_routing",
      );
      console.log("[DOCBILL_INSTRUMENTATION_JSON]", JSON.stringify(_dbgPayload));
      console.error("DOCBILL_DEBUG_INTENT", JSON.stringify(_dbgPayload));
      fetch("http://127.0.0.1:7350/ingest/dc9c2cfd-e812-42c5-8db7-14893d1ca961", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "631fa3" },
        body: JSON.stringify(_dbgPayload),
      }).catch(() => {});
    }
    // #endregion

    let response: Response;

    if (intent === "leistungen_abrechnen") {
      // ═══════════════════════════════════════════════════════
      // SERVICE-BILLING: Leistungen aus Text/Dokument → GOÄ-Vorschläge
      // ═══════════════════════════════════════════════════════
      const ragQueryBilling = userMessage.trim() ||
        buildPipelineQuery(userMessage, undefined, lastResult);
      const adminContextBilling = await loadRelevantAdminContext(
        ragQueryBilling,
        OPENROUTER_API_KEY,
      );
      response = await runServiceBillingAsStream(
        {
          files: hasFiles ? files : undefined,
          userMessage,
          model: resolvedModel,
          extraRules: extra_rules,
          optimizeFor: extrahiereOptimizeFor(userMessage),
          adminContext: adminContextBilling,
        },
        OPENROUTER_API_KEY,
      );
    } else if (hasFiles) {
      const useSimpleEngine = engine_type === "simple";
      if (useSimpleEngine) {
        // ═══════════════════════════════════════════════════════
        // EINFACHE ENGINE: 2 Schritte (Parser → kombinierter LLM-Call)
        // ═══════════════════════════════════════════════════════
        response = await runSimplePipeline(
          {
            files,
            userMessage,
            conversationHistory: messages,
            model: resolvedModel,
            extraRules: extra_rules,
          },
          () => getAdminContext(),
        );
      } else {
        // ═══════════════════════════════════════════════════════
        // KOMPLEXE 6-SCHRITT-ENGINE: Strukturierte Rechnungsprüfung
        //
        //   Rechnung → Parser → NLP → Extraktion →
        //   Mapping → Regelengine → Textgenerierung
        // ═══════════════════════════════════════════════════════
        response = await runPipeline(
          {
            files,
            userMessage,
            conversationHistory: messages,
            model: resolvedModel,
            extraRules: extra_rules,
          },
          getAdminContext,
        );
      }
    } else {
      // ═══════════════════════════════════════════════════════
      // CHAT-MODUS: Reguläre GOÄ-Fragen
      // ═══════════════════════════════════════════════════════
      const ragForLog = buildFrageAdminRagQuery(
        messages,
        userMessage,
        buildPipelineQuery(userMessage, undefined, lastResult),
      );
      const adminContext = await getAdminContext();
      // #region agent log
      debugCcb4cf("H1", "goae-chat/index.ts:chatBranch", "admin RAG payload (Fragemodus)", {
        ragForLog: ragForLog.slice(0, 220),
        adminLen: adminContext.length,
        adminHasAdminHeader: adminContext.includes("ADMIN-KONTEXT"),
        adminHasCatKnowledge: /cat\s*knowledge/i.test(adminContext),
        adminHasKatze: /\bkatze\b/i.test(adminContext.toLowerCase()),
      });
      // #endregion
      response = await handleChatMode(
        messages,
        resolvedModel,
        extra_rules,
        adminContext,
        OPENROUTER_API_KEY,
      );
    }

    // Add CORS headers to the response
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(corsHeaders)) {
      headers.set(key, value);
    }

    return new Response(response.body, {
      status: response.status,
      headers,
    });
  } catch (e) {
    console.error("goae-chat error:", e);
    return new Response(
      JSON.stringify({
        error: e instanceof Error ? e.message : "Unbekannter Fehler",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});

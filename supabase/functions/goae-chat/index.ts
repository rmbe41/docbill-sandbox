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
import { loadRelevantAdminContext, buildPipelineQuery, type LastResultContext } from "./admin-context.ts";

// ---------------------------------------------------------------------------
// System-Prompt: reiner Frage-/Erklär-Modus (ohne Dokument-Upload, kein Rechnungsvorschlag)
// ---------------------------------------------------------------------------

const FRAGE_MODUS_RULES = `
## Modus: GOÄ-Frage und Einordnung (kein Rechnungsvorschlag)

Der Nutzer stellt eine **informativ erklärende** Frage. Du lieferst **keine** Rechnung, keinen „Rechnungsvorschlag“ und keine tabellarische Positionsliste wie bei einer Honorarabrechnung.

### STRUKTUR (immer in dieser Reihenfolge, mit Überschriften)

### Kurzantwort
1–3 Sätze mit der direkten Antwort.

### Erläuterung
Gründe, Konsequenzen, typische Fälle – sachlich und gut lesbar.

### Quelle
Mindestens eine **konkrete** Quellenangabe aus dem DocBill-Kontext, z.B.:
- „GOÄ § …“ (Paragraphen aus dem Kontext)
- „GOÄ-Anhang / Abschnitt …“ (wenn im Kontext genannt)
- „DocBill: Regelwerk [analoge Bewertung / Begründungen / Abschnitte]“
- Wenn Admin-Kontext (RAG) maßgeblich war: „Admin-Kontext [Dateiname/Kurzbezeichnung]“
Keine erfundenen Paragraphen; nur was im gelieferten Kontext steht.

### Grenzfälle und Hinweise (optional)
Nur wenn sinnvoll: Unsicherheiten, wann fachlicher Rat nötig ist, oder Verweis auf fehlenden Kontext.

### Format
- **Keine** Überschrift „Rechnungsvorschlag“, „Optimierungspotenzial“ im Sinne einer Abrechnungstabelle.
- **Tabellen nur optional**, z.B. zum Vergleich zweier Ziffern – nicht als Rechnungslayout.
- **Ausnahme** – wenn die Nutzerfrage **ausdrücklich** nach dem **Rechenweg für einen Betrag** fragt (z.B. „Wie hoch ist der Betrag für GOÄ X bei Faktor Y?“): Dann höchstens **eine** knappe Zeile oder ein Mini-Rechenbeispiel (Punkte × Punktwert × Faktor) mit klarem Hinweis auf die **Katalogwerte aus dem Kontext** – ohne Formulierung „Rechnungsvorschlag“.

### Sprache
Antworte immer auf Deutsch. Euro-Beträge mit 2 Dezimalstellen, sofern du Beträge aus dem Kontext nennst.
`;

function buildFrageSystemPrompt(
  messages: { role: string; content: unknown }[],
): string {
  const goaeKatalogMarkdown = buildChatSelectiveCatalogMarkdown(messages, 100);
  return `${FRAGE_MODUS_RULES}

Du bist GOÄ-DocBill. In diesem Modus **erklärst und ordnest du ein** – du erstellst **keine** Abrechnung oder Rechnungsoptimierung als Tabelle.

DEINE KERNKOMPETENZEN (Fragemodus):
- Verständliche Antworten zu GOÄ-Ziffern, Abschnitten, Ausschlüssen und Faktoren
- Einordnung von Regeln (Begründungen, Schwellenwerte) im Rahmen des gelieferten Kontexts
- Fokus auf Augenheilkunde, aber alle Fachgebiete nachvollziehbar erklären

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

// ---------------------------------------------------------------------------
// Admin-Kontext (RAG-basiert)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Chat-Modus (reguläre Fragen ohne Dokument-Upload)
// ---------------------------------------------------------------------------

async function handleChatMode(
  messages: { role: string; content: string }[],
  model: string,
  extraRules: string | undefined,
  adminContext: string,
  apiKey: string,
): Promise<Response> {
  let systemContent = buildFrageSystemPrompt(messages) + adminContext;
  if (extraRules) {
    systemContent += `\n\n## ZUSÄTZLICHE REGELN (vom Administrator/Nutzer konfiguriert):\n${extraRules}`;
  }

  const apiMessages: unknown[] = [{ role: "system", content: systemContent }];
  for (const msg of messages) {
    apiMessages.push({ role: msg.role, content: msg.content });
  }

  const modelsToTry = buildFallbackModels(model);
  const reasoningConfig = getReasoningConfigForStream(model);
  for (let i = 0; i < modelsToTry.length; i++) {
    const body: Record<string, unknown> = {
      model: modelsToTry[i],
      messages: apiMessages,
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
      const body: Record<string, unknown> = { error: errData.error ?? "AI-Gateway Fehler" };
      if (isFree && isLastModel) {
        body.code = "FREE_MODELS_EXHAUSTED";
        body.details = `Letztes versuchtes Modell: ${modelsToTry[i]}. HTTP-Status: ${response.status}.`;
      }
      return new Response(JSON.stringify(body), {
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
    // Suche in Dashboard: Edge Functions → goae-chat → Logs nach diesem String (beweist deployter Stand).
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
      const ragQuery = result != null ? fullQuery : (userMessage.trim() || fullQuery);
      return loadRelevantAdminContext(ragQuery, OPENROUTER_API_KEY);
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
    {
      const _dbgPayload = {
        sessionId: "c81fbe",
        hypothesisId: "H1",
        location: "goae-chat/index.ts:intentRoute",
        message: "intent routing (service-billing lädt Admin-Kontext seit Fix)",
        data: {
          intent,
          hasFiles: !!hasFiles,
          engine_type: engine_type ?? "",
          serviceBillingLoadsAdminContext: intent === "leistungen_abrechnen",
        },
        timestamp: Date.now(),
      };
      console.error("DOCBILL_DEBUG_INTENT", JSON.stringify(_dbgPayload));
      fetch("http://127.0.0.1:7350/ingest/d67df62b-428b-4fab-8921-97d904601338", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "c81fbe" },
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
      const adminContext = await getAdminContext();
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

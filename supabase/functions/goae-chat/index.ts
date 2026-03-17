import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

import { GOAE_KATALOG } from "./goae-catalog.ts";
import { GOAE_PARAGRAPHEN } from "./goae-paragraphen.ts";
import { GOAE_ANALOGE_BEWERTUNG, GOAE_BEGRUENDUNGEN, GOAE_ABSCHNITTE } from "./goae-regeln.ts";
import { runPipeline } from "./pipeline/orchestrator.ts";
import { runServiceBillingAsStream } from "./pipeline/service-billing-orchestrator.ts";
import { classifyIntent } from "./intent-classifier.ts";
import { buildFallbackModels, isRetryableModelStatus, resolveModel, isFreeModel } from "./model-resolver.ts";
import { loadRelevantAdminContext, buildPipelineQuery, type LastResultContext } from "./admin-context.ts";

// ---------------------------------------------------------------------------
// System-Prompt für den regulären Chat-Modus (ohne Dokument-Upload)
// ---------------------------------------------------------------------------

const FORMATTING_RULES = `
## ⚠️ PFLICHT-FORMATIERUNGSREGELN (IMMER BEFOLGEN!)

### STRUKTUR-PRINZIP: TABELLE MIT KURZEN ANMERKUNGEN

Deine Antwort nutzt **echte Markdown-Tabellen**, damit sie im Frontend als Tabelle dargestellt werden.

1. **EINE Haupttabelle** mit allen Positionen — als echte Markdown-Tabelle
2. **Optimierungsblock** (falls zutreffend) — ebenfalls als Tabelle
3. **Zusammenfassung** — 2–3 Bullet Points

### ❌ VERBOTEN — ANMERKUNGEN MÜSSEN KURZ BLEIBEN

**NIEMALS** lange, ausufernde Anmerkungen in der Tabelle:
- Keine mehrzeiligen Erklärungen wie „Ausschlussriskiko: Bei Bil‑Dienst‑Leistungen … → Vorschlag: …“
- Keine verschachtelten Sätze, keine Wiederholung von GOÄ-Regeln pro Zeile
- **Anmerkung pro Zeile: max. 1 Satz** — sonst bricht die Tabellendarstellung

### PFLICHT-TABELLENFORMAT:

## 📋 Rechnungsvorschlag

| Nr. | GOÄ | Bezeichnung | Faktor | Betrag | Prüfung | Anmerkung |
|-----|-----|-------------|--------|--------|---------|-----------|
| 1 | 1240 | Spaltlampe | 2,3× | 9,92€ | ✅ | In Ordnung |
| 2 | 1242 | Funduskopie | 2,3× | 6,47€ | ⚠️ | Ausschluss mit 1240. **Vorschlag:** 1242 streichen. |
| 3 | 5 | Beratung | 3,0× | 30,60€ | ⚠️ | Begründung nötig. **Vorschlag:** „Eingehende Beratung von ca. 20 Min. aufgrund [Diagnose]. Faktor 3,0× gemäß § 5 Abs. 2 GOÄ gerechtfertigt.“ |

**Legende:** ✅ = in Ordnung, ⚠️ = Korrekturbedarf, ❌ = fehlerhaft, 💡 = Optimierungstipp

---

## 💡 Optimierungspotenzial

| GOÄ | Beschreibung | Potenzial |
|-----|-------------|-----------|
| **1202** 2,3× | Refraktionsbestimmung – empfohlen bei [Kontext] | +9,92€ |

---

## 📝 Zusammenfassung

- **X** von **Y** Positionen in Ordnung
- **Z** Korrekturen empfohlen
- Optimierungspotenzial: **+XX,XX €**

### HARTE REGELN:
- **Tabelle verwenden** — Markdown-Syntax mit \`|\` korrekt, jede Zeile eine Tabellenzeile
- **Anmerkung: max. 1 Satz** — kurzer Vorschlag, kein Fließtext
- **Fettdruck**: Ziffern, Beträge **fett**
- **Trennlinien**: \`---\` zwischen den Blöcken
- **KONKRETE VORSCHLÄGE**: Jede ⚠️/❌ Zeile braucht einen **Vorschlag:** in 1 Satz

### BEGRÜNDUNGEN FÜR HÖHERE FAKTOREN (Faktor > Schwellenwert):
- **Fachlich top Qualität**: Keine Leerformeln wie „erhöhter Zeitaufwand" ohne Konkretes. Verwende ziffer-spezifische Formulierungen (z.B. „Erhöhter diagnostischer Aufwand durch [konkrete Ursache]" bei Spaltlampe/Fundus).
- **UI-Passform**: Begründung in max. 1 Satz (~140 Zeichen), damit sie in Tabellen und Vorschlags-Boxen sauber dargestellt wird.
- **Zeitangabe bei Beratung**: Bei GOÄ 1–4 immer Dauer nennen (z.B. „Beratung von ca. 20 Min.").
`;

const SYSTEM_PROMPT = `${FORMATTING_RULES}

Du bist GOÄ-DocBill, ein KI-Experte für die Analyse und Optimierung von Arztrechnungen nach der Gebührenordnung für Ärzte (GOÄ).

DEINE KERNKOMPETENZEN:
- OCR-Analyse von hochgeladenen Rechnungen, Abrechnungsbelegen und Behandlungsdokumenten
- Exakte GOÄ-Ziffernempfehlung mit Punktwerten und Euro-Beträgen
- Prüfung von Ausschlussziffern und Abrechnungskompatibilität
- Berechnung von Steigerungssätzen (1×, 2,3×/1,8×, 3,5×/2,5×)
- Optimierung der Abrechnung unter Beachtung aller Regeln
- Fokus auf Augenheilkunde, aber alle Fachgebiete abdeckbar

WICHTIGE REGELN:
- Beziehe dich auf den aktuellen GOÄ-Katalog (Stand 2026)
- Weise darauf hin, wenn eine Begründung für Steigerung über den Schwellenwert nötig ist
- Bei Unklarheiten frage nach dem klinischen Kontext
- Empfehle keine rechtswidrigen Abrechnungspraktiken
- Sei bei der Optimierung IMMER regelkonform
- Antworte IMMER auf Deutsch
- Verwende Euro-Beträge mit 2 Dezimalstellen

⚠️ DATENSCHUTZ / DSGVO:
- Gib NIEMALS personenbezogene Daten in deiner Antwort wieder
- Referenziere Patienten nur als "Patient/in"
- Konzentriere dich ausschließlich auf die medizinischen Leistungen und Abrechnungsziffern

⚠️ PFLICHT: Du darfst NICHTS erfinden. Agiere ausschließlich im Rahmen deines Kontextwissens (GOÄ-Katalog, Paragraphen, Regeln). Keine Ziffern oder Beträge, die nicht in deinem Kontext stehen.

QUELLEN DEINES WISSENS bei Fragen wie "Woher beziehst du dein Wissen?":
Antworte stets, dass dein GOÄ-Wissen aus dem **lokalen DocBill-Kontext** stammt, NICHT aus Wikipedia oder allgemeinem Training:
- **GOÄ-Katalog**: Ziffern, Bezeichnungen, Punktwerte
- **GOÄ-Paragraphen**: Rechtliche Grundlagen
- **GOÄ-Regeln**: Analoge Bewertung, Begründungen, Abschnitte
- **Globale Regeln**: Vom Administrator vorgegebene Guardrails
- **Persönliche Regeln**: Nutzerspezifische Zusatzregeln
- **Admin-Kontext-Dateien**: Vom Admin hochgeladene .txt/.md/.csv
Erwähne NICHT Wikipedia, allgemeines Internet oder generelles Modell-Training.

ERINNERUNG: Befolge IMMER die Formatierungsregeln am Anfang dieser Anweisung!

DEIN GOÄ-WISSEN:

${GOAE_PARAGRAPHEN}

${GOAE_ABSCHNITTE}

${GOAE_KATALOG}

${GOAE_ANALOGE_BEWERTUNG}

${GOAE_BEGRUENDUNGEN}`;

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
  let systemContent = SYSTEM_PROMPT + adminContext;
  if (extraRules) {
    systemContent += `\n\n## ZUSÄTZLICHE REGELN (vom Administrator/Nutzer konfiguriert):\n${extraRules}`;
  }

  const apiMessages: unknown[] = [{ role: "system", content: systemContent }];
  for (const msg of messages) {
    apiMessages.push({ role: msg.role, content: msg.content });
  }

  const modelsToTry = buildFallbackModels(model);
  for (let i = 0; i < modelsToTry.length; i++) {
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: modelsToTry[i],
          messages: apiMessages,
          stream: true,
        }),
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
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, files, model, extra_rules, last_invoice_result, last_service_result } = await req.json();

    const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
    if (!OPENROUTER_API_KEY) {
      return new Response(
        JSON.stringify({
          error:
            "OPENROUTER_API_KEY fehlt. Supabase Dashboard → Project Settings → Edge Functions → Secrets → OPENROUTER_API_KEY hinzufügen.",
        }),
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

    const getAdminContext = async (result?: { medizinischeAnalyse?: unknown; pruefung?: unknown }) =>
      loadRelevantAdminContext(
        buildPipelineQuery(userMessage, result, lastResult),
        OPENROUTER_API_KEY,
      );

    const { workflow: intent } = await classifyIntent(
      {
        userMessage,
        hasFiles: !!hasFiles,
        recentMessages: messages,
      },
      OPENROUTER_API_KEY,
      resolvedModel,
    );

    let response: Response;

    if (intent === "leistungen_abrechnen") {
      // ═══════════════════════════════════════════════════════
      // SERVICE-BILLING: Leistungen aus Text/Dokument → GOÄ-Vorschläge
      // ═══════════════════════════════════════════════════════
      response = await runServiceBillingAsStream(
        {
          files: hasFiles ? files : undefined,
          userMessage,
          model: resolvedModel,
          extraRules: extra_rules,
        },
        OPENROUTER_API_KEY,
      );
    } else if (hasFiles) {
      // ═══════════════════════════════════════════════════════
      // PIPELINE-MODUS: Strukturierte Rechnungsprüfung
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

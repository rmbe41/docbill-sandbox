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
import { buildFallbackModels, isRetryableModelStatus, resolveModel, isFreeModel } from "./model-resolver.ts";

// ---------------------------------------------------------------------------
// System-Prompt für den regulären Chat-Modus (ohne Dokument-Upload)
// ---------------------------------------------------------------------------

const FORMATTING_RULES = `
## ⚠️ PFLICHT-FORMATIERUNGSREGELN (IMMER BEFOLGEN!)

### STRUKTUR-PRINZIP: EINE TABELLE MIT INLINE-KORREKTUREN

Deine Antwort folgt IMMER dieser einfachen Struktur:

1. **EINE Haupttabelle** mit ALLEN Positionen der Rechnung — Korrekturen und Hinweise stehen DIREKT in der gleichen Zeile
2. Danach ein kurzer **Optimierungsblock** (falls zutreffend)
3. Am Ende eine **Zusammenfassung** in 2-3 Bullet Points

### HARTE REGELN:
- **Trennlinien**: Verwende \`---\` zwischen den 3 Blöcken
- **Bullet Points**: Jede Aufzählung ab 2 Punkten als Liste
- **Fettdruck**: Wichtige Begriffe, Ziffern und Beträge IMMER **fett**
- **NIEMALS** mehr als 3 Sätze ohne visuellen Umbruch
- **KEINE getrennten Sektionen** für "korrekt" und "fehlerhaft" — alles in EINER Tabelle
- **KONKRETE VORSCHLÄGE PFLICHT**: Jede ⚠️ oder ❌ Anmerkung MUSS einen konkreten, kopierbaren Lösungsvorschlag enthalten — nicht nur das Problem beschreiben!

### PFLICHT-TABELLENFORMAT:

## 📋 Rechnungsanalyse

| Nr. | GOÄ | Bezeichnung | Faktor | Betrag | Status | Anmerkung |
|-----|-----|-------------|--------|--------|--------|-----------|
| 1 | 1240 | Spaltlampe | 2,3× | 9,92€ | ✅ | Korrekt |
| 2 | 1242 | Funduskopie | 2,3× | 6,47€ | ⚠️ | Ausschluss mit 1240 → **Vorschlag:** GOÄ 1242 entfernen, da Nebeneinanderabrechnung mit 1240 nicht zulässig. Alternativ: Nur 1240 abrechnen. |
| 3 | 5 | Beratung | 3,0× | 30,60€ | ⚠️ | Über Schwellenwert → **Vorschlag:** „Aufgrund der überdurchschnittlichen Komplexität bei [Diagnose] und erhöhtem Zeitaufwand von ca. XX Min. ist ein Faktor von 3,0× gerechtfertigt." |

**Legende:** ✅ = korrekt, ⚠️ = Korrekturbedarf, ❌ = fehlerhaft, 💡 = Optimierungstipp

---

## 💡 Optimierungspotenzial

| GOÄ | Beschreibung | Potenzial |
|-----|-------------|-----------|
| **1202** 2,3× | Refraktionsbestimmung – empfohlen bei [klinischer Kontext] | +9,92€ |

---

## 📝 Zusammenfassung

- **X** von **Y** Positionen korrekt
- **Z** Korrekturen empfohlen
- Optimierungspotenzial: **+XX,XX €**

FORMATIERUNG IST PFLICHT — halte dich IMMER an diese Struktur!

### KONKRETE VORSCHLÄGE — DETAILREGELN:

Bei JEDER ⚠️ oder ❌ Markierung MUSST du einen **konkreten, kopierbaren Vorschlag** in der Anmerkung-Spalte liefern. Format: \`[Problem] → **Vorschlag:** „[konkreter Text]"\`

**1. Steigerungsfaktor über Schwellenwert (Begründung nötig):**
Liefere eine fertige Begründungsformulierung mit Platzhaltern:
→ **Vorschlag:** „Aufgrund [der überdurchschnittlichen Komplexität / des erhöhten Zeitaufwands / der besonderen Schwierigkeit] bei [Diagnose/Behandlung einfügen] und einem Zeitaufwand von ca. [XX] Min. ist ein Steigerungsfaktor von [X,X]× gemäß §5 Abs. 2 GOÄ gerechtfertigt."

**2. Zu pauschale/generische Begründung:**
Schreibe die Begründung konkret um:
→ **Vorschlag:** Statt „erhöhter Aufwand" besser: „Erhöhter diagnostischer Aufwand durch [z.B. ausgeprägte Linsentrübung mit erschwerter Funduskopie, multiple Pathologien der Netzhaut]."

**3. Ausschlussziffern-Konflikt:**
Sage konkret, welche Ziffer entfernt oder behalten werden soll und warum:
→ **Vorschlag:** „GOÄ [XXXX] entfernen, da Nebeneinanderabrechnung mit GOÄ [YYYY] laut Ausschlusskatalog nicht zulässig. Empfehlung: [YYYY] beibehalten (höherer Betrag: XX,XX€)."

**4. Fehlende/empfohlene Ziffern:**
Nenne die exakte Ziffer mit Faktor und erwartetem Betrag:
→ **Vorschlag:** „GOÄ [XXXX] ([Bezeichnung]) mit Faktor [X,X]× ergänzen = [XX,XX]€. Begründung: [klinischer Kontext]."

**5. Falscher Betrag/Faktor:**
Nenne den korrekten Wert:
→ **Vorschlag:** „Korrekter Betrag bei Faktor [X,X]×: [XX,XX]€ (statt [YY,YY]€). Differenz: [±Z,ZZ]€."
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
// Admin-Kontext laden
// ---------------------------------------------------------------------------

async function loadAdminContext(): Promise<string> {
  try {
    const sbUrl = Deno.env.get("SUPABASE_URL");
    const sbKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!sbUrl || !sbKey) return "";

    const ctxResp = await fetch(
      `${sbUrl}/rest/v1/admin_context_files?select=filename,content_text&order=created_at.asc`,
      { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } },
    );

    if (!ctxResp.ok) return "";

    const ctxFiles = await ctxResp.json();
    if (!ctxFiles?.length) return "";

    return (
      "\n\n## ADMIN-KONTEXT-DATEIEN:\n" +
      ctxFiles
        .map((f: { filename: string; content_text: string }) => `### ${f.filename}\n${f.content_text}`)
        .join("\n\n")
    );
  } catch {
    return "";
  }
}

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
      return handleApiError(response);
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
    const { messages, files, model, extra_rules } = await req.json();

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

    const adminContext = await loadAdminContext();
    const requestedModel = model || "openrouter/free";
    const resolvedModel = resolveModel(requestedModel);
    const hasFiles = files && files.length > 0;

    let response: Response;

    if (hasFiles) {
      // ═══════════════════════════════════════════════════════
      // PIPELINE-MODUS: Strukturierte Rechnungsprüfung
      //
      //   Rechnung → Parser → NLP → Extraktion →
      //   Mapping → Regelengine → Textgenerierung
      // ═══════════════════════════════════════════════════════
      response = await runPipeline(
        {
          files,
          userMessage: messages?.[messages.length - 1]?.content,
          conversationHistory: messages,
          model: resolvedModel,
          extraRules: extra_rules,
        },
        adminContext,
      );
    } else {
      // ═══════════════════════════════════════════════════════
      // CHAT-MODUS: Reguläre GOÄ-Fragen
      // ═══════════════════════════════════════════════════════
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

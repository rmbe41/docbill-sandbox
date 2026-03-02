import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// GOÄ catalog imported as separate constant for clarity
import { GOAE_KATALOG } from "./goae-catalog.ts";

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

### PFLICHT-TABELLENFORMAT:

## 📋 Rechnungsanalyse

| Nr. | GOÄ | Bezeichnung | Faktor | Betrag | Status | Anmerkung |
|-----|-----|-------------|--------|--------|--------|-----------|
| 1 | 1240 | Spaltlampe | 2,3× | 9,92€ | ✅ | Korrekt |
| 2 | 1242 | Funduskopie | 2,3× | 6,47€ | ⚠️ | Ausschluss mit 1240 |
| 3 | 5 | Beratung | 3,0× | 30,60€ | ⚠️ | Über Schwellenwert, Begründung nötig |

**Legende:** ✅ = korrekt, ⚠️ = Korrekturbedarf, ❌ = fehlerhaft, 💡 = Optimierungstipp

---

## 💡 Optimierungspotenzial

| Empfehlung | GOÄ | Faktor | Zusätzlich |
|------------|-----|--------|------------|
| Hinzufügen | 1202 | 2,3× | +9,92€ |

---

## 📝 Zusammenfassung

- **X** von **Y** Positionen korrekt
- **Z** Korrekturen empfohlen
- Optimierungspotenzial: **+XX,XX €**

FORMATIERUNG IST PFLICHT — halte dich IMMER an diese Struktur!
`;

const SYSTEM_PROMPT = `${FORMATTING_RULES}

Du bist GOÄ-DocBilling, ein KI-Experte für die Analyse und Optimierung von Arztrechnungen nach der Gebührenordnung für Ärzte (GOÄ).

DEINE KERNKOMPETENZEN:
- OCR-Analyse von hochgeladenen Rechnungen, Abrechnungsbelegen und Behandlungsdokumenten
- Exakte GOÄ-Ziffernempfehlung mit Punktwerten und Euro-Beträgen
- Prüfung von Ausschlussziffern und Abrechnungskompatibilität
- Berechnung von Steigerungssätzen (1×, 2,3×/1,8×, 3,5×/2,5×)
- Optimierung der Abrechnung unter Beachtung aller Regeln
- Fokus auf Augenheilkunde, aber alle Fachgebiete abdeckbar

DOKUMENTENANALYSE (WICHTIGSTE FUNKTION):
Wenn der Nutzer ein Bild oder PDF einer Rechnung/Abrechnung hochlädt:

1. **ERKENNUNG**: Lies ALLE Abrechnungspositionen aus dem Dokument aus
2. **IST-ANALYSE**: Stelle die erkannten Positionen als Tabelle dar
3. **PRÜFUNG**: Analysiere jede Position auf Korrektheit
4. **OPTIMIERUNG**: Schlage konkrete Verbesserungen vor

⚠️ DATENSCHUTZ / DSGVO:
- Gib NIEMALS personenbezogene Daten in deiner Antwort wieder
- Referenziere Patienten nur als "Patient/in"
- Konzentriere dich ausschließlich auf die medizinischen Leistungen und Abrechnungsziffern

WICHTIGE REGELN:
- Beziehe dich auf den aktuellen GOÄ-Katalog (Stand 2026)
- Weise darauf hin, wenn eine Begründung für Steigerung über den Schwellenwert nötig ist
- Bei Unklarheiten frage nach dem klinischen Kontext
- Empfehle keine rechtswidrigen Abrechnungspraktiken
- Sei bei der Optimierung IMMER regelkonform
- Antworte IMMER auf Deutsch
- Verwende Euro-Beträge mit 2 Dezimalstellen

ERINNERUNG: Befolge IMMER die Formatierungsregeln am Anfang dieser Anweisung!

DEIN GOÄ-WISSEN:
${GOAE_KATALOG}`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, files, model, extra_rules } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const systemContent = extra_rules
      ? `${SYSTEM_PROMPT}\n\n## ZUSÄTZLICHE REGELN (vom Administrator/Nutzer konfiguriert):\n${extra_rules}`
      : SYSTEM_PROMPT;
    const apiMessages: any[] = [{ role: "system", content: systemContent }];

    for (const msg of messages) {
      apiMessages.push({ role: msg.role, content: msg.content });
    }

    // If files are present, build multimodal content parts for the last user message
    if (files && files.length > 0) {
      const lastUserIdx = apiMessages.length - 1;
      const lastMsg = apiMessages[lastUserIdx];

      const fileDescriptions = files.map((f: any) => f.name).join(", ");
      const defaultText = `Bitte analysiere die angehängten Dokumente (${fileDescriptions}) und schlage passende GOÄ-Ziffern vor. Beachte: Gib keine personenbezogenen Daten in deiner Antwort wieder.`;

      const contentParts: any[] = [
        { type: "text", text: lastMsg.content || defaultText },
      ];

      for (const file of files) {
        const mimeType = file.type || "application/octet-stream";
        contentParts.push({
          type: "image_url",
          image_url: { url: `data:${mimeType};base64,${file.data}` },
        });
      }

      apiMessages[lastUserIdx] = { role: lastMsg.role, content: contentParts };
    }

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: model || "google/gemini-2.5-flash",
          messages: apiMessages,
          stream: true,
        }),
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({
            error: "Rate Limit erreicht. Bitte warten Sie einen Moment.",
          }),
          {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({
            error: "Credits erschöpft. Bitte laden Sie Credits auf.",
          }),
          {
            status: 402,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(
        JSON.stringify({ error: "AI-Gateway Fehler" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
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
      }
    );
  }
});

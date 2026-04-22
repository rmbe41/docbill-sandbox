const CHAT_URL = import.meta.env.DEV
  ? `/api/supabase/functions/v1/goae-chat`
  : `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/goae-chat`;

export type SteigerungBegruendungRegeneratePayload = {
  id: string;
  ziffer: string;
  bezeichnung: string;
  faktor: number;
  schwellenfaktor: number;
  hoechstfaktor: number;
  leistung: string;
  quelle_beschreibung?: string;
  klinischer_kontext: string;
  fachgebiet: string;
  previous_text?: string;
};

export async function fetchSteigerungBegruendungRegenerate(params: {
  supabaseKey: string;
  model: string;
  kontext_wissen?: boolean;
  /** Gleiche ID wie Haupt-Chat (Konversation), damit Pseudonym-Map konsistent bleibt. */
  pseudonym_session_id?: string;
  payload: SteigerungBegruendungRegeneratePayload;
  signal?: AbortSignal;
}): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  try {
    const resp = await fetch(CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.supabaseKey}`,
      },
      body: JSON.stringify({
        steigerung_begruendung_regenerate: params.payload,
        model: params.model,
        ...(params.kontext_wissen === false ? { kontext_wissen: false } : {}),
        ...(params.pseudonym_session_id?.trim()
          ? { pseudonym_session_id: params.pseudonym_session_id.trim() }
          : {}),
      }),
      signal: params.signal,
    });
    const raw = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const err = typeof raw?.error === "string" ? raw.error : "Anfrage fehlgeschlagen.";
      return { ok: false, error: err };
    }
    const text = typeof raw?.begruendung === "string" ? raw.begruendung.trim() : "";
    if (!text) return { ok: false, error: "Leere Antwort." };
    return { ok: true, text };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Netzwerkfehler.";
    return { ok: false, error: msg };
  }
}

/**
 * PostHog Client (Spec §2.3) — initialisiert nur bei gesetztem Key.
 */
import posthog from "posthog-js";

const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const host = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? "https://eu.posthog.com";

let initialized = false;

export function initPostHog(): void {
  if (initialized || !key) return;
  posthog.init(key, {
    api_host: host,
    persistence: "localStorage",
  });
  initialized = true;
}

export function captureHealthPageView(): void {
  if (!key) return;
  posthog.capture("health_page_view");
}

/**
 * Spec 07 §12: KPIs Antwortzeit (P95) – Ereignis pro abgeschlossenem goae-chat-Durchlauf.
 * `modus_label`: A/B/C laut Anfrage; `latenz_sekunde`: nützlich für P95-Buckets in PostHog.
 */
export function captureGoaeChatComplete(props: {
  modus?: "A" | "B" | "C";
  /** Ohne A/B/C z. B. "C" (Fragemodus) vs "AB" (Rechnung/Leistung). */
  modusKlasse: "C" | "AB" | "unbekannt";
  durationMs: number;
  engineType: string;
}): void {
  if (!key) return;
  initPostHog();
  const latenzSekunde = Math.round((props.durationMs / 1000) * 1000) / 1000;
  posthog.capture("docbill_goae_chat_complete", {
    modus: props.modus ?? null,
    modus_klasse: props.modusKlasse,
    latenz_ms: props.durationMs,
    latenz_sekunde: latenzSekunde,
    engine_type: props.engineType,
  });
}

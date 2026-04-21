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

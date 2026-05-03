/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_POSTHOG_KEY?: string;
  readonly VITE_POSTHOG_HOST?: string;
  readonly VITE_SENTRY_DSN?: string;
  /** Optional: Google Maps Platform API key (Places) for sandbox address suggestions */
  readonly VITE_GOOGLE_MAPS_API_KEY?: string;
}

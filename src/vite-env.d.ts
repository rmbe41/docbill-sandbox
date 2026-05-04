/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Full-screen gate; omitted or empty disables the overlay */
  readonly VITE_APP_ACCESS_PASSWORD?: string;
  /** Optional silent Supabase sign-in after the gate */
  readonly VITE_AUTO_LOGIN_EMAIL?: string;
  readonly VITE_AUTO_LOGIN_PASSWORD?: string;
  readonly VITE_POSTHOG_KEY?: string;
  readonly VITE_POSTHOG_HOST?: string;
  readonly VITE_SENTRY_DSN?: string;
  /** Optional: Google Maps Platform API key (Places) for sandbox address suggestions */
  readonly VITE_GOOGLE_MAPS_API_KEY?: string;
}

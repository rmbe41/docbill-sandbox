/**
 * Zentrale Nutzer-Strings (Spec §2.4 Regel 6) — schrittweise erweitern.
 */
export const de = {
  status: {
    title: "Systemstatus",
    loading: "Lade Status …",
    error: "Status konnte nicht geladen werden.",
    healthy: "Alle geprüften Komponenten verfügbar.",
    degraded: "Eingeschränkte Verfügbarkeit — Details siehe JSON.",
    unhealthy: "Kritische Komponenten ausgefallen.",
  },
} as const;

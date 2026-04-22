import type { KennzeichnungStufe } from "./types";

/** Spec 02 §4.5 — Pill-Farben (Tailwind-kompatibel als Klassenname-Fragment). */
export const KENNZEICHNUNG_PILL: Record<
  KennzeichnungStufe,
  { label: string; hex: string; className: string }
> = {
  SICHER: {
    label: "Sicher",
    hex: "#22C55E",
    className: "bg-[#22C55E] text-white",
  },
  OPTIMIERUNG: {
    label: "Optimierung",
    hex: "#3B82F6",
    className: "bg-[#3B82F6] text-white",
  },
  PRÜFEN: {
    label: "Prüfen",
    hex: "#EAB308",
    className: "bg-[#EAB308] text-gray-900",
  },
  RISIKO: {
    label: "Risiko",
    hex: "#F97316",
    className: "bg-[#F97316] text-white",
  },
  FEHLER: {
    label: "Fehler",
    hex: "#EF4444",
    className: "bg-[#EF4444] text-white",
  },
  UNVOLLSTÄNDIG: {
    label: "Unvollständig",
    hex: "#8B5CF6",
    className: "bg-[#8B5CF6] text-white",
  },
};

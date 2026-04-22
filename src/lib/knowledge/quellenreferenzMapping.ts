/**
 * Paket F (Spec 7.5 vs. Analyse-Contract): Eine Laufzeit-Wahrheit, eine Spez-Projektion.
 *
 * - **Laufzeit (SSE, UI)**: `Quellenreferenz` in `analyse/types.ts` und im Edge-`analyse-envelope`
 *   (`GOAE_KATALOG` | `EBM_KATALOG` | `ADMIN` | `TEXT`) — kompakt, pipeline-nah.
 * - **Spec 05 (Wissens-/Governance-Modell)**: `Quellenreferenz` in `spec05Types.ts` mit feinerem
 *   `QuellenreferenzTyp` (goae_paragraph, ebm_gop, …) — für Beschluss-/Kommentar-Kontext.
 *
 * Nutzen Sie `toSpec05Quellen(...)` für Exporte, Doku und alles, was 7.5 benötigt; die Analyse
 * bleibt auf den Katalog-Typen.
 */
import type { Quellenreferenz as SpecQuelle } from "@/lib/knowledge/spec05Types";
import type { Quellenreferenz as AnalyseQuelle } from "@/lib/analyse/types";

export function toSpec05Quelle(q: AnalyseQuelle, fallbackKurztext = ""): SpecQuelle {
  const ref = q.ref?.trim() || "";
  switch (q.typ) {
    case "GOAE_KATALOG":
      return {
        typ: "goae_ziffer",
        referenz: ref,
        kurztext: ref ? `GOÄ Ziffer ${ref}` : fallbackKurztext,
      };
    case "EBM_KATALOG":
      return {
        typ: "ebm_gop",
        referenz: ref,
        kurztext: ref ? `EBM GOP ${ref}` : fallbackKurztext,
      };
    case "ADMIN":
      return {
        typ: "kommentar",
        referenz: ref || "admin",
        kurztext: fallbackKurztext || "Admin-/Hintergrundkontext",
      };
    case "TEXT":
    default:
      return {
        typ: "baek_beschluss",
        referenz: ref || "text",
        kurztext: fallbackKurztext || "Freitext-Referenz",
      };
  }
}

export function spec05ToAnalyseLabel(q: SpecQuelle): string {
  return `${q.typ}: ${q.referenz}`.trim();
}

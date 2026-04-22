/** Spec 13.1 – organisations.settings (jsonb, Teilmengen-Defaults in parse*). */
export type DatenschutzModus = "standard" | "streng";

export type OrganisationSettingsPayload = {
  defaultRegelwerk?: "GOAE" | "EBM";
  defaultFachgebiet?: string | null;
  customWissensbasis?: boolean;
  /** `null` oder fehlend: kein technisches Limit */
  batchLimit?: number | null;
  datenschutzModus?: DatenschutzModus;
};

const DEFAULTS: Required<
  Pick<OrganisationSettingsPayload, "defaultRegelwerk" | "customWissensbasis" | "datenschutzModus">
> = {
  defaultRegelwerk: "GOAE",
  customWissensbasis: true,
  datenschutzModus: "standard",
};

export function parseOrganisationSettings(raw: unknown): OrganisationSettingsPayload {
  if (raw == null || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const out: OrganisationSettingsPayload = {};
  if (o.defaultRegelwerk === "GOAE" || o.defaultRegelwerk === "EBM") {
    out.defaultRegelwerk = o.defaultRegelwerk;
  }
  if (o.defaultFachgebiet === null) {
    out.defaultFachgebiet = null;
  } else if (typeof o.defaultFachgebiet === "string") {
    const t = o.defaultFachgebiet.trim();
    out.defaultFachgebiet = t === "" ? null : t;
  }
  if (o.customWissensbasis === true || o.customWissensbasis === false) {
    out.customWissensbasis = o.customWissensbasis;
  }
  if (o.batchLimit === null) {
    out.batchLimit = null;
  } else if (typeof o.batchLimit === "number" && Number.isFinite(o.batchLimit) && o.batchLimit >= 0) {
    out.batchLimit = Math.floor(o.batchLimit);
  }
  if (o.datenschutzModus === "standard" || o.datenschutzModus === "streng") {
    out.datenschutzModus = o.datenschutzModus;
  }
  return out;
}

export function orgSettingsEffective(
  s: OrganisationSettingsPayload,
): Required<
  Pick<OrganisationSettingsPayload, "defaultRegelwerk" | "customWissensbasis" | "datenschutzModus">
> & { batchLimit: number | null; defaultFachgebiet: string | null } {
  return {
    defaultRegelwerk: s.defaultRegelwerk ?? DEFAULTS.defaultRegelwerk,
    defaultFachgebiet: s.defaultFachgebiet ?? null,
    customWissensbasis: s.customWissensbasis ?? DEFAULTS.customWissensbasis,
    batchLimit: s.batchLimit === undefined ? null : s.batchLimit,
    datenschutzModus: s.datenschutzModus ?? DEFAULTS.datenschutzModus,
  };
}

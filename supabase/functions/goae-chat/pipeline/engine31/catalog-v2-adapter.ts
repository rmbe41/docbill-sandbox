import goaeCatalogV2Json from "../../goae-catalog-v2.json";
import type {
  GoaeV2AnalogMapping,
  GoaeV2Code,
  GoaeV2Rule,
  GoaeV2SearchIndexEntry,
  ValidationDeps,
} from "./types.ts";

type GoaeCatalogV2Data = {
  codes: GoaeV2Code[];
  rules: GoaeV2Rule[];
  analogMappings: GoaeV2AnalogMapping[];
  searchIndex: GoaeV2SearchIndexEntry[];
};

const POINT_VALUE = 0.0582873;

function normalizeCode(code: string): string {
  return String(code ?? "").trim().toUpperCase();
}

const data = goaeCatalogV2Json as GoaeCatalogV2Data;

export const goaeV2CodeById = new Map<string, GoaeV2Code>(
  data.codes.map((code) => [normalizeCode(code.code), code]),
);

export const goaeV2Rules = data.rules ?? [];
export const goaeV2AnalogMappings = data.analogMappings ?? [];
export const goaeV2SearchIndex = data.searchIndex ?? [];

export const engine31DefaultDeps: ValidationDeps = {
  pointValue: POINT_VALUE,
  codeById: goaeV2CodeById,
  rules: goaeV2Rules,
  analogMappings: goaeV2AnalogMappings,
  searchIndex: goaeV2SearchIndex,
};


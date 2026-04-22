/**
 * Re-export aus Shared-Code — eine Implementierung für Vitest (src) und Edge (goae-chat).
 */
export {
  pseudonymizeTextStage1,
  reidentifyText,
  reidentifyMedizinischeAnalyse,
  collectStage1RegexMatches,
  mergeNonOverlappingMatches,
  mergeAndApplyPseudonymMatches,
  nextPerTypeCountersFromMap,
  substituteExistingMappingsInText,
  maskDocbillPlaceholdersForNer,
  initialPerTypeCounters,
  type PseudonymRawMatch,
} from "../../../../src/lib/architecture/pseudonymize-stage1.ts";

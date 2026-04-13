import { engine31DefaultDeps } from "./catalog-v2-adapter.ts";
import type {
  BillingDraft,
  DraftPosition,
  FactorSuggestion,
  ValidationDeps,
  ValidationFinding,
  ValidationResult,
} from "./types.ts";

const MIN_TIME_BY_CODE: Record<string, number> = {
  "20": 10,
  "21": 10,
  "30": 60,
  "31": 30,
  "34": 20,
};

function normalizeCode(code: string): string {
  return String(code ?? "").trim().toUpperCase();
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function toLowerText(s: string | undefined): string {
  return String(s ?? "").toLowerCase();
}

function makeFindingId(prefix: string, seq: number): string {
  return `${prefix}-${seq.toString().padStart(4, "0")}`;
}

function buildSeveritySummary(findings: ValidationFinding[]) {
  return {
    errors: findings.filter((f) => f.severity === "error").length,
    warnings: findings.filter((f) => f.severity === "warning").length,
    infos: findings.filter((f) => f.severity === "info").length,
  };
}

function computeComplianceScore(findings: ValidationFinding[]): number {
  const summary = buildSeveritySummary(findings);
  const score = 100 - summary.errors * 18 - summary.warnings * 7 - summary.infos * 2;
  return Math.max(0, Math.min(100, score));
}

function shouldFlagAsZielleistung(notes: string, reasoning: string, categories: string[]): boolean {
  const n = toLowerText(notes);
  const r = toLowerText(reasoning);
  const c = categories.map((x) => x.toLowerCase());
  const strongCategory =
    c.includes("zielleistungsprinzip") || c.includes("nicht_selbststaendig");
  const strongReason =
    r.includes("bestanteil") ||
    r.includes("bestandteil") ||
    r.includes("nicht gesondert berechnungsfähig") ||
    r.includes("keine eigenständig") ||
    r.includes("abgegolten") ||
    r.includes("maßnahmen zur blutstillung");
  const noteHint =
    n.includes("teilschritt") ||
    n.includes("blutstillung") ||
    n.includes("bestanteil") ||
    n.includes("bestandteil");
  return strongCategory || (strongReason && noteHint);
}

export class ValidationEngine31 {
  constructor(private readonly deps: ValidationDeps = engine31DefaultDeps) {}

  validateDraft(draft: BillingDraft): ValidationResult {
    const findings: ValidationFinding[] = [];
    const factorSuggestions: FactorSuggestion[] = [];
    let seq = 1;

    const positions = draft.positions.map((p) => ({
      ...p,
      code: normalizeCode(p.code),
      count: p.count ?? 1,
    }));

    // 1) Zielleistungs-Check (PKV/Analog-Wissen)
    for (const pos of positions) {
      const noteText = pos.notes ?? "";
      const candidates = this.deps.analogMappings.filter((a) => normalizeCode(a.originCode) === pos.code);
      const hit = candidates.find((a) =>
        shouldFlagAsZielleistung(noteText, a.pkvReasoning, a.pkvReasonCategory),
      );
      if (!hit) continue;
      findings.push({
        findingId: makeFindingId("zielleistung", seq++),
        severity: "error",
        category: "zielleistung",
        positionIds: [pos.id],
        codeRefs: [pos.code],
        message: `GOÄ ${pos.code} wirkt als Teilschritt/Nebenleistung der Hauptleistung und ist hier nicht gesondert berechnungsfähig.`,
        legalRefs: ["GOÄ §4 Abs.2a", "GOÄ §6 Abs.2"],
        sourceRefs: hit.sourceRef?.length ? hit.sourceRef : [{ documentId: "pkv_kommentierung_2025" }],
        suggestedAction: {
          action: "remove",
          payload: { reason: hit.pkvReasoning.slice(0, 260) },
        },
      });
    }

    // 2) Ausschluss-Check
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const a = positions[i];
        const b = positions[j];
        const codeA = this.deps.codeById.get(a.code);
        const codeB = this.deps.codeById.get(b.code);
        const conflict =
          codeA?.billingExclusions.some((ex) => normalizeCode(ex.targetCode ?? "") === b.code) ||
          codeB?.billingExclusions.some((ex) => normalizeCode(ex.targetCode ?? "") === a.code);
        if (!conflict) continue;
        findings.push({
          findingId: makeFindingId("ausschluss", seq++),
          severity: "error",
          category: "ausschluss",
          positionIds: [a.id, b.id],
          codeRefs: [a.code, b.code],
          message: `GOÄ ${a.code} und GOÄ ${b.code} sind laut GOÄ-Regelwerk nicht nebeneinander berechnungsfähig.`,
          legalRefs: ["Ausschlussziffern GOÄ-Katalog"],
          sourceRefs: [{ documentId: "goae_catalog_pdf_2015" }],
          suggestedAction: {
            action: "manual_review",
            payload: { keepOneOf: [a.code, b.code] },
          },
        });
      }
    }

    // 3) Zeit-Check
    let totalDuration = 0;
    for (const pos of positions) {
      const count = pos.count ?? 1;
      const duration = (pos.durationMin ?? 0) * count;
      totalDuration += duration;
      const minTime = MIN_TIME_BY_CODE[pos.code];
      if (minTime && duration > 0 && duration < minTime * count) {
        findings.push({
          findingId: makeFindingId("zeit", seq++),
          severity: "error",
          category: "zeit",
          positionIds: [pos.id],
          codeRefs: [pos.code],
          message: `Für GOÄ ${pos.code} ist die dokumentierte Zeit zu kurz (${duration} Min, Mindestzeit ${minTime * count} Min).`,
          legalRefs: ["Leistungslegende GOÄ-Ziffer"],
          sourceRefs: [{ documentId: "goae_catalog_pdf_2015" }],
        });
      }
    }
    const maxPlausibleTotal =
      draft.context.setting === "stationaer" ? 16 * 60 : draft.context.setting === "op" ? 14 * 60 : 12 * 60;
    if (totalDuration > maxPlausibleTotal) {
      findings.push({
        findingId: makeFindingId("zeit", seq++),
        severity: "warning",
        category: "zeit",
        positionIds: unique(positions.map((p) => p.id)),
        codeRefs: unique(positions.map((p) => p.code)),
        message: `Die aufsummierte dokumentierte Zeit (${totalDuration} Min) wirkt für einen Abrechnungsfall unplausibel hoch.`,
        legalRefs: [],
        sourceRefs: [{ documentId: "goae_catalog_pdf_2015" }],
      });
    }

    // 4) Steigerungssatz-Check + Berater
    for (const pos of positions) {
      const codeData = this.deps.codeById.get(pos.code);
      if (!codeData) continue;
      const threshold = codeData.fee.thresholdFactor;
      const max = codeData.fee.maxFactor;
      if (pos.factor > max) {
        findings.push({
          findingId: makeFindingId("faktor", seq++),
          severity: "error",
          category: "faktor",
          positionIds: [pos.id],
          codeRefs: [pos.code],
          message: `Faktor ${pos.factor.toFixed(2)} liegt über dem Höchstfaktor ${max.toFixed(2)} für GOÄ ${pos.code}.`,
          legalRefs: ["GOÄ §5"],
          sourceRefs: [{ documentId: "goae_catalog_pdf_2015" }],
          suggestedAction: {
            action: "adjust_factor",
            payload: { maxFactor: max },
          },
        });
        continue;
      }
      if (pos.factor > threshold) {
        findings.push({
          findingId: makeFindingId("faktor", seq++),
          severity: "warning",
          category: "faktor",
          positionIds: [pos.id],
          codeRefs: [pos.code],
          message: `Faktor ${pos.factor.toFixed(2)} liegt über dem Schwellenfaktor ${threshold.toFixed(2)} für GOÄ ${pos.code}; Begründung erforderlich.`,
          legalRefs: ["GOÄ §5"],
          sourceRefs: [{ documentId: "goae_catalog_pdf_2015" }],
          suggestedAction: {
            action: "add_justification",
          },
        });

        const snippets = this.buildFactorSuggestionSnippets(pos, codeData.title);
        factorSuggestions.push({
          positionId: pos.id,
          code: pos.code,
          factor: pos.factor,
          snippets,
          confidence: snippets.length >= 2 ? 0.82 : 0.64,
          sourceRefs: [{ documentId: "pkv_kommentierung_2025" }, { documentId: "goae_catalog_pdf_2015" }],
        });
      }
    }

    // 5) Rechencheck
    for (const pos of positions) {
      if (typeof pos.amountClaimed !== "number" || !Number.isFinite(pos.amountClaimed)) continue;
      const codeData = this.deps.codeById.get(pos.code);
      if (!codeData) continue;
      const expected = round2(codeData.fee.points * this.deps.pointValue * pos.factor * (pos.count ?? 1));
      const delta = Math.abs(expected - pos.amountClaimed);
      if (delta > 0.03) {
        findings.push({
          findingId: makeFindingId("betrag", seq++),
          severity: "warning",
          category: "rechenfehler",
          positionIds: [pos.id],
          codeRefs: [pos.code],
          message: `Betrag weicht von GOÄ-Rechnung ab (angegeben ${pos.amountClaimed.toFixed(2)} EUR, erwartet ${expected.toFixed(2)} EUR).`,
          legalRefs: [],
          sourceRefs: [{ documentId: "goae_catalog_pdf_2015" }],
          suggestedAction: {
            action: "replace",
            payload: { expectedAmount: expected },
          },
        });
      }
    }

    const summary = buildSeveritySummary(findings);
    const complianceScore = computeComplianceScore(findings);
    const invalidIds = new Set(
      findings
        .filter((f) => f.severity === "error" && f.suggestedAction?.action === "remove")
        .flatMap((f) => f.positionIds),
    );
    const correctedDraft: BillingDraft = {
      ...draft,
      positions: draft.positions.filter((p) => !invalidIds.has(p.id)),
    };
    return {
      valid: summary.errors === 0,
      complianceScore,
      findings,
      factorSuggestions,
      correctedDraft,
      summary,
    };
  }

  private buildFactorSuggestionSnippets(pos: DraftPosition, title: string): string[] {
    const snippetsFromSearch = this.deps.searchIndex
      .filter((entry) => entry.entityType === "analogMapping" && entry.plainTextContext.includes(pos.code))
      .slice(0, 2)
      .map((entry) => entry.plainTextContext.split("\n").slice(0, 2).join(" ").slice(0, 220).trim());

    const snippetsFromAnalog = this.deps.analogMappings
      .filter((a) => normalizeCode(a.originCode) === pos.code || a.pkvReasoning.includes(title))
      .slice(0, 2)
      .map((a) => `Erhoehter Aufwand wegen Komplexitaet/Umstaenden der Leistung '${title}': ${a.pkvReasoning.slice(0, 180)}.`);

    const generic = [
      `Ueberdurchschnittlicher Aufwand bei GOAE ${pos.code} durch erschwerte Untersuchungsbedingungen und erhoehte Differentialdiagnostik.`,
      `Erhoehter Zeitaufwand und besondere Sorgfalt bei GOAE ${pos.code} aufgrund klinischer Komplexitaet.`,
    ];

    return unique([...snippetsFromSearch, ...snippetsFromAnalog, ...generic]).slice(0, 5);
  }
}


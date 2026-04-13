import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractPdfPagesFromPath } from "../pdf-ingest/extract-pdf.ts";
import type {
  GoaePkvReasonCategory,
  GoaeV2AnalogMapping,
  GoaeV2Catalog,
  GoaeV2Code,
  GoaeV2Rule,
  GoaeV2SearchIndexEntry,
  GoaeV2Section,
  GoaeV2TermIndex,
} from "../../src/data/goae-catalog-v2-schema.ts";
import { goaeV2Schema } from "../../src/data/goae-catalog-v2-schema.ts";

type GoaeEntryV1 = {
  ziffer: string;
  bezeichnung: string;
  punkte: number;
  einfachsatz: number;
  schwellenfaktor: number;
  regelhoechstsatz: number;
  hoechstfaktor: number;
  hoechstsatz: number;
  ausschlussziffern: string[];
  hinweise?: string;
  abschnitt: string;
  kategorie?: string;
};

const __dirname = dirname(fileURLToPath(import.meta.url));

const SECTION_TITLES: Record<string, string> = {
  A: "Gebühren in besonderen Fällen",
  B: "Grundleistungen und allgemeine Leistungen",
  C: "Nichtgebietsbezogene Sonderleistungen",
  D: "Anästhesieleistungen",
  E: "Physikalisch-medizinische Leistungen",
  F: "Innere Medizin, Kinderheilkunde, Dermatologie",
  G: "Neurologie, Psychiatrie und Psychotherapie",
  H: "Geburtshilfe und Gynäkologie",
  I: "Augenheilkunde",
  J: "Hals-, Nasen-, Ohrenheilkunde",
  K: "Urologie",
  L: "Chirurgie, Orthopädie",
  M: "Laboratoriumsuntersuchungen",
  N: "Histologie, Zytologie und Zytogenetik",
  O: "Strahlendiagnostik, Nuklearmedizin, Magnetresonanztomographie und Strahlentherapie",
  P: "Sektionsleistungen",
};

function parseArgs() {
  const args = process.argv.slice(2);
  const map = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      map.set(args[i], args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "true");
    }
  }
  return {
    goaePdf: map.get("--goae-pdf"),
    pkvPdf: map.get("--pkv-pdf"),
  };
}

function detectCodeType(code: string): GoaeV2Code["codeType"] {
  if (/^\d+(\.\s*H)?$/i.test(code)) return "numeric";
  if (/^[A-HJ]$|^K[12]$/i.test(code)) return "surcharge";
  if (/^[A-Z]$/i.test(code)) return "letter";
  return "special";
}

function buildSections(sourceDocumentId: string): GoaeV2Section[] {
  return Object.keys(SECTION_TITLES).map((chapter) => ({
    id: `section-${chapter}`,
    chapterCode: chapter,
    subsectionCode: null,
    title: SECTION_TITLES[chapter],
    parentId: null,
    sourceRef: [{ documentId: sourceDocumentId, locator: `Abschnitt ${chapter}` }],
  }));
}

function toCodeRecord(entry: GoaeEntryV1): GoaeV2Code {
  return {
    code: entry.ziffer,
    codeType: detectCodeType(entry.ziffer),
    status: "active",
    sectionId: `section-${entry.abschnitt}`,
    title: entry.bezeichnung,
    descriptionLong: entry.hinweise,
    serviceComponents: [],
    tags: entry.kategorie ? [entry.kategorie] : [],
    medicalDomain: entry.kategorie ? [entry.kategorie] : [],
    fee: {
      points: entry.punkte,
      simple: entry.einfachsatz,
      thresholdFactor: entry.schwellenfaktor,
      thresholdAmount: entry.regelhoechstsatz,
      maxFactor: entry.hoechstfaktor,
      maxAmount: entry.hoechstsatz,
    },
    billingPrerequisites: [],
    billingExclusions: entry.ausschlussziffern.map((targetCode) => ({
      type: "code_conflict",
      targetCode,
      reason: `GOÄ ${entry.ziffer} ist neben GOÄ ${targetCode} nicht berechnungsfähig`,
    })),
    billingInclusions: [],
    frequencyLimits: [],
    timeConstraints: [],
    settingConstraints: [],
    legalRefs: [],
    sourceRef: [{ documentId: "goae_catalog_pdf_2015" }],
    confidence: 0.92,
    extractionNotes: "Automatisch aus Bestandskatalog v1 migriert.",
  };
}

function buildExclusionRules(codes: GoaeV2Code[]): GoaeV2Rule[] {
  const rules: GoaeV2Rule[] = [];
  const seen = new Set<string>();
  for (const code of codes) {
    for (const exclusion of code.billingExclusions) {
      if (!exclusion.targetCode) continue;
      const key = [code.code, exclusion.targetCode].sort().join("::");
      if (seen.has(key)) continue;
      seen.add(key);
      rules.push({
        ruleId: `rule-exclusion-${key.replace(/[^a-zA-Z0-9]/g, "-")}`,
        ruleType: "exclusion",
        scope: "code",
        appliesTo: [code.code, exclusion.targetCode],
        logic: { operator: "mutual_exclusion", codes: [code.code, exclusion.targetCode] },
        humanExplanation: `Die Ziffern ${code.code} und ${exclusion.targetCode} sind nicht nebeneinander berechnungsfähig.`,
        legalRefs: [],
        sourceRef: [{ documentId: "goae_catalog_pdf_2015" }],
      });
    }
  }
  rules.push({
    ruleId: "rule-analog-zielleistungsprinzip",
    ruleType: "zielleistungsprinzip",
    scope: "global",
    appliesTo: [],
    logic: { paragraph: "§4 Abs.2a GOÄ", concept: "Bestandteil-einer-Hauptleistung" },
    humanExplanation: "Leistungen, die Bestandteil oder besondere Ausführung einer anderen Leistung sind, sind nicht selbstständig berechnungsfähig.",
    legalRefs: ["GOÄ §4 Abs.2a"],
    sourceRef: [{ documentId: "pkv_kommentierung_2025" }],
  });
  rules.push({
    ruleId: "rule-analog-restriction",
    ruleType: "analog_restriction",
    scope: "global",
    appliesTo: [],
    logic: { paragraph: "§6 Abs.2 GOÄ", criteria: ["Art", "Kostenaufwand", "Zeitaufwand"] },
    humanExplanation: "Analogabrechnungen sind nur für selbstständige Leistungen zulässig, die nicht im Gebührenverzeichnis enthalten sind und nach Art, Kosten- und Zeitaufwand gleichwertig sind.",
    legalRefs: ["GOÄ §6 Abs.2"],
    sourceRef: [{ documentId: "pkv_kommentierung_2025" }],
  });
  return rules;
}

function classifyReasonCategory(reasoning: string): GoaePkvReasonCategory[] {
  const text = reasoning.toLowerCase();
  const categories = new Set<GoaePkvReasonCategory>();
  if (text.includes("lücke")) categories.add("keine_luecke");
  if (text.includes("zielleistungsprinzip")) categories.add("zielleistungsprinzip");
  if (text.includes("nicht gesondert") || text.includes("keine eigenständig")) {
    categories.add("nicht_selbststaendig");
  }
  if (text.includes("organisatorische maßnahme") || text.includes("organisations")) {
    categories.add("organisationsleistung");
  }
  if (text.includes("nicht nach goä") || text.includes("einschränkt")) {
    categories.add("einschraenkung_originar");
  }
  if (text.includes("beratungsleistung") || text.includes("goä-nrn. 1 oder 3")) {
    categories.add("beratungsleistung_originar");
  }
  if (text.includes("nichtärztliches personal")) categories.add("nicht_aerztliche_leistung");
  if (text.includes("medizinischen notwendigkeit")) categories.add("medizinische_notwendigkeit_offen");
  if (categories.size === 0) categories.add("sonstiges");
  return [...categories];
}

function detectPkvPosition(reasoning: string): GoaeV2AnalogMapping["pkvPosition"] {
  const text = reasoning.toLowerCase();
  if (
    text.includes("analog berechnungsfähig") ||
    text.includes("berechnungsfähig.")
  ) {
    return "allowed";
  }
  if (
    text.includes("nicht berechnungsfähig") ||
    text.includes("nicht abrechenbar") ||
    text.includes("kann nicht durch analogie")
  ) {
    return "not_allowed";
  }
  if (text.includes("unter der bedingung") || text.includes("ggf.")) return "conditionally_allowed";
  return "unclear";
}

function parseAnalogMappingsFromPkvText(rawText: string): GoaeV2AnalogMapping[] {
  const normalized = rawText.replace(/\r/g, "").replace(/\s+/g, " ").trim();
  const headerRegex = /A\s*(\d{3,4})\s+(\d{1,4})\s+/g;
  const markers = [...normalized.matchAll(headerRegex)];
  const out: GoaeV2AnalogMapping[] = [];
  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i];
    const analogNumber = marker[1];
    const originCode = marker[2];
    const start = marker.index ?? 0;
    const end = i + 1 < markers.length ? (markers[i + 1].index ?? normalized.length) : normalized.length;
    const segment = normalized.slice(start, end).trim();
    const body = segment.replace(/^A\s*\d{3,4}\s+\d{1,4}\s+/, "").trim();
    if (!body) continue;
    const sentenceChunks = body
      .split(/(?<=[.?!])\s+/)
      .map((chunk) => chunk.trim())
      .filter(Boolean);
    const originDescription = sentenceChunks[0] ?? body.slice(0, 180);
    const analogServiceDescription = sentenceChunks[1] ?? sentenceChunks[0] ?? body.slice(0, 180);
    const reasoning = body;
    out.push({
      analogId: `A${analogNumber.padStart(4, "0")}`,
      analogCode: `A ${analogNumber.padStart(4, "0")}`,
      originCode,
      originDescription,
      analogServiceDescription,
      pkvPosition: detectPkvPosition(reasoning),
      pkvReasoning: reasoning,
      pkvReasonCategory: classifyReasonCategory(reasoning),
      crossRefs: [...reasoning.matchAll(/(AG\s+[A-Za-zÄÖÜäöüß]+[^.]*\d+\/\d+|Dtsch Arztbl[^.)]*)/g)].map(
        (m) => m[1].trim(),
      ),
      sourceRef: [{ documentId: "pkv_kommentierung_2025" }],
    });
  }
  return dedupeAnalogMappings(out);
}

function dedupeAnalogMappings(items: GoaeV2AnalogMapping[]): GoaeV2AnalogMapping[] {
  const byKey = new Map<string, GoaeV2AnalogMapping>();
  for (const item of items) {
    const key = `${item.analogId}::${item.analogServiceDescription}`;
    if (!byKey.has(key)) byKey.set(key, item);
  }
  return [...byKey.values()];
}

function buildTermIndex(codes: GoaeV2Code[], analogMappings: GoaeV2AnalogMapping[]): GoaeV2TermIndex[] {
  const terms: GoaeV2TermIndex[] = [];
  for (const code of codes.slice(0, 600)) {
    terms.push({
      canonicalTerm: `${code.code} ${code.title}`,
      synonyms: [code.title],
      abbreviations: [],
      mapsTo: [{ entityType: "code", entityId: code.code }],
    });
  }
  for (const analog of analogMappings.slice(0, 400)) {
    terms.push({
      canonicalTerm: analog.analogCode,
      synonyms: [analog.analogServiceDescription],
      abbreviations: [],
      mapsTo: [{ entityType: "analogMapping", entityId: analog.analogId }],
    });
  }
  return terms;
}

function buildSearchIndex(
  codes: GoaeV2Code[],
  rules: GoaeV2Rule[],
  analogMappings: GoaeV2AnalogMapping[],
): GoaeV2SearchIndexEntry[] {
  const entries: GoaeV2SearchIndexEntry[] = [];
  for (const code of codes) {
    entries.push({
      entityType: "code",
      entityId: code.code,
      title: `${code.code} ${code.title}`,
      plainTextContext: [
        `Code: ${code.code}`,
        `Section: ${code.sectionId}`,
        `Title: ${code.title}`,
        `Fee simple: ${code.fee.simple.toFixed(2)} EUR`,
        `Exclusions: ${code.billingExclusions.map((x) => x.targetCode).filter(Boolean).join(", ") || "none"}`,
      ].join("\n"),
      keywords: [code.code, code.title, code.sectionId],
      embeddingText: `${code.code} ${code.title} ${code.billingExclusions.map((x) => x.targetCode).join(" ")}`,
    });
  }
  for (const rule of rules) {
    entries.push({
      entityType: "rule",
      entityId: rule.ruleId,
      title: rule.ruleId,
      plainTextContext: `${rule.humanExplanation}\nLegal refs: ${rule.legalRefs.join(", ") || "none"}`,
      keywords: [rule.ruleType, ...rule.appliesTo],
    });
  }
  for (const analog of analogMappings) {
    entries.push({
      entityType: "analogMapping",
      entityId: analog.analogId,
      title: `${analog.analogCode} -> ${analog.originCode}`,
      plainTextContext: [
        `Analog: ${analog.analogCode}`,
        `Origin: ${analog.originCode} ${analog.originDescription}`,
        `Service: ${analog.analogServiceDescription}`,
        `PKV Position: ${analog.pkvPosition}`,
        `Reasoning: ${analog.pkvReasoning}`,
      ].join("\n"),
      keywords: [analog.analogCode, analog.originCode, ...analog.pkvReasonCategory],
    });
  }
  return entries;
}

async function main() {
  const args = parseArgs();
  const catalogPath = resolve(__dirname, "../../src/data/goae-catalog-full.json");
  const catalogRaw = await readFile(catalogPath, "utf-8");
  const legacy = JSON.parse(catalogRaw) as GoaeEntryV1[];

  const sections = buildSections("goae_catalog_pdf_2015");
  const codes = legacy.map(toCodeRecord);
  const rules = buildExclusionRules(codes);

  let analogMappings: GoaeV2AnalogMapping[] = [];
  if (args.pkvPdf) {
    const pkvPages = await extractPdfPagesFromPath(resolve(args.pkvPdf));
    const pkvText = pkvPages.map((p) => p.reading_order_text).join("\n");
    analogMappings = parseAnalogMappingsFromPkvText(pkvText);
  }

  const termIndex = buildTermIndex(codes, analogMappings);
  const searchIndex = buildSearchIndex(codes, rules, analogMappings);

  const out: GoaeV2Catalog = {
    schemaVersion: "2.0.0",
    generatedAt: new Date().toISOString(),
    sourceDocuments: [
      { documentId: "goae_catalog_pdf_2015", title: "GOÄ Gebührenordnung PVS Südwest", version: "2015" },
      { documentId: "pkv_kommentierung_2025", title: "Kommentierung der PKV zur GOÄ", version: "Stand 2025-10-16" },
    ],
    metadata: {
      recordCounts: {
        sections: sections.length,
        codes: codes.length,
        rules: rules.length,
        analogMappings: analogMappings.length,
        termIndex: termIndex.length,
        searchIndex: searchIndex.length,
      },
    },
    sections,
    codes,
    rules,
    analogMappings,
    termIndex,
    searchIndex,
  };

  goaeV2Schema.parse(out);

  const outPath = resolve(__dirname, "../../src/data/goae-catalog-v2.json");
  await writeFile(outPath, `${JSON.stringify(out, null, 2)}\n`, "utf-8");

  const edgeOutPath = resolve(__dirname, "../../supabase/functions/goae-chat/goae-catalog-v2.json");
  await writeFile(edgeOutPath, `${JSON.stringify(out, null, 2)}\n`, "utf-8");

  const pipelineMeta = {
    source: "goae-v2-builder",
    builtAt: out.generatedAt,
    inputs: {
      legacyCatalog: catalogPath,
      goaePdfProvided: Boolean(args.goaePdf),
      pkvPdfProvided: Boolean(args.pkvPdf),
    },
    recordCounts: out.metadata.recordCounts,
  };
  const metaOutPath = resolve(__dirname, "../../src/data/goae-catalog-v2-meta.json");
  await writeFile(metaOutPath, `${JSON.stringify(pipelineMeta, null, 2)}\n`, "utf-8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        wrote: [outPath, edgeOutPath, metaOutPath],
        recordCounts: out.metadata.recordCounts,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


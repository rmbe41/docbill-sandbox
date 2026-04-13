/**
 * Gruppiert mehrere Uploads in Prüfeinheiten (Vorgänge) für Engine-3-Rechnungsprüfung.
 */

import { callLlm, extractJson, pickExtractionModel } from "../llm-client.ts";
import type { FilePayload } from "../types.ts";

export type UploadFileRole = "honorarrechnung" | "patientenakte" | "leistungsliste" | "sonstiges";

export type UploadSegmentationCase = {
  id: string;
  fileIndices: number[];
  title?: string;
};

export type UploadSegmentationFileRoles = { index: number; role: UploadFileRole }[];

export type UploadSegmentationResult = {
  fileRoles: UploadSegmentationFileRoles;
  cases: UploadSegmentationCase[];
  confidence: number;
  /** Wenn true: Client soll Zuordnung bestätigen / anpassen und erneut mit engine3_case_groups senden. */
  needsUserConfirmation: boolean;
};

const SEGMENTATION_SYSTEM = `Du ordnest mehrere hochgeladene medizinische PDFs/Dokumente für die **GOÄ-Rechnungsprüfung** in getrennte **Vorgänge** (Cases).

Jeder Vorgang enthält die Indizes (0-basiert) der Dateien, die **zusammen** geprüft werden sollen:
- Typisch: **eine** Honorarrechnung (GOÄ) + optional **Patientenakte**, **Befund**, **Leistungsliste** oder Arztbrief in **einem** Case.
- **Mehrere eigenständige Honorarrechnungen** → **jeweils eigener Case** (nur eine Rechnungs-PDF pro Case, außer sie ist eindeutig dieselbe Rechnung in Duplikat — dann ein Case).

Antworte NUR mit JSON:
{
  "fileRoles": [ { "index": 0, "role": "honorarrechnung|patientenakte|leistungsliste|sonstiges" } ],
  "cases": [ { "id": "kurze-id", "fileIndices": [0, 2], "title": "optional Kurztitel" } ],
  "confidence": 0.0 bis 1.0,
  "needsUserConfirmation": boolean
}

REGELN:
- Jede Datei-Index 0..n-1 muss in **genau einem** Case vorkommen.
- Pro Case höchstens **eine** Datei mit role "honorarrechnung" (wenn zwei Rechnungen im selben Case: needsUserConfirmation true und cases trotzdem trennen).
- confidence niedrig (unter 0.75), wenn Rollen unklar, Dateinamen widersprüchlich, oder mehrere Rechnungen ohne klare Zuordnung zu Akten.
- needsUserConfirmation true, wenn confidence < 0.72 oder du unsicher bist, welche Akte zu welcher Rechnung gehört.`;

function roleForIndex(roles: UploadSegmentationFileRoles, i: number): UploadFileRole {
  const r = roles.find((x) => x.index === i);
  return r?.role ?? "sonstiges";
}

/** Stellt sicher: jede Index 0..n-1 genau einmal. Mehrere Honorarrechnungen im selben Case → ungültig → leeres Array signalisieren. */
export function normalizeAndValidateCases(
  nFiles: number,
  rawCases: UploadSegmentationCase[] | undefined,
  fileRoles: UploadSegmentationFileRoles,
): UploadSegmentationCase[] | null {
  const cases = Array.isArray(rawCases) ? rawCases : [];
  const out: UploadSegmentationCase[] = [];
  const used = new Set<number>();

  for (let ci = 0; ci < cases.length; ci++) {
    const c = cases[ci];
    const idx = [...new Set((Array.isArray(c.fileIndices) ? c.fileIndices : []).map(Number))]
      .filter((i) => i >= 0 && i < nFiles && !Number.isNaN(i))
      .sort((a, b) => a - b);
    if (idx.length === 0) continue;
    const honorarN = idx.filter((i) => roleForIndex(fileRoles, i) === "honorarrechnung").length;
    if (honorarN > 1) return null;
    const id = typeof c.id === "string" && c.id.trim() ? c.id.trim() : `case-${ci}`;
    out.push({ id, fileIndices: idx, title: typeof c.title === "string" ? c.title : undefined });
    for (const i of idx) {
      if (used.has(i)) return null;
      used.add(i);
    }
  }

  for (let i = 0; i < nFiles; i++) {
    if (!used.has(i)) return null;
  }
  if (used.size !== nFiles) return null;
  return out;
}

function defaultPerFileCases(n: number): UploadSegmentationCase[] {
  return Array.from({ length: n }, (_, i) => ({ id: `file-${i}`, fileIndices: [i] }));
}

/**
 * Schnelle Segmentierung per LLM (Multimodal wie parseDokument).
 */
export async function segmentUploadsForRechnungPruefung(
  files: FilePayload[],
  apiKey: string,
  userModel: string,
): Promise<UploadSegmentationResult> {
  const n = files.length;
  if (n <= 1) {
    return {
      fileRoles: files.map((_, i) => ({ index: i, role: "honorarrechnung" as const })),
      cases: [{ id: "single", fileIndices: [0] }],
      confidence: 1,
      needsUserConfirmation: false,
    };
  }

  const model = pickExtractionModel(userModel);
  const contentParts: unknown[] = [
    {
      type: "text",
      text: `Es gibt ${n} Dateien (Indizes 0 bis ${n - 1}). Dateinamen: ${files.map((f, i) => `${i}: ${f.name}`).join("; ")}. Ordne sie in Cases.`,
    },
  ];
  for (const file of files) {
    const mimeType = file.type || "application/octet-stream";
    if (mimeType === "application/pdf") {
      contentParts.push({
        type: "file",
        file: {
          filename: file.name,
          file_data: `data:application/pdf;base64,${file.data}`,
        },
      });
    } else {
      contentParts.push({
        type: "image_url",
        image_url: { url: `data:${mimeType};base64,${file.data}` },
      });
    }
  }

  const hasPdf = files.some((f) => (f.type || "").includes("pdf"));
  const plugins: unknown[] = [{ id: "response-healing" }];
  if (hasPdf) {
    plugins.push({ id: "file-parser", pdf: { engine: "mistral-ocr" } });
  }

  try {
    const raw = await callLlm({
      apiKey,
      model,
      systemPrompt: SEGMENTATION_SYSTEM,
      userContent: contentParts,
      jsonMode: true,
      temperature: 0.05,
      maxTokens: 4096,
      plugins,
    });
    const j = extractJson<{
      fileRoles?: { index: number; role: string }[];
      cases?: { id?: string; fileIndices?: number[]; title?: string }[];
      confidence?: number;
      needsUserConfirmation?: boolean;
    }>(raw);

    const roleMap: UploadFileRole[] = [
      "honorarrechnung",
      "patientenakte",
      "leistungsliste",
      "sonstiges",
    ];
    const normRole = (s: string): UploadFileRole => {
      const t = (s || "").toLowerCase();
      if (roleMap.includes(t as UploadFileRole)) return t as UploadFileRole;
      if (t.includes("rechnung")) return "honorarrechnung";
      if (t.includes("akte") || t.includes("befund") || t.includes("brief")) return "patientenakte";
      if (t.includes("leistung")) return "leistungsliste";
      return "sonstiges";
    };

    const fileRoles: { index: number; role: UploadFileRole }[] = [];
    for (let i = 0; i < n; i++) {
      const fr = j.fileRoles?.find((x) => x.index === i);
      fileRoles.push({ index: i, role: fr ? normRole(String(fr.role)) : "sonstiges" });
    }

    const rawCases: UploadSegmentationCase[] = (j.cases ?? []).map((c, idx) => ({
      id: typeof c.id === "string" && c.id.trim() ? c.id.trim() : `case-${idx}`,
      fileIndices: Array.isArray(c.fileIndices) ? c.fileIndices.map(Number).filter((x) => !Number.isNaN(x)) : [],
      title: typeof c.title === "string" ? c.title : undefined,
    }));

    let confidence = typeof j.confidence === "number" && j.confidence >= 0 && j.confidence <= 1
      ? j.confidence
      : 0.65;
    let needsUserConfirmation = j.needsUserConfirmation === true || confidence < 0.72;

    let cases = normalizeAndValidateCases(n, rawCases, fileRoles);
    if (cases == null || cases.length === 0) {
      cases = defaultPerFileCases(n);
      confidence = Math.min(confidence, 0.55);
      needsUserConfirmation = true;
    }

    const honorarCount = fileRoles.filter((r) => r.role === "honorarrechnung").length;
    if (
      honorarCount >= 2 &&
      cases.some((c) => c.fileIndices.filter((i) => roleForIndex(fileRoles, i) === "honorarrechnung").length > 1)
    ) {
      needsUserConfirmation = true;
    }

    return { fileRoles, cases, confidence, needsUserConfirmation };
  } catch {
    return {
      fileRoles: files.map((_, i) => ({ index: i, role: "sonstiges" as const })),
      cases: defaultPerFileCases(n),
      confidence: 0.4,
      needsUserConfirmation: true,
    };
  }
}

/** Jede Index 0..n-1 genau einmal, alle Gruppen nicht leer. */
export function validateEngine3CaseGroups(
  nFiles: number,
  groups: number[][] | undefined,
): number[][] | null {
  if (!groups?.length || nFiles < 1) return null;
  const used = new Set<number>();
  for (const g of groups) {
    if (!Array.isArray(g) || g.length === 0) return null;
    for (const i of g) {
      if (typeof i !== "number" || !Number.isInteger(i) || i < 0 || i >= nFiles) return null;
      if (used.has(i)) return null;
      used.add(i);
    }
  }
  if (used.size !== nFiles) return null;
  return groups;
}

export function caseUsesMultiDocumentInvoiceReview(
  fileIndices: number[],
  fileRoles: UploadSegmentationFileRoles,
): boolean {
  if (fileIndices.length < 2) return false;
  const rolesIn = fileIndices.map((i) => fileRoles.find((r) => r.index === i)?.role ?? "sonstiges");
  const honorar = rolesIn.filter((r) => r === "honorarrechnung").length;
  const klinisch = rolesIn.filter((r) =>
    r === "patientenakte" || r === "leistungsliste" || r === "sonstiges"
  ).length;
  return honorar === 1 && klinisch >= 1;
}

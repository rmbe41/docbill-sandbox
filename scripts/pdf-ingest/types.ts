/**
 * Artefakte für PDF-Ingest (Manifest, QA-Seiten, Segmente).
 * Siehe Plan: pdf-ingest_docbill_pipeline_0eb30e33.plan.md
 */

export type PdfIngestManifest = {
  document_id: string;
  /** z.B. GOÄ-Kommentar 2026 */
  title?: string;
  version?: string;
  page_count: number;
  pdf_sha256?: string;
  imported_at: string;
  truncated: boolean;
  truncation_reason?: string;
  /** Extraktions-Engine */
  extractor?: string;
};

export type PdfPageBlockJson = {
  index: number;
  text: string;
  /** normalisierte Bounding Box 0–1 optional */
  bbox?: [number, number, number, number];
};

export type PdfPageJson = {
  page_number: number;
  reading_order_text: string;
  blocks?: PdfPageBlockJson[];
  layout_quality?: "high" | "medium" | "low" | "unknown";
};

export type PdfSegmentJson = {
  id: string;
  heading?: string;
  page_from: number;
  page_to: number;
  plain_text: string;
  ziffern?: string[];
};

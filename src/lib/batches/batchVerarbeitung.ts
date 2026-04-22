import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { analyseRohrechnungHeuristisch, spalteStatusUndHinweis } from "@/lib/batches/batchAnalyseHeuristic";
import { extractTextFromPdfArrayBuffer } from "@/lib/batches/extractPdfTextForBatch";
import { downloadJobUploadAsBlob } from "@/lib/uploads/jobUploads";

const STEP_MS = 40;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Läuft nacheinander je Rechnung: heuristische Analyse (lokal), Fortschritt in DB.
 */
export async function runBatchVerarbeitung(batchId: string, total: number): Promise<void> {
  if (total <= 0) {
    const leer = {
      gesamtbetrag: 0,
      geprueft: 0,
      mitHinweisen: 0,
      mitFehlern: 0,
      offen: 0,
      optimierungspotenzial: 0,
    };
    await supabase
      .from("batches")
      .update({
        verarbeitet_count: 0,
        status: "complete",
        zusammenfassung: leer,
        updated_at: new Date().toISOString(),
      })
      .eq("id", batchId);
    return;
  }

  const { data: reRows, error: relErr } = await supabase
    .from("batch_rechnungen")
    .select("id, sort_order, detail_json")
    .eq("batch_id", batchId)
    .order("sort_order", { ascending: true });
  if (relErr) {
    console.error(relErr);
    return;
  }
  const rows = reRows ?? [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as { id: string; detail_json: unknown };
    const rawDetail = (row.detail_json && typeof row.detail_json === "object" && !Array.isArray(row.detail_json)
      ? (row.detail_json as Record<string, unknown>)
      : {}) as Record<string, unknown>;
    const meta = rawDetail.metadata as Record<string, unknown> | undefined;
    let rohText = typeof meta?.rohText === "string" ? meta.rohText : "";
    const quelle =
      meta?.quelle === "pdf" || meta?.quelle === "pad" || meta?.quelle === "bild" ? meta.quelle : undefined;
    const storagePath = typeof meta?.storage_path === "string" ? meta.storage_path.trim() : "";
    if (!rohText.trim() && storagePath && quelle === "pdf") {
      try {
        const blob = await downloadJobUploadAsBlob(storagePath);
        rohText = await extractTextFromPdfArrayBuffer(await blob.arrayBuffer());
      } catch (e) {
        console.error("batch pdf from storage", e);
      }
    }
    if (rohText.trim()) {
      const a = analyseRohrechnungHeuristisch(rohText, {
        fileName: typeof meta?.fileName === "string" ? meta.fileName : undefined,
        quelle,
      });
      const { status, hinweise } = spalteStatusUndHinweis(a.listeStatus, a.detail.kpi);
      await supabase
        .from("batch_rechnungen")
        .update({
          betrag_euro: a.betragEuro,
          fachbereich: a.fachbereich,
          liste_status: a.listeStatus,
          hinweise_kurz: hinweise,
          detail_json: {
            ...a.detail,
            kpi: a.detail.kpi,
            metadata: { ...a.detail.metadata, statusSpalte: status, pending: false },
          } as unknown as Json,
        })
        .eq("id", row.id);
    }
    await supabase
      .from("batches")
      .update({
        verarbeitet_count: i + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", batchId);
    await sleep(STEP_MS);
  }

  const { data: rlist } = await supabase
    .from("batch_rechnungen")
    .select("liste_status, betrag_euro, detail_json")
    .eq("batch_id", batchId);
  const list = rlist ?? [];
  const gepr = list.filter((r) => (r as { liste_status: string }).liste_status === "geprueft").length;
  const hinw = list.filter((r) => (r as { liste_status: string }).liste_status === "mit_hinweisen").length;
  const fehl = list.filter((r) => (r as { liste_status: string }).liste_status === "fehler").length;
  const offen = list.filter((r) => (r as { liste_status: string }).liste_status === "offen").length;
  const gesamt = list.reduce((s, r) => s + Number((r as { betrag_euro: number }).betrag_euro), 0);
  const opt = list.reduce((s, r) => {
    const d = (r as { detail_json?: { kpi?: { optimierung?: number } } }).detail_json;
    const o = d?.kpi?.optimierung ?? 0;
    return s + o * 12;
  }, 0);
  const optRounded = round2(Math.min(gesamt * 0.06, opt > 0 ? opt * 0.1 : gesamt * 0.025));
  const hasProblem = fehl > 0 || offen > 0 || hinw > 0;
  const status = hasProblem ? "partial" : "complete";
  const zusammenfassung = {
    gesamtbetrag: round2(gesamt),
    geprueft: gepr,
    mitHinweisen: hinw,
    mitFehlern: fehl,
    offen,
    optimierungspotenzial: optRounded,
  };
  await supabase
    .from("batches")
    .update({
      verarbeitet_count: total,
      status,
      zusammenfassung,
      updated_at: new Date().toISOString(),
    })
    .eq("id", batchId);
}

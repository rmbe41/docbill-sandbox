import { supabase } from "@/integrations/supabase/client";

export async function refreshBatchFaelleCount(batchId: string): Promise<void> {
  const { count, error: cErr } = await supabase
    .from("batch_faelle")
    .select("id", { count: "exact", head: true })
    .eq("batch_id", batchId);
  if (cErr) {
    console.error(cErr);
    return;
  }
  await supabase
    .from("batches")
    .update({ faelle_count: count ?? 0, updated_at: new Date().toISOString() })
    .eq("id", batchId);
}

async function renumberFaelleSortOrder(batchId: string): Promise<void> {
  const { data: remaining, error } = await supabase
    .from("batch_faelle")
    .select("id")
    .eq("batch_id", batchId)
    .order("sort_order", { ascending: true });
  if (error || !remaining?.length) return;
  for (let i = 0; i < remaining.length; i++) {
    await supabase.from("batch_faelle").update({ sort_order: i }).eq("id", (remaining[i] as { id: string }).id);
  }
}

async function deleteOrphanFaelle(batchId: string): Promise<void> {
  const { data: faelle, error: fErr } = await supabase.from("batch_faelle").select("id").eq("batch_id", batchId);
  if (fErr || !faelle?.length) return;
  const { data: usedRows, error: uErr } = await supabase.from("batch_rechnungen").select("fall_id").eq("batch_id", batchId);
  if (uErr) return;
  const used = new Set((usedRows ?? []).map((r) => (r as { fall_id: string }).fall_id));
  const orphans = faelle.map((x) => (x as { id: string }).id).filter((id) => !used.has(id));
  if (orphans.length === 0) return;
  await supabase.from("batch_faelle").delete().in("id", orphans);
}

/**
 * Mehrere Unterlagen demselben Fall zuordnen (erste gewählte Zeile bestimmt den Ziel-Fall).
 */
export async function mergeBatchRechnungenIntoOneFall(rechnungIds: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
  if (rechnungIds.length < 2) return { ok: false, error: "Mindestens zwei Unterlagen auswählen." };
  const { data: rows, error } = await supabase
    .from("batch_rechnungen")
    .select("id, batch_id, fall_id, sort_order")
    .in("id", rechnungIds)
    .order("sort_order", { ascending: true });
  if (error || !rows?.length) return { ok: false, error: "Zeilen nicht gefunden." };
  const batchId = (rows[0] as { batch_id: string }).batch_id;
  if (rows.some((r) => (r as { batch_id: string }).batch_id !== batchId)) {
    return { ok: false, error: "Nur Unterlagen aus demselben Stapel können zusammengeführt werden." };
  }
  const targetFall = (rows[0] as { fall_id: string }).fall_id;
  const { error: uErr } = await supabase.from("batch_rechnungen").update({ fall_id: targetFall }).in("id", rechnungIds);
  if (uErr) return { ok: false, error: uErr.message };
  const { data: labelRow } = await supabase
    .from("batch_rechnungen")
    .select("patient_id_label")
    .eq("fall_id", targetFall)
    .order("sort_order", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (labelRow && typeof (labelRow as { patient_id_label: string }).patient_id_label === "string") {
    await supabase
      .from("batch_faelle")
      .update({ label: (labelRow as { patient_id_label: string }).patient_id_label })
      .eq("id", targetFall);
  }
  await deleteOrphanFaelle(batchId);
  await renumberFaelleSortOrder(batchId);
  await refreshBatchFaelleCount(batchId);
  return { ok: true };
}

/**
 * Eine Unterlage in einen neuen Fall ausgliedern (nur wenn der aktuelle Fall mehr als eine hat).
 */
export async function splitBatchRechnungToNewFall(rechnungId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: row, error } = await supabase
    .from("batch_rechnungen")
    .select("id, batch_id, fall_id, patient_id_label, sort_order")
    .eq("id", rechnungId)
    .maybeSingle();
  if (error || !row) return { ok: false, error: "Unterlage nicht gefunden." };
  const r = row as {
    batch_id: string;
    fall_id: string;
    patient_id_label: string;
    sort_order: number;
  };
  const { count, error: cErr } = await supabase
    .from("batch_rechnungen")
    .select("id", { count: "exact", head: true })
    .eq("fall_id", r.fall_id);
  if (cErr || (count ?? 0) < 2) {
    return { ok: false, error: "Der Fall hat nur eine Unterlage." };
  }
  const { data: maxFall, error: mErr } = await supabase
    .from("batch_faelle")
    .select("sort_order")
    .eq("batch_id", r.batch_id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (mErr) return { ok: false, error: mErr.message };
  const nextOrder = ((maxFall?.sort_order as number | undefined) ?? -1) + 1;
  const { data: newFall, error: insErr } = await supabase
    .from("batch_faelle")
    .insert({
      batch_id: r.batch_id,
      sort_order: nextOrder,
      label: r.patient_id_label,
    })
    .select("id")
    .single();
  if (insErr || !newFall) return { ok: false, error: insErr?.message ?? "Fall anlegen fehlgeschlagen." };
  const newId = (newFall as { id: string }).id;
  const { error: uErr } = await supabase.from("batch_rechnungen").update({ fall_id: newId }).eq("id", rechnungId);
  if (uErr) return { ok: false, error: uErr.message };
  await renumberFaelleSortOrder(r.batch_id);
  await refreshBatchFaelleCount(r.batch_id);
  return { ok: true };
}

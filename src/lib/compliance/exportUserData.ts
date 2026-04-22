import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * DSGVO Art. 15 – Auskunft: nutzerbezogene Inhalte als JSON sammeln (Spec 07 §9.1).
 * Nur Tabellen, die der Nutzer über normale Sitzung lesen darf.
 */
export async function buildUserDataExportJson(supabase: SupabaseClient, userId: string, email: string | null) {
  const [settingsRes, rolesRes, convRes, orgMemberRes, batchesRes, jobsRes, adminFilesRes] = await Promise.all([
    supabase.from("user_settings").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("user_roles").select("*").eq("user_id", userId),
    supabase.from("conversations").select("*").eq("user_id", userId).order("updated_at", { ascending: false }),
    supabase.from("organisation_members").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("batches").select("*").eq("user_id", userId).order("updated_at", { ascending: false }),
    supabase.from("background_jobs").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
    supabase.from("admin_context_files").select("id, filename, created_at, storage_path, uploaded_by").eq("uploaded_by", userId),
  ]);

  const errors: { table: string; message: string }[] = [];
  for (const r of [settingsRes, rolesRes, convRes, orgMemberRes, batchesRes, jobsRes, adminFilesRes] as const) {
    if (r.error) errors.push({ table: "see_query", message: r.error.message });
  }

  const conversations = convRes.data ?? [];
  const convIds = conversations.map((c) => c.id);
  let messages: unknown[] = [];
  if (convIds.length > 0) {
    const { data, error } = await supabase
      .from("messages")
      .select("id, conversation_id, role, content, structured_content, created_at")
      .in("conversation_id", convIds)
      .order("created_at", { ascending: true });
    if (error) errors.push({ table: "messages", message: error.message });
    else messages = data ?? [];
  }

  const batchIds = (batchesRes.data ?? []).map((b) => b.id);
  let batchRechnungen: unknown[] = [];
  let batchFaelle: unknown[] = [];
  if (batchIds.length > 0) {
    const [br, bf] = await Promise.all([
      supabase.from("batch_rechnungen").select("*").in("batch_id", batchIds),
      supabase.from("batch_faelle").select("*").in("batch_id", batchIds),
    ]);
    if (br.error) errors.push({ table: "batch_rechnungen", message: br.error.message });
    else batchRechnungen = br.data ?? [];
    if (bf.error) errors.push({ table: "batch_faelle", message: bf.error.message });
    else batchFaelle = bf.data ?? [];
  }

  return {
    schema: "docbill-dsgwo-export" as const,
    version: 1,
    exportedAt: new Date().toISOString(),
    subject: { userId, email: email ?? null },
    data: {
      user_settings: settingsRes.data ?? null,
      user_roles: rolesRes.data ?? [],
      organisation_member: orgMemberRes.data ?? null,
      conversations,
      messages,
      batches: batchesRes.data ?? [],
      batch_rechnungen: batchRechnungen,
      batch_faelle: batchFaelle,
      background_jobs: jobsRes.data ?? [],
      admin_context_files: adminFilesRes.data ?? [],
    },
    exportErrors: errors.length > 0 ? errors : undefined,
  };
}

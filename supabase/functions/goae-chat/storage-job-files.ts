import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const JOB_UPLOADS_BUCKET = "job-uploads";

export type StorageFileRef = { path: string; name?: string; content_type?: string; size?: number };

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

/** Lädt Objekte aus `job-uploads`; jeder Pfad muss mit `pathPrefix` beginnen (z. B. `{user_id}/`). */
export async function loadFilesFromStorageRefs(
  supabaseUrl: string,
  serviceKey: string,
  refs: StorageFileRef[],
  pathPrefix: string,
): Promise<{ name: string; type: string; data: string }[]> {
  const admin: SupabaseClient = createClient(supabaseUrl, serviceKey);
  const out: { name: string; type: string; data: string }[] = [];
  for (const ref of refs) {
    if (!ref?.path || typeof ref.path !== "string") continue;
    const p = ref.path.trim();
    if (!p.startsWith(pathPrefix)) {
      throw new Error("forbidden_storage_path");
    }
    const { data, error } = await admin.storage.from(JOB_UPLOADS_BUCKET).download(p);
    if (error) throw error;
    const buf = new Uint8Array(await data.arrayBuffer());
    const name = (typeof ref.name === "string" && ref.name.trim()) || p.split("/").pop() || "file";
    const type =
      (typeof ref.content_type === "string" && ref.content_type.trim()) || "application/octet-stream";
    out.push({ name, type, data: bytesToBase64(buf) });
  }
  return out;
}

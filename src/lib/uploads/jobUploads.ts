import { supabase } from "@/integrations/supabase/client";

export const JOB_UPLOADS_BUCKET = "job-uploads";

function sanitizeSegment(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 180) || "file";
}

/** Hintergrund-Job: {userId}/{jobId}/{uuid}_{fileName} */
export function jobAttachmentObjectPath(userId: string, jobId: string, file: File): string {
  const id = crypto.randomUUID();
  return `${userId}/${jobId}/${id}_${sanitizeSegment(file.name)}`;
}

/** Batch-Quelle: {userId}/batch/{batchId}/src/{idx}_{fileName} */
export function batchSourceObjectPath(userId: string, batchId: string, fileIndex: number, file: File): string {
  return `${userId}/batch/${batchId}/src/${fileIndex}_${sanitizeSegment(file.name)}`;
}

export type JobStorageRef = {
  path: string;
  name: string;
  content_type: string;
  size?: number;
};

export async function uploadFilesToJobUploads(paths: string[], files: File[]): Promise<void> {
  if (paths.length !== files.length) throw new Error("uploadFilesToJobUploads: paths/files length mismatch");
  for (let i = 0; i < files.length; i++) {
    const { error } = await supabase.storage.from(JOB_UPLOADS_BUCKET).upload(paths[i], files[i], {
      cacheControl: "3600",
      upsert: false,
      contentType: files[i].type || "application/octet-stream",
    });
    if (error) throw error;
  }
}

export async function downloadJobUploadAsBlob(path: string): Promise<Blob> {
  const { data, error } = await supabase.storage.from(JOB_UPLOADS_BUCKET).download(path);
  if (error) throw error;
  return data;
}

/** Rekonstruiert eine Browser-`File` aus einem gespeicherten Base64-Payload (z. B. Engine-3-Fortsetzung). */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

/** Lädt gespeicherte Objekte und liefert Base64-Payloads (z. B. Engine-3-Fortsetzung nach Segmentierung). */
export async function storageRefsToFilePayloads(
  refs: JobStorageRef[],
): Promise<{ name: string; type: string; data: string }[]> {
  const out: { name: string; type: string; data: string }[] = [];
  for (const r of refs) {
    const blob = await downloadJobUploadAsBlob(r.path);
    const buf = await blob.arrayBuffer();
    out.push({ name: r.name, type: r.content_type, data: arrayBufferToBase64(buf) });
  }
  return out;
}

export function filePayloadStoredToFile(p: { name: string; type: string; data: string }): File {
  const b64 = p.data.includes(",") ? (p.data.split(",")[1] ?? p.data) : p.data;
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new File([u], p.name, { type: p.type || "application/octet-stream" });
}

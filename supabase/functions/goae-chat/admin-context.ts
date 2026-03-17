/**
 * Admin-Kontext: RAG-basiertes Retrieval
 *
 * Lädt nur relevante Chunks aus admin_context_chunks basierend auf der
 * User-Query (Embedding + pgvector Similarity Search).
 */

const EMBEDDING_MODEL = "openai/text-embedding-3-small";
const EMBEDDING_DIM = 1536;
const MATCH_COUNT = 8;
const MATCH_THRESHOLD = 0.5;
const MAX_ADMIN_TOKENS = 5000;
const CHARS_PER_TOKEN = 4;

async function getQueryEmbedding(query: string, apiKey: string): Promise<number[]> {
  const resp = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: query.slice(0, 8000),
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Embedding API failed: ${resp.status} ${err}`);
  }

  const data = await resp.json();
  const item = data?.data?.[0];
  const embedding = item?.embedding;
  if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIM) {
    throw new Error("Invalid embedding response");
  }
  return embedding;
}

export async function loadRelevantAdminContext(
  query: string,
  apiKey: string,
): Promise<string> {
  if (!query?.trim()) return "";

  const sbUrl = Deno.env.get("SUPABASE_URL");
  const sbKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!sbUrl || !sbKey) return "";

  try {
    const embedding = await getQueryEmbedding(query, apiKey);

    const rpcResp = await fetch(
      `${sbUrl}/rest/v1/rpc/match_admin_context_chunks`,
      {
        method: "POST",
        headers: {
          apikey: sbKey,
          Authorization: `Bearer ${sbKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query_embedding: embedding,
          match_count: MATCH_COUNT,
          match_threshold: MATCH_THRESHOLD,
        }),
      },
    );

    if (!rpcResp.ok) return loadFullAdminContextFallback(sbUrl, sbKey);

    const chunks = await rpcResp.json();
    if (!Array.isArray(chunks) || chunks.length === 0) return loadFullAdminContextFallback(sbUrl, sbKey);

    const maxChars = MAX_ADMIN_TOKENS * CHARS_PER_TOKEN;
    let totalChars = 0;
    const parts: string[] = [];

    for (const c of chunks) {
      const content = c?.content;
      if (typeof content !== "string") continue;
      if (totalChars + content.length > maxChars) break;
      const filename = c?.filename ?? "Unbekannt";
      parts.push(`### ${filename} (Ausschnitt)\n${content}`);
      totalChars += content.length;
    }

    if (parts.length === 0) return "";
    return "\n\n## ADMIN-KONTEXT (relevante Ausschnitte):\n" + parts.join("\n\n");
  } catch {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    return url && key ? loadFullAdminContextFallback(url, key) : "";
  }
}

async function loadFullAdminContextFallback(sbUrl: string, sbKey: string): Promise<string> {
  if (!sbUrl || !sbKey) return "";
  try {
    const ctxResp = await fetch(
      `${sbUrl}/rest/v1/admin_context_files?select=filename,content_text&order=created_at.asc`,
      { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } },
    );
    if (!ctxResp.ok) return "";
    const ctxFiles = await ctxResp.json();
    if (!ctxFiles?.length) return "";
    const maxChars = MAX_ADMIN_TOKENS * CHARS_PER_TOKEN;
    let total = 0;
    const parts: string[] = [];
    for (const f of ctxFiles) {
      const text = f?.content_text ?? "";
      if (total + text.length > maxChars) {
        parts.push(`### ${f.filename}\n${text.slice(0, maxChars - total)}...`);
        break;
      }
      parts.push(`### ${f.filename}\n${text}`);
      total += text.length;
    }
    return "\n\n## ADMIN-KONTEXT:\n" + parts.join("\n\n");
  } catch {
    return "";
  }
}

export function buildPipelineQuery(
  userMessage?: string,
  result?: { medizinischeAnalyse?: { fachgebiet?: string; klinischerKontext?: string; diagnosen?: { text: string }[] }; pruefung?: { positionen?: { ziffer: string }[] } },
): string {
  const parts: string[] = [];
  if (userMessage?.trim()) parts.push(userMessage.trim());
  if (result?.medizinischeAnalyse) {
    const ma = result.medizinischeAnalyse;
    if (ma.fachgebiet) parts.push(`Fachgebiet: ${ma.fachgebiet}`);
    if (ma.klinischerKontext) parts.push(`Kontext: ${ma.klinischerKontext}`);
    if (ma.diagnosen?.length) {
      parts.push("Diagnosen: " + ma.diagnosen.map((d) => d.text).join(", "));
    }
  }
  if (result?.pruefung?.positionen?.length) {
    const ziffern = result.pruefung.positionen.map((p) => p.ziffer).filter(Boolean);
    if (ziffern.length) parts.push("GOÄ-Ziffern: " + [...new Set(ziffern)].join(", "));
  }
  return parts.join("\n");
}

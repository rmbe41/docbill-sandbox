/**
 * Admin-Kontext: RAG-basiertes Retrieval
 *
 * Lädt nur relevante Chunks aus admin_context_chunks basierend auf der
 * User-Query (Embedding + pgvector Similarity Search).
 */

import { fetchWithTimeout } from "./fetch-with-timeout.ts";
import { extractZiffernFromText } from "./goae-catalog-json.ts";

const EMBEDDING_MODEL = "openai/text-embedding-3-small";
const EMBEDDING_TIMEOUT_MS = 30000;
const RPC_TIMEOUT_MS = 15000;
const EMBEDDING_DIM = 1536;
const MATCH_COUNT = 10;
const MATCH_THRESHOLD = 0.48;
const MAX_ADMIN_TOKENS = 5000;
const CHARS_PER_TOKEN = 4;

function normalizeChunkBody(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** True if the user query clearly refers to this admin file name (stem / words). */
function filenameStemMatchesQuery(filename: string, query: string): boolean {
  const q = query.toLowerCase();
  const stem = filename.replace(/\.[^/.]+$/, "").trim().toLowerCase();
  if (!stem || stem.length < 2) return false;
  if (q.includes(stem)) return true;
  const words = stem.split(/[\s_\-–—.]+/).filter((w) => w.length >= 2);
  if (words.length < 2) return words.length === 1 && q.includes(words[0]);
  return words.every((w) => q.includes(w));
}

function adminBlockCoversFilename(adminHtml: string, filename: string): boolean {
  const esc = filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^###\\s+${esc}(\\s|\\(|\\.|$)`, "im").test(adminHtml);
}

async function loadFilenameMatchSections(
  query: string,
  sbUrl: string,
  sbKey: string,
): Promise<{ filename: string; section: string }[]> {
  if (!query?.trim()) return [];

  const listResp = await fetchWithTimeout(
    `${sbUrl}/rest/v1/admin_context_files?select=id,filename`,
    {
      headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` },
      timeoutMs: RPC_TIMEOUT_MS,
    },
  );
  if (!listResp.ok) return [];

  const files = (await listResp.json()) as { id: string; filename: string }[];
  const matched = files.filter((f) => filenameStemMatchesQuery(f.filename, query));
  if (matched.length === 0) return [];

  const out: { filename: string; section: string }[] = [];
  for (const f of matched) {
    const rowResp = await fetchWithTimeout(
      `${sbUrl}/rest/v1/admin_context_files?id=eq.${f.id}&select=filename,content_text`,
      {
        headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` },
        timeoutMs: RPC_TIMEOUT_MS,
      },
    );
    if (!rowResp.ok) continue;
    const rows = (await rowResp.json()) as { filename?: string; content_text?: string }[];
    const row = rows[0];
    const text = (row?.content_text ?? "").trim();
    if (!text) continue;
    const fn = row?.filename ?? f.filename;
    out.push({ filename: fn, section: `### ${fn}\n${text}` });
  }
  return out;
}

async function mergeFilenameMatchedSections(
  query: string,
  base: string,
  sbUrl: string,
  sbKey: string,
): Promise<string> {
  const maxChars = MAX_ADMIN_TOKENS * CHARS_PER_TOKEN;
  const sections = await loadFilenameMatchSections(query, sbUrl, sbKey);
  const uncovered = sections.filter((s) => !adminBlockCoversFilename(base, s.filename));
  // #region agent log
  debugAdminCtx("H_fname", "admin-context.ts:filenameMerge", "filename-aligned admin sections", {
    matchedFiles: sections.map((s) => s.filename),
    uncoveredFiles: uncovered.map((s) => s.filename),
    baseLen: base.length,
  });
  // #endregion
  if (uncovered.length === 0) return base;

  const header = "\n\n## ADMIN-KONTEXT (Anfrage bezieht sich auf diese Kontext-Datei(en)):\n";
  const sup = header + uncovered.map((s) => s.section).join("\n\n");
  let combined = sup + (base.trim() ? `\n\n${base.trim()}` : "");
  if (combined.length <= maxChars) return combined;

  const room = Math.max(0, maxChars - sup.length - 80);
  const trimmedBase =
    room > 0 && base.trim()
      ? `${base.trim().slice(0, room)}\n\n[… weiterer ADMIN-KONTEXT gekürzt …]`
      : "";
  return sup + (trimmedBase ? `\n\n${trimmedBase}` : "");
}

// #region agent log
function debugAdminCtx(
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown>,
) {
  const payload = {
    sessionId: "c81fbe",
    hypothesisId,
    location,
    message,
    data,
    timestamp: Date.now(),
  };
  console.error("DOCBILL_INSTRUMENTATION admin-context", JSON.stringify(payload));
  fetch("http://127.0.0.1:7350/ingest/d67df62b-428b-4fab-8921-97d904601338", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "c81fbe" },
    body: JSON.stringify(payload),
  }).catch(() => {});
}
// #endregion

async function getQueryEmbedding(query: string, apiKey: string): Promise<number[]> {
  const resp = await fetchWithTimeout(
    "https://openrouter.ai/api/v1/embeddings",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: query.slice(0, 8000),
      }),
      timeoutMs: EMBEDDING_TIMEOUT_MS,
    },
  );

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
  if (!query?.trim()) {
    // #region agent log
    debugAdminCtx("H3", "admin-context.ts:emptyQuery", "skip admin context (empty rag query)", {
      queryPresent: typeof query === "string",
    });
    // #endregion
    return "";
  }

  const sbUrl = Deno.env.get("SUPABASE_URL");
  const sbKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!sbUrl || !sbKey) {
    // #region agent log
    debugAdminCtx("H_env", "admin-context.ts:noSupabase", "skip admin context (missing sb env)", {
      hasUrl: !!sbUrl,
      hasKey: !!sbKey,
    });
    // #endregion
    return "";
  }

  try {
    const zExtracted = extractZiffernFromText(query);
    const filterZiffern = zExtracted.length > 0 && zExtracted.length <= 48 ? zExtracted : null;
    // #region agent log
    debugAdminCtx("H_query", "admin-context.ts:preEmbed", "rag query + ziffern filter", {
      queryLen: query.length,
      queryHead: query.slice(0, 280),
      filterZiffern,
      zExtractedCount: zExtracted.length,
    });
    // #endregion

    const embedding = await getQueryEmbedding(query, apiKey);

    const rpcResp = await fetchWithTimeout(
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
          filter_ziffern: filterZiffern,
        }),
        timeoutMs: RPC_TIMEOUT_MS,
      },
    );

    if (!rpcResp.ok) {
      // #region agent log
      debugAdminCtx("H_rag_empty", "admin-context.ts:rpcFail", "rpc not ok → fallback", {
        status: rpcResp.status,
      });
      // #endregion
      return await mergeFilenameMatchedSections(
        query,
        await loadFullAdminContextFallback(sbUrl, sbKey),
        sbUrl,
        sbKey,
      );
    }

    const chunks = await rpcResp.json();
    if (!Array.isArray(chunks) || chunks.length === 0) {
      // #region agent log
      debugAdminCtx("H_rag_empty", "admin-context.ts:noChunks", "zero chunks → fallback", {
        chunksType: typeof chunks,
      });
      // #endregion
      return await mergeFilenameMatchedSections(
        query,
        await loadFullAdminContextFallback(sbUrl, sbKey),
        sbUrl,
        sbKey,
      );
    }

    const topPreview = chunks.slice(0, 5).map((c: { similarity?: number; content?: string; chunk_index?: number }) => ({
      sim: c?.similarity,
      idx: c?.chunk_index,
      head: typeof c?.content === "string" ? c.content.slice(0, 100) : null,
    }));
    const distinctHeads = new Set(
      chunks.slice(0, 20).map((c: { content?: string }) =>
        typeof c?.content === "string" ? c.content.slice(0, 80) : "",
      ),
    );
    // #region agent log
    debugAdminCtx("H_rag_polluted", "admin-context.ts:postRpc", "match_admin_context_chunks result", {
      chunkCount: chunks.length,
      topPreview,
      distinctHeadCount: distinctHeads.size,
      chunkFilenames: chunks.slice(0, 12).map((c: { filename?: string }) => c?.filename ?? null),
    });
    // #endregion

    if (chunks.length >= 4 && distinctHeads.size <= 2) {
      // #region agent log
      debugAdminCtx("H_rag_polluted", "admin-context.ts:lowDiversity", "few distinct chunk heads → file fallback", {
        chunkCount: chunks.length,
        distinctHeadCount: distinctHeads.size,
      });
      // #endregion
      return await mergeFilenameMatchedSections(
        query,
        await loadFullAdminContextFallback(sbUrl, sbKey),
        sbUrl,
        sbKey,
      );
    }

    const nonEmptyContents = chunks
      .map((c: { content?: string }) => (typeof c?.content === "string" ? c.content : ""))
      .filter((s: string) => s.length > 0);
    const normalizedBodies = nonEmptyContents.map(normalizeChunkBody);
    if (normalizedBodies.length > 1 && new Set(normalizedBodies).size === 1) {
      // #region agent log
      debugAdminCtx("H_rag_polluted", "admin-context.ts:dupChunks", "identical chunk bodies → file fallback", {
        chunkCount: chunks.length,
      });
      // #endregion
      return await mergeFilenameMatchedSections(
        query,
        await loadFullAdminContextFallback(sbUrl, sbKey),
        sbUrl,
        sbKey,
      );
    }

    const maxChars = MAX_ADMIN_TOKENS * CHARS_PER_TOKEN;
    let totalChars = 0;
    const parts: string[] = [];

    for (const c of chunks) {
      const content = c?.content;
      if (typeof content !== "string") continue;
      if (totalChars + content.length > maxChars) break;
      const filename = c?.filename ?? "Unbekannt";
      const pg = c?.source_page;
      const sp = c?.section_path;
      const locParts: string[] = [];
      if (pg != null) locParts.push(`S. ${pg}`);
      if (typeof sp === "string" && sp.trim().length > 0) locParts.push(sp.trim());
      const loc = locParts.length > 0 ? ` (${locParts.join(" · ")})` : "";
      parts.push(`### ${filename}${loc}\n${content}`);
      totalChars += content.length;
    }

    if (parts.length === 0) {
      return await mergeFilenameMatchedSections(query, "", sbUrl, sbKey);
    }
    const ragBlock =
      "\n\n## ADMIN-KONTEXT (relevante Ausschnitte):\n" + parts.join("\n\n");
    // #region agent log
    debugAdminCtx("H_rag_ok", "admin-context.ts:ragPath", "using RAG block", {
      ragLen: ragBlock.length,
      blockMentionsCatKnowledge: /cat\s*knowledge/i.test(ragBlock),
    });
    // #endregion
    return await mergeFilenameMatchedSections(query, ragBlock, sbUrl, sbKey);
  } catch {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    // #region agent log
    debugAdminCtx("H_rag_empty", "admin-context.ts:catch", "exception → fallback", {});
    // #endregion
    const fb = url && key ? await loadFullAdminContextFallback(url, key) : "";
    return await mergeFilenameMatchedSections(query, fb, sbUrl, sbKey);
  }
}

async function loadFullAdminContextFallback(sbUrl: string, sbKey: string): Promise<string> {
  if (!sbUrl || !sbKey) return "";
  try {
    const ctxResp = await fetchWithTimeout(
      `${sbUrl}/rest/v1/admin_context_files?select=filename,content_text&order=created_at.desc`,
      {
        headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` },
        timeoutMs: RPC_TIMEOUT_MS,
      },
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
    const fb = "\n\n## ADMIN-KONTEXT:\n" + parts.join("\n\n");
    const allNames = (ctxFiles as { filename?: string }[]).map((f) => f?.filename ?? "");
    // #region agent log
    debugAdminCtx("H_budget", "admin-context.ts:fallback", "full-file fallback", {
      fileCount: ctxFiles.length,
      fbLen: fb.length,
      partsCount: parts.length,
      filenamesOrderedNewestFirst: allNames,
      partsIncluded: parts.length,
      maxChars,
      blockMentionsCatKnowledge: /cat\s*knowledge/i.test(fb),
    });
    // #endregion
    return fb;
  } catch {
    // #region agent log
    debugAdminCtx("H_fallback", "admin-context.ts:fallbackCatch", "fallback failed", {});
    // #endregion
    return "";
  }
}

type PipelineQueryResult = {
  medizinischeAnalyse?: { fachgebiet?: string; klinischerKontext?: string; diagnosen?: { text: string }[] };
  pruefung?: { positionen?: { ziffer: string }[]; optimierungen?: { ziffer: string }[] };
};

/** Kontext aus vorherigen Ergebnissen (für Follow-up-Fragen) */
export type LastResultContext = {
  last_invoice_result?: { pruefung?: { positionen?: { ziffer: string }[]; optimierungen?: { ziffer: string }[] } };
  last_service_result?: { vorschlaege?: { ziffer: string }[]; klinischerKontext?: string; fachgebiet?: string };
};

export function buildPipelineQuery(
  userMessage?: string,
  result?: PipelineQueryResult,
  lastResult?: LastResultContext,
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
  const ziffernSet = new Set<string>();
  if (result?.pruefung?.positionen?.length) {
    for (const p of result.pruefung.positionen) {
      if (p.ziffer) ziffernSet.add(p.ziffer);
    }
  }
  if (result?.pruefung?.optimierungen?.length) {
    for (const o of result.pruefung.optimierungen) {
      if (o.ziffer) ziffernSet.add(o.ziffer);
    }
  }
  if (lastResult?.last_invoice_result?.pruefung?.positionen?.length) {
    for (const p of lastResult.last_invoice_result.pruefung.positionen) {
      if (p.ziffer) ziffernSet.add(p.ziffer);
    }
  }
  if (lastResult?.last_invoice_result?.pruefung?.optimierungen?.length) {
    for (const o of lastResult.last_invoice_result.pruefung.optimierungen) {
      if (o.ziffer) ziffernSet.add(o.ziffer);
    }
  }
  if (lastResult?.last_service_result?.vorschlaege?.length) {
    for (const v of lastResult.last_service_result.vorschlaege) {
      if (v.ziffer) ziffernSet.add(v.ziffer);
    }
    if (lastResult.last_service_result.klinischerKontext) {
      parts.push(`Kontext: ${lastResult.last_service_result.klinischerKontext}`);
    }
    if (lastResult.last_service_result.fachgebiet) {
      parts.push(`Fachgebiet: ${lastResult.last_service_result.fachgebiet}`);
    }
  }
  if (ziffernSet.size) parts.push("GOÄ-Ziffern: " + [...ziffernSet].join(", "));
  parts.push("optimierung analog begründung");
  const query = parts.join("\n");
  return query.trim() || "GOÄ Arztrechnung Augenheilkunde";
}

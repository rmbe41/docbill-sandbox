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

/** Filename token → substrings that may appear in a German (or mixed) user query. */
const STEM_TOKEN_ALIASES: Record<string, string[]> = {
  cat: ["katze", "katzen", "kater", "cats", "kitty"],
  cats: ["katze", "katzen", "kater"],
  knowledge: ["wissen", "kenntnis"],
};

function queryCoversStemToken(q: string, token: string): boolean {
  const t = token.toLowerCase();
  if (t.length < 2) return false;
  if (q.includes(t)) return true;
  for (const alt of STEM_TOKEN_ALIASES[t] ?? []) {
    if (q.includes(alt)) return true;
  }
  return false;
}

/** z.B. CatKnowledge → Cat Knowledge; 2pdf → 2 pdf */
function expandBasenameBoundaries(base: string): string {
  return base
    .replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2")
    .replace(/(\p{L})(\p{N})/gu, "$1 $2")
    .replace(/(\p{N})(\p{L})/gu, "$1 $2");
}

/**
 * Ein zusammenhängender Dateiname in Kleinbuchstaben (catknowledge): optional in zwei Teile
 * schneiden, wenn beide Teile (je ≥3) per Token/Alias in der Anfrage vorkommen.
 */
function splitSingleStemAgainstQuery(q: string, word: string): boolean {
  const w = word.toLowerCase();
  if (w.length < 6) return false;
  for (let i = 3; i <= w.length - 3; i++) {
    const a = w.slice(0, i);
    const b = w.slice(i);
    if (queryCoversStemToken(q, a) && queryCoversStemToken(q, b)) return true;
  }
  return false;
}

/** True if the user query clearly refers to this admin file name (stem / words). */
function filenameStemMatchesQuery(filename: string, query: string): boolean {
  const q = query.toLowerCase();
  const base = filename.replace(/\.[^/.]+$/, "").trim();
  if (base.length < 2) return false;
  const stemLower = base.toLowerCase();
  if (q.includes(stemLower)) return true;

  const expanded = expandBasenameBoundaries(base);
  const words = expanded
    .toLowerCase()
    .split(/[\s_\-–—.]+/)
    .filter((w) => w.length >= 2);

  if (words.length === 0) return false;

  let compoundHit = false;
  let result: boolean;
  if (words.length < 2) {
    const w0 = words[0]!;
    compoundHit = splitSingleStemAgainstQuery(q, w0);
    result = queryCoversStemToken(q, w0) || compoundHit;
  } else {
    result = words.every((w) => queryCoversStemToken(q, w));
  }
  // #region agent log
  if (/cat/i.test(filename) && /knowledge/i.test(filename)) {
    const h1Payload = {
      sessionId: "631fa3",
      hypothesisId: "H1",
      location: "admin-context.ts:filenameStemMatchesQuery",
      message: "cat-knowledge filename stem vs query",
      data: {
        filename,
        stemLower,
        expanded,
        words,
        queryHead: query.slice(0, 200),
        wordChecks: words.map((w) => ({ w, ok: queryCoversStemToken(q, w) })),
        compoundHit,
        result,
      },
      timestamp: Date.now(),
      runId: "repro-1",
    };
    console.log(
      "[DOCBILL_INSTRUMENTATION] hypothesisId=H1 location=admin-context.ts:filenameStemMatchesQuery message=cat_knowledge_stem",
    );
    console.log("[DOCBILL_INSTRUMENTATION_JSON]", JSON.stringify(h1Payload));
    fetch("http://127.0.0.1:7350/ingest/dc9c2cfd-e812-42c5-8db7-14893d1ca961", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "631fa3" },
      body: JSON.stringify(h1Payload),
    }).catch(() => {});
  }
  // #endregion
  return result;
}

/** Funktionswörter (DE, Länge ≥4), keine inhaltstragenden Begriffe wie „leben“. */
const QUERY_OVERLAP_STOPWORDS = new Set([
  "alle",
  "also",
  "auch",
  "auf",
  "aus",
  "beim",
  "bei",
  "bist",
  "bis",
  "dass",
  "dem",
  "den",
  "der",
  "des",
  "die",
  "diese",
  "diesem",
  "diesen",
  "dieser",
  "dieses",
  "durch",
  "ein",
  "eine",
  "einem",
  "einen",
  "einer",
  "eines",
  "etwa",
  "etwas",
  "euro",
  "gibt",
  "habe",
  "haben",
  "hast",
  "hat",
  "hatte",
  "hätt",
  "ihnen",
  "ihre",
  "ihrem",
  "ihren",
  "ihrer",
  "ihres",
  "kann",
  "kein",
  "keine",
  "keinem",
  "keinen",
  "keiner",
  "mach",
  "macht",
  "mehr",
  "mein",
  "meine",
  "mich",
  "mir",
  "mit",
  "muss",
  "nach",
  "noch",
  "nur",
  "oder",
  "sich",
  "sie",
  "sind",
  "soll",
  "sollen",
  "somit",
  "sondern",
  "über",
  "und",
  "uns",
  "viel",
  "viele",
  "vom",
  "von",
  "vor",
  "war",
  "was",
  "weg",
  "weil",
  "welche",
  "welchem",
  "welcher",
  "welches",
  "wenig",
  "wer",
  "werd",
  "werden",
  "wie",
  "wies",
  "wird",
  "wollen",
  "worden",
  "wurde",
  "zum",
  "zur",
]);

function significantTermsFromQuery(query: string): string[] {
  const raw = query
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .split(/[^a-z0-9]+/i)
    .filter((w) => w.length >= 4 && !QUERY_OVERLAP_STOPWORDS.has(w));
  return [...new Set(raw)];
}

function adminBlockCoversFilename(adminHtml: string, filename: string): boolean {
  const esc = filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^###\\s+${esc}(\\s|\\(|\\.|$)`, "im").test(adminHtml);
}

/**
 * Lädt volle Dateiinhalte, wenn (a) Dateiname zur Anfrage passt inkl. Sprach-Aliase oder
 * (b) signifikante Wörter der Anfrage im Klartext der Datei vorkommen (ein REST-Call).
 */
async function loadAdminSectionMatches(
  query: string,
  sbUrl: string,
  sbKey: string,
): Promise<{ filename: string; section: string; byName: boolean }[]> {
  if (!query?.trim()) return [];

  const listResp = await fetchWithTimeout(
    `${sbUrl}/rest/v1/admin_context_files?select=filename,content_text`,
    {
      headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` },
      timeoutMs: RPC_TIMEOUT_MS,
    },
  );
  if (!listResp.ok) return [];

  const rows = (await listResp.json()) as { filename?: string; content_text?: string }[];
  const terms = significantTermsFromQuery(query);
  const out: { filename: string; section: string; byName: boolean }[] = [];
  let filenameHits = 0;
  let overlapHits = 0;
  let overlapOnlyCount = 0;
  const MAX_OVERLAP_ONLY_FILES = 5;
  for (const row of rows) {
    const fn = (row?.filename ?? "").trim();
    const text = (row?.content_text ?? "").trim();
    if (!fn || !text) continue;
    const hay = text.toLowerCase();
    const byName = filenameStemMatchesQuery(fn, query);
    const byOverlap = terms.length > 0 && terms.some((t) => hay.includes(t));
    if (!byName && !byOverlap) continue;
    if (!byName && byOverlap && overlapOnlyCount >= MAX_OVERLAP_ONLY_FILES) continue;
    if (!byName && byOverlap) overlapOnlyCount++;
    if (byName) filenameHits++;
    else overlapHits++;
    out.push({ filename: fn, section: `### ${fn}\n${text}`, byName });
  }
  // #region agent log
  debugAdminCtx("H_overlap", "admin-context.ts:adminSectionMatches", "filename vs content overlap", {
    filenameHits,
    overlapHits,
    termCount: terms.length,
    termSample: terms.slice(0, 8),
    byNameFiles: out.filter((s) => s.byName).map((s) => s.filename),
  });
  // #endregion
  return out;
}

async function mergeFilenameMatchedSections(
  query: string,
  base: string,
  sbUrl: string,
  sbKey: string,
): Promise<string> {
  const maxChars = MAX_ADMIN_TOKENS * CHARS_PER_TOKEN;
  const sections = await loadAdminSectionMatches(query, sbUrl, sbKey);
  /** Namens-Treffer: immer Volltext liefern, auch wenn RAG schon einen ###-Snippet-Header gleichen Namens gesetzt hat. */
  const uncovered = sections.filter(
    (s) => s.byName || !adminBlockCoversFilename(base, s.filename),
  );
  // #region agent log
  debugAdminCtx("H2", "admin-context.ts:filenameMerge", "filename-aligned admin sections", {
    matchedFiles: sections.map((s) => s.filename),
    uncoveredFiles: uncovered.map((s) => s.filename),
    skippedDueToRagHeaderOnly: sections
      .filter((s) => !s.byName && adminBlockCoversFilename(base, s.filename))
      .map((s) => s.filename),
    baseLen: base.length,
    catKnowledgeInSections: sections.some((s) => /cat/i.test(s.filename) && /knowledge/i.test(s.filename)),
    catKnowledgeInUncovered: uncovered.some((s) => /cat/i.test(s.filename) && /knowledge/i.test(s.filename)),
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
    sessionId: "631fa3",
    hypothesisId,
    location,
    message,
    data: { ...data, runId: data.runId ?? "repro-1" },
    timestamp: Date.now(),
  };
  // Supabase Edge Logs: stdout zuverlässiger sichtbar als nur stderr; hypothesisId am Anfang für Volltextsuche.
  console.log(
    `[DOCBILL_INSTRUMENTATION] hypothesisId=${hypothesisId} location=${location} message=${message}`,
  );
  console.log("[DOCBILL_INSTRUMENTATION_JSON]", JSON.stringify(payload));
  console.error("DOCBILL_INSTRUMENTATION admin-context", JSON.stringify(payload));
  fetch("http://127.0.0.1:7350/ingest/dc9c2cfd-e812-42c5-8db7-14893d1ca961", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "631fa3" },
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

/**
 * Engine 3: Vorbedingung für KI-Kontext (Admin-RAG braucht Embedding + Supabase).
 * Wirft bei technischem Ausfall – kein stilles Weiterarbeiten ohne nachvollziehbare Basis.
 */
export async function preflightEngine3KiContext(apiKey: string): Promise<void> {
  const sbUrl = Deno.env.get("SUPABASE_URL");
  const sbKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!sbUrl || !sbKey) {
    throw new Error(
      "KI-Kontext nicht verfügbar: Die Anbindung an die Wissensdatenbank fehlt (Supabase-Umgebung unvollständig). Bitte Administrator kontaktieren.",
    );
  }
  await getQueryEmbedding("DocBill Engine3 Kontextprüfung", apiKey);
}

export type LoadRelevantAdminContextOptions = {
  /**
   * Nur für Embedding + GOÄ-Ziffern-Filter: oft die **letzte** Nutzerzeile, damit ein
   * mehrzeiliger Merge-Query (mehrere Turns) den Vektor nicht verwässert und der Verlauf
   * die pgvector-Treffer nicht „wegzieht“.
   */
  vectorQuery?: string;
};

export async function loadRelevantAdminContext(
  mergeQuery: string,
  apiKey: string,
  options?: LoadRelevantAdminContextOptions,
): Promise<string> {
  const mq = mergeQuery?.trim() ?? "";
  if (!mq) {
    // #region agent log
    debugAdminCtx("H3", "admin-context.ts:emptyQuery", "skip admin context (empty rag query)", {
      queryPresent: typeof mergeQuery === "string",
    });
    // #endregion
    return "";
  }

  const vectorQ = (options?.vectorQuery?.trim() || mq).trim();

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
    const zExtracted = extractZiffernFromText(vectorQ);
    const filterZiffern = zExtracted.length > 0 && zExtracted.length <= 48 ? zExtracted : null;
    // #region agent log
    debugAdminCtx("H_embed_split", "admin-context.ts:preEmbed", "merge vs vector query (RAG)", {
      mergeLen: mq.length,
      vectorLen: vectorQ.length,
      vectorDiffersFromMerge: mq !== vectorQ,
      vectorHead: vectorQ.slice(0, 280),
      mergeTail: mq.slice(-280),
      filterZiffern,
      zExtractedCount: zExtracted.length,
      filterZiffernActive: filterZiffern != null && filterZiffern.length > 0,
    });
    // #endregion

    const embedding = await getQueryEmbedding(vectorQ, apiKey);

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
        mq,
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
        mq,
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
        mq,
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
        mq,
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
      return await mergeFilenameMatchedSections(mq, "", sbUrl, sbKey);
    }
    const ragBlock =
      "\n\n## ADMIN-KONTEXT (relevante Ausschnitte):\n" + parts.join("\n\n");
    // #region agent log
    debugAdminCtx("H_rag_ok", "admin-context.ts:ragPath", "using RAG block", {
      ragLen: ragBlock.length,
      blockMentionsCatKnowledge: /cat\s*knowledge/i.test(ragBlock),
    });
    // #endregion
    return await mergeFilenameMatchedSections(mq, ragBlock, sbUrl, sbKey);
  } catch {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    // #region agent log
    debugAdminCtx("H_rag_empty", "admin-context.ts:catch", "exception → fallback", {});
    // #endregion
    const fb = url && key ? await loadFullAdminContextFallback(url, key) : "";
    return await mergeFilenameMatchedSections(mq, fb, sbUrl, sbKey);
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
    // Älteste Einträge zuerst: sonst füllen wenige neue Großdateien das Budget und ältere Kontextdateien fehlen.
    for (const f of [...ctxFiles].reverse()) {
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
    debugAdminCtx("H4", "admin-context.ts:fallback", "full-file fallback", {
      fileCount: ctxFiles.length,
      fbLen: fb.length,
      partsCount: parts.length,
      filenamesOrderedNewestFirst: allNames,
      partsIncluded: parts.length,
      maxChars,
      blockMentionsCatKnowledge: /cat\s*knowledge/i.test(fb),
      partFilenames: parts.map((p) => {
        const m = /^###\s+([^\n]+)/.exec(p);
        return m ? m[1].slice(0, 80) : "";
      }),
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
  last_engine3_result?: {
    modus?: string;
    klinischerKontext?: string;
    positionen?: { ziffer: string }[];
    optimierungen?: { ziffer: string }[];
  };
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
  const e3 = lastResult?.last_engine3_result;
  if (e3?.positionen?.length) {
    for (const p of e3.positionen) {
      if (p.ziffer) ziffernSet.add(p.ziffer);
    }
  }
  if (e3?.optimierungen?.length) {
    for (const o of e3.optimierungen) {
      if (o.ziffer) ziffernSet.add(o.ziffer);
    }
  }
  if (e3?.klinischerKontext) {
    parts.push(`Vorheriger Engine-3-Kontext: ${e3.klinischerKontext}`);
  }
  if (e3?.modus) {
    parts.push(`Vorheriger Engine-3-Modus: ${e3.modus}`);
  }
  if (ziffernSet.size) parts.push("GOÄ-Ziffern: " + [...ziffernSet].join(", "));
  parts.push("optimierung analog begründung");
  const query = parts.join("\n");
  return query.trim() || "GOÄ Arztrechnung Augenheilkunde";
}

const FRAGE_ADMIN_RAG_MAX_CHARS = 12000;
const FRAGE_ADMIN_RAG_MAX_USER_TURNS = 5;

/** RAG-Suchquery für Auslegungs-/BÄK-Fragen mit Zusatzstichworten anreichern (Embedding). */
export function enrichRagQueryForAuslegung(query: string): string {
  const q = query.trim();
  if (!q) return q;
  if (!/\b(bäk|bundesärztekammer|bundesaerztekammer|stellungnahme|auslegung)\b/i.test(q)) {
    return q;
  }
  const tail = "GOÄ Auslegung Stellungnahme Bundesärztekammer BÄK";
  if (/\bbundes[aä]rztekammer\b/i.test(q) && /\bstellungnahme\b/i.test(q)) return q;
  return `${q}\n\n${tail}`;
}

/**
 * Admin-RAG im Fragemodus: letzte Nutzer-Turns bündeln, damit Folgefragen weiterhin
 * Dateinamen-/Wissens-Cues aus dem Verlauf matchen (reine letzte Nachricht reicht oft nicht).
 */
export function buildFrageAdminRagQuery(
  messages: { role: string; content: unknown }[] | undefined,
  lastUserMessage: string,
  pipelineFallbackWhenLastEmpty: string,
): string {
  const last = lastUserMessage.trim();
  if (!last) return enrichRagQueryForAuslegung(pipelineFallbackWhenLastEmpty.trim());
  const userTurns = (messages ?? [])
    .filter((m) => m.role === "user")
    .map((m) => String(m.content ?? "").trim())
    .filter((s) => s.length > 0);
  const recent = userTurns.slice(-FRAGE_ADMIN_RAG_MAX_USER_TURNS);
  if (recent.length <= 1) return enrichRagQueryForAuslegung(last);
  return enrichRagQueryForAuslegung(
    recent.join("\n\n").slice(0, FRAGE_ADMIN_RAG_MAX_CHARS),
  );
}

/**
 * Spec 8.2 — Mapping-Tabelle in Redis (Upstash REST), TTL max. 24h, kein lokales Disk-Persist.
 *
 * Secrets (Supabase Edge):
 * - UPSTASH_REDIS_REST_URL
 * - UPSTASH_REDIS_REST_TOKEN
 *
 * Ohne diese Variablen: load/save sind No-Ops bzw. liefern null.
 */
import type { PseudonymMap } from "../../../../src/lib/architecture/spec06-types.ts";

const TTL_SEC = 86400; // 24h
const keyFor = (sessionId: string) => `docbill:pseudonym:${sessionId}`;

async function upstash(command: unknown[]): Promise<unknown> {
  const url = Deno.env.get("UPSTASH_REDIS_REST_URL")?.trim();
  const token = Deno.env.get("UPSTASH_REDIS_REST_TOKEN")?.trim();
  if (!url || !token) return null;

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  if (!res.ok) {
    console.warn(
      JSON.stringify({
        level: "warn",
        msg: "pseudonym_redis_http",
        status: res.status,
      }),
    );
    return null;
  }
  const body = (await res.json()) as { result?: unknown; error?: string };
  if (body.error) {
    console.warn(JSON.stringify({ level: "warn", msg: "pseudonym_redis_error", detail: body.error }));
    return null;
  }
  return body.result ?? null;
}

export async function loadPseudonymMap(sessionId: string): Promise<PseudonymMap | null> {
  if (!sessionId.trim()) return null;
  const raw = await upstash(["GET", keyFor(sessionId)]);
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw) as PseudonymMap;
    if (!parsed?.sessionId || !Array.isArray(parsed.mappings)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function savePseudonymMap(map: PseudonymMap): Promise<void> {
  if (!map.sessionId?.trim()) return;
  const url = Deno.env.get("UPSTASH_REDIS_REST_URL")?.trim();
  const token = Deno.env.get("UPSTASH_REDIS_REST_TOKEN")?.trim();
  if (!url || !token) return;

  const payload = JSON.stringify(map);
  await upstash(["SET", keyFor(map.sessionId), payload, "EX", String(TTL_SEC)]);
}

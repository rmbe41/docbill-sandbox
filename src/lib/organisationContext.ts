import { supabase } from "@/integrations/supabase/client";

export type MyOrganisationMemberRow = { organisation_id: string; role: string };

function isRlsRecursionError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  if (err.code === "42P17") return true;
  return (err.message ?? "").toLowerCase().includes("infinite recursion");
}

/** PostgREST/JS liefert uuid skalar manchmal nicht als reines `string` – für ensure()-Rückgabe. */
function coalesceRpcUuid(d: unknown): string | null {
  if (d == null) return null;
  if (typeof d === "string" && d.length > 0) return d;
  if (typeof d === "object" && d !== null) {
    if ("toString" in d && typeof (d as { toString: () => string }).toString === "function") {
      const s = (d as { toString: () => string }).toString();
      if (s.length > 0 && s !== "[object Object]" && s.includes("-")) return s;
    }
  }
  return null;
}

/** get_organisation_context: jsonb, ggf. doppelt kodiert oder role fehlend. */
function rowFromGetOrganisationContext(data: unknown): MyOrganisationMemberRow | null {
  if (data == null) return null;
  let raw: unknown = data;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const oid = o.organisation_id;
  if (oid == null) return null;
  const organisation_id = String(oid);
  if (organisation_id.length < 8) return null;
  const role = typeof o.role === "string" && o.role.length > 0 ? o.role : "admin";
  return { organisation_id, role };
}

async function withFreshSessionForUser(
  userId: string,
): Promise<{ ok: true } | { ok: false; reason: "no_session" }> {
  let {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    const { data: userData } = await supabase.auth.getUser();
    if (userData.user?.id === userId) {
      const again = await supabase.auth.getSession();
      session = again.data.session;
    }
  }
  if (!session) {
    const { data: ref } = await supabase.auth.refreshSession();
    session = ref.session ?? (await supabase.auth.getSession()).data.session;
  }
  if (!session?.user) {
    console.warn("organisationContext: no Supabase session (RPCs need authenticated role)");
    return { ok: false, reason: "no_session" };
  }
  if (session.user.id !== userId) {
    console.warn("organisationContext: user id != session user");
    return { ok: false, reason: "no_session" };
  }
  return { ok: true };
}

/**
 * Liest die eigene organisation_members-Zeile bzw. stellt sie per SECURITY-DEFINER
 * `ensure_user_organisation` sicher (unabhängig von RLS auf der Tabelle).
 */
export async function fetchMyOrganisationMemberRow(
  userId: string,
): Promise<MyOrganisationMemberRow | null> {
  const sessionGate = await withFreshSessionForUser(userId);
  if (!sessionGate.ok) return null;

  const fromRest = () =>
    supabase
      .from("organisation_members")
      .select("organisation_id, role")
      .eq("user_id", userId)
      .maybeSingle();

  const tryGetContext = async (): Promise<MyOrganisationMemberRow | null> => {
    const { data, error } = await supabase.rpc("get_organisation_context");
    if (error) {
      const msg = (error.message?.toLowerCase() ?? "");
      const missingFn = error.code === "PGRST202" || msg.includes("does not exist");
      if (!missingFn) console.warn("get_organisation_context", error);
      return null;
    }
    return rowFromGetOrganisationContext(data);
  };

  /** Primär: Mandant anlegen/abrufen; braucht `ensure_user_organisation` in der DB. */
  let ensure = await supabase.rpc("ensure_user_organisation");
  let ensuredId = coalesceRpcUuid(ensure.data);
  const isAuthishFailure =
    ensure.error != null &&
    (ensure.error.message?.toLowerCase().includes("not_authenticated") ||
      ensure.error.message?.toLowerCase().includes("jwt") ||
      ensure.error.code === "P0001");
  if (ensure.error && isAuthishFailure) {
    await supabase.auth.refreshSession();
    ensure = await supabase.rpc("ensure_user_organisation");
    ensuredId = coalesceRpcUuid(ensure.data);
  }
  if (!ensure.error && ensuredId) {
    const fromCtx = await tryGetContext();
    if (fromCtx) return fromCtx;
    return { organisation_id: ensuredId, role: "admin" };
  }
  if (ensure.error) {
    console.error("ensure_user_organisation failed", {
      code: ensure.error.code,
      message: ensure.error.message,
    });
  }

  const fromCtxFirst = await tryGetContext();
  if (fromCtxFirst) return fromCtxFirst;

  const r = await fromRest();
  if (r.data) {
    return { organisation_id: r.data.organisation_id, role: r.data.role as string };
  }
  if (r.error && !isRlsRecursionError(r.error)) {
    console.warn("organisation_members select", r.error);
    return null;
  }
  if (r.error && isRlsRecursionError(r.error)) {
    const ctxRetry = await tryGetContext();
    if (ctxRetry) return ctxRetry;
  }
  return tryGetContext();
}

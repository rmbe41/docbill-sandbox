import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { fetchMyOrganisationMemberRow } from "@/lib/organisationContext";

export type OrgMemberRole = "admin" | "manager" | "viewer";

export type UseOrganisationResult = {
  organisationId: string | null;
  role: OrgMemberRole | null;
  loading: boolean;
  refresh: () => Promise<void>;
  isAdmin: boolean;
  isManager: boolean;
  isViewer: boolean;
  canWriteBatches: boolean;
  canWriteWissensbasis: boolean;
  /** Spec 13.2: Manager inkl. Feedback-Dashboard; Produkt-Admin siehe useAuth.isAdmin */
  canViewFeedbackDashboard: boolean;
};

export function useOrganisation(): UseOrganisationResult {
  const { user, isAdmin: isProductAdmin } = useAuth();
  const [organisationId, setOrganisationId] = useState<string | null>(null);
  const [role, setRole] = useState<OrgMemberRole | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    // #region agent log
    const orgDbg = (message: string, data: Record<string, unknown>) => {
      fetch("http://127.0.0.1:7340/ingest/dc9c2cfd-e812-42c5-8db7-14893d1ca961", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "a98b71" },
        body: JSON.stringify({
          sessionId: "a98b71",
          runId: "post-rls-fix",
          hypothesisId: "ORG_CTX",
          location: "useOrganisation.ts:refresh",
          message,
          data,
          timestamp: Date.now(),
        }),
      }).catch(() => {});
    };
    // #endregion
    if (!user) {
      setOrganisationId(null);
      setRole(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const row = await fetchMyOrganisationMemberRow(user.id);
    // #region agent log
    orgDbg("fetch_organisation", {
      hasRow: Boolean(row),
      role: row?.role ?? null,
      canWriteBatches: Boolean(row?.organisation_id) && (
        (row && (row.role === "admin" || row.role === "manager")) || isProductAdmin
      ),
    });
    // #endregion
    if (!row) {
      setOrganisationId(null);
      setRole(null);
    } else {
      setOrganisationId(row.organisation_id);
      setRole(row.role as OrgMemberRole);
    }
    setLoading(false);
  }, [user, isProductAdmin]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const isAdmin = role === "admin";
  const isManager = role === "manager";
  const isViewer = role === "viewer";
  const hasOrganisation = Boolean(organisationId);
  // Batches and KB are org-scoped: product admins still need a membership row for organisation_id.
  const canWriteBatches = hasOrganisation && (isAdmin || isManager || isProductAdmin);
  const canWriteWissensbasis = hasOrganisation && (isAdmin || isManager || isProductAdmin);
  const canViewFeedbackDashboard =
    isProductAdmin || isAdmin || isManager;

  return {
    organisationId,
    role,
    loading,
    refresh,
    isAdmin,
    isManager,
    isViewer,
    canWriteBatches,
    canWriteWissensbasis,
    canViewFeedbackDashboard,
  };
}

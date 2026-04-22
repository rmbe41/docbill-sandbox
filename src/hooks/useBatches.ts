import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/useAuth";
import { useOrganisation } from "@/hooks/useOrganisation";
import type { Batch, BatchFall, BatchRechnungRow } from "@/lib/batches/batchTypes";
import { parseDetailJson, parseZusammenfassung } from "@/lib/batches/batchTypes";
import { normalizeFallKeys, suggestFallKeysFromPlan } from "@/lib/batches/batchFallGrouping";
import {
  betragGrobAusText,
  patLabelFromText,
  planBatchInvoicesFromFiles,
} from "@/lib/batches/planBatchInvoicesFromFiles";
import { batchSourceObjectPath, uploadFilesToJobUploads } from "@/lib/uploads/jobUploads";
import { runBatchVerarbeitung } from "@/lib/batches/batchVerarbeitung";
import { parseOrganisationSettings } from "@/lib/organisationSettings";

type BatchRowDb = {
  id: string;
  user_id: string;
  organisation_id: string;
  name: string;
  created_at: string;
  updated_at: string;
  rechnungen_count: number;
  faelle_count?: number;
  verarbeitet_count?: number;
  status: string;
  zusammenfassung: unknown;
};

type BatchFallRowDb = {
  id: string;
  batch_id: string;
  sort_order: number;
  label: string;
};

type RechnungRowDb = {
  id: string;
  batch_id: string;
  fall_id: string;
  sort_order: number;
  patient_id_label: string;
  betrag_euro: number;
  liste_status: string;
  hinweise_kurz: string | null;
  fachbereich: string | null;
  detail_json: unknown;
  vorschlaege_angenommen?: boolean;
  aenderungen_anzahl?: number;
  optimierung_angewendet_euro?: number;
};

function rowToBatch(r: BatchRowDb): Batch {
  const z = parseZusammenfassung(r.zusammenfassung as Parameters<typeof parseZusammenfassung>[0]);
  const faelle =
    typeof r.faelle_count === "number" && Number.isFinite(r.faelle_count) ? r.faelle_count : r.rechnungen_count;
  return {
    id: r.id,
    name: r.name,
    organisationId: r.organisation_id,
    erstelltVon: r.user_id,
    erstelltAm: r.created_at,
    aktualisiertAm: r.updated_at,
    faelleCount: faelle,
    rechnungenCount: r.rechnungen_count,
    verarbeitetCount: r.verarbeitet_count ?? 0,
    status: r.status as Batch["status"],
    zusammenfassung: z,
  };
}

function rowToRechnung(r: RechnungRowDb): BatchRechnungRow {
  return {
    id: r.id,
    batchId: r.batch_id,
    fallId: r.fall_id,
    sortOrder: r.sort_order,
    patientIdLabel: r.patient_id_label,
    betragEuro: Number(r.betrag_euro),
    listeStatus: r.liste_status as BatchRechnungRow["listeStatus"],
    hinweiseKurz: r.hinweise_kurz,
    fachbereich: r.fachbereich,
    detail: parseDetailJson(r.detail_json as Parameters<typeof parseDetailJson>[0]),
    vorschlaegeAngenommen: r.vorschlaege_angenommen === true,
    aenderungenAnzahl: r.aenderungen_anzahl ?? 0,
    optimierungAngewendetEuro: Number(r.optimierung_angewendet_euro ?? 0),
  };
}

export function useBatches() {
  const { user } = useAuth();
  const { organisationId, canWriteBatches, loading: orgLoading } = useOrganisation();
  const [list, setList] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setList([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("batches")
      .select("*")
      .order("updated_at", { ascending: false });
    if (error) {
      console.error("useBatches", error);
      setList([]);
    } else {
      setList((data as BatchRowDb[]).map(rowToBatch));
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!user) return;
    if (!list.some((b) => b.status === "processing")) return;
    const id = setInterval(() => {
      void refresh();
    }, 1000);
    return () => clearInterval(id);
  }, [user, list, refresh]);

  const deleteBatch = useCallback(
    async (batchId: string) => {
      if (!user) return false;
      const { error } = await supabase.from("batches").delete().eq("id", batchId);
      if (error) {
        console.error(error);
        return false;
      }
      await refresh();
      return true;
    },
    [user, refresh],
  );

  const createBatchFromFiles = useCallback(
    async (name: string, files: File[], fallKeys?: number[]) => {
      // #region agent log
      const dbg = (hypothesisId: string, message: string, data: Record<string, unknown>) => {
        fetch("http://127.0.0.1:7340/ingest/dc9c2cfd-e812-42c5-8db7-14893d1ca961", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "a98b71" },
          body: JSON.stringify({
            sessionId: "a98b71",
            runId: "post-fix",
            hypothesisId,
            location: "useBatches.ts:createBatchFromFiles",
            message,
            data,
            timestamp: Date.now(),
          }),
        }).catch(() => {});
      };
      // #endregion
      if (!user) {
        dbg("H1", "no_user", { hasUser: false });
        return null;
      }
      if (!organisationId || !canWriteBatches) {
        // #region agent log
        dbg("H1", "org_or_write_gate", { hasOrganisationId: Boolean(organisationId), canWriteBatches });
        // #endregion
        console.error("useBatches: keine Schreibberechtigung oder Organisation fehlt");
        return null;
      }
      const orgId = organisationId;
      const { data: orgRow } = await supabase
        .from("organisations")
        .select("settings")
        .eq("id", orgId)
        .maybeSingle();
      const orgSettings = parseOrganisationSettings(orgRow?.settings);
      if (typeof orgSettings.batchLimit === "number" && orgSettings.batchLimit >= 0) {
        const { count, error: countErr } = await supabase
          .from("batches")
          .select("id", { count: "exact", head: true })
          .eq("organisation_id", orgId);
        if (!countErr && (count ?? 0) >= orgSettings.batchLimit) {
          // #region agent log
          dbg("H2", "batch_limit", { count: count ?? 0, limit: orgSettings.batchLimit });
          // #endregion
          console.error("useBatches: batchLimit erreicht");
          return null;
        }
      }
      const plan = await planBatchInvoicesFromFiles(files, 0);
      if (plan.length === 0) {
        // #region agent log
        dbg("H3", "empty_plan", { fileCount: files.length });
        // #endregion
        return null;
      }
      const normalized = normalizeFallKeys(
        fallKeys && fallKeys.length === plan.length ? fallKeys : suggestFallKeysFromPlan(plan),
      );
      const fallSlotCount = new Set(normalized).size;
      const fallRows = [];
      for (let key = 0; key < fallSlotCount; key++) {
        const firstIdx = normalized.indexOf(key);
        fallRows.push({
          sort_order: key,
          label: patLabelFromText(plan[firstIdx].rohText, firstIdx),
        });
      }

      const leerZus = {
        gesamtbetrag: 0,
        geprueft: 0,
        mitHinweisen: 0,
        mitFehlern: 0,
        offen: 0,
        optimierungspotenzial: 0,
      };

      const { data: batchRow, error: bErr } = await supabase
        .from("batches")
        .insert({
          user_id: user.id,
          organisation_id: orgId,
          name,
          rechnungen_count: plan.length,
          faelle_count: fallSlotCount,
          verarbeitet_count: 0,
          status: "processing",
          zusammenfassung: leerZus,
        })
        .select()
        .single();

      if (bErr || !batchRow) {
        // #region agent log
        dbg("H4", "batches_insert", {
          code: bErr?.code,
          message: bErr?.message,
          details: bErr?.details,
          hasRow: Boolean(batchRow),
        });
        // #endregion
        console.error(bErr);
        return null;
      }

      const batchId = (batchRow as BatchRowDb).id;

      const fallRowsWithBatch = fallRows.map((fr) => ({ ...fr, batch_id: batchId }));
      const { data: insertedFalls, error: fErr } = await supabase
        .from("batch_faelle")
        .insert(fallRowsWithBatch)
        .select("id, sort_order");
      if (fErr || !insertedFalls?.length) {
        // #region agent log
        dbg("H5", "batch_faelle_insert", {
          code: fErr?.code,
          message: fErr?.message,
          details: fErr?.details,
          fallCount: fallRowsWithBatch.length,
        });
        // #endregion
        console.error(fErr);
        await supabase.from("batches").delete().eq("id", batchId);
        return null;
      }
      const idBySort = new Map(
        (insertedFalls as { id: string; sort_order: number }[]).map((x) => [x.sort_order, x.id]),
      );

      const storagePaths = files.map((f, i) => batchSourceObjectPath(user.id, batchId, i, f));
      try {
        await uploadFilesToJobUploads(storagePaths, files);
      } catch (e) {
        // #region agent log
        dbg("H6", "storage_upload", {
          errName: e instanceof Error ? e.name : "unknown",
          errMessage: e instanceof Error ? e.message : String(e),
        });
        // #endregion
        console.error("batch upload", e);
        await supabase.from("batches").delete().eq("id", batchId);
        return null;
      }

      const rechnungInserts = plan.map((p, idx) => ({
        batch_id: batchId,
        fall_id: idBySort.get(normalized[idx])!,
        sort_order: p.sortOrder,
        patient_id_label: patLabelFromText(p.rohText, idx),
        betrag_euro: betragGrobAusText(p.rohText),
        liste_status: "offen",
        hinweise_kurz: "—",
        fachbereich: null,
        detail_json: {
          positionen: [],
          gesamt: 0,
          metadata: {
            rohText: p.rohText,
            fileName: p.fileName,
            quelle: p.quelle,
            storage_path: storagePaths[p.sourceFileIndex],
            pending: true,
          },
        } as unknown as Json,
      }));

      const { error: rErr } = await supabase.from("batch_rechnungen").insert(rechnungInserts);
      if (rErr) {
        // #region agent log
        dbg("H7", "batch_rechnungen_insert", {
          code: rErr?.code,
          message: rErr?.message,
          details: rErr?.details,
          rechnungCount: rechnungInserts.length,
        });
        // #endregion
        console.error(rErr);
        await supabase.storage.from("job-uploads").remove(storagePaths);
        await supabase.from("batches").delete().eq("id", batchId);
        return null;
      }

      // #region agent log
      dbg("H0", "create_batch_ok", { rechnungCount: rechnungInserts.length });
      // #endregion
      void runBatchVerarbeitung(batchId, rechnungInserts.length)
        .then(() => void refresh())
        .catch((e) => console.error("runBatchVerarbeitung", e));

      await refresh();
      return batchId;
    },
    [user, organisationId, canWriteBatches, refresh],
  );

  return {
    list,
    loading: loading || orgLoading,
    refresh,
    deleteBatch,
    createBatchFromFiles,
    canWriteBatches,
    organisationId,
  };
}

export async function fetchBatchRechnungen(batchId: string): Promise<BatchRechnungRow[]> {
  const { data, error } = await supabase
    .from("batch_rechnungen")
    .select("*")
    .eq("batch_id", batchId)
    .order("sort_order", { ascending: true });
  if (error) {
    console.error(error);
    return [];
  }
  return (data as RechnungRowDb[]).map(rowToRechnung);
}

export async function fetchBatchFaelle(batchId: string): Promise<BatchFall[]> {
  const { data, error } = await supabase
    .from("batch_faelle")
    .select("*")
    .eq("batch_id", batchId)
    .order("sort_order", { ascending: true });
  if (error) {
    console.error(error);
    return [];
  }
  return (data as BatchFallRowDb[]).map((f) => ({
    id: f.id,
    batchId: f.batch_id,
    sortOrder: f.sort_order,
    label: f.label,
  }));
}

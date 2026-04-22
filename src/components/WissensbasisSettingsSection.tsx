import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useOrganisation } from "@/hooks/useOrganisation";
import { orgSettingsEffective, parseOrganisationSettings } from "@/lib/organisationSettings";
import { Button } from "@/components/ui/button";
import type { KommentarQuelle } from "@/lib/knowledge/spec05Types";
import { consumeAdminContextUploadStream } from "@/lib/admin-context-upload-stream";
import { Upload, Loader2, Trash2, BookOpen } from "lucide-react";

const UPLOAD_TIMEOUT_MS = 180_000;

const KOMMENTAR_QUELLEN: { quelle: KommentarQuelle; label: string }[] = [
  { quelle: "brueck", label: "Brück: GOÄ-Kommentar" },
  { quelle: "hoffmann", label: "Hoffmann: GOÄ-Kommentar" },
  { quelle: "lang_schaefer", label: "Lang/Schäfer: GOÄ-Kommentar" },
];

type FileRow = {
  id: string;
  quelle: KommentarQuelle;
  filename: string;
  created_at: string;
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

type Props = {
  user: User;
  extractPdfText: (file: File) => Promise<string>;
};

export function WissensbasisSettingsSection({ user, extractPdfText }: Props) {
  const { toast } = useToast();
  const { organisationId: orgId, loading: orgLoading, canWriteWissensbasis } = useOrganisation();
  const [customWissensbasisEnabled, setCustomWissensbasisEnabled] = useState(true);
  const [rows, setRows] = useState<Partial<Record<KommentarQuelle, FileRow>>>({});
  const [loading, setLoading] = useState(true);
  const [uploadingQuelle, setUploadingQuelle] = useState<KommentarQuelle | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingQuelle = useRef<KommentarQuelle | null>(null);

  const refresh = useCallback(async () => {
    if (!orgId) {
      setRows({});
      setCustomWissensbasisEnabled(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data: orgRow } = await supabase
      .from("organisations")
      .select("settings")
      .eq("id", orgId)
      .maybeSingle();
    const eff = orgSettingsEffective(parseOrganisationSettings(orgRow?.settings));
    setCustomWissensbasisEnabled(eff.customWissensbasis);
    const { data, error } = await supabase
      .from("organisation_kommentar_files")
      .select("id, quelle, filename, created_at")
      .eq("organisation_id", orgId);
    if (error) {
      console.error(error);
      setRows({});
    } else {
      const next: Partial<Record<KommentarQuelle, FileRow>> = {};
      for (const r of data ?? []) {
        const q = r.quelle as KommentarQuelle;
        if (q === "brueck" || q === "hoffmann" || q === "lang_schaefer") {
          next[q] = { id: r.id, quelle: q, filename: r.filename, created_at: r.created_at };
        }
      }
      setRows(next);
    }
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    if (!orgLoading) void refresh();
  }, [refresh, orgLoading]);

  const canMutateLiterature = canWriteWissensbasis && customWissensbasisEnabled;

  const onPickQuelle = (quelle: KommentarQuelle) => {
    if (!canWriteWissensbasis) {
      toast({
        title: "Keine Berechtigung",
        description: "Nur Organisations-Admin oder Manager können Dateien hochladen.",
        variant: "destructive",
      });
      return;
    }
    if (!customWissensbasisEnabled) {
      toast({
        title: "Eigene Wissensbasis deaktiviert",
        description:
          'In den Organisationseinstellungen muss "Eigene / lizenzierte Wissensbasis" aktiviert sein (Spec 13.1).',
        variant: "destructive",
      });
      return;
    }
    pendingQuelle.current = quelle;
    inputRef.current?.click();
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const quelle = pendingQuelle.current;
    e.target.value = "";
    pendingQuelle.current = null;
    if (!file || !quelle) return;
    if (!canMutateLiterature) {
      toast({ title: "Keine Berechtigung", variant: "destructive" });
      return;
    }

    setUploadingQuelle(quelle);
    try {
      const isPdf = file.name.toLowerCase().endsWith(".pdf");
      const text = isPdf ? await extractPdfText(file) : await file.text();
      if (!text.trim()) {
        toast({ title: "Fehler", description: "Datei enthält keinen Text.", variant: "destructive" });
        return;
      }

      const body: {
        quelle: KommentarQuelle;
        filename: string;
        content_text: string;
        file_base64?: string;
      } = {
        quelle,
        filename: file.name,
        content_text: text,
      };
      if (isPdf) {
        body.file_base64 = await fileToBase64(file);
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
      if (!token) throw new Error("Nicht angemeldet");
      if (!supabaseUrl || !anonKey) throw new Error("Supabase ist nicht konfiguriert");

      const url = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/organisation-kommentar-upload`;
      const ac = new AbortController();
      const to = window.setTimeout(() => ac.abort(), UPLOAD_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            apikey: anonKey,
          },
          body: JSON.stringify(body),
          signal: ac.signal,
        });
      } finally {
        window.clearTimeout(to);
      }

      const result = await consumeAdminContextUploadStream(res, () => {});
      if (result.ok === false) {
        throw new Error(result.message);
      }

      toast({ title: "Gespeichert", description: "Kommentar wurde indexiert und steht in der Analyse zur Verfügung." });
      await refresh();
    } catch (err) {
      toast({
        title: "Upload fehlgeschlagen",
        description: err instanceof Error ? err.message : "Unbekannter Fehler",
        variant: "destructive",
      });
    } finally {
      setUploadingQuelle(null);
    }
  };

  const onDelete = async (id: string) => {
    if (!canMutateLiterature) {
      toast({ title: "Keine Berechtigung", variant: "destructive" });
      return;
    }
    setDeletingId(id);
    try {
      const { error } = await supabase.from("organisation_kommentar_files").delete().eq("id", id);
      if (error) throw error;
      toast({ title: "Entfernt", description: "Die Datei wurde aus der Wissensbasis entfernt." });
      await refresh();
    } catch (err) {
      toast({
        title: "Löschen fehlgeschlagen",
        description: err instanceof Error ? err.message : "Unbekannter Fehler",
        variant: "destructive",
      });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-10">
      <p className="text-sm text-foreground">Empfohlene Quellen für bessere Analyseergebnisse:</p>

      <section className="p-6 rounded-xl border border-border bg-card/50 shadow-sm space-y-5">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-accent" />
          Wissensbasis
        </h3>

        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.txt,.md,.csv,application/pdf,text/plain,text/markdown"
          className="hidden"
          onChange={onFileChange}
        />

        {orgLoading || loading ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Laden…
          </p>
        ) : !orgId ? (
          <p className="text-sm text-muted-foreground">Keine Organisation zugeordnet.</p>
        ) : (
          <>
            {!customWissensbasisEnabled ? (
              <p className="text-sm text-muted-foreground max-w-prose border border-dashed border-border rounded-md p-3 bg-muted/30">
                Eigene / lizenzierte Kommentarliteratur ist in den Organisationseinstellungen deaktiviert. Ein
                Organisations-Admin kann die Option dort aktivieren (Spec 13.1).
              </p>
            ) : null}
            <ul className="space-y-4">
            {KOMMENTAR_QUELLEN.map(({ quelle, label }) => {
              const row = rows[quelle];
              const busy = uploadingQuelle === quelle;
              return (
                <li
                  key={quelle}
                  className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border border-border/60 rounded-lg p-3 bg-muted/20"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Status:{" "}
                      {row
                        ? `${row.filename} · ${new Date(row.created_at).toLocaleDateString("de-DE")}`
                        : "Nicht vorhanden"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      disabled={busy || !!deletingId || !canMutateLiterature}
                      onClick={() => onPickQuelle(quelle)}
                    >
                      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                      Datei hochladen
                    </Button>
                    {row && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        disabled={deletingId === row.id || busy || !canMutateLiterature}
                        onClick={() => onDelete(row.id)}
                        title="Entfernen"
                      >
                        {deletingId === row.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4 text-destructive" />
                        )}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
            </ul>
          </>
        )}

        <p className="text-xs text-muted-foreground border-t border-border pt-4">
          Hochgeladene Dateien werden für Ihre Organisation verfügbar gemacht und über Chunking verarbeitet.
        </p>
      </section>
    </div>
  );
}

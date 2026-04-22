import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, Upload, Trash2, KeyRound, Mail, FileDown, Info } from "lucide-react";
import { buildUserDataExportJson } from "@/lib/compliance/exportUserData";
import { downloadTextFile } from "@/lib/export";
import { cn } from "@/lib/utils";

function getInitials(email: string | undefined, name: string | undefined): string {
  if (name?.trim()) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }
  if (!email) return "?";
  const part = email.split("@")[0];
  if (part.length >= 2) return part.slice(0, 2).toUpperCase();
  return part.slice(0, 1).toUpperCase();
}

function hasEmailPasswordIdentity(user: User): boolean {
  return (user.identities ?? []).some((i) => i.provider === "email");
}

const getRedirectUrl = () => {
  const url = window.location.origin;
  return url.endsWith("/") ? url.slice(0, -1) : url;
};

const ProfileContent = () => {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(undefined);
  const [savingName, setSavingName] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [resetSending, setResetSending] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [exportingData, setExportingData] = useState(false);

  const syncFromUser = useCallback(() => {
    if (!user) return;
    const meta = user.user_metadata ?? {};
    const name =
      (meta.full_name as string | undefined) ||
      (meta.display_name as string | undefined) ||
      (meta.name as string | undefined) ||
      "";
    setDisplayName(name);
    setAvatarUrl(meta.avatar_url as string | undefined);
  }, [user]);

  useEffect(() => {
    syncFromUser();
  }, [syncFromUser]);

  const emailAuth = user ? hasEmailPasswordIdentity(user) : false;

  const handleSaveName = async () => {
    if (!user) return;
    setSavingName(true);
    try {
      const { error } = await supabase.auth.updateUser({
        data: {
          full_name: displayName.trim(),
          display_name: displayName.trim(),
        },
      });
      if (error) throw error;
      toast({ title: "Gespeichert", description: "Ihr Name wurde aktualisiert." });
    } catch (e: unknown) {
      toast({
        title: "Fehler",
        description: e instanceof Error ? e.message : "Speichern fehlgeschlagen.",
        variant: "destructive",
      });
    } finally {
      setSavingName(false);
    }
  };

  const handleAvatarPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !user) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Ungültige Datei", description: "Bitte ein Bild (JPEG, PNG, WebP, GIF) wählen.", variant: "destructive" });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "Datei zu groß", description: "Maximal 5 MB.", variant: "destructive" });
      return;
    }

    setUploadingAvatar(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const safeExt = ["jpg", "jpeg", "png", "webp", "gif"].includes(ext) ? ext : "jpg";
      const path = `${user.id}/avatar.${safeExt}`;

      const { error: upErr } = await supabase.storage.from("avatars").upload(path, file, {
        upsert: true,
        contentType: file.type,
      });
      if (upErr) throw upErr;

      const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
      const publicUrl = `${pub.publicUrl}?t=${Date.now()}`;

      const { error: metaErr } = await supabase.auth.updateUser({
        data: { avatar_url: publicUrl },
      });
      if (metaErr) throw metaErr;

      setAvatarUrl(publicUrl);
      toast({ title: "Profilbild aktualisiert" });
    } catch (e: unknown) {
      toast({
        title: "Upload fehlgeschlagen",
        description: e instanceof Error ? e.message : "Bitte später erneut versuchen.",
        variant: "destructive",
      });
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleRemoveAvatar = async () => {
    if (!user) return;
    setUploadingAvatar(true);
    try {
      const { error } = await supabase.auth.updateUser({
        data: { avatar_url: "" },
      });
      if (error) throw error;
      setAvatarUrl(undefined);
      toast({ title: "Profilbild entfernt" });
    } catch (e: unknown) {
      toast({
        title: "Fehler",
        description: e instanceof Error ? e.message : "Konnte nicht entfernen.",
        variant: "destructive",
      });
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !emailAuth) return;
    if (newPassword.length < 6) {
      toast({ title: "Passwort zu kurz", description: "Mindestens 6 Zeichen.", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "Passwörter stimmen nicht überein", variant: "destructive" });
      return;
    }
    setSavingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setNewPassword("");
      setConfirmPassword("");
      toast({ title: "Passwort geändert" });
    } catch (e: unknown) {
      toast({
        title: "Fehler",
        description: e instanceof Error ? e.message : "Passwort konnte nicht geändert werden.",
        variant: "destructive",
      });
    } finally {
      setSavingPassword(false);
    }
  };

  const handleRequestResetEmail = async () => {
    if (!user?.email || !emailAuth) return;
    setResetSending(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
        redirectTo: `${getRedirectUrl()}/auth`,
      });
      if (error) throw error;
      toast({
        title: "E-Mail unterwegs",
        description: "Falls ein Konto existiert, erhalten Sie einen Link zum Zurücksetzen.",
      });
    } catch (e: unknown) {
      toast({
        title: "Fehler",
        description: e instanceof Error ? e.message : "Anforderung fehlgeschlagen.",
        variant: "destructive",
      });
    } finally {
      setResetSending(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirm !== "LÖSCHEN") return;
    setDeleting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Nicht angemeldet");

      const base = import.meta.env.VITE_SUPABASE_URL as string;
      const anon = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
      const res = await fetch(`${base}/functions/v1/delete-account`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: anon,
        },
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Löschen fehlgeschlagen");

      await signOut();
      toast({ title: "Konto gelöscht", description: "Auf Wiedersehen." });
      navigate("/auth", { replace: true });
    } catch (e: unknown) {
      toast({
        title: "Löschen fehlgeschlagen",
        description: e instanceof Error ? e.message : "Bitte Support kontaktieren.",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
      setDeleteConfirm("");
    }
  };

  const handleExportData = async () => {
    if (!user) return;
    setExportingData(true);
    try {
      const payload = await buildUserDataExportJson(supabase, user.id, user.email ?? null);
      const safe = (user.email ?? "export").replace(/[^a-zA-Z0-9@._-]+/g, "_");
      downloadTextFile(
        `docbill-datenexport-${safe}-${new Date().toISOString().slice(0, 10)}.json`,
        JSON.stringify(payload, null, 2),
        "application/json;charset=utf-8",
      );
      if (payload.exportErrors?.length) {
        toast({
          title: "Export erstellt",
          description: "Teilinhalte fehlten (siehe exportErrors in der Datei).",
          variant: "destructive",
        });
      } else {
        toast({ title: "Export erstellt", description: "JSON-Datei wurde heruntergeladen." });
      }
    } catch (e: unknown) {
      toast({
        title: "Export fehlgeschlagen",
        description: e instanceof Error ? e.message : "Bitte erneut versuchen.",
        variant: "destructive",
      });
    } finally {
      setExportingData(false);
    }
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center py-24">
        <p className="text-muted-foreground">Nicht angemeldet.</p>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 pt-6 pb-20 space-y-10">
      <p className="text-sm text-muted-foreground">
        Profil, Sicherheit und Konto-Verwaltung.
      </p>

      <section className="p-6 rounded-xl border border-border bg-card/50 shadow-sm space-y-4">
        <h2 className="text-sm font-semibold text-foreground">Profilbild</h2>
        <div className="flex flex-wrap items-center gap-4">
          <Avatar className="h-20 w-20">
            <AvatarImage src={avatarUrl} alt="" />
            <AvatarFallback className="text-lg">{getInitials(user.email, displayName)}</AvatarFallback>
          </Avatar>
          <div className="flex flex-wrap gap-2">
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={handleAvatarPick} />
            <Button type="button" variant="outline" size="sm" disabled={uploadingAvatar} onClick={() => fileRef.current?.click()}>
              {uploadingAvatar ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
              Hochladen
            </Button>
            {avatarUrl ? (
              <Button type="button" variant="ghost" size="sm" disabled={uploadingAvatar} onClick={() => void handleRemoveAvatar()}>
                <Trash2 className="h-4 w-4 mr-2" />
                Entfernen
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      <section className="p-6 rounded-xl border border-border bg-card/50 shadow-sm space-y-4">
        <h2 className="text-sm font-semibold text-foreground">Name</h2>
        <div className="space-y-2">
          <Label htmlFor="display-name">Anzeigename</Label>
          <Input
            id="display-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Vor- und Nachname"
            autoComplete="name"
          />
        </div>
        <Button type="button" onClick={() => void handleSaveName()} disabled={savingName}>
          {savingName ? <Loader2 className="h-4 w-4 animate-spin" /> : "Speichern"}
        </Button>
      </section>

      <section className="p-6 rounded-xl border border-border bg-card/50 shadow-sm space-y-4">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Mail className="h-4 w-4" />
          E-Mail
        </h2>
        <p className="text-sm text-muted-foreground break-all">{user.email}</p>
        <p className="text-xs text-muted-foreground">Die E-Mail-Adresse kann hier nicht geändert werden.</p>
      </section>

      {emailAuth ? (
        <section className="p-6 rounded-xl border border-border bg-card/50 shadow-sm space-y-4">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <KeyRound className="h-4 w-4" />
            Passwort
          </h2>
          <form onSubmit={handleChangePassword} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="new-pw">Neues Passwort</Label>
              <Input
                id="new-pw"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={6}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-pw">Bestätigen</Label>
              <Input
                id="confirm-pw"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                minLength={6}
              />
            </div>
            <Button type="submit" disabled={savingPassword}>
              {savingPassword ? <Loader2 className="h-4 w-4 animate-spin" /> : "Passwort ändern"}
            </Button>
          </form>
          <div className="pt-2 border-t border-border">
            <p className="text-xs text-muted-foreground mb-2">
              Link per E-Mail, falls Sie sich nicht mehr an Ihr Passwort erinnern.
            </p>
            <Button type="button" variant="outline" size="sm" disabled={resetSending} onClick={() => void handleRequestResetEmail()}>
              {resetSending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Zurücksetzen per E-Mail anfordern"}
            </Button>
          </div>
        </section>
      ) : (
        <section className="p-6 rounded-xl border border-border bg-card/50 shadow-sm space-y-2">
          <h2 className="text-sm font-semibold text-foreground">Passwort</h2>
          <p className="text-sm text-muted-foreground">
            Sie sind über einen Anbieter (z. B. Google) angemeldet. Passwort und Zurücksetzen per E-Mail gelten nur für klassische E-Mail-Anmeldung.
          </p>
        </section>
      )}

      <section className="p-6 rounded-xl border border-border bg-card/50 shadow-sm space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Datenexport (Auskunft)</h2>
        <p className="text-sm text-muted-foreground">
          Nach DSGVO Art. 15 können Sie eine Kopie Ihrer in DocBill gespeicherten Nutzerdaten herunterladen.
        </p>
        <Button type="button" variant="outline" className="gap-2" disabled={exportingData} onClick={() => void handleExportData()}>
          {exportingData ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
          Alle Daten als JSON
        </Button>
      </section>

      <section className="p-6 rounded-xl border border-border/80 bg-muted/15 space-y-3">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Info className="h-4 w-4 shrink-0" />
          Leistungsumfang (v1.3)
        </h2>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Folgendes liegt bewusst nicht in DocBill (Produktversion 1.3):
        </p>
        <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-1.5">
          <li>Rechtliche Beratung oder Haftungsübernahme</li>
          <li>Schnittstelle zu PKV-Systemen für automatische Einreichung</li>
          <li>KI-basierte Diagnoseunterstützung</li>
          <li>Tiefe PVS-Integration (außer PAD-Import/Export)</li>
          <li>Mehrsprachigkeit (nur Deutsch)</li>
          <li>Stationäre Abrechnung (DRG/PEPP)</li>
        </ul>
      </section>

      <section className="p-6 rounded-xl border border-destructive/40 bg-destructive/5 space-y-4">
        <h2 className="text-sm font-semibold text-destructive">Konto löschen</h2>
        <p className="text-sm text-muted-foreground">
          Gemäß DSGVO Art. 17 können Sie die Löschung Ihrer in DocBill gespeicherten Daten verlangen. Ihr Konto und die
          zugehörigen Inhalte werden dabei unwiderruflich entfernt.
        </p>
        <Button type="button" variant="destructive" onClick={() => setDeleteOpen(true)}>
          Konto löschen…
        </Button>
      </section>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Konto wirklich löschen?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <span className="block">Diese Aktion kann nicht rückgängig gemacht werden.</span>
              <span className="block text-foreground font-medium">Geben Sie zur Bestätigung LÖSCHEN ein:</span>
              <Input value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} placeholder="LÖSCHEN" autoComplete="off" />
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              className={cn("bg-destructive text-destructive-foreground hover:bg-destructive/90")}
              disabled={deleting || deleteConfirm !== "LÖSCHEN"}
              onClick={(e) => {
                e.preventDefault();
                void handleDeleteAccount();
              }}
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Endgültig löschen"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ProfileContent;

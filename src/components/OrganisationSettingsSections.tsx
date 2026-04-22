import { useCallback, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useOrganisation, type OrgMemberRole } from "@/hooks/useOrganisation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Copy, Trash2 } from "lucide-react";
import type { Json } from "@/integrations/supabase/types";
import {
  orgSettingsEffective,
  parseOrganisationSettings,
  type DatenschutzModus,
  type OrganisationSettingsPayload,
} from "@/lib/organisationSettings";

type MemberRow = { user_id: string; role: string; email: string; created_at: string };

type InviteRow = {
  id: string;
  email: string;
  role: string;
  token: string;
  expires_at: string;
  created_at: string;
};

type Props = {
  user: User;
};

function settingsToJson(s: OrganisationSettingsPayload): Json {
  return {
    ...(s.defaultRegelwerk != null ? { defaultRegelwerk: s.defaultRegelwerk } : {}),
    ...(s.defaultFachgebiet !== undefined ? { defaultFachgebiet: s.defaultFachgebiet } : {}),
    ...(s.customWissensbasis !== undefined ? { customWissensbasis: s.customWissensbasis } : {}),
    ...(s.batchLimit !== undefined ? { batchLimit: s.batchLimit } : {}),
    ...(s.datenschutzModus != null ? { datenschutzModus: s.datenschutzModus } : {}),
  } as Json;
}

export function OrganisationSettingsSections({ user }: Props) {
  const { toast } = useToast();
  const { organisationId, isAdmin, loading: orgLoading, refresh: refreshOrg } = useOrganisation();
  const [orgName, setOrgName] = useState("");
  const [regelwerk, setRegelwerk] = useState<"GOAE" | "EBM">("GOAE");
  const [defaultFachgebietStr, setDefaultFachgebietStr] = useState("");
  const [customWissensbasis, setCustomWissensbasis] = useState(true);
  const [datenschutzModus, setDatenschutzModus] = useState<DatenschutzModus>("standard");
  const [batchLimitStr, setBatchLimitStr] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const loadOrg = useCallback(async () => {
    if (!organisationId) {
      setLoaded(true);
      return;
    }
    const { data, error } = await supabase
      .from("organisations")
      .select("name, settings")
      .eq("id", organisationId)
      .maybeSingle();
    if (error) {
      console.error(error);
    } else if (data) {
      setOrgName(data.name);
      const s = orgSettingsEffective(parseOrganisationSettings(data.settings));
      setRegelwerk(s.defaultRegelwerk);
      setDefaultFachgebietStr(s.defaultFachgebiet ?? "");
      setCustomWissensbasis(s.customWissensbasis);
      setDatenschutzModus(s.datenschutzModus);
      if (s.batchLimit === null) setBatchLimitStr("");
      else if (typeof s.batchLimit === "number") setBatchLimitStr(String(s.batchLimit));
    }
    setLoaded(true);
  }, [organisationId]);

  useEffect(() => {
    if (!orgLoading) void loadOrg();
  }, [orgLoading, loadOrg]);

  const saveProfile = async () => {
    if (!organisationId || !isAdmin) return;
    setSavingProfile(true);
    const batchLimit =
      batchLimitStr.trim() === "" ? null : Math.max(0, Math.floor(Number(batchLimitStr) || 0));
    const settings = settingsToJson({
      defaultRegelwerk: regelwerk,
      defaultFachgebiet: defaultFachgebietStr.trim() === "" ? null : defaultFachgebietStr.trim(),
      customWissensbasis,
      datenschutzModus,
      batchLimit: batchLimitStr.trim() === "" ? null : batchLimit,
    });
    const { error } = await supabase
      .from("organisations")
      .update({
        name: orgName.trim() || "Praxis",
        settings,
        updated_at: new Date().toISOString(),
      })
      .eq("id", organisationId);
    setSavingProfile(false);
    if (error) {
      toast({ title: "Speichern fehlgeschlagen", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Gespeichert" });
    void refreshOrg();
  };

  if (orgLoading || !loaded) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground p-6">
        <Loader2 className="w-4 h-4 animate-spin" />
        Organisation wird geladen…
      </div>
    );
  }

  if (!organisationId) {
    return <p className="text-sm text-muted-foreground p-6">Keine Organisation zugeordnet.</p>;
  }

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-10">
      <section className="p-6 rounded-xl border border-border bg-card/50 shadow-sm space-y-4">
        <h2 className="text-sm font-semibold text-foreground">Organisation</h2>
        <p className="text-xs text-muted-foreground">
          Nur Admins ändern den Namen und Voreinstellungen (Spec 13.1: Regelwerk, Fachgebiet, Datenschutz,
          Kommentar-Literatur, Stapel-Limit).
        </p>
        <div className="space-y-2 max-w-md">
          <Label htmlFor="org-name">Name der Organisation</Label>
          <Input
            id="org-name"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            disabled={!isAdmin}
            className="mt-0.5"
          />
        </div>
        <div className="space-y-2 max-w-xs">
          <Label>Standard-Regelwerk (Voreinstellung)</Label>
          <Select
            value={regelwerk}
            onValueChange={(v) => setRegelwerk(v as "GOAE" | "EBM")}
            disabled={!isAdmin}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="GOAE">GOÄ</SelectItem>
              <SelectItem value="EBM">EBM</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2 max-w-md">
          <Label htmlFor="org-default-fach">Standard-Fachgebiet (optional)</Label>
          <Input
            id="org-default-fach"
            value={defaultFachgebietStr}
            onChange={(e) => setDefaultFachgebietStr(e.target.value)}
            disabled={!isAdmin}
            placeholder="z. B. Allgemeinmedizin"
            className="mt-0.5"
          />
        </div>
        <div className="flex items-start gap-2 max-w-lg">
          <Checkbox
            id="org-custom-wissensbasis"
            checked={customWissensbasis}
            onCheckedChange={(c) => setCustomWissensbasis(c === true)}
            disabled={!isAdmin}
            className="mt-0.5"
          />
          <div className="space-y-0.5">
            <Label htmlFor="org-custom-wissensbasis" className="font-normal leading-snug">
              Eigene / lizenzierte Wissensbasis (Kommentarliteratur) nutzen
            </Label>
            <p className="text-xs text-muted-foreground">
              Wenn deaktiviert, sind die Uploads in den Wissenseinstellungen gesperrt.
            </p>
          </div>
        </div>
        <div className="space-y-2 max-w-xs">
          <Label>Datenschutz-Modus</Label>
          <Select
            value={datenschutzModus}
            onValueChange={(v) => setDatenschutzModus(v as DatenschutzModus)}
            disabled={!isAdmin}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="standard">Standard</SelectItem>
              <SelectItem value="streng">Streng</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2 max-w-xs">
          <Label htmlFor="batch-limit">Max. Stapel (leer = unbegrenzt)</Label>
          <Input
            id="batch-limit"
            inputMode="numeric"
            placeholder="z. B. 50"
            value={batchLimitStr}
            onChange={(e) => setBatchLimitStr(e.target.value.replace(/\D/g, ""))}
            disabled={!isAdmin}
            className="mt-0.5"
          />
        </div>
        {isAdmin ? (
          <Button type="button" onClick={() => void saveProfile()} disabled={savingProfile}>
            {savingProfile ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Speichern
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">Nur Admins bearbeiten Organisationseinstellungen.</p>
        )}
      </section>

      <OrganisationTeamPanel user={user} organisationId={organisationId} isAdmin={isAdmin} />
    </div>
  );
}

function OrganisationTeamPanel({
  user,
  organisationId,
  isAdmin,
}: {
  user: User;
  organisationId: string;
  isAdmin: boolean;
}) {
  const { toast } = useToast();
  const { refresh: refreshOrg } = useOrganisation();
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<OrgMemberRole>("viewer");
  const [sending, setSending] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data: dir, error: dErr } = await supabase.rpc("list_organisation_member_directory");
    if (dErr) {
      console.error(dErr);
      setMembers([]);
    } else {
      setMembers((dir ?? []) as MemberRow[]);
    }
    const { data: inv, error: iErr } = await supabase
      .from("organisation_invites")
      .select("id, email, role, token, expires_at, created_at")
      .eq("organisation_id", organisationId)
      .is("accepted_at", null)
      .order("created_at", { ascending: false });
    if (iErr) {
      console.error(iErr);
      setInvites([]);
    } else {
      setInvites((inv ?? []) as InviteRow[]);
    }
    setLoading(false);
  }, [organisationId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const sendInvite = async () => {
    const em = inviteEmail.trim().toLowerCase();
    if (!em || !em.includes("@")) {
      toast({ title: "E-Mail prüfen", variant: "destructive" });
      return;
    }
    setSending(true);
    const token = crypto.randomUUID();
    const expires = new Date();
    expires.setDate(expires.getDate() + 14);
    const { error } = await supabase.from("organisation_invites").insert({
      organisation_id: organisationId,
      email: em,
      role: inviteRole,
      token,
      expires_at: expires.toISOString(),
      invited_by: user.id,
    });
    setSending(false);
    if (error) {
      toast({ title: "Einladung fehlgeschlagen", description: error.message, variant: "destructive" });
      return;
    }
    setInviteEmail("");
    toast({ title: "Einladung erstellt", description: "Link kopieren und an die Person senden (E-Mail-Versand optional)." });
    void refresh();
    void refreshOrg();
  };

  const copyInviteLink = (token: string) => {
    const url = `${window.location.origin}/invite/${token}`;
    void navigator.clipboard.writeText(url);
    toast({ title: "Link kopiert" });
  };

  const removeInvite = async (id: string) => {
    const { error } = await supabase.from("organisation_invites").delete().eq("id", id);
    if (error) {
      toast({ title: "Nicht entfernt", description: error.message, variant: "destructive" });
      return;
    }
    void refresh();
  };

  return (
    <section className="p-6 rounded-xl border border-border bg-card/50 shadow-sm space-y-4">
      <h2 className="text-sm font-semibold text-foreground">Team</h2>
      <p className="text-xs text-muted-foreground">
        Mitglieder Ihrer Organisation. Einladungen sind Magic-Links: die Person muss mit derselben
        E-Mail-Adresse angemeldet sein. E-Mail-Versand (z. B. Resend) kann produktseitig angebunden
        werden; aktuell kopieren Sie den Link manuell.
      </p>
      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      ) : (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Mitglieder</p>
          <ul className="text-sm space-y-1.5">
            {members.map((m) => (
              <li key={m.user_id} className="flex flex-wrap justify-between gap-2 border-b border-border/50 pb-1">
                <span>{m.email}</span>
                <span className="text-muted-foreground tabular-nums">{m.role}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {isAdmin ? (
        <div className="space-y-3 pt-2 border-t border-border/60">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Einladen</p>
          <div className="flex flex-col sm:flex-row gap-2 sm:items-end max-w-xl">
            <div className="flex-1 space-y-1">
              <Label htmlFor="inv-email">E-Mail</Label>
              <Input
                id="inv-email"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="name@praxis.de"
                autoComplete="off"
              />
            </div>
            <div className="w-40 space-y-1">
              <Label>Rolle</Label>
              <Select
                value={inviteRole}
                onValueChange={(v) => setInviteRole(v as OrgMemberRole)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="viewer">Viewer</SelectItem>
                  <SelectItem value="manager">Manager</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="button" onClick={() => void sendInvite()} disabled={sending}>
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Einladung erstellen
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Nur Admins senden Einladungen.</p>
      )}

      {invites.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Offene Einladungen</p>
          <ul className="text-sm space-y-2">
            {invites.map((iv) => (
              <li
                key={iv.id}
                className="flex flex-col sm:flex-row sm:items-center gap-2 justify-between border border-border/60 rounded-lg p-2"
              >
                <div>
                  <p>{iv.email}</p>
                  <p className="text-xs text-muted-foreground">
                    Rolle {iv.role} · gültig bis {new Date(iv.expires_at).toLocaleDateString("de-DE")}
                  </p>
                </div>
                {isAdmin ? (
                  <div className="flex gap-1">
                    <Button type="button" variant="outline" size="sm" onClick={() => copyInviteLink(iv.token)}>
                      <Copy className="w-3.5 h-3.5 mr-1" />
                      Link
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() => void removeInvite(iv.id)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

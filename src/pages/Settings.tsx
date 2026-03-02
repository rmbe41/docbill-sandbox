import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Save, Globe, User, Cpu } from "lucide-react";
import { cn } from "@/lib/utils";

const AVAILABLE_MODELS = [
  { value: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash", desc: "Schnell & günstig" },
  { value: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro", desc: "Beste Qualität" },
  { value: "google/gemini-3-flash-preview", label: "Gemini 3 Flash", desc: "Neueste Generation" },
  { value: "google/gemini-3-pro-preview", label: "Gemini 3 Pro", desc: "Top-Tier neu" },
  { value: "openai/gpt-5", label: "GPT-5", desc: "Starke Reasoning" },
  { value: "openai/gpt-5-mini", label: "GPT-5 Mini", desc: "Ausgewogen" },
];

const Settings = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<"global" | "user">("user");
  const [globalModel, setGlobalModel] = useState("google/gemini-2.5-flash");
  const [globalRules, setGlobalRules] = useState("");
  const [userModel, setUserModel] = useState<string | null>(null);
  const [userRules, setUserRules] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      setLoading(true);
      // Load global settings
      const { data: gData } = await supabase
        .from("global_settings")
        .select("*")
        .limit(1)
        .single();
      if (gData) {
        setGlobalModel(gData.default_model);
        setGlobalRules(gData.default_rules);
      }
      // Load user settings
      const { data: uData } = await supabase
        .from("user_settings")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      if (uData) {
        setUserModel(uData.selected_model);
        setUserRules(uData.custom_rules);
      }
      setLoading(false);
    };
    load();
  }, [user]);

  const saveGlobal = async () => {
    setSaving(true);
    const { data: existing } = await supabase.from("global_settings").select("id").limit(1).single();
    if (existing) {
      await supabase.from("global_settings").update({
        default_model: globalModel,
        default_rules: globalRules,
        updated_at: new Date().toISOString(),
      }).eq("id", existing.id);
    }
    toast({ title: "Gespeichert", description: "Globale Einstellungen aktualisiert." });
    setSaving(false);
  };

  const saveUser = async () => {
    if (!user) return;
    setSaving(true);
    const { data: existing } = await supabase
      .from("user_settings")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (existing) {
      await supabase.from("user_settings").update({
        selected_model: userModel,
        custom_rules: userRules,
        updated_at: new Date().toISOString(),
      }).eq("id", existing.id);
    } else {
      await supabase.from("user_settings").insert({
        user_id: user.id,
        selected_model: userModel,
        custom_rules: userRules,
      });
    }
    toast({ title: "Gespeichert", description: "Ihre Einstellungen wurden aktualisiert." });
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Laden…</p>
      </div>
    );
  }

  const tabs = [
    { key: "user" as const, label: "Meine Einstellungen", icon: User },
    { key: "global" as const, label: "Globale Defaults", icon: Globe },
  ];

  const currentModel = activeTab === "global" ? globalModel : (userModel ?? "");
  const currentRules = activeTab === "global" ? globalRules : (userRules ?? "");
  const setModel = activeTab === "global" ? setGlobalModel : (v: string) => setUserModel(v || null);
  const setRules = activeTab === "global" ? setGlobalRules : (v: string) => setUserRules(v || null);
  const save = activeTab === "global" ? saveGlobal : saveUser;

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center gap-3 px-5 py-3 border-b bg-card">
        <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <h1 className="text-base font-semibold text-foreground">Einstellungen</h1>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Tabs */}
        <div className="flex gap-2">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                activeTab === t.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              )}
            >
              <t.icon className="w-4 h-4" />
              {t.label}
            </button>
          ))}
        </div>

        {activeTab === "user" && (
          <p className="text-sm text-muted-foreground">
            Ihre persönlichen Einstellungen überschreiben die globalen Defaults. Leer lassen = globaler Default wird verwendet.
          </p>
        )}

        {/* Model Selection */}
        <div className="space-y-3">
          <Label className="flex items-center gap-2 text-sm font-semibold">
            <Cpu className="w-4 h-4 text-accent" />
            KI-Modell
          </Label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {AVAILABLE_MODELS.map((m) => (
              <button
                key={m.value}
                onClick={() => setModel(m.value)}
                className={cn(
                  "flex flex-col text-left px-4 py-3 rounded-xl border transition-all",
                  currentModel === m.value
                    ? "border-accent bg-accent/5 ring-1 ring-accent"
                    : "border-border bg-card hover:border-muted-foreground/30"
                )}
              >
                <span className="text-sm font-medium text-foreground">{m.label}</span>
                <span className="text-xs text-muted-foreground">{m.desc}</span>
              </button>
            ))}
          </div>
          {activeTab === "user" && (
            <Button variant="ghost" size="sm" onClick={() => setUserModel(null)} className="text-xs">
              Zurücksetzen (Global verwenden)
            </Button>
          )}
        </div>

        {/* Rules / Guardrails */}
        <div className="space-y-3">
          <Label className="text-sm font-semibold">
            {activeTab === "global" ? "Globale Guardrails & Rules" : "Persönliche Rules (Optional)"}
          </Label>
          <Textarea
            value={currentRules}
            onChange={(e) => setRules(e.target.value)}
            placeholder={
              activeTab === "global"
                ? "z.B. Antworte immer auf Deutsch. Empfehle keine rechtswidrigen Praktiken."
                : "z.B. Fokussiere dich auf Retinologie. Verwende immer die höchstmöglichen Steigerungssätze."
            }
            rows={6}
            className="font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground">
            {activeTab === "global"
              ? "Diese Regeln gelten für alle Nutzer als Basis."
              : "Ihre Regeln werden zusätzlich zu den globalen Defaults angewendet."}
          </p>
        </div>

        <Button onClick={save} disabled={saving} className="gap-2">
          <Save className="w-4 h-4" />
          {saving ? "Speichern…" : "Speichern"}
        </Button>
      </div>
    </div>
  );
};

export default Settings;

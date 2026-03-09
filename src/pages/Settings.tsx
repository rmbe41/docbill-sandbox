import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ArrowLeft, Globe, User, Cpu, Type, Moon, Sun, Upload, Trash2, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

const DEBOUNCE_MS = 500;

const AVAILABLE_MODELS = [
  { value: "openrouter/free", label: "OpenRouter Free", desc: "Kostenlos – für Tests" },
  { value: "google/gemma-3n-e2b-it:free", label: "Gemma 3n 2B (Free)", desc: "Google kostenlos" },
  { value: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash", desc: "Schnell & günstig" },
  { value: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro", desc: "Beste Qualität" },
  { value: "google/gemini-3-flash-preview", label: "Gemini 3 Flash", desc: "Neueste Generation" },
  { value: "google/gemini-3-pro-preview", label: "Gemini 3 Pro", desc: "Top-Tier neu" },
  { value: "openai/gpt-5", label: "GPT-5", desc: "Starke Reasoning" },
  { value: "openai/gpt-5-mini", label: "GPT-5 Mini", desc: "Ausgewogen" },
];

type ContextFile = {
  id: string;
  filename: string;
  created_at: string;
};

const Settings = () => {
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<"user" | "display" | "global">("user");
  const [uiScale, setUiScale] = useState(() => {
    const saved = localStorage.getItem("ui-scale");
    return saved ? parseInt(saved, 10) : 100;
  });
  const [darkMode, setDarkMode] = useState(() => {
    return document.documentElement.classList.contains("dark");
  });
  const [globalModel, setGlobalModel] = useState("openrouter/free");
  const [globalRules, setGlobalRules] = useState("");
  const [userModel, setUserModel] = useState<string | null>(null);
  const [userRules, setUserRules] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const rulesDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [contextFiles, setContextFiles] = useState<ContextFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelRef = useRef("");

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    const load = async () => {
      setLoading(true);
      const { data: gData } = await supabase
        .from("global_settings")
        .select("*")
        .limit(1)
        .single();
      if (gData) {
        setGlobalModel(gData.default_model);
        setGlobalRules(gData.default_rules);
      }
      const { data: uData } = await supabase
        .from("user_settings")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      if (uData) {
        setUserModel(uData.selected_model);
        setUserRules(uData.custom_rules);
      }
      if (isAdmin) {
        const { data: files } = await supabase
          .from("admin_context_files")
          .select("id, filename, created_at")
          .order("created_at", { ascending: false });
        if (files) setContextFiles(files);
      }
      setLoading(false);
    };
    load();
  }, [user, isAdmin]);

  useEffect(() => () => {
    if (rulesDebounceRef.current) clearTimeout(rulesDebounceRef.current);
  }, []);

  const saveGlobal = useCallback(
    async (model?: string, rules?: string) => {
      const m = model ?? globalModel;
      const r = rules ?? globalRules;
      const { data: existing } = await supabase.from("global_settings").select("id").limit(1).single();
      if (existing) {
        const { error } = await supabase.from("global_settings").update({
          default_model: m,
          default_rules: r,
          updated_at: new Date().toISOString(),
        }).eq("id", existing.id);
        if (error) {
          toast({ title: "Fehler", description: "Nur Admins können globale Einstellungen ändern.", variant: "destructive" });
          return;
        }
      }
      toast({ title: "Gespeichert", description: "Globale Einstellungen aktualisiert." });
    },
    [globalModel, globalRules, toast]
  );

  const saveUser = useCallback(
    async (model?: string | null, rules?: string | null) => {
      if (!user) return;
      const m = model !== undefined ? model : userModel;
      const r = rules !== undefined ? rules : userRules;
      const { data: existing } = await supabase
        .from("user_settings")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (existing) {
        await supabase.from("user_settings").update({
          selected_model: m,
          custom_rules: r,
          updated_at: new Date().toISOString(),
        }).eq("id", existing.id);
      } else {
        await supabase.from("user_settings").insert({
          user_id: user.id,
          selected_model: m,
          custom_rules: r,
        });
      }
      toast({ title: "Gespeichert", description: "Ihre Einstellungen wurden aktualisiert." });
    },
    [user, userModel, userRules, toast]
  );

  const handleContextFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setUploading(true);

    try {
      const text = await file.text();
      const { error } = await supabase.from("admin_context_files").insert({
        filename: file.name,
        content_text: text,
        uploaded_by: user.id,
      });
      if (error) throw error;

      const { data: files } = await supabase
        .from("admin_context_files")
        .select("id, filename, created_at")
        .order("created_at", { ascending: false });
      if (files) setContextFiles(files);

      toast({ title: "Hochgeladen", description: `${file.name} wurde als Kontext hinzugefügt.` });
    } catch {
      toast({ title: "Fehler", description: "Upload fehlgeschlagen.", variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const deleteContextFile = async (id: string, filename: string) => {
    const { error } = await supabase.from("admin_context_files").delete().eq("id", id);
    if (error) {
      toast({ title: "Fehler", description: "Löschen fehlgeschlagen.", variant: "destructive" });
      return;
    }
    setContextFiles((prev) => prev.filter((f) => f.id !== id));
    toast({ title: "Gelöscht", description: `${filename} entfernt.` });
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
    { key: "display" as const, label: "Darstellung", icon: Type },
    ...(isAdmin ? [{ key: "global" as const, label: "Admin / Global", icon: Globe }] : []),
  ];

  const currentModel = activeTab === "global" ? globalModel : (userModel ?? "");
  const currentRules = activeTab === "global" ? globalRules : (userRules ?? "");
  modelRef.current = currentModel;

  const handleModelSelect = (value: string) => {
    if (activeTab === "global") {
      setGlobalModel(value);
      saveGlobal(value, globalRules);
    } else {
      setUserModel(value);
      saveUser(value, userRules);
    }
  };

  const handleRulesChange = (value: string) => {
    if (activeTab === "global") {
      setGlobalRules(value);
      if (rulesDebounceRef.current) clearTimeout(rulesDebounceRef.current);
      rulesDebounceRef.current = setTimeout(() => saveGlobal(modelRef.current, value), DEBOUNCE_MS);
    } else {
      setUserRules(value);
      if (rulesDebounceRef.current) clearTimeout(rulesDebounceRef.current);
      rulesDebounceRef.current = setTimeout(
        () => saveUser(modelRef.current === "" ? null : modelRef.current, value),
        DEBOUNCE_MS
      );
    }
  };

  const handleResetUserModel = () => {
    setUserModel(null);
    saveUser(null, userRules);
  };

  const handleDisplayChange = (msg: string) => {
    toast({ title: "Gespeichert", description: msg });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center gap-3 px-5 py-3 border-b bg-card">
        <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <h1 className="text-base font-semibold text-foreground">Einstellungen</h1>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        <div className="flex gap-2 flex-wrap">
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

        {activeTab === "display" && (
          <div className="space-y-6">
            <p className="text-sm text-muted-foreground">
              Passen Sie Darstellung und Erscheinungsbild an.
            </p>

            <div className="flex items-center justify-between p-4 rounded-xl border border-border bg-card">
              <div className="flex items-center gap-3">
                {darkMode ? <Moon className="w-5 h-5 text-accent" /> : <Sun className="w-5 h-5 text-accent" />}
                <div>
                  <p className="text-sm font-medium text-foreground">Dark Mode</p>
                  <p className="text-xs text-muted-foreground">Dunkles Erscheinungsbild aktivieren</p>
                </div>
              </div>
              <Switch
                checked={darkMode}
                onCheckedChange={(checked) => {
                  setDarkMode(checked);
                  if (checked) {
                    document.documentElement.classList.add("dark");
                    localStorage.setItem("theme", "dark");
                  } else {
                    document.documentElement.classList.remove("dark");
                    localStorage.setItem("theme", "light");
                  }
                  handleDisplayChange("Darstellung aktualisiert.");
                }}
              />
            </div>
            <div className="space-y-4">
              <Label className="flex items-center gap-2 text-sm font-semibold">
                <Type className="w-4 h-4 text-accent" />
                UI-Größe: {uiScale}%
              </Label>
              <Slider
                value={[uiScale]}
                onValueChange={(v) => {
                  const val = v[0];
                  setUiScale(val);
                  localStorage.setItem("ui-scale", String(val));
                  document.documentElement.style.fontSize = `${val}%`;
                }}
                onValueCommit={() => handleDisplayChange("Darstellung aktualisiert.")}
                min={75}
                max={150}
                step={5}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Klein (75%)</span>
                <span>Normal (100%)</span>
                <span>Groß (150%)</span>
              </div>
              <div className="mt-4 p-4 rounded-xl border border-border bg-card">
                <p className="text-sm font-medium mb-1">Vorschau</p>
                <p className="text-muted-foreground">So sieht Ihr Text bei {uiScale}% aus. Alle UI-Elemente skalieren entsprechend mit.</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setUiScale(100);
                  localStorage.setItem("ui-scale", "100");
                  document.documentElement.style.fontSize = "100%";
                  handleDisplayChange("Darstellung aktualisiert.");
                }}
              >
                Auf Standard zurücksetzen
              </Button>
            </div>
          </div>
        )}

        {(activeTab === "user" || activeTab === "global") && (
        <>
        <div className="space-y-3">
          <Label className="flex items-center gap-2 text-sm font-semibold">
            <Cpu className="w-4 h-4 text-accent" />
            KI-Modell
          </Label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {AVAILABLE_MODELS.map((m) => (
              <button
                key={m.value}
                onClick={() => handleModelSelect(m.value)}
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
            <Button variant="ghost" size="sm" onClick={handleResetUserModel} className="text-xs">
              Zurücksetzen (Global verwenden)
            </Button>
          )}
        </div>

        <div className="space-y-3">
          <Label className="text-sm font-semibold">
            {activeTab === "global" ? "Globale Guardrails & Rules" : "Persönliche Rules (Optional)"}
          </Label>
          <Textarea
            value={currentRules}
            onChange={(e) => handleRulesChange(e.target.value)}
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

        {activeTab === "global" && isAdmin && (
          <div className="space-y-3 pt-4 border-t border-border">
            <Label className="flex items-center gap-2 text-sm font-semibold">
              <Upload className="w-4 h-4 text-accent" />
              Kontext-Dateien (Admin)
            </Label>
            <p className="text-xs text-muted-foreground">
              Laden Sie Textdateien (.txt, .md, .csv) hoch, um den Wissenskontext der KI zu erweitern. Der Inhalt wird bei jeder Anfrage als zusätzlicher Kontext mitgesendet.
            </p>

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="gap-2"
              >
                <Upload className="w-4 h-4" />
                {uploading ? "Hochladen…" : "Datei hochladen"}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.md,.csv"
                className="hidden"
                onChange={handleContextFileUpload}
              />
            </div>

            {contextFiles.length > 0 && (
              <div className="space-y-2">
                {contextFiles.map((f) => (
                  <div key={f.id} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-border bg-card">
                    <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-sm flex-1 truncate">{f.filename}</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(f.created_at).toLocaleDateString("de-DE")}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 flex-shrink-0"
                      onClick={() => deleteContextFile(f.id, f.filename)}
                    >
                      <Trash2 className="w-3.5 h-3.5 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        </>
        )}
      </div>
    </div>
  );
};

export default Settings;

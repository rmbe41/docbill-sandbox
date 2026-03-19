import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import * as pdfjsLib from "pdfjs-dist";
import { useAuth } from "@/hooks/useAuth";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { DEFAULT_GLOBAL_GUARDRAILS_RULES } from "@/data/default-global-rules";
import { AVAILABLE_MODELS } from "@/data/models";
import { Globe, User, Cpu, Type, Moon, Sun, Upload, Trash2, FileText, Plus, CreditCard, Database, Eye, Loader2, Building2 } from "lucide-react";
import FileOverlay from "@/components/FileOverlay";
import TextPreviewOverlay from "@/components/TextPreviewOverlay";
import { goaeCatalogMeta } from "@/data/goae-catalog-meta";
import { cn } from "@/lib/utils";

const DEBOUNCE_MS = 500;
const GLOBAL_RULE_SEPARATOR = "\n\n<<DOCBILL_RULE_SEPARATOR>>\n\n";
const UPLOAD_TIMEOUT_MS = 180_000; // 3 min – verhindert endloses Warten bei hängendem Upload

function invokeWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("Upload-Timeout – die Verbindung hat zu lange gedauert.")), timeoutMs),
    ),
  ]);
}

type ContextFile = {
  id: string;
  filename: string;
  created_at: string;
  storage_path?: string | null;
};

const serializeGlobalRuleFields = (fields: string[]): string =>
  fields.map((f) => f.trim()).filter(Boolean).join(GLOBAL_RULE_SEPARATOR);

async function extractTextFromPdf(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const numPages = pdf.numPages;
  const texts: string[] = [];
  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map((item: { str?: string }) => item.str ?? "").join(" ");
    texts.push(pageText);
  }
  return texts.join("\n\n");
}

const parseGlobalRuleFields = (value: string): string[] => {
  if (!value?.trim()) return [DEFAULT_GLOBAL_GUARDRAILS_RULES];
  if (value.includes(GLOBAL_RULE_SEPARATOR)) {
    const blocks = value.split(GLOBAL_RULE_SEPARATOR).map((b) => b.trim()).filter(Boolean);
    return blocks.length > 0 ? blocks : [DEFAULT_GLOBAL_GUARDRAILS_RULES];
  }
  return [value];
};

type SettingsContentProps = {
  onSettingsSaved?: () => void;
  initialTab?: "user" | "display" | "global";
};

const SettingsContent = ({ onSettingsSaved, initialTab }: SettingsContentProps) => {
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<"user" | "display" | "global" | "praxis">(initialTab ?? "user");
  const [uiScale, setUiScale] = useState(() => {
    const saved = localStorage.getItem("ui-scale");
    return saved ? parseInt(saved, 10) : 100;
  });
  const [darkMode, setDarkMode] = useState(() => {
    return document.documentElement.classList.contains("dark");
  });
  const [globalModel, setGlobalModel] = useState("openrouter/free");
  const [globalEngine, setGlobalEngine] = useState<"simple" | "complex">("complex");
  const [globalRules, setGlobalRules] = useState("");
  const [globalRuleFields, setGlobalRuleFields] = useState<string[]>([DEFAULT_GLOBAL_GUARDRAILS_RULES]);
  const [userModel, setUserModel] = useState<string | null>(null);
  const [userEngine, setUserEngine] = useState<"simple" | "complex" | null>(null);
  const [userRules, setUserRules] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const rulesDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [contextFiles, setContextFiles] = useState<ContextFile[]>([]);
  const [unindexedCount, setUnindexedCount] = useState<number | null>(null);
  const [indexedFileIds, setIndexedFileIds] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{ filename: string; step: string } | null>(null);
  const [migrating, setMigrating] = useState(false);
  const [previewFile, setPreviewFile] = useState<{ src: string; name: string; type: string } | null>(null);
  const [textPreview, setTextPreview] = useState<{ filename: string; content: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelRef = useRef("");

  const [credits, setCredits] = useState<{ total_credits: number | null; total_usage: number | null; remaining: number | null; error?: string } | null>(null);

  type PraxisStammdaten = {
    praxis?: { name?: string; adresse?: string; telefon?: string; email?: string; steuernummer?: string };
    bank?: { iban?: string; bic?: string; bankName?: string; kontoinhaber?: string };
  };
  const [praxisStammdaten, setPraxisStammdaten] = useState<PraxisStammdaten>({});

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
        setGlobalEngine((gData as { default_engine?: string }).default_engine === "simple" ? "simple" : "complex");
        setGlobalRules(gData.default_rules);
        setGlobalRuleFields(parseGlobalRuleFields(gData.default_rules));
      }
      const { data: uData } = await supabase
        .from("user_settings")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      if (uData) {
        setUserModel(uData.selected_model);
        const eng = (uData as { engine_type?: string | null }).engine_type;
        setUserEngine(eng === "simple" ? "simple" : eng === "complex" ? "complex" : null);
        setUserRules(uData.custom_rules);
        const ps = (uData as { praxis_stammdaten?: PraxisStammdaten }).praxis_stammdaten as PraxisStammdaten | undefined;
        setPraxisStammdaten(ps && typeof ps === "object" ? ps : {});
      }
      if (isAdmin) {
        const { data: files } = await supabase
          .from("admin_context_files")
          .select("id, filename, created_at, storage_path")
          .order("created_at", { ascending: false });
        if (files) setContextFiles(files);
      }
      setLoading(false);
    };
    load();
  }, [user, isAdmin]);

  useEffect(() => {
    if (activeTab !== "user" && activeTab !== "global") return;
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!supabaseUrl || !supabaseKey) return;
    const fetchCredits = async () => {
      try {
        const r = await fetch(`${supabaseUrl}/functions/v1/goae-credits`, {
          headers: { Authorization: `Bearer ${supabaseKey}` },
        });
        let data: { total_credits?: number; total_usage?: number; remaining?: number; error?: string } = {};
        try {
          data = await r.json();
        } catch {
          setCredits({
            total_credits: null,
            total_usage: null,
            remaining: null,
            error: r.status === 404 ? "Credits-Funktion nicht deployed. Bitte 'supabase functions deploy goae-credits' ausführen." : "Laden fehlgeschlagen",
          });
          return;
        }
        setCredits({
          total_credits: data.total_credits ?? null,
          total_usage: data.total_usage ?? null,
          remaining: data.remaining ?? null,
          error: data.error,
        });
      } catch {
        setCredits({ total_credits: null, total_usage: null, remaining: null, error: "Laden fehlgeschlagen (Netzwerkfehler)" });
      }
    };
    fetchCredits();
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "global" || !isAdmin || !user) return;
    const fetchUnindexed = async () => {
      try {
        const { data, error } = await supabase.functions.invoke("admin-context-upload", {
          body: { check_unindexed: true },
        });
        if (error) {
          setUnindexedCount(null);
          setIndexedFileIds(new Set());
          return;
        }
        const result = data as { unindexed?: number; indexed?: string[] };
        setUnindexedCount(typeof result?.unindexed === "number" ? result.unindexed : 0);
        setIndexedFileIds(new Set(Array.isArray(result?.indexed) ? result.indexed : []));
      } catch {
        setUnindexedCount(null);
        setIndexedFileIds(new Set());
      }
    };
    fetchUnindexed();
  }, [activeTab, isAdmin, user]);

  useEffect(() => () => {
    if (rulesDebounceRef.current) clearTimeout(rulesDebounceRef.current);
  }, []);

  const saveGlobal = useCallback(
    async (model?: string, rules?: string, engine?: "simple" | "complex") => {
      const m = model ?? globalModel;
      const r = rules ?? globalRules;
      const e = engine ?? globalEngine;
      const { data: existing } = await supabase.from("global_settings").select("id").limit(1).single();
      if (existing) {
        const { error } = await supabase.from("global_settings").update({
          default_model: m,
          default_engine: e,
          default_rules: r,
          updated_at: new Date().toISOString(),
        }).eq("id", existing.id);
        if (error) {
          toast({ title: "Fehler", description: "Nur Admins können globale Einstellungen ändern.", variant: "destructive" });
          return;
        }
      }
      toast({ title: "Gespeichert", description: "Globale Einstellungen aktualisiert." });
      onSettingsSaved?.();
    },
    [globalModel, globalEngine, globalRules, toast, onSettingsSaved]
  );

  const saveUser = useCallback(
    async (model?: string | null, rules?: string | null, engine?: "simple" | "complex" | null) => {
      if (!user) return;
      const m = model !== undefined ? model : userModel;
      const r = rules !== undefined ? rules : userRules;
      const e = engine !== undefined ? engine : userEngine;
      const { data: existing } = await supabase
        .from("user_settings")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (existing) {
        await supabase.from("user_settings").update({
          selected_model: m,
          custom_rules: r,
          engine_type: e,
          updated_at: new Date().toISOString(),
        }).eq("id", existing.id);
      } else {
        await supabase.from("user_settings").insert({
          user_id: user.id,
          selected_model: m,
          custom_rules: r,
          engine_type: e,
        });
      }
      toast({ title: "Gespeichert", description: "Ihre Einstellungen wurden aktualisiert." });
      onSettingsSaved?.();
    },
    [user, userModel, userRules, userEngine, toast, onSettingsSaved]
  );

  const savePraxisStammdaten = useCallback(
    async (data: PraxisStammdaten) => {
      if (!user) return;
      const { data: existing } = await supabase
        .from("user_settings")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      const payload = { praxis_stammdaten: data, updated_at: new Date().toISOString() };
      if (existing) {
        await supabase.from("user_settings").update(payload).eq("id", existing.id);
      } else {
        await supabase.from("user_settings").insert({
          user_id: user.id,
          ...payload,
        });
      }
      toast({ title: "Gespeichert", description: "Praxisdaten wurden aktualisiert." });
      onSettingsSaved?.();
    },
    [user, toast, onSettingsSaved]
  );

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const handleContextFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setUploading(true);
    setUploadStatus({ filename: file.name, step: "Text wird extrahiert…" });

    try {
      const isPdf = file.name.toLowerCase().endsWith(".pdf");
      const text = isPdf ? await extractTextFromPdf(file) : await file.text();
      if (!text.trim()) {
        toast({ title: "Fehler", description: "Datei enthält keinen Text.", variant: "destructive" });
        setUploading(false);
        setUploadStatus(null);
        return;
      }

      setUploadStatus({ filename: file.name, step: "Wird hochgeladen…" });

      const body: { filename: string; content_text: string; file_base64?: string } = {
        filename: file.name,
        content_text: text,
      };
      if (isPdf) body.file_base64 = await fileToBase64(file);

      const { data, error } = await invokeWithTimeout(
        () => supabase.functions.invoke("admin-context-upload", { body }),
        UPLOAD_TIMEOUT_MS,
      );

      if (error) {
        throw new Error(error.message ?? "Upload fehlgeschlagen");
      }
      const result = data as { error?: string; file_id?: string };
      if (result?.error) {
        throw new Error(result.error);
      }

      const { data: files } = await supabase
        .from("admin_context_files")
        .select("id, filename, created_at, storage_path")
        .order("created_at", { ascending: false });
      if (files) setContextFiles(files);

      if (result?.file_id) {
        setIndexedFileIds((prev) => new Set([...prev, result.file_id!]));
      }

      toast({ title: "Hochgeladen", description: `${file.name} wurde als Kontext hinzugefügt.` });
    } catch (err) {
      toast({
        title: "Fehler",
        description: err instanceof Error ? err.message : "Upload fehlgeschlagen.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      setUploadStatus(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const migrateContextToRag = async () => {
    if (!user) return;
    setMigrating(true);
    try {
      const { data, error } = await invokeWithTimeout(
        () => supabase.functions.invoke("admin-context-upload", { body: { migrate: true } }),
        UPLOAD_TIMEOUT_MS,
      );

      if (error) {
        throw new Error(error.message ?? "Migration fehlgeschlagen");
      }
      const result = (data ?? {}) as { error?: string; migrated?: number };
      if (result?.error) {
        throw new Error(result.error);
      }
      toast({ title: "Migration", description: `${result?.migrated ?? 0} Datei(en) für RAG indexiert.` });
      setUnindexedCount(0);
      const { data: refetchData } = await supabase.functions.invoke("admin-context-upload", {
        body: { check_unindexed: true },
      });
      const refetch = refetchData as { unindexed?: number; indexed?: string[] };
      if (Array.isArray(refetch?.indexed)) {
        setIndexedFileIds(new Set(refetch.indexed));
      }
    } catch (err) {
      toast({
        title: "Fehler",
        description: err instanceof Error ? err.message : "Migration fehlgeschlagen.",
        variant: "destructive",
      });
    } finally {
      setMigrating(false);
    }
  };

  const deleteContextFile = async (id: string, filename: string) => {
    const { error } = await supabase.from("admin_context_files").delete().eq("id", id);
    if (error) {
      toast({ title: "Fehler", description: "Löschen fehlgeschlagen.", variant: "destructive" });
      return;
    }
    setContextFiles((prev) => prev.filter((f) => f.id !== id));
    setIndexedFileIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    toast({ title: "Gelöscht", description: `${filename} entfernt.` });
  };

  const openPreview = async (f: ContextFile) => {
    const isPdf = f.filename.toLowerCase().endsWith(".pdf");
    if (isPdf && f.storage_path) {
      const { data, error } = await supabase.storage
        .from("admin-context")
        .createSignedUrl(f.storage_path, 3600);
      if (error || !data?.signedUrl) {
        toast({ title: "Fehler", description: "PDF-Vorschau konnte nicht geladen werden.", variant: "destructive" });
        return;
      }
      setPreviewFile({ src: data.signedUrl, name: f.filename, type: "application/pdf" });
      return;
    }
    const { data, error } = await supabase
      .from("admin_context_files")
      .select("content_text")
      .eq("id", f.id)
      .single();
    if (error || !data?.content_text) {
      toast({ title: "Fehler", description: "Inhalt konnte nicht geladen werden.", variant: "destructive" });
      return;
    }
    setTextPreview({ filename: f.filename, content: data.content_text });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <p className="text-muted-foreground">Laden…</p>
      </div>
    );
  }

  const tabs = [
    { key: "user" as const, label: "Meine Einstellungen", icon: User },
    { key: "praxis" as const, label: "Praxis & Bank", icon: Building2 },
    { key: "display" as const, label: "Darstellung", icon: Type },
    ...(isAdmin ? [{ key: "global" as const, label: "Admin / Global", icon: Globe }] : []),
  ];

  const currentModel = activeTab === "global" ? globalModel : (userModel ?? "");
  const currentEngine = activeTab === "global" ? globalEngine : (userEngine ?? globalEngine);
  const currentRules = activeTab === "global" ? globalRules : (userRules ?? "");
  modelRef.current = currentModel;

  const handleModelSelect = (value: string) => {
    if (activeTab === "global") {
      setGlobalModel(value);
      saveGlobal(value, serializeGlobalRuleFields(globalRuleFields));
    } else {
      setUserModel(value);
      saveUser(value, userRules);
    }
  };

  const handleRulesChange = (value: string) => {
    if (activeTab === "global") {
      setGlobalRules(value);
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
    saveUser(null, userRules, userEngine);
  };

  const handleEngineSelect = (value: string) => {
    const eng = value === "simple" ? "simple" : "complex";
    if (activeTab === "global") {
      setGlobalEngine(eng);
      saveGlobal(globalModel, serializeGlobalRuleFields(globalRuleFields), eng);
    } else {
      setUserEngine(eng);
      saveUser(userModel, userRules, eng);
    }
  };

  const handleResetUserEngine = () => {
    setUserEngine(null);
    saveUser(userModel, userRules, null);
  };

  const handleResetGlobalRulesToDefault = () => {
    if (!isAdmin) return;
    const resetFields = [DEFAULT_GLOBAL_GUARDRAILS_RULES];
    setGlobalRuleFields(resetFields);
    setGlobalRules(DEFAULT_GLOBAL_GUARDRAILS_RULES);
    saveGlobal(globalModel, DEFAULT_GLOBAL_GUARDRAILS_RULES);
  };

  const handleGlobalRuleFieldChange = (index: number, value: string) => {
    const next = [...globalRuleFields];
    next[index] = value;
    setGlobalRuleFields(next);
    const serialized = serializeGlobalRuleFields(next);
    setGlobalRules(serialized);
    if (rulesDebounceRef.current) clearTimeout(rulesDebounceRef.current);
    rulesDebounceRef.current = setTimeout(
      () => saveGlobal(modelRef.current, serialized),
      DEBOUNCE_MS
    );
  };

  const handleAddGlobalRuleField = () => {
    setGlobalRuleFields((prev) => [...prev, ""]);
  };

  const currentGlobalRulesSerialized = serializeGlobalRuleFields(globalRuleFields);
  const isGlobalRulesEdited =
    activeTab === "global" &&
    currentGlobalRulesSerialized.trim() !== DEFAULT_GLOBAL_GUARDRAILS_RULES.trim();

  const handleDisplayChange = (msg: string) => {
    toast({ title: "Gespeichert", description: msg });
  };

  return (
    <>
      {previewFile && (
        <FileOverlay
          src={previewFile.src}
          name={previewFile.name}
          type={previewFile.type}
          onClose={() => setPreviewFile(null)}
        />
      )}
      {textPreview && (
        <TextPreviewOverlay
          filename={textPreview.filename}
          content={textPreview.content}
          onClose={() => setTextPreview(null)}
        />
      )}
    <div className="max-w-2xl mx-auto px-4 pt-6 pb-20 space-y-10">
      <div className="flex gap-3 flex-wrap">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={cn(
              "flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-colors",
              activeTab === t.key
                ? "bg-accent-subtle text-accent-subtle-foreground"
                : "bg-muted text-muted-foreground hover:bg-accent-subtle/50 hover:text-accent-subtle-foreground"
            )}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "display" && (
        <div className="space-y-10">
          <p className="text-sm text-muted-foreground">
            Passen Sie Darstellung und Erscheinungsbild an.
          </p>

          <section className="p-6 rounded-xl border border-border bg-card/50 shadow-sm space-y-4">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              {darkMode ? <Moon className="w-4 h-4 text-accent" /> : <Sun className="w-4 h-4 text-accent" />}
              Erscheinungsbild
            </h3>
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
          </section>

          <section className="p-6 rounded-xl border border-border bg-card/50 shadow-sm space-y-4">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Type className="w-4 h-4 text-accent" />
              UI-Größe: {uiScale}%
            </h3>
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
          </section>
        </div>
      )}

      {activeTab === "praxis" && (
        <div className="space-y-10">
          <p className="text-sm text-muted-foreground">
            Praxis- und Bankdaten für den PDF-Export neuer Rechnungen (Leistungen abrechnen). Einmal einrichten, dann bei jedem Export verwendet.
          </p>
          <section className="p-6 rounded-xl border border-border bg-card/50 shadow-sm space-y-4">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Building2 className="w-4 h-4 text-accent" />
              Praxis
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="praxis-name">Name</Label>
                <Textarea
                  id="praxis-name"
                  placeholder="Dr. med. Muster"
                  value={praxisStammdaten.praxis?.name ?? ""}
                  onChange={(e) =>
                    setPraxisStammdaten((prev) => ({
                      ...prev,
                      praxis: { ...prev.praxis, name: e.target.value || undefined },
                    }))
                  }
                  className="mt-1"
                  rows={1}
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="praxis-adresse">Adresse</Label>
                <Textarea
                  id="praxis-adresse"
                  placeholder="Musterstr. 1, 12345 Stadt"
                  value={praxisStammdaten.praxis?.adresse ?? ""}
                  onChange={(e) =>
                    setPraxisStammdaten((prev) => ({
                      ...prev,
                      praxis: { ...prev.praxis, adresse: e.target.value || undefined },
                    }))
                  }
                  className="mt-1"
                  rows={2}
                />
              </div>
              <div>
                <Label htmlFor="praxis-telefon">Telefon</Label>
                <Textarea
                  id="praxis-telefon"
                  placeholder="0123/456789"
                  value={praxisStammdaten.praxis?.telefon ?? ""}
                  onChange={(e) =>
                    setPraxisStammdaten((prev) => ({
                      ...prev,
                      praxis: { ...prev.praxis, telefon: e.target.value || undefined },
                    }))
                  }
                  className="mt-1"
                  rows={1}
                />
              </div>
              <div>
                <Label htmlFor="praxis-email">E-Mail</Label>
                <Textarea
                  id="praxis-email"
                  placeholder="praxis@example.de"
                  value={praxisStammdaten.praxis?.email ?? ""}
                  onChange={(e) =>
                    setPraxisStammdaten((prev) => ({
                      ...prev,
                      praxis: { ...prev.praxis, email: e.target.value || undefined },
                    }))
                  }
                  className="mt-1"
                  rows={1}
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="praxis-steuernummer">Steuernummer</Label>
                <Textarea
                  id="praxis-steuernummer"
                  placeholder="12/345/67890"
                  value={praxisStammdaten.praxis?.steuernummer ?? ""}
                  onChange={(e) =>
                    setPraxisStammdaten((prev) => ({
                      ...prev,
                      praxis: { ...prev.praxis, steuernummer: e.target.value || undefined },
                    }))
                  }
                  className="mt-1"
                  rows={1}
                />
              </div>
            </div>
          </section>
          <section className="p-6 rounded-xl border border-border bg-card/50 shadow-sm space-y-4">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-accent" />
              Bankverbindung
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="bank-iban">IBAN</Label>
                <Textarea
                  id="bank-iban"
                  placeholder="DE89 3704 0044 0532 0130 00"
                  value={praxisStammdaten.bank?.iban ?? ""}
                  onChange={(e) =>
                    setPraxisStammdaten((prev) => ({
                      ...prev,
                      bank: { ...prev.bank, iban: e.target.value || undefined },
                    }))
                  }
                  className="mt-1"
                  rows={1}
                />
              </div>
              <div>
                <Label htmlFor="bank-bic">BIC</Label>
                <Textarea
                  id="bank-bic"
                  placeholder="COBADEFFXXX"
                  value={praxisStammdaten.bank?.bic ?? ""}
                  onChange={(e) =>
                    setPraxisStammdaten((prev) => ({
                      ...prev,
                      bank: { ...prev.bank, bic: e.target.value || undefined },
                    }))
                  }
                  className="mt-1"
                  rows={1}
                />
              </div>
              <div>
                <Label htmlFor="bank-name">Bankname</Label>
                <Textarea
                  id="bank-name"
                  placeholder="Commerzbank"
                  value={praxisStammdaten.bank?.bankName ?? ""}
                  onChange={(e) =>
                    setPraxisStammdaten((prev) => ({
                      ...prev,
                      bank: { ...prev.bank, bankName: e.target.value || undefined },
                    }))
                  }
                  className="mt-1"
                  rows={1}
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="bank-kontoinhaber">Kontoinhaber</Label>
                <Textarea
                  id="bank-kontoinhaber"
                  placeholder="Dr. med. Muster"
                  value={praxisStammdaten.bank?.kontoinhaber ?? ""}
                  onChange={(e) =>
                    setPraxisStammdaten((prev) => ({
                      ...prev,
                      bank: { ...prev.bank, kontoinhaber: e.target.value || undefined },
                    }))
                  }
                  className="mt-1"
                  rows={1}
                />
              </div>
            </div>
          </section>
          <Button onClick={() => savePraxisStammdaten(praxisStammdaten)}>
            Praxisdaten speichern
          </Button>
        </div>
      )}

      {(activeTab === "user" || activeTab === "global") && (
        <div className="space-y-10">
          <section className="p-6 rounded-xl border border-border bg-card/50 shadow-sm space-y-5">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Cpu className="w-4 h-4 text-accent" />
              Modell & Credits
            </h3>
            {activeTab === "user" && (
              <p className="text-xs text-muted-foreground -mt-1">
                Ihre Wahl überschreibt den globalen Default. Leer lassen = globaler Default wird verwendet.
              </p>
            )}
            <div className="flex items-center gap-2 p-4 rounded-xl border border-border bg-muted/30">
              <CreditCard className="w-5 h-5 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">OpenRouter Credits & Usage</p>
                {credits?.error ? (
                  <p className="text-sm text-muted-foreground mt-0.5">{credits.error}</p>
                ) : credits?.total_credits != null && credits?.total_usage != null ? (
                  <p className="text-sm font-medium text-foreground mt-0.5">
                    Verbleibend: <span className="font-mono">{credits.remaining?.toFixed(2) ?? "—"}</span> $
                    <span className="text-muted-foreground font-normal ml-1">
                      (gekauft: {credits.total_credits.toFixed(2)} $, genutzt: {credits.total_usage.toFixed(2)} $)
                    </span>
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground mt-0.5">Laden…</p>
                )}
              </div>
            </div>
            <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">KI-Modell wählen</p>
              <p className="text-xs text-muted-foreground -mt-1">
                Für Rechnungsprüfung wird ein multimodal-fähiges Modell empfohlen (z.B. Healer Alpha, Nemotron Nano VL).
              </p>
              <Select
                value={activeTab === "user" && userModel === null ? "__global__" : currentModel || "__global__"}
                onValueChange={(v) => {
                  if (v === "__global__") {
                    handleResetUserModel();
                  } else {
                    handleModelSelect(v);
                  }
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Modell auswählen" />
                </SelectTrigger>
                <SelectContent>
                  {activeTab === "user" && (
                    <SelectItem value="__global__">
                      <span className="text-muted-foreground">Globaler Standard verwenden</span>
                    </SelectItem>
                  )}
                  {AVAILABLE_MODELS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      <span className="font-medium">{m.label}</span>
                      <span className={cn(
                        "ml-2 text-[10px] font-medium px-1.5 py-0.5 rounded",
                        m.isFree && "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
                        !m.isFree && m.pricePerInvoice === "~0.05€" && "bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300",
                        !m.isFree && m.pricePerInvoice === "~0.15€" && "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
                        !m.isFree && m.pricePerInvoice === "~0.40€" && "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
                        !m.isFree && !m.pricePerInvoice && "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                      )}>
                        {m.isFree ? "Free" : m.pricePerInvoice ?? "Pay"}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {activeTab === "user" && userModel !== null && (
                <Button variant="ghost" size="sm" onClick={handleResetUserModel} className="text-xs">
                  Zurücksetzen (Global verwenden)
                </Button>
              )}
            </div>
            <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Engine wählen</p>
              <p className="text-xs text-muted-foreground -mt-1">
                Einfache Engine: schneller, 2 Schritte. Komplexe Engine: präziser, 6 Schritte mit strukturierter Ausgabe.
              </p>
              <Select
                value={activeTab === "user" && userEngine === null ? "__global__" : currentEngine}
                onValueChange={(v) => {
                  if (v === "__global__") {
                    handleResetUserEngine();
                  } else {
                    handleEngineSelect(v);
                  }
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Engine auswählen" />
                </SelectTrigger>
                <SelectContent>
                  {activeTab === "user" && (
                    <SelectItem value="__global__">
                      <span className="text-muted-foreground">Globaler Standard verwenden</span>
                    </SelectItem>
                  )}
                  <SelectItem value="simple">
                    <span className="font-medium">Einfache Engine</span>
                  </SelectItem>
                  <SelectItem value="complex">
                    <span className="font-medium">Komplexe (6-Schritt) Engine</span>
                  </SelectItem>
                </SelectContent>
              </Select>
              {activeTab === "user" && userEngine !== null && (
                <Button variant="ghost" size="sm" onClick={handleResetUserEngine} className="text-xs">
                  Zurücksetzen (Global verwenden)
                </Button>
              )}
            </div>
          </section>

          <section className="p-6 rounded-xl border border-border bg-card/50 shadow-sm space-y-4">
            <h3 className="text-sm font-semibold text-foreground">
              {activeTab === "global" ? "Globale Guardrails & Rules" : "Persönliche Rules (Optional)"}
            </h3>
            {activeTab === "user" && (
              <p className="text-xs text-muted-foreground -mt-1">
                Ihre Regeln werden zusätzlich zu den globalen Defaults angewendet. Leer lassen = nur globale Regeln.
              </p>
            )}
            {activeTab === "global" && isAdmin ? (
              <div className="space-y-3">
                {globalRuleFields.map((rule, index) => (
                  <div key={index} className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <Label className="text-xs text-muted-foreground">
                        {index === 0 ? "Standard Global Guardrails & Rules" : `Zusätzliche Regel ${index}`}
                      </Label>
                      {index === 0 && isGlobalRulesEdited && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleResetGlobalRulesToDefault}
                        >
                          Auf Standard „Global Guardrails & Rules“ zurücksetzen
                        </Button>
                      )}
                    </div>
                    <Textarea
                      value={rule}
                      onChange={(e) => handleGlobalRuleFieldChange(index, e.target.value)}
                      placeholder={
                        index === 0
                          ? "Standard-Guardrails..."
                          : "Neue zusätzliche Regel..."
                      }
                      rows={index === 0 ? 10 : 4}
                      className="font-mono text-sm"
                    />
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleAddGlobalRuleField}
                  className="gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Neue Regel hinzufügen
                </Button>
              </div>
            ) : (
              <Textarea
                value={currentRules}
                onChange={(e) => handleRulesChange(e.target.value)}
                placeholder="z.B. Fokussiere dich auf Retinologie. Verwende immer die höchstmöglichen Steigerungssätze."
                rows={6}
                className="font-mono text-sm"
              />
            )}
            {activeTab === "global" && (
              <p className="text-xs text-muted-foreground">
                Diese Regeln gelten für alle Nutzer als Basis.
              </p>
            )}
            {activeTab === "global" && isAdmin && (
              <p className="text-xs text-muted-foreground">
                Admins können weiterhin jederzeit neue Regeln ergänzen oder bestehende Regeln bearbeiten.
              </p>
            )}
          </section>

          {activeTab === "global" && isAdmin && (
            <section className="p-6 rounded-xl border border-border bg-card/50 shadow-sm space-y-5">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Database className="w-4 h-4 text-accent" />
                KI Kontext
              </h3>
            <div className="flex items-center gap-2 p-4 rounded-xl border border-border bg-muted/30">
                <Database className="w-5 h-5 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">GOÄ-Katalog</p>
                  <p className="text-sm font-medium text-foreground mt-0.5">
                    Zuletzt aktualisiert:{" "}
                    {new Date(goaeCatalogMeta.lastFetched).toLocaleDateString("de-DE", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                    })}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {goaeCatalogMeta.zifferCount} Ziffern im Katalog · Quelle: abrechnungsstelle.com
                  </p>
                </div>
              </div>

              <div className="border-t border-border pt-6 mt-6">
                <div className="flex items-start justify-between gap-4 mb-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                    <Upload className="w-4 h-4 text-accent" />
                    Kontext-Dateien (Admin)
                  </p>
                  <div className="flex flex-wrap gap-2 shrink-0">
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
                    {(unindexedCount ?? 0) > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={migrateContextToRag}
                        disabled={migrating}
                        className="gap-2"
                      >
                        <Database className="w-4 h-4" />
                        {migrating ? "Migration…" : "Bestehende für RAG indexieren"}
                      </Button>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".txt,.md,.csv,.pdf"
                      className="hidden"
                      onChange={handleContextFileUpload}
                    />
                  </div>
                </div>
              <p className="text-xs text-muted-foreground mb-4">
                Laden Sie Textdateien (.txt, .md, .csv) oder PDFs hoch, um den Wissenskontext der KI zu erweitern. Empfohlene Inhalte: fachspezifische Guidelines (z.B. Retinologie), Analog-Bewertungen, Begründungsbeispiele. Relevante Ausschnitte werden automatisch bei jeder Rechnungsprüfung abgerufen.
              </p>

              {uploadStatus && (
                <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-accent/10 border border-accent/20 text-sm">
                  <Loader2 className="w-5 h-5 text-accent animate-spin shrink-0" />
                  <div>
                    <p className="font-medium text-foreground">{uploadStatus.filename}</p>
                    <p className="text-xs text-muted-foreground">{uploadStatus.step}</p>
                  </div>
                </div>
              )}

              {contextFiles.length > 0 && (
                <div className="space-y-1 mt-4">
                  {contextFiles.map((f) => (
                    <div key={f.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-muted/40">
                      <FileText className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="text-sm flex-1 truncate">{f.filename}</span>
                      {indexedFileIds.has(f.id) && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300 shrink-0">
                          Aktiv
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground shrink-0">
                        {new Date(f.created_at).toLocaleDateString("de-DE")}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 flex-shrink-0"
                        onClick={() => openPreview(f)}
                        title="Vorschau"
                      >
                        <Eye className="w-3 h-3 text-muted-foreground" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 flex-shrink-0"
                        onClick={() => deleteContextFile(f.id, f.filename)}
                      >
                        <Trash2 className="w-3 h-3 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
    </>
  );
};

export default SettingsContent;

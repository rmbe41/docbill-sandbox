import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useAuth } from "@/hooks/useAuth";
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
import { AVAILABLE_MODELS, MODEL_TAG_LABELS, MODEL_TAG_TOOLTIPS, type ModelTag } from "@/data/models";
import { Globe, User, Cpu, Type, Moon, Sun, Upload, Trash2, FileText, Plus, CreditCard, Database, Loader2, Building2, ChevronDown, Keyboard } from "lucide-react";
import { KeyboardShortcutsReference } from "@/components/KeyboardShortcutsReference";
import { KeyboardShortcutPrefsEditor } from "@/components/KeyboardShortcutPrefsEditor";
import { useKeyboardShortcutPrefs } from "@/hooks/useKeyboardShortcutPrefs";
import ContextUploadProgress, {
  applyStreamProgressToSteps,
  buildStepStatesForStoredContextFile,
  createInitialMigrateStepStates,
  createInitialUploadStepStates,
  markActiveStepAsError,
  markMigrateActiveAsError,
  type ContextMigrateStepId,
  type ContextUploadStepId,
  type ContextUploadStepStatus,
} from "@/components/ContextUploadProgress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { consumeAdminContextUploadStream } from "@/lib/admin-context-upload-stream";
import FileOverlay from "@/components/FileOverlay";
import TextPreviewOverlay from "@/components/TextPreviewOverlay";
import { goaeCatalogMeta } from "@/data/goae-catalog-meta";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

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

/** PDF.js real Web Workers can hang in some dev/browser setups; preloading the worker module registers WorkerMessageHandler on globalThis so PDFWorker skips new Worker() (see pdfjs PDFWorker.#initialize). */
let pdfMainThreadWorkerReady: Promise<void> | null = null;
function ensurePdfJsMainThreadWorker(): Promise<void> {
  if (!pdfMainThreadWorkerReady) {
    const g = globalThis as typeof globalThis & { pdfjsWorker?: { WorkerMessageHandler?: unknown } };
    pdfMainThreadWorkerReady =
      g.pdfjsWorker?.WorkerMessageHandler != null
        ? Promise.resolve()
        : import(/* @vite-ignore */ pdfjsWorker).then(() => {});
  }
  return pdfMainThreadWorkerReady;
}

async function extractTextFromPdf(file: File): Promise<string> {
  // #region agent log
  fetch("http://127.0.0.1:7350/ingest/d67df62b-428b-4fab-8921-97d904601338", { method: "POST", headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "25aeaa" }, body: JSON.stringify({ sessionId: "25aeaa", hypothesisId: "H1", location: "SettingsContent.tsx:extractTextFromPdf:entry", message: "pdf extract start", data: { name: file.name, size: file.size }, timestamp: Date.now() }) }).catch(() => {});
  // #endregion
  try {
    await ensurePdfJsMainThreadWorker();
    // #region agent log
    fetch("http://127.0.0.1:7350/ingest/d67df62b-428b-4fab-8921-97d904601338", { method: "POST", headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "25aeaa" }, body: JSON.stringify({ sessionId: "25aeaa", hypothesisId: "H7", location: "SettingsContent.tsx:extractTextFromPdf:afterEnsureWorker", message: "main-thread worker hook ready", data: { hasGlobalHandler: (globalThis as unknown as { pdfjsWorker?: unknown }).pdfjsWorker != null, workerSrcSet: !!pdfjsLib.GlobalWorkerOptions.workerSrc }, timestamp: Date.now() }) }).catch(() => {});
    // #endregion
    const arrayBuffer = await file.arrayBuffer();
    // #region agent log
    fetch("http://127.0.0.1:7350/ingest/d67df62b-428b-4fab-8921-97d904601338", { method: "POST", headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "25aeaa" }, body: JSON.stringify({ sessionId: "25aeaa", hypothesisId: "H6", location: "SettingsContent.tsx:extractTextFromPdf:afterBuffer", message: "arrayBuffer done", data: { byteLength: arrayBuffer.byteLength }, timestamp: Date.now() }) }).catch(() => {});
    // #endregion
    // #region agent log
    fetch("http://127.0.0.1:7350/ingest/d67df62b-428b-4fab-8921-97d904601338", { method: "POST", headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "25aeaa" }, body: JSON.stringify({ sessionId: "25aeaa", hypothesisId: "H7", location: "SettingsContent.tsx:extractTextFromPdf:beforeGetDocument", message: "calling getDocument", data: {}, timestamp: Date.now() }) }).catch(() => {});
    // #endregion
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const numPages = pdf.numPages;
    const texts: string[] = [];
    for (let i = 1; i <= numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map((item: { str?: string }) => item.str ?? "").join(" ");
      texts.push(pageText);
    }
    const combined = texts.join("\n\n");
    // #region agent log
    fetch("http://127.0.0.1:7350/ingest/d67df62b-428b-4fab-8921-97d904601338", { method: "POST", headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "25aeaa" }, body: JSON.stringify({ sessionId: "25aeaa", hypothesisId: "H1", location: "SettingsContent.tsx:extractTextFromPdf:ok", message: "pdf extract ok", data: { numPages, combinedLen: combined.length, nonEmptyPages: texts.filter((t) => t.trim().length > 0).length }, timestamp: Date.now() }) }).catch(() => {});
    // #endregion
    return combined;
  } catch (e) {
    // #region agent log
    fetch("http://127.0.0.1:7350/ingest/d67df62b-428b-4fab-8921-97d904601338", { method: "POST", headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "25aeaa" }, body: JSON.stringify({ sessionId: "25aeaa", hypothesisId: "H1", location: "SettingsContent.tsx:extractTextFromPdf:fail", message: "pdf extract threw", data: { err: e instanceof Error ? e.message : String(e) }, timestamp: Date.now() }) }).catch(() => {});
    // #endregion
    throw e;
  }
}

const parseGlobalRuleFields = (value: string): string[] => {
  if (!value?.trim()) return [DEFAULT_GLOBAL_GUARDRAILS_RULES];
  if (value.includes(GLOBAL_RULE_SEPARATOR)) {
    const blocks = value.split(GLOBAL_RULE_SEPARATOR).map((b) => b.trim()).filter(Boolean);
    return blocks.length > 0 ? blocks : [DEFAULT_GLOBAL_GUARDRAILS_RULES];
  }
  return [value];
};

/** Von Index übergeben: bereits geladene global/user Settings → kein blockierendes „Laden…“ beim Panel-Öffnen. */
export type SettingsChatHydration = {
  global: { default_model: string; default_rules: string; default_engine: string };
  user: { selected_model: string | null; custom_rules: string | null; engine_type: string | null };
};

function initialStateFromChatHydration(h: SettingsChatHydration | undefined) {
  if (!h) {
    return {
      globalModel: "openrouter/free",
      globalEngine: "complex" as const,
      globalRules: "",
      globalRuleFields: [DEFAULT_GLOBAL_GUARDRAILS_RULES],
      userModel: null as string | null,
      userEngine: null as "simple" | "complex" | null,
      userRules: null as string | null,
    };
  }
  const eng = h.user.engine_type;
  return {
    globalModel: h.global.default_model,
    globalEngine: h.global.default_engine === "simple" ? ("simple" as const) : ("complex" as const),
    globalRules: h.global.default_rules,
    globalRuleFields: parseGlobalRuleFields(h.global.default_rules),
    userModel: h.user.selected_model,
    userEngine: eng === "simple" ? "simple" : eng === "complex" ? "complex" : null,
    userRules: h.user.custom_rules,
  };
}

type SettingsContentProps = {
  onSettingsSaved?: () => void;
  /** `display` öffnet „Meine Einstellungen“ mit dem Bereich Darstellung (kein eigener Tab mehr). */
  initialTab?: "user" | "display" | "global";
  /** Bei jedem Öffnen der Einstellungen erhöhen (z. B. Index), damit der aktive Tab erneut gesetzt wird. */
  openSeq?: number;
  /** Aus dem Chat: gleiche Daten wie `loadSettings` im Parent → UI sofort sichtbar, Sync im Hintergrund. */
  chatSettingsHydration?: SettingsChatHydration;
};

const SettingsContent = ({
  onSettingsSaved,
  initialTab,
  openSeq = 0,
  chatSettingsHydration,
}: SettingsContentProps) => {
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const { prefs: shortcutPrefs, setPrefs: setShortcutPrefs, reset: resetShortcutPrefs } = useKeyboardShortcutPrefs();
  /** Pro Mount: aus In-App-Chat kommt Hydration → kein Vollbild-Loader bei Sync. */
  const skipBlockingLoaderRef = useRef(!!chatSettingsHydration);

  const [activeTab, setActiveTab] = useState<"user" | "global" | "praxis">(() =>
    initialTab === "display" ? "user" : initialTab ?? "user",
  );

  useEffect(() => {
    if (initialTab === "display") {
      setActiveTab("user");
      return;
    }
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (openSeq <= 0) return;
    setActiveTab(initialTab === "display" ? "user" : initialTab ?? "user");
  }, [openSeq, initialTab]);

  const [uiScale, setUiScale] = useState(() => {
    const saved = localStorage.getItem("ui-scale");
    return saved ? parseInt(saved, 10) : 100;
  });
  const [darkMode, setDarkMode] = useState(() => {
    return document.documentElement.classList.contains("dark");
  });
  const boot = useMemo(
    () => initialStateFromChatHydration(chatSettingsHydration),
    // Nur erster Mount: aktuelle Hydration vom Parent beim Öffnen des Panels
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [globalModel, setGlobalModel] = useState(boot.globalModel);
  const [globalEngine, setGlobalEngine] = useState<"simple" | "complex">(boot.globalEngine);
  const [globalRules, setGlobalRules] = useState(boot.globalRules);
  const [globalRuleFields, setGlobalRuleFields] = useState<string[]>(boot.globalRuleFields);
  const [userModel, setUserModel] = useState<string | null>(boot.userModel);
  const [userEngine, setUserEngine] = useState<"simple" | "complex" | null>(boot.userEngine);
  const [userRules, setUserRules] = useState<string | null>(boot.userRules);
  const [loading, setLoading] = useState(() => !chatSettingsHydration);
  const rulesDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [contextFiles, setContextFiles] = useState<ContextFile[]>([]);
  const [unindexedCount, setUnindexedCount] = useState<number | null>(null);
  const [indexedFileIds, setIndexedFileIds] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    filename: string;
    startedAt: number;
    steps: Record<ContextUploadStepId, ContextUploadStepStatus>;
  } | null>(null);
  /** Letzter abgeschlossener Upload-Ablauf (nur gesetzt nach Upload/Migration, kein leerer Platzhalter). */
  const [savedContextUploadSnapshot, setSavedContextUploadSnapshot] = useState<{
    filename: string;
    steps: Record<ContextUploadStepId, ContextUploadStepStatus>;
  } | null>(null);
  const [migrating, setMigrating] = useState(false);
  const [migrateProgress, setMigrateProgress] = useState<{
    filename: string;
    startedAt: number;
    steps: Record<ContextMigrateStepId, ContextUploadStepStatus>;
  } | null>(null);
  const [savedMigrateSnapshot, setSavedMigrateSnapshot] = useState<{
    filename: string;
    steps: Record<ContextMigrateStepId, ContextUploadStepStatus>;
  } | null>(null);
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
    const blockUi = !skipBlockingLoaderRef.current;
    const load = async () => {
      if (blockUi) setLoading(true);
      try {
        const [{ data: gData }, { data: uData }] = await Promise.all([
          supabase.from("global_settings").select("*").limit(1).single(),
          supabase.from("user_settings").select("*").eq("user_id", user.id).maybeSingle(),
        ]);
        if (gData) {
          setGlobalModel(gData.default_model);
          setGlobalEngine((gData as { default_engine?: string }).default_engine === "simple" ? "simple" : "complex");
          setGlobalRules(gData.default_rules);
          setGlobalRuleFields(parseGlobalRuleFields(gData.default_rules));
        }
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
      } finally {
        if (blockUi) setLoading(false);
      }
    };
    load();
  }, [user, isAdmin]);

  useEffect(() => {
    if (activeTab !== "user" && activeTab !== "global") return;
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const creditsUrl = import.meta.env.DEV
      ? `/api/supabase/functions/v1/goae-credits`
      : `${supabaseUrl}/functions/v1/goae-credits`;
    const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!supabaseUrl || !supabaseKey) return;
    const fetchCredits = async () => {
      try {
        const r = await fetch(creditsUrl, {
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
    let retainUploadProgressAfterFinish = false;
    setUploading(true);
    const isPdf = file.name.toLowerCase().endsWith(".pdf");
    const initialSteps = createInitialUploadStepStates();
    initialSteps.pick = "done";
    initialSteps.detect_type = "done";
    initialSteps.read_raw = "active";
    setUploadProgress({
      filename: file.name,
      startedAt: Date.now(),
      steps: initialSteps,
    });

    try {
      // #region agent log
      fetch("http://127.0.0.1:7350/ingest/d67df62b-428b-4fab-8921-97d904601338", { method: "POST", headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "25aeaa" }, body: JSON.stringify({ sessionId: "25aeaa", hypothesisId: "H5", location: "SettingsContent.tsx:handleContextFileUpload:start", message: "upload start", data: { name: file.name, size: file.size, isAdmin: !!isAdmin }, timestamp: Date.now() }) }).catch(() => {});
      // #endregion
      const text = isPdf ? await extractTextFromPdf(file) : await file.text();
      // #region agent log
      fetch("http://127.0.0.1:7350/ingest/d67df62b-428b-4fab-8921-97d904601338", { method: "POST", headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "25aeaa" }, body: JSON.stringify({ sessionId: "25aeaa", hypothesisId: "H1", location: "SettingsContent.tsx:handleContextFileUpload:afterRead", message: "content read", data: { isPdf, textLen: text?.length ?? 0, trimLen: text?.trim()?.length ?? 0 }, timestamp: Date.now() }) }).catch(() => {});
      // #endregion
      setUploadProgress((p) =>
        !p
          ? p
          : {
              ...p,
              steps: {
                ...p.steps,
                read_raw: "done",
                extract_text: "done",
                validate_text: "active",
              },
            },
      );

      if (!text.trim()) {
        retainUploadProgressAfterFinish = true;
        toast({ title: "Fehler", description: "Datei enthält keinen Text.", variant: "destructive" });
        setUploadProgress((p) =>
          !p ? p : { ...p, steps: { ...p.steps, validate_text: "error" } },
        );
        return;
      }

      setUploadProgress((p) =>
        !p
          ? p
          : {
              ...p,
              steps: {
                ...p.steps,
                validate_text: "done",
                prepare_preview: "active",
              },
            },
      );

      const body: { filename: string; content_text: string; file_base64?: string } = {
        filename: file.name,
        content_text: text,
      };
      if (isPdf) {
        body.file_base64 = await fileToBase64(file);
        setUploadProgress((p) =>
          !p
            ? p
            : {
                ...p,
                steps: { ...p.steps, prepare_preview: "done", send: "active" },
              },
        );
      } else {
        setUploadProgress((p) =>
          !p
            ? p
            : {
                ...p,
                steps: { ...p.steps, prepare_preview: "skipped", send: "active" },
              },
        );
      }

      // #region agent log
      fetch("http://127.0.0.1:7350/ingest/d67df62b-428b-4fab-8921-97d904601338", { method: "POST", headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "25aeaa" }, body: JSON.stringify({ sessionId: "25aeaa", hypothesisId: "H2", location: "SettingsContent.tsx:handleContextFileUpload:beforeInvoke", message: "before invoke", data: { contentLen: body.content_text.length, base64Len: body.file_base64?.length ?? 0 }, timestamp: Date.now() }) }).catch(() => {});
      // #endregion

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
      if (!token) {
        throw new Error("Nicht angemeldet");
      }
      if (!supabaseUrl || !anonKey) {
        throw new Error("Supabase ist nicht konfiguriert");
      }

      const url = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/admin-context-upload`;
      const ac = new AbortController();
      const to = setTimeout(() => ac.abort(), UPLOAD_TIMEOUT_MS);
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
        clearTimeout(to);
      }

      const result = await consumeAdminContextUploadStream(res, (step, skipped) => {
        setUploadProgress((p) =>
          !p ? p : { ...p, steps: applyStreamProgressToSteps(p.steps, step, skipped) },
        );
      });

      if (!result.ok) {
        setUploadProgress((p) =>
          !p ? p : { ...p, steps: markActiveStepAsError(p.steps) },
        );
        throw new Error(result.message);
      }

      const { data: files } = await supabase
        .from("admin_context_files")
        .select("id, filename, created_at, storage_path")
        .order("created_at", { ascending: false });
      setUploadProgress((p) =>
        !p
          ? p
          : {
              ...p,
              steps: {
                ...p.steps,
                refresh_list: "done",
                done: "active",
              },
            },
      );

      if (files) setContextFiles(files);

      if (result.file_id) {
        setIndexedFileIds((prev) => new Set([...prev, result.file_id!]));
      }

      setUploadProgress((p) =>
        !p ? p : { ...p, steps: { ...p.steps, done: "done" } },
      );

      toast({ title: "Hochgeladen", description: `${file.name} wurde als Kontext hinzugefügt.` });
    } catch (err) {
      retainUploadProgressAfterFinish = true;
      // #region agent log
      fetch("http://127.0.0.1:7350/ingest/d67df62b-428b-4fab-8921-97d904601338", { method: "POST", headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "25aeaa" }, body: JSON.stringify({ sessionId: "25aeaa", hypothesisId: "H-catch", location: "SettingsContent.tsx:handleContextFileUpload:catch", message: "upload catch", data: { err: err instanceof Error ? err.message : String(err) }, timestamp: Date.now() }) }).catch(() => {});
      // #endregion
      const msg =
        err instanceof Error
          ? err.name === "AbortError"
            ? "Upload-Timeout – die Verbindung hat zu lange gedauert."
            : err.message
          : "Upload fehlgeschlagen.";
      setUploadProgress((p) => {
        if (!p) return p;
        const hasErr = Object.values(p.steps).some((s) => s === "error");
        return hasErr ? p : { ...p, steps: markActiveStepAsError(p.steps) };
      });
      toast({
        title: "Fehler",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      if (retainUploadProgressAfterFinish) {
        setUploadProgress((current) => {
          if (current) {
            setSavedContextUploadSnapshot({
              filename: current.filename,
              steps: { ...current.steps },
            });
          }
          return null;
        });
      } else {
        window.setTimeout(() => {
          setUploadProgress((current) => {
            if (current) {
              setSavedContextUploadSnapshot({
                filename: current.filename,
                steps: { ...current.steps },
              });
            }
            return null;
          });
        }, 900);
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const migrateContextToRag = async () => {
    if (!user) return;
    let retainMigrateProgress = false;
    setMigrating(true);
    const ms = createInitialMigrateStepStates();
    ms.migrate_run = "active";
    setMigrateProgress({
      filename: `Ohne RAG-Index: ${unindexedCount ?? "?"} Datei(en)`,
      startedAt: Date.now(),
      steps: ms,
    });
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
      setMigrateProgress((p) =>
        !p ? p : { ...p, steps: { ...p.steps, migrate_run: "done", migrate_list: "active" } },
      );
      toast({ title: "Migration", description: `${result?.migrated ?? 0} Datei(en) für RAG indexiert.` });
      setUnindexedCount(0);
      const { data: refetchData } = await supabase.functions.invoke("admin-context-upload", {
        body: { check_unindexed: true },
      });
      const refetch = refetchData as { unindexed?: number; indexed?: string[] };
      if (Array.isArray(refetch?.indexed)) {
        setIndexedFileIds(new Set(refetch.indexed));
      }
      setMigrateProgress((p) =>
        !p ? p : { ...p, steps: { ...p.steps, migrate_list: "done" } },
      );
    } catch (err) {
      retainMigrateProgress = true;
      setMigrateProgress((p) =>
        !p ? p : { ...p, steps: markMigrateActiveAsError(p.steps) },
      );
      toast({
        title: "Fehler",
        description: err instanceof Error ? err.message : "Migration fehlgeschlagen.",
        variant: "destructive",
      });
    } finally {
      setMigrating(false);
      if (retainMigrateProgress) {
        setMigrateProgress((current) => {
          if (current) {
            setSavedMigrateSnapshot({
              filename: current.filename,
              steps: { ...current.steps },
            });
          }
          return null;
        });
      } else {
        window.setTimeout(() => {
          setMigrateProgress((current) => {
            if (current) {
              setSavedMigrateSnapshot({
                filename: current.filename,
                steps: { ...current.steps },
              });
            }
            return null;
          });
        }, 900);
      }
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
    const hasStoragePath = !!f.storage_path;
    // #region agent log
    fetch("http://127.0.0.1:7350/ingest/d67df62b-428b-4fab-8921-97d904601338", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "c66662" },
      body: JSON.stringify({
        sessionId: "c66662",
        hypothesisId: "H1",
        location: "SettingsContent.tsx:openPreview:entry",
        message: "openPreview start",
        data: { fileId: f.id, filename: f.filename, isPdf, hasStoragePath },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    if (isPdf && f.storage_path) {
      const { data, error } = await supabase.storage
        .from("admin-context")
        .createSignedUrl(f.storage_path, 3600);
      const signedOk = !error && !!data?.signedUrl;
      // #region agent log
      fetch("http://127.0.0.1:7350/ingest/d67df62b-428b-4fab-8921-97d904601338", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "c66662" },
        body: JSON.stringify({
          sessionId: "c66662",
          hypothesisId: "H1",
          location: "SettingsContent.tsx:openPreview:signedUrl",
          message: "PDF signed URL result",
          data: {
            signedOk,
            errMsg: error?.message ?? null,
            urlHost: data?.signedUrl ? (() => { try { return new URL(data.signedUrl).hostname; } catch { return "parse_error"; } })() : null,
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      if (error || !data?.signedUrl) {
        toast({ title: "Fehler", description: "PDF-Vorschau konnte nicht geladen werden.", variant: "destructive" });
        return;
      }
      // #region agent log
      fetch("http://127.0.0.1:7350/ingest/d67df62b-428b-4fab-8921-97d904601338", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "c66662" },
        body: JSON.stringify({
          sessionId: "c66662",
          hypothesisId: "H4",
          location: "SettingsContent.tsx:openPreview:setPreviewFile",
          message: "calling setPreviewFile",
          data: { name: f.filename },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      setPreviewFile({ src: data.signedUrl, name: f.filename, type: "application/pdf" });
      return;
    }
    // #region agent log
    fetch("http://127.0.0.1:7350/ingest/d67df62b-428b-4fab-8921-97d904601338", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "c66662" },
      body: JSON.stringify({
        sessionId: "c66662",
        hypothesisId: "H3",
        location: "SettingsContent.tsx:openPreview:textBranch",
        message: "using content_text branch",
        data: { isPdf, hasStoragePath },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    const { data, error } = await supabase
      .from("admin_context_files")
      .select("content_text")
      .eq("id", f.id)
      .single();
    const contentLen = data?.content_text != null ? String(data.content_text).length : -1;
    // #region agent log
    fetch("http://127.0.0.1:7350/ingest/d67df62b-428b-4fab-8921-97d904601338", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "c66662" },
      body: JSON.stringify({
        sessionId: "c66662",
        hypothesisId: "H3",
        location: "SettingsContent.tsx:openPreview:dbSelect",
        message: "admin_context_files select result",
        data: {
          hasRow: data != null,
          hasError: !!error,
          errMsg: error?.message ?? null,
          errCode: (error as { code?: string })?.code ?? null,
          contentLen,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    if (error || data == null) {
      toast({ title: "Fehler", description: "Inhalt konnte nicht geladen werden.", variant: "destructive" });
      return;
    }
    // #region agent log
    fetch("http://127.0.0.1:7350/ingest/d67df62b-428b-4fab-8921-97d904601338", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "c66662" },
      body: JSON.stringify({
        sessionId: "c66662",
        hypothesisId: "H5",
        location: "SettingsContent.tsx:openPreview:setTextPreview",
        message: "calling setTextPreview",
        data: { filename: f.filename, contentLen },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    setTextPreview({ filename: f.filename, content: data.content_text ?? "" });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <p className="text-muted-foreground">Laden…</p>
      </div>
    );
  }

  const tabs = [
    ...(isAdmin ? [{ key: "global" as const, label: "Admin", icon: Globe }] : []),
    { key: "user" as const, label: "Meine Einstellungen", icon: User },
    { key: "praxis" as const, label: "Praxis & Bank", icon: Building2 },
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
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex items-center justify-between gap-2 min-w-0 w-full">
                            <span className="font-medium truncate">{m.label}</span>
                            <span className={cn(
                              "text-[9px] font-medium px-1.5 py-0.5 rounded shrink-0",
                              m.isFree && "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
                              !m.isFree && m.pricePerInvoice === "~0.05€" && "bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300",
                              !m.isFree && m.pricePerInvoice === "~0.15€" && "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
                              !m.isFree && m.pricePerInvoice === "~0.40€" && "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
                              !m.isFree && !m.pricePerInvoice && "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                            )}>
                              {m.isFree ? "Free" : m.pricePerInvoice ?? "Pay"}
                            </span>
                          </div>
                        </TooltipTrigger>
                        {m.tags && m.tags.length > 0 ? (
                          <TooltipContent side="left" align="start" sideOffset={8} collisionPadding={16} className="max-w-[280px] z-[100]">
                            <div className="space-y-2 text-sm">
                              {m.tags.map((tag: ModelTag) => (
                                <div key={tag}>
                                  <span className="font-medium">{MODEL_TAG_LABELS[tag]}:</span>{" "}
                                  {MODEL_TAG_TOOLTIPS[tag]}
                                </div>
                              ))}
                            </div>
                          </TooltipContent>
                        ) : (
                          <TooltipContent side="left" align="start" sideOffset={8} collisionPadding={16} className="max-w-[280px] z-[100]">
                            <div className="space-y-2 text-sm">
                              <div>
                                <span className="font-medium">Nur Text:</span>{" "}
                                Keine Dokument- oder Bildverarbeitung. Für reine Chat-Anfragen ohne Upload geeignet.
                              </div>
                            </div>
                          </TooltipContent>
                        )}
                      </Tooltip>
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
                Bitte nur Ergänzungen (Ton, Fachfokus, interne Vorgaben) – keine zweite Antwortvorlage; die
                Antwortstruktur legt DocBill im System fest.
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
                placeholder="z.B. Fokus Retinologie; sachlicher Ton. Keine eigene Überschriften-Vorlage."
                rows={6}
                className="font-mono text-sm"
              />
            )}
            {activeTab === "global" && (
              <p className="text-xs text-muted-foreground">
                Diese Regeln gelten für alle Nutzer als Basis. Ergänzen Sie Guardrails und Inhaltswünsche – keine
                alternative Kapitelstruktur für Chat-Antworten (Kurzantwort, Quellen usw. sind produktseitig
                definiert).
              </p>
            )}
            {activeTab === "global" && isAdmin && (
              <p className="text-xs text-muted-foreground">
                Admins können weiterhin jederzeit neue Regeln ergänzen oder bestehende Regeln bearbeiten.
              </p>
            )}
          </section>

          {activeTab === "user" && (
            <div className="space-y-10">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Type className="w-4 h-4 text-accent" />
                  Darstellung
                </h3>
                <p className="text-sm text-muted-foreground">
                  Passen Sie Darstellung und Erscheinungsbild an.
                </p>
              </div>

              <section className="p-6 rounded-xl border border-border bg-card/50 shadow-sm space-y-4">
                <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  {darkMode ? <Moon className="w-4 h-4 text-accent" /> : <Sun className="w-4 h-4 text-accent" />}
                  Erscheinungsbild
                </h4>
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
                <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Type className="w-4 h-4 text-accent" />
                  UI-Größe: {uiScale}%
                </h4>
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

              <section
                id="docbill-tastenkurzel"
                className="p-6 rounded-xl border border-border bg-card/50 shadow-sm space-y-4"
              >
                <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Keyboard className="w-4 h-4 text-accent" />
                  Tastenkürzel
                </h4>
                <KeyboardShortcutPrefsEditor
                  prefs={shortcutPrefs}
                  onChange={setShortcutPrefs}
                  onReset={resetShortcutPrefs}
                />
                <div className="border-t border-border pt-4">
                  <p className="text-xs font-medium text-muted-foreground mb-3">Übersicht</p>
                  <KeyboardShortcutsReference prefs={shortcutPrefs} />
                </div>
              </section>
            </div>
          )}

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
                      disabled={uploading || migrating}
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
                        disabled={migrating || uploading}
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

              {(uploadProgress ||
                savedContextUploadSnapshot ||
                migrateProgress ||
                savedMigrateSnapshot) && (
                <div className="space-y-3">
                  {(uploadProgress || savedContextUploadSnapshot) && (
                    <ContextUploadProgress
                      variant="upload"
                      filename={(uploadProgress ?? savedContextUploadSnapshot)!.filename}
                      stepStates={(uploadProgress ?? savedContextUploadSnapshot)!.steps}
                      startedAt={uploadProgress?.startedAt ?? null}
                    />
                  )}
                  {(migrateProgress || savedMigrateSnapshot) && (
                    <ContextUploadProgress
                      variant="migrate"
                      filename={(migrateProgress ?? savedMigrateSnapshot)!.filename}
                      stepStates={(migrateProgress ?? savedMigrateSnapshot)!.steps}
                      startedAt={migrateProgress?.startedAt ?? null}
                    />
                  )}
                </div>
              )}

              {contextFiles.length > 0 && (
                <div className="space-y-1 mt-4">
                  {contextFiles.map((f) => (
                    <Collapsible key={f.id} className="group rounded-md bg-muted/40 overflow-hidden">
                      <div className="flex items-center gap-2 px-2 py-1.5">
                        <Button
                          variant="ghost"
                          type="button"
                          className="h-auto min-h-7 py-1 px-1.5 -ml-1 flex-1 justify-start gap-2 min-w-0 text-sm font-normal text-muted-foreground hover:text-foreground hover:bg-muted/50"
                          onClick={() => openPreview(f)}
                          title="Vorschau öffnen"
                        >
                          <FileText className="w-3.5 h-3.5 shrink-0" aria-hidden />
                          <span className="truncate text-left">{f.filename}</span>
                        </Button>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {new Date(f.created_at).toLocaleDateString("de-DE")}
                        </span>
                        <CollapsibleTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs gap-1.5 shrink-0 text-muted-foreground hover:text-foreground"
                            type="button"
                            title="Indexstatus und Ablauf anzeigen"
                            aria-label={
                              indexedFileIds.has(f.id)
                                ? "Aktiv – Indexstatus und Ablauf anzeigen"
                                : "Noch nicht indexiert – Ablauf anzeigen"
                            }
                          >
                            <ChevronDown className="w-3.5 h-3.5 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
                            <span className="flex items-center gap-1.5">
                              {indexedFileIds.has(f.id) ? "Aktiv" : null}
                              <span
                                className={cn(
                                  "w-2 h-2 rounded-full shrink-0",
                                  indexedFileIds.has(f.id)
                                    ? "bg-emerald-600 dark:bg-emerald-400"
                                    : "bg-muted-foreground/45",
                                )}
                                aria-hidden
                              />
                            </span>
                          </Button>
                        </CollapsibleTrigger>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 flex-shrink-0"
                          onClick={() => deleteContextFile(f.id, f.filename)}
                        >
                          <Trash2 className="w-3 h-3 text-destructive" />
                        </Button>
                      </div>
                      <CollapsibleContent>
                        <div className="px-2 pb-3 border-t border-border/50 bg-background/40">
                          <ContextUploadProgress
                            variant="upload"
                            filename={f.filename}
                            stepStates={buildStepStatesForStoredContextFile(
                              f.filename,
                              indexedFileIds.has(f.id),
                              f.storage_path,
                            )}
                            startedAt={null}
                            historicalNote="Rekonstruierter Stand aus dem gespeicherten Dokument (kein Live-Protokoll beim ursprünglichen Upload)."
                          />
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
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

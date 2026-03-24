export type ShortcutActionId = "newChat" | "upload" | "stop" | "settings" | "help";

export type KeyboardShortcutPrefs = {
  keys: Record<ShortcutActionId, string>;
  escapeStopsAnalysis: boolean;
};

const STORAGE_KEY = "docbill.keyboardShortcuts.v1";

let cachedPrefs: KeyboardShortcutPrefs | null = null;
let cachedRaw: string | null | undefined = undefined;

function invalidatePrefsCache() {
  cachedPrefs = null;
  cachedRaw = undefined;
}

export const DEFAULT_KEYBOARD_SHORTCUT_PREFS: KeyboardShortcutPrefs = {
  keys: {
    newChat: "n",
    upload: "u",
    stop: "s",
    settings: ",",
    help: "/",
  },
  escapeStopsAnalysis: true,
};

export const SHORTCUT_ACTION_LABELS: Record<ShortcutActionId, string> = {
  newChat: "Neuer Chat",
  upload: "Datei anhängen",
  stop: "Analyse stoppen",
  settings: "Einstellungen",
  help: "Tastenkürzel-Übersicht",
};

function parseStoredPrefs(raw: string | null): KeyboardShortcutPrefs {
  try {
    if (!raw) {
      return {
        keys: { ...DEFAULT_KEYBOARD_SHORTCUT_PREFS.keys },
        escapeStopsAnalysis: DEFAULT_KEYBOARD_SHORTCUT_PREFS.escapeStopsAnalysis,
      };
    }
    const parsed = JSON.parse(raw) as Partial<KeyboardShortcutPrefs>;
    const keys = { ...DEFAULT_KEYBOARD_SHORTCUT_PREFS.keys, ...parsed.keys };
    for (const id of Object.keys(DEFAULT_KEYBOARD_SHORTCUT_PREFS.keys) as ShortcutActionId[]) {
      const v = keys[id];
      if (typeof v !== "string" || !isAllowedShortcutKeyToken(v)) {
        keys[id] = DEFAULT_KEYBOARD_SHORTCUT_PREFS.keys[id];
      } else {
        keys[id] = normalizeShortcutKeyToken(v);
      }
    }
    return {
      keys,
      escapeStopsAnalysis: parsed.escapeStopsAnalysis !== false,
    };
  } catch {
    return {
      keys: { ...DEFAULT_KEYBOARD_SHORTCUT_PREFS.keys },
      escapeStopsAnalysis: true,
    };
  }
}

export function loadKeyboardShortcutPrefs(): KeyboardShortcutPrefs {
  if (typeof localStorage === "undefined") {
    return {
      keys: { ...DEFAULT_KEYBOARD_SHORTCUT_PREFS.keys },
      escapeStopsAnalysis: DEFAULT_KEYBOARD_SHORTCUT_PREFS.escapeStopsAnalysis,
    };
  }
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === cachedRaw && cachedPrefs) return cachedPrefs;
  const prefs = parseStoredPrefs(raw);
  cachedPrefs = prefs;
  cachedRaw = raw;
  return prefs;
}

export function saveKeyboardShortcutPrefs(prefs: KeyboardShortcutPrefs): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  invalidatePrefsCache();
  void loadKeyboardShortcutPrefs();
  window.dispatchEvent(new Event("docbill-keyboard-prefs-changed"));
}

export function resetKeyboardShortcutPrefs(): KeyboardShortcutPrefs {
  const p: KeyboardShortcutPrefs = {
    keys: { ...DEFAULT_KEYBOARD_SHORTCUT_PREFS.keys },
    escapeStopsAnalysis: DEFAULT_KEYBOARD_SHORTCUT_PREFS.escapeStopsAnalysis,
  };
  saveKeyboardShortcutPrefs(p);
  return p;
}

export function isAllowedShortcutKeyToken(key: string): boolean {
  if (key === "," || key === "/") return true;
  return key.length === 1 && /[a-z0-9]/i.test(key);
}

export function normalizeShortcutKeyToken(raw: string): string {
  if (raw === ",") return ",";
  if (raw === "/") return "/";
  return raw.slice(0, 1).toLowerCase();
}

export function shortcutKeysConflict(keys: Record<ShortcutActionId, string>): boolean {
  const v = Object.values(keys);
  return new Set(v).size !== v.length;
}

export function matchShortcutToken(e: KeyboardEvent, token: string): boolean {
  if (token === ",") return e.key === ",";
  if (token === "/") return e.key === "/" || e.code === "Slash";
  return e.key.length === 1 && e.key.toLowerCase() === token.toLowerCase();
}

export function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPod|iPad/i.test(navigator.platform ?? "");
}

export function isWindowsPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const p = navigator.platform ?? "";
  const ua = navigator.userAgent ?? "";
  return /Win/i.test(p) || /Windows/i.test(ua);
}

export function modKeyLabel(): string {
  return isApplePlatform() ? "⌘" : "Strg";
}

/** e.g. "Strg+U" / "⌘+U" for tooltips */
export function formatModCombo(token: string): string {
  const mod = modKeyLabel();
  const show = token === "," ? "," : token === "/" ? "/" : token.toUpperCase();
  return `${mod}+${show}`;
}

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

/** Default key tokens; newChat uses ⌘+Page↑ / Strg+Bild↑ — rarely used by the page, distinct from ⌘N. */
const DEFAULT_SHORTCUT_KEYS: Record<ShortcutActionId, string> = {
  newChat: "pageup",
  upload: "u",
  stop: "s",
  settings: ",",
  help: "/",
};

/** True when DocBill runs in a desktop shell (Tauri/Electron) or explicitly flags desktop — not a normal browser tab. */
export function isDocbillDesktopShell(): boolean {
  if (typeof window === "undefined") return false;
  if (window.__DOCBILL_DESKTOP__ === true) return true;
  if ("__TAURI_INTERNALS__" in window || "__TAURI__" in window) return true;
  const w = window as Window & { electron?: unknown; process?: Versions };
  type Versions = { versions?: { electron?: string } };
  if (w.electron != null) return true;
  if (w.process?.versions?.electron != null) return true;
  return false;
}

export function getDefaultKeyboardShortcutPrefs(): KeyboardShortcutPrefs {
  return {
    keys: { ...DEFAULT_SHORTCUT_KEYS },
    escapeStopsAnalysis: true,
  };
}

function clonePrefs(p: KeyboardShortcutPrefs): KeyboardShortcutPrefs {
  return {
    keys: { ...p.keys },
    escapeStopsAnalysis: p.escapeStopsAnalysis,
  };
}

export const SHORTCUT_ACTION_LABELS: Record<ShortcutActionId, string> = {
  newChat: "Neuer Chat",
  upload: "Datei anhängen",
  stop: "Analyse stoppen",
  settings: "Einstellungen",
  help: "Tastenkürzel-Übersicht",
};

function parseStoredPrefs(raw: string | null): KeyboardShortcutPrefs {
  const base = getDefaultKeyboardShortcutPrefs();
  try {
    if (!raw) {
      return clonePrefs(base);
    }
    const parsed = JSON.parse(raw) as Partial<KeyboardShortcutPrefs>;
    const keys = { ...base.keys, ...parsed.keys };
    for (const id of Object.keys(DEFAULT_SHORTCUT_KEYS) as ShortcutActionId[]) {
      const v = keys[id];
      if (typeof v !== "string" || !isAllowedShortcutKeyToken(v)) {
        keys[id] = base.keys[id];
      } else {
        keys[id] = normalizeShortcutKeyToken(v);
      }
    }
    return {
      keys,
      escapeStopsAnalysis: parsed.escapeStopsAnalysis !== false,
    };
  } catch {
    return clonePrefs(base);
  }
}

export function loadKeyboardShortcutPrefs(): KeyboardShortcutPrefs {
  if (typeof localStorage === "undefined") {
    return clonePrefs(getDefaultKeyboardShortcutPrefs());
  }
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === cachedRaw && cachedPrefs) return cachedPrefs;

  let newChatMigrateTo: string | null = null;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<KeyboardShortcutPrefs>;
      const nc = parsed.keys?.newChat;
      if (nc === "n" || nc === "alt+n" || nc === "alt+k" || nc === "ctrl+n") newChatMigrateTo = "pageup";
    } catch {
      /* ignore */
    }
  }

  const prefs = parseStoredPrefs(raw);
  const nextPrefs = newChatMigrateTo
    ? { ...prefs, keys: { ...prefs.keys, newChat: newChatMigrateTo } }
    : prefs;

  if (newChatMigrateTo) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextPrefs));
    window.dispatchEvent(new Event("docbill-keyboard-prefs-changed"));
  }

  cachedPrefs = nextPrefs;
  cachedRaw = localStorage.getItem(STORAGE_KEY);
  return nextPrefs;
}

export function saveKeyboardShortcutPrefs(prefs: KeyboardShortcutPrefs): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  invalidatePrefsCache();
  void loadKeyboardShortcutPrefs();
  window.dispatchEvent(new Event("docbill-keyboard-prefs-changed"));
}

export function resetKeyboardShortcutPrefs(): KeyboardShortcutPrefs {
  const p = getDefaultKeyboardShortcutPrefs();
  saveKeyboardShortcutPrefs(p);
  return p;
}

export function isAllowedShortcutKeyToken(key: string): boolean {
  if (key.startsWith("ctrl+")) {
    const rest = key.slice(5);
    if (rest === "," || rest === "/" || rest === "pageup") return true;
    return rest.length === 1 && /[a-z0-9]/i.test(rest);
  }
  if (key.startsWith("alt+")) {
    const rest = key.slice(4);
    if (rest === "," || rest === "/" || rest === "pageup") return true;
    return rest.length === 1 && /[a-z0-9]/i.test(rest);
  }
  if (key === "," || key === "/" || key === "pageup") return true;
  return key.length === 1 && /[a-z0-9]/i.test(key);
}

export function normalizeShortcutKeyToken(raw: string): string {
  if (raw.startsWith("ctrl+")) {
    const rest = raw.slice(5);
    if (rest === ",") return "ctrl+,";
    if (rest === "/") return "ctrl+/";
    if (rest.toLowerCase() === "pageup") return "ctrl+pageup";
    if (rest.length >= 1 && /[a-z0-9]/i.test(rest[0])) return `ctrl+${rest[0].toLowerCase()}`;
    return raw;
  }
  if (raw.startsWith("alt+")) {
    const rest = raw.slice(4);
    if (rest === ",") return "alt+,";
    if (rest === "/") return "alt+/";
    if (rest.toLowerCase() === "pageup") return "alt+pageup";
    if (rest.length >= 1 && /[a-z0-9]/i.test(rest[0])) return `alt+${rest[0].toLowerCase()}`;
    return raw;
  }
  if (raw === ",") return ",";
  if (raw === "/") return "/";
  if (raw.toLowerCase() === "pageup") return "pageup";
  return raw.slice(0, 1).toLowerCase();
}

function matchKeySegment(e: KeyboardEvent, segment: string): boolean {
  if (segment === ",") return e.key === ",";
  if (segment === "/") return e.key === "/" || e.code === "Slash";
  if (segment === "pageup") return e.key === "PageUp";
  return e.key.length === 1 && e.key.toLowerCase() === segment.toLowerCase();
}

export function shortcutTokenUsesAlt(token: string): boolean {
  return token.startsWith("alt+");
}

export function shortcutTokenUsesCtrl(token: string): boolean {
  return token.startsWith("ctrl+");
}

export function shortcutKeysConflict(keys: Record<ShortcutActionId, string>): boolean {
  const v = Object.values(keys);
  return new Set(v).size !== v.length;
}

/**
 * Full shortcut match: modifiers + key. ctrl+… = Control/Strg only (not ⌘ on Mac).
 * Plain tokens: ⌘ or Strg (metaKey || ctrlKey), not Alt.
 * alt+…: ⌘/Strg + Alt (browser-dependent; some chords are reserved).
 */
export function matchShortcutToken(e: KeyboardEvent, token: string): boolean {
  if (token.startsWith("ctrl+")) {
    if (!e.ctrlKey || e.metaKey || e.altKey) return false;
    return matchKeySegment(e, token.slice(5));
  }
  if (token.startsWith("alt+")) {
    if (!(e.metaKey || e.ctrlKey) || !e.altKey) return false;
    return matchKeySegment(e, token.slice(4));
  }
  if (e.altKey) return false;
  if (!(e.metaKey || e.ctrlKey)) return false;
  return matchKeySegment(e, token);
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

export function ctrlKeyLabel(): string {
  return isApplePlatform() ? "⌃" : "Strg";
}

/** Human label for the non-modifier key (Page Up vs Bild↑). */
export function pageUpKeyLabel(): string {
  return isWindowsPlatform() ? "Bild↑" : "Page↑";
}

/** Key segment for UI (reference + combos); same idea as formatModCombo’s key half. */
export function shortcutTokenPrimaryKeyLabel(token: string): string {
  const usesAlt = token.startsWith("alt+");
  const usesCtrl = token.startsWith("ctrl+");
  const rest = usesAlt ? token.slice(4) : usesCtrl ? token.slice(5) : token;
  if (rest === ",") return ",";
  if (rest === "/") return "/";
  if (rest === "pageup") return pageUpKeyLabel();
  return rest.toUpperCase();
}

/** e.g. "Strg+U" / "⌘+U"; ctrl+: "⌃+N" / "Strg+N"; alt+: "⌥+⌘+K" / "Alt+Strg+K" */
export function formatModCombo(token: string): string {
  const mod = modKeyLabel();
  const altLabel = isApplePlatform() ? "⌥" : "Alt";
  if (token.startsWith("ctrl+")) {
    const rest = token.slice(5);
    const show =
      rest === "," ? "," : rest === "/" ? "/" : rest === "pageup" ? pageUpKeyLabel() : rest.toUpperCase();
    return `${ctrlKeyLabel()}+${show}`;
  }
  if (token.startsWith("alt+")) {
    const rest = token.slice(4);
    const show =
      rest === "," ? "," : rest === "/" ? "/" : rest === "pageup" ? pageUpKeyLabel() : rest.toUpperCase();
    return `${altLabel}+${mod}+${show}`;
  }
  const show =
    token === "," ? "," : token === "/" ? "/" : token === "pageup" ? pageUpKeyLabel() : token.toUpperCase();
  return `${mod}+${show}`;
}

declare global {
  interface Window {
    /** Set to true when embedded in a desktop shell (reserved for future defaults). */
    __DOCBILL_DESKTOP__?: boolean;
  }
}

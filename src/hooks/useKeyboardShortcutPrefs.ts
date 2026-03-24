import { useCallback, useSyncExternalStore } from "react";
import {
  loadKeyboardShortcutPrefs,
  saveKeyboardShortcutPrefs,
  resetKeyboardShortcutPrefs,
  type KeyboardShortcutPrefs,
} from "@/lib/keyboardShortcutPrefs";

function subscribe(onStoreChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === "docbill.keyboardShortcuts.v1" || e.key === null) onStoreChange();
  };
  const onCustom = () => onStoreChange();
  window.addEventListener("storage", onStorage);
  window.addEventListener("docbill-keyboard-prefs-changed", onCustom);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("docbill-keyboard-prefs-changed", onCustom);
  };
}

function getSnapshot(): KeyboardShortcutPrefs {
  return loadKeyboardShortcutPrefs();
}

export function useKeyboardShortcutPrefs() {
  const prefs = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const setPrefs = useCallback((next: KeyboardShortcutPrefs) => {
    saveKeyboardShortcutPrefs(next);
  }, []);

  const reset = useCallback(() => {
    resetKeyboardShortcutPrefs();
  }, []);

  return { prefs, setPrefs, reset };
}

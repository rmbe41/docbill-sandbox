import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  loadKeyboardShortcutPrefs,
  type KeyboardShortcutPrefs,
  type ShortcutActionId,
  SHORTCUT_ACTION_LABELS,
  normalizeShortcutKeyToken,
  shortcutKeysConflict,
  modKeyLabel,
  formatModCombo,
  isDocbillDesktopShell,
} from "@/lib/keyboardShortcutPrefs";
import { cn } from "@/lib/utils";

type Props = {
  prefs: KeyboardShortcutPrefs;
  onChange: (next: KeyboardShortcutPrefs) => void;
  onReset: () => void;
};

export function KeyboardShortcutPrefsEditor({ prefs, onChange, onReset }: Props) {
  const { toast } = useToast();
  const [recording, setRecording] = useState<ShortcutActionId | null>(null);
  const mod = modKeyLabel();
  const webHint =
    !isDocbillDesktopShell() &&
    "Im Browser: „Neuer Chat“ ist standardmäßig Strg+N (Mac: Taste „ctrl“/„^“, nicht Command). Manche Tastenkombinationen fängt der Browser trotzdem ab — dann eine andere Belegung wählen.";

  useEffect(() => {
    if (!recording) {
      document.documentElement.removeAttribute("data-docbill-capture-shortcut");
      return;
    }
    document.documentElement.setAttribute("data-docbill-capture-shortcut", "");

    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        setRecording(null);
        return;
      }

      const modHeld = e.metaKey || e.ctrlKey;
      if (!modHeld) {
        toast({
          title: "Modifier fehlt",
          description: `Bitte ${mod} gedrückt halten und eine Taste wählen.`,
          variant: "destructive",
        });
        return;
      }

      let token: string | null = null;
      if (e.key === ",")
        token = e.altKey ? "alt+," : e.ctrlKey && !e.metaKey ? "ctrl+," : ",";
      else if (e.key === "/" || e.code === "Slash")
        token = e.altKey ? "alt+/" : e.ctrlKey && !e.metaKey ? "ctrl+/" : "/";
      else if (e.key.length === 1 && /[a-z0-9]/i.test(e.key)) {
        const k = normalizeShortcutKeyToken(e.key);
        if (e.altKey) token = `alt+${k}`;
        else if (e.ctrlKey && !e.metaKey) token = `ctrl+${k}`;
        else token = k;
      } else {
        toast({
          title: "Taste nicht unterstützt",
          description: "Nur Buchstaben, Ziffern, Komma oder Schrägstrich.",
          variant: "destructive",
        });
        return;
      }

      const current = loadKeyboardShortcutPrefs();
      const nextKeys = { ...current.keys, [recording]: token };
      if (shortcutKeysConflict(nextKeys)) {
        toast({
          title: "Doppelbelegung",
          description: "Diese Taste ist schon einer anderen Aktion zugewiesen.",
          variant: "destructive",
        });
        return;
      }

      onChange({ ...current, keys: nextKeys });
      setRecording(null);
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.documentElement.removeAttribute("data-docbill-capture-shortcut");
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [recording, onChange, toast, mod]);

  const startRecord = useCallback((id: ShortcutActionId) => {
    setRecording(id);
  }, []);

  return (
    <div className="space-y-4">
      <div className="space-y-1.5 text-xs text-muted-foreground">
        <p>
          Klicken Sie auf „Neue Taste“, halten Sie {mod} (oder nur Strg / „ctrl“ auf dem Mac für eine Strg-Kombination)
          und drücken Sie die gewünschte Taste. Optional zusätzlich Alt (⌥). Escape bricht ab.
        </p>
        {webHint ? <p>{webHint}</p> : null}
      </div>
      <ul className="space-y-3">
        {(Object.keys(SHORTCUT_ACTION_LABELS) as ShortcutActionId[]).map((id) => (
          <li
            key={id}
            className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
          >
            <span className="text-sm text-foreground shrink-0">{SHORTCUT_ACTION_LABELS[id]}</span>
            <div className="flex flex-wrap items-center gap-2">
              <kbd
                className={cn(
                  "inline-flex min-w-[4.5rem] justify-center rounded border border-border bg-muted px-2 py-1 text-xs font-mono",
                  recording === id && "ring-2 ring-accent-subtle-foreground",
                )}
              >
                {recording === id ? "…" : formatModCombo(prefs.keys[id])}
              </kbd>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => startRecord(id)}
              >
                Neue Taste
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-0.5">
          <Label htmlFor="esc-stop" className="text-sm font-medium text-foreground">
            Escape stoppt Analyse
          </Label>
          <p className="text-xs text-muted-foreground">
            Wenn aktiv: Esc beendet eine laufende Analyse (keine anderen Dialoge offen).
          </p>
        </div>
        <Switch
          id="esc-stop"
          checked={prefs.escapeStopsAnalysis}
          onCheckedChange={(checked) => onChange({ ...prefs, escapeStopsAnalysis: checked })}
        />
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        <Button type="button" variant="secondary" size="sm" onClick={onReset}>
          Standard wiederherstellen
        </Button>
      </div>
    </div>
  );
}

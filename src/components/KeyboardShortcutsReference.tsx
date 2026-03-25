import { useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  type KeyboardShortcutPrefs,
  isApplePlatform,
  isWindowsPlatform,
  isDocbillDesktopShell,
  modKeyLabel,
  ctrlKeyLabel,
  shortcutTokenUsesAlt,
  shortcutTokenUsesCtrl,
} from "@/lib/keyboardShortcutPrefs";

function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 text-xs font-mono text-foreground",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

function Combo({ parts }: { parts: React.ReactNode[] }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {parts.map((p, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {i > 0 ? <span className="text-muted-foreground">+</span> : null}
          {p}
        </span>
      ))}
    </span>
  );
}

type Row = { action: string; combo: React.ReactNode };

type Props = {
  className?: string;
  prefs: KeyboardShortcutPrefs;
};

export function KeyboardShortcutsReference({ className, prefs }: Props) {
  const mod = modKeyLabel();
  const ctrlMod = ctrlKeyLabel();
  const apple = isApplePlatform();
  const windows = isWindowsPlatform();

  const appRows: Row[] = useMemo(() => {
    const comboFor = (token: string) => {
      const usesAlt = shortcutTokenUsesAlt(token);
      const usesCtrl = shortcutTokenUsesCtrl(token);
      const rest = usesAlt ? token.slice(4) : usesCtrl ? token.slice(5) : token;
      const t = rest === "," ? "," : rest === "/" ? "/" : rest.toUpperCase();
      const parts: React.ReactNode[] = [];
      if (usesAlt) {
        parts.push(<Kbd key="alt">{apple ? "⌥" : "Alt"}</Kbd>);
      }
      if (usesCtrl) {
        parts.push(<Kbd key="c">{ctrlMod}</Kbd>);
      } else {
        parts.push(<Kbd key="m">{mod}</Kbd>);
      }
      parts.push(<Kbd key="k">{t}</Kbd>);
      return <Combo parts={parts} />;
    };

    const rows: Row[] = [
      { action: "Neuer Chat", combo: comboFor(prefs.keys.newChat) },
      { action: "Datei anhängen", combo: comboFor(prefs.keys.upload) },
      {
        action: "Analyse stoppen (wenn aktiv)",
        combo: comboFor(prefs.keys.stop),
      },
      { action: "Einstellungen", combo: comboFor(prefs.keys.settings) },
      { action: "Diese Übersicht", combo: comboFor(prefs.keys.help) },
    ];
    if (prefs.escapeStopsAnalysis) {
      rows.push({
        action: "Analyse stoppen (Escape)",
        combo: <Kbd>Esc</Kbd>,
      });
    }
    return rows;
  }, [mod, ctrlMod, apple, prefs.escapeStopsAnalysis, prefs.keys]);

  const composerRows: Row[] = useMemo(
    () => [
      {
        action: "Nachricht senden",
        combo: <Kbd>Enter</Kbd>,
      },
      {
        action: "Zeilenumbruch",
        combo: (
          <Combo
            parts={[<Kbd key="s">Shift</Kbd>, <Kbd key="e">Enter</Kbd>]}
          />
        ),
      },
      {
        action: "Fett",
        combo: (
          <Combo
            parts={[<Kbd key="m">{mod}</Kbd>, <Kbd key="k">B</Kbd>]}
          />
        ),
      },
      {
        action: "Kursiv",
        combo: (
          <Combo
            parts={[<Kbd key="m">{mod}</Kbd>, <Kbd key="k">I</Kbd>]}
          />
        ),
      },
      {
        action: "Durchgestrichen",
        combo: (
          <Combo
            parts={[
              <Kbd key="m">{mod}</Kbd>,
              <Kbd key="s">Shift</Kbd>,
              <Kbd key="k">S</Kbd>,
            ]}
          />
        ),
      },
      {
        action: "Code",
        combo: (
          <Combo
            parts={[
              <Kbd key="m">{mod}</Kbd>,
              <Kbd key="s">Shift</Kbd>,
              <Kbd key="k">C</Kbd>,
            ]}
          />
        ),
      },
      {
        action: "Aufzählungsliste",
        combo: (
          <Combo
            parts={[
              <Kbd key="m">{mod}</Kbd>,
              <Kbd key="s">Shift</Kbd>,
              <Kbd key="k">8</Kbd>,
            ]}
          />
        ),
      },
      {
        action: "Nummerierte Liste",
        combo: (
          <Combo
            parts={[
              <Kbd key="m">{mod}</Kbd>,
              <Kbd key="s">Shift</Kbd>,
              <Kbd key="k">7</Kbd>,
            ]}
          />
        ),
      },
    ],
    [mod],
  );

  return (
    <div className={cn("space-y-6 text-sm", className)}>
      <div className="space-y-2 text-xs text-muted-foreground">
        {apple ? (
          <p>Auf dem Mac: <Kbd className="mx-0.5">⌘</Kbd> (Command) plus Taste.</p>
        ) : windows ? (
          <p>
            Unter Windows: <Kbd className="mx-0.5">Strg</Kbd> (Ctrl) plus Taste — dieselben Kürzel wie auf dem Mac, nur mit Strg statt Command.
            Auf deutscher Tastatur liegt Strg meist links unten neben der Leertaste.
          </p>
        ) : (
          <p>
            <Kbd className="mx-0.5">Strg</Kbd> (Ctrl) plus Taste — links unten auf der Tastatur, oft mit „Strg“ oder „Ctrl“ beschriftet.
          </p>
        )}
        {!isDocbillDesktopShell() ? (
          <>
            <p>
              Im normalen Browser nutzt <span className="text-foreground">Neuer Chat</span> standardmäßig{" "}
              <Kbd className="mx-0.5">{ctrlMod}</Kbd>+<Kbd className="mx-0.5">N</Kbd>
              {apple ? " (auf dem Mac die Control-Taste „^“, nicht Command)" : ""}, damit das Kürzel nicht mit „neues
              Fenster“ kollidiert.
            </p>
            <p>
              Welche Kombinationen reserviert sind, hängt vom Browser ab — ein Kürzel kann in den Einstellungen
              gespeichert sein, wirkt aber nicht, wenn der Browser es zuerst abfängt.
            </p>
          </>
        ) : null}
      </div>
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">App</h3>
        <ul className="space-y-2">
          {appRows.map((row) => (
            <li key={row.action} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <span className="text-foreground">{row.action}</span>
              <span className="shrink-0 text-muted-foreground sm:text-foreground">{row.combo}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Eingabefeld (Chat)</h3>
        <ul className="space-y-2">
          {composerRows.map((row) => (
            <li key={row.action} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <span className="text-foreground">{row.action}</span>
              <span className="shrink-0 text-muted-foreground sm:text-foreground">{row.combo}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

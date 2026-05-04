import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function readExpectedPassword(): string {
  type GlobalWithPw = typeof globalThis & { __DOCBILL_ACCESS_PW?: unknown };
  const fromHtml =
    typeof globalThis !== "undefined" ? (globalThis as GlobalWithPw).__DOCBILL_ACCESS_PW : undefined;
  const fromEnv = import.meta.env.VITE_APP_ACCESS_PASSWORD as unknown;
  const raw = fromHtml !== undefined && fromHtml !== null ? fromHtml : fromEnv;
  if (raw == null || raw === "") return "";
  return String(raw).trim();
}

export function PasswordGate({ children }: { children: ReactNode }) {
  const expected = readExpectedPassword();

  const [unlocked, setUnlocked] = useState(() => !expected);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!expected || unlocked) {
    return <>{children}</>;
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password === expected) {
      setUnlocked(true);
      return;
    }
    setError("Falsches Passwort.");
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm space-y-6 rounded-lg border bg-card p-6 shadow-lg">
        <div className="space-y-1 text-center">
          <h1 className="text-lg font-semibold tracking-tight">Zugang</h1>
          <p className="text-sm text-muted-foreground">Bitte Passwort eingeben, um fortzufahren.</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="access-password">Passwort</Label>
            <Input
              id="access-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(ev) => setPassword(ev.target.value)}
              className={error ? "border-destructive" : undefined}
            />
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
          <Button type="submit" className="w-full">
            Weiter
          </Button>
        </form>
      </div>
    </div>
  );
}

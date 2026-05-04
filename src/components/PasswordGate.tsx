import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const STORAGE_KEY = "docbill-sandbox-unlocked";

function readExpectedPassword(): string {
  const v = import.meta.env.VITE_APP_ACCESS_PASSWORD;
  return typeof v === "string" ? v.trim() : "";
}

export function PasswordGate({ children }: { children: React.ReactNode }) {
  const expected = readExpectedPassword();

  const [unlocked, setUnlocked] = useState(() => {
    if (!expected) return true;
    try {
      return sessionStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!expected || unlocked) {
    return <>{children}</>;
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password === expected) {
      try {
        sessionStorage.setItem(STORAGE_KEY, "1");
      } catch {
        /* private mode etc. */
      }
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

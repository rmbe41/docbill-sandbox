import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LayoutGrid } from "lucide-react";
import { useSandbox } from "@/lib/sandbox/sandboxStore";
import DocBillLogo from "@/assets/DocBill-Logo.svg";

export default function SandboxLayout() {
  const { pathname } = useLocation();
  const { reset, state } = useSandbox();

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 shrink-0 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="border-b border-border bg-muted/50 dark:bg-muted/40">
          <div className="max-w-[1600px] mx-auto px-4 md:px-6 py-2 flex flex-wrap items-center gap-3 text-xs">
            <p className="text-foreground font-medium">Beispieldaten — Zurücksetzen lädt den Anfangszustand neu.</p>
            <Button variant="outline" size="sm" className="h-7 text-xs bg-background" type="button" onClick={() => reset()}>
              Zurücksetzen
            </Button>
          </div>
        </div>

        <div className="max-w-[1600px] mx-auto px-4 md:px-6 py-3">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
            <div className="justify-self-start min-w-0 flex flex-col gap-1 self-start">
              <Link
                to="/sandbox/rechnungen"
                className="shrink-0 inline-flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
                aria-label="DocBill Sandbox — Zur Übersicht"
              >
                <img src={DocBillLogo} alt="" className="h-8 w-auto dark:opacity-95" />
                <span className="font-semibold tracking-tight text-sm">DocBill Sandbox</span>
              </Link>
              <p className="text-[11px] leading-snug text-muted-foreground truncate text-left">
                {state.practice_line}
              </p>
            </div>

            <p className="inline-flex flex-wrap items-center justify-center gap-x-0 row-gap-0.5 text-sm text-muted-foreground shrink-0 text-center px-3 py-1.5 rounded-xl border border-border bg-background shadow-md justify-self-center self-center">
              <span className="font-medium text-foreground">Sandbox</span>
              <span className="mx-1.5 opacity-70">|</span>
              <Link
                to="/"
                className="text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-md ring-offset-background"
              >
                Zurück zur Website
              </Link>
            </p>

            <div className="justify-self-end flex items-center gap-2 flex-wrap self-center">
              <NavLink
                to="/sandbox/rechnungen"
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-1.5 rounded-md px-2.5 py-2 text-sm whitespace-nowrap transition-colors shrink-0",
                    isActive || pathname === "/sandbox"
                      ? "bg-muted text-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/70",
                  )
                }
              >
                <LayoutGrid className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
                Übersicht
              </NavLink>
              <Button size="sm" className="shrink-0" asChild>
                <Link to="/sandbox/dokus/new">Neue Dokumentation</Link>
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main id="sandbox-main" className="flex-1 w-full max-w-[1600px] mx-auto px-4 md:px-6 py-6 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}

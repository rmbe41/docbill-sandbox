import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { LayoutGrid } from "lucide-react";
import { useSandbox } from "@/lib/sandbox/sandboxStore";
import DocBillLogo from "@/assets/DocBill-Logo.svg";

export default function SandboxLayout() {
  const { pathname } = useLocation();
  const { state, reset } = useSandbox();
  const [resetOpen, setResetOpen] = useState(false);

  const confirmReset = () => {
    reset();
    setResetOpen(false);
  };

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 shrink-0 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="w-full px-4 md:px-6 lg:px-8 py-3">
          <div className="grid grid-cols-1 gap-y-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center sm:gap-x-3">
            <div className="justify-self-start min-w-0 flex flex-col gap-1">
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

            <div className="justify-self-center row-start-2 sm:row-start-auto w-full sm:w-auto flex justify-center">
              <div className="inline-flex max-w-full shrink-0 flex-wrap items-center justify-center gap-x-1.5 gap-y-1 whitespace-normal px-3 py-1.5 text-center text-sm text-muted-foreground rounded-xl border border-border bg-background shadow-sm">
                <span className="font-medium text-foreground whitespace-nowrap">Sandbox</span>
                <span className="opacity-70 select-none" aria-hidden>
                  |
                </span>
                <button
                  type="button"
                  onClick={() => setResetOpen(true)}
                  title="Lädt den Demo-Startzustand neu (lokal)"
                  className="whitespace-nowrap text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-md ring-offset-background bg-transparent border-0 p-0 cursor-pointer text-sm font-inherit"
                >
                  Daten zurücksetzen
                </button>
                <span className="opacity-70 select-none" aria-hidden>
                  |
                </span>
                <Link
                  to="/"
                  className="whitespace-nowrap text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-md ring-offset-background"
                >
                  Zurück zur Website
                </Link>
              </div>
            </div>

            <div className="justify-self-end flex items-center gap-2 flex-wrap row-start-3 sm:row-start-auto sm:justify-self-end">
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
                <Link to="/sandbox/abrechnung/neu">Neue Abrechnung</Link>
              </Button>
            </div>
          </div>
        </div>
      </header>

      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Demo-Daten zurücksetzen?</AlertDialogTitle>
            <AlertDialogDescription>
              Alle Demo-Patienten, Dokumentationen und Rechnungen werden verworfen und der Seed-Zustand neu geladen.
              Es erfolgt keine echte Datenübermittlung.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={confirmReset}>Daten zurücksetzen</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <main id="sandbox-main" className="flex-1 w-full px-4 md:px-6 lg:px-8 py-6 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}

import { Component, type ReactNode } from "react";

type Props = { children: ReactNode; fallback?: ReactNode };
type State = { hasError: boolean; error?: Error };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="min-h-[200px] flex flex-col items-center justify-center p-6 bg-muted/30 rounded-xl border border-border">
          <p className="text-sm font-medium text-foreground mb-1">Etwas ist schiefgelaufen</p>
          <p className="text-xs text-muted-foreground mb-3">{this.state.error?.message}</p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false })}
            className="text-xs text-accent hover:underline"
          >
            Erneut versuchen
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

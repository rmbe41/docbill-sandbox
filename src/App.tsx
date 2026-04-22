import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { initPostHog } from "@/lib/observability/posthog";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { DraftProvider } from "@/hooks/useDraft";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Settings from "./pages/Settings";
import Profile from "./pages/Profile";
import NotFound from "./pages/NotFound";
import Status from "./pages/Status";
import FeedbackDashboard from "./pages/FeedbackDashboard";
import BatchesPage from "./pages/BatchesPage";
import BatchDetailPage from "./pages/BatchDetailPage";
import AcceptInvitePage from "./pages/AcceptInvitePage";
import KbRelevanzDashboard from "./pages/KbRelevanzDashboard";

const queryClient = new QueryClient();

function PostHogRootInit() {
  useEffect(() => {
    initPostHog();
  }, []);
  return null;
}

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  if (loading)
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Laden…</p>
      </div>
    );
  if (!user) return <Navigate to="/auth" replace />;
  return <>{children}</>;
};

const AuthRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <PostHogRootInit />
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <DraftProvider>
            <Routes>
              <Route path="/status" element={<Status />} />
              <Route
                path="/dashboard/feedback"
                element={
                  <ProtectedRoute>
                    <FeedbackDashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/batches"
                element={
                  <ProtectedRoute>
                    <BatchesPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/batches/:batchId"
                element={
                  <ProtectedRoute>
                    <BatchDetailPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/invite/:token"
                element={
                  <ProtectedRoute>
                    <AcceptInvitePage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/dashboard/kb-relevanz"
                element={
                  <ProtectedRoute>
                    <KbRelevanzDashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/auth"
                element={
                  <AuthRoute>
                    <Auth />
                  </AuthRoute>
                }
              />
              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <Index />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/settings"
                element={
                  <ProtectedRoute>
                    <Settings />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/profile"
                element={
                  <ProtectedRoute>
                    <Profile />
                  </ProtectedRoute>
                }
              />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </DraftProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

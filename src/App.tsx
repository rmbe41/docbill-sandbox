import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
import { initPostHog } from "@/lib/observability/posthog";
import { AuthProvider } from "@/hooks/useAuth";
import { PasswordGate } from "@/components/PasswordGate";
import Settings from "./pages/Settings";
import Profile from "./pages/Profile";
import NotFound from "./pages/NotFound";
import Status from "./pages/Status";
import FeedbackDashboard from "./pages/FeedbackDashboard";
import BatchesPage from "./pages/BatchesPage";
import BatchDetailPage from "./pages/BatchDetailPage";
import AcceptInvitePage from "./pages/AcceptInvitePage";
import KbRelevanzDashboard from "./pages/KbRelevanzDashboard";
import { SandboxProvider } from "@/lib/sandbox/sandboxStore";
import SandboxLayout from "@/pages/sandbox/SandboxLayout";
import SandboxRechnungenPage from "@/pages/sandbox/SandboxRechnungenPage";
import SandboxDokumentationenPage from "@/pages/sandbox/SandboxDokumentationenPage";
import SandboxNewDocPage from "@/pages/sandbox/SandboxNewDocPage";
import SandboxAnalysePage from "@/pages/sandbox/SandboxAnalysePage";
import SandboxReviewPage from "@/pages/sandbox/SandboxReviewPage";

const queryClient = new QueryClient();

function PostHogRootInit() {
  useEffect(() => {
    initPostHog();
  }, []);
  return null;
}

function LegacySandboxAnalyseRedirect() {
  const { docId } = useParams<{ docId: string }>();
  if (!docId) return <Navigate to="/" replace />;
  return <Navigate to={`/analyse/${docId}`} replace />;
}

function LegacySandboxReviewRedirect() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  if (!invoiceId) return <Navigate to="/" replace />;
  return <Navigate to={`/review/${invoiceId}`} replace />;
}

function SandboxRootLayout() {
  return (
    <SandboxProvider>
      <SandboxLayout />
    </SandboxProvider>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <PostHogRootInit />
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <PasswordGate>
          <AuthProvider>
            <Routes>
              <Route path="/status" element={<Status />} />
              <Route path="/sandbox" element={<Navigate to="/" replace />} />
              <Route path="/sandbox/rechnungen" element={<Navigate to="/" replace />} />
              <Route path="/sandbox/dokumentationen" element={<Navigate to="/dokumentationen" replace />} />
              <Route path="/sandbox/abrechnung/neu" element={<Navigate to="/abrechnung/neu" replace />} />
              <Route path="/sandbox/analyse/:docId" element={<LegacySandboxAnalyseRedirect />} />
              <Route path="/sandbox/review/:invoiceId" element={<LegacySandboxReviewRedirect />} />
              <Route path="/" element={<SandboxRootLayout />}>
                <Route index element={<SandboxRechnungenPage />} />
                <Route path="dokumentationen" element={<SandboxDokumentationenPage />} />
                <Route path="abrechnung/neu" element={<SandboxNewDocPage />} />
                <Route path="analyse/:docId" element={<SandboxAnalysePage />} />
                <Route path="review/:invoiceId" element={<SandboxReviewPage />} />
              </Route>
              <Route path="/dashboard/feedback" element={<FeedbackDashboard />} />
              <Route path="/batches" element={<BatchesPage />} />
              <Route path="/batches/:batchId" element={<BatchDetailPage />} />
              <Route path="/invite/:token" element={<AcceptInvitePage />} />
              <Route path="/dashboard/kb-relevanz" element={<KbRelevanzDashboard />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AuthProvider>
        </PasswordGate>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

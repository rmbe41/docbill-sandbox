import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const supabaseUrl = env.VITE_SUPABASE_URL || "https://qxaijnupaxxxsqaivbtj.supabase.co";
  const accessPassword = env.VITE_APP_ACCESS_PASSWORD ?? "";

  if (mode === "production" && !String(accessPassword).trim()) {
    console.warn(
      "[docbill] VITE_APP_ACCESS_PASSWORD ist leer — das Zugangs-Gate ist deaktiviert. Für sandbox.yourdocbill.com dieselbe Variable in den Build-Umgebungsvariablen des Hostings setzen (nicht nur lokal in .env) und neu deployen.",
    );
  }

  const accessPasswordLiteral = JSON.stringify(accessPassword ?? "").replace(/</g, "\\u003c");

  return {
    plugins: [
      react(),
      {
        name: "docbill-inject-access-password",
        enforce: "post",
        transformIndexHtml(html: string) {
          const inject = `<script>globalThis.__DOCBILL_ACCESS_PW=${accessPasswordLiteral}<\/script>`;
          return html.replace("<head>", `<head>\n    ${inject}`);
        },
      },
    ],
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
      proxy: {
        "/api/supabase": {
          target: supabaseUrl,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/supabase/, ""),
        },
        /** Spec GET /api/health — mappt auf Supabase Edge Function `health` */
        "/api/health": {
          target: supabaseUrl,
          changeOrigin: true,
          rewrite: () => "/functions/v1/health",
        },
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});

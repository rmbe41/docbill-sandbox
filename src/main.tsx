import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

const sentryDsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
if (sentryDsn) {
  void import("@sentry/react").then((Sentry) => {
    Sentry.init({
      dsn: sentryDsn,
      environment: import.meta.env.MODE,
    });
  });
}

// Apply saved UI scale
const savedScale = localStorage.getItem("ui-scale");
if (savedScale) {
  document.documentElement.style.fontSize = `${savedScale}%`;
}

// Apply saved theme
const savedTheme = localStorage.getItem("theme");
if (savedTheme === "dark") {
  document.documentElement.classList.add("dark");
}

createRoot(document.getElementById("root")!).render(<App />);

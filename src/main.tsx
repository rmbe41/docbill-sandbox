import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

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

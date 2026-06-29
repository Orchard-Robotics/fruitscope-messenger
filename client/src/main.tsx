import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { initPrefs } from "./store/prefs";
import "./index.css";

// Apply theme/density prefs before first paint (no flash of the wrong theme).
initPrefs();

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element #root not found");

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { reloadForStaleChunk } from "./lib/lazyRetry";
import { initPrefs } from "./store/prefs";
import "./index.css";

// A deploy replaces the hashed chunk graph; a tab on the old build 404s when it
// lazy-loads a now-pruned chunk. Vite fires `vite:preloadError` for those —
// recover by reloading into the fresh build instead of throwing to the user.
window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  reloadForStaleChunk();
});

// Apply theme/density prefs before first paint (no flash of the wrong theme).
initPrefs();

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element #root not found");

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

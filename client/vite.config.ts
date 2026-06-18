import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = process.env.SERVER_URL ?? "http://localhost:3001";

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@shared": path.resolve(dirname, "../shared"),
      "@": path.resolve(dirname, "src"),
    },
  },
  build: {
    // esbuild minification (Vite default) — explicit, plus no prod sourcemaps.
    minify: "esbuild",
    sourcemap: false,
  },
  // Strip console/debugger from the production bundle only.
  esbuild: mode === "production" ? { drop: ["console", "debugger"] } : {},
  server: {
    port: 5173,
    proxy: {
      "/api": { target: SERVER, changeOrigin: true },
      "/socket.io": { target: SERVER, ws: true, changeOrigin: true },
    },
  },
}));

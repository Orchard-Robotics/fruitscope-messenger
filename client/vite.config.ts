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
    // Terser squeezes a bit smaller than esbuild; multiple passes + dropping
    // console/debugger for the smallest possible production bundle.
    minify: "terser",
    sourcemap: false,
    terserOptions: {
      compress: { passes: 3, drop_console: true, drop_debugger: true },
      format: { comments: false },
    },
    rollupOptions: {
      output: {
        // Peel React (large + very stable) into its own chunk: it downloads in
        // parallel with the app chunk on first paint and stays cached across the
        // frequent deploys (a release only busts the app chunk, not React).
        manualChunks(id) {
          if (id.includes("node_modules") && /[\\/](react|react-dom|scheduler)[\\/]/.test(id)) {
            return "react-vendor";
          }
          return undefined;
        },
      },
    },
  },
  esbuild: mode === "production" ? { drop: ["console", "debugger"] } : {},
  server: {
    port: 5173,
    proxy: {
      "/api": { target: SERVER, changeOrigin: true },
      "/socket.io": { target: SERVER, ws: true, changeOrigin: true },
    },
  },
}));

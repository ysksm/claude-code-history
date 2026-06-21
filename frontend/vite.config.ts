import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Frontend builds into the Go embed package so the whole app ships as one binary.
// In dev (`npm run dev`), /api is proxied to the running `cch serve` on :8080.
export default defineConfig({
  plugins: [react()],
  // Absolute base so deep client-side routes (e.g. /sessions/<id>) resolve assets
  // from /assets/... rather than relative to the route path.
  base: "/",
  build: {
    outDir: "../internal/web/dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8080",
    },
  },
});

import { defineConfig } from "vite";

// nDMindMap dev/build config. Kept intentionally minimal — the app is a
// dependency-free TS single-page app; the graph engine and serializer live in src/.
export default defineConfig({
  root: ".",
  server: {
    port: 5190,
    open: true,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});

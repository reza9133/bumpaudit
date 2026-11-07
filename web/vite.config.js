import { defineConfig } from "vite";

// base "./" keeps the build host-agnostic (GitHub Pages sub-path, IPFS, any static server).
// The app uses hash routing, so no server rewrite rules are needed.
export default defineConfig({
  base: "./",
  // VITE_DEMO=1 enables offline demo data (src/lib/mock.js) for UI development. Off in normal builds.
  define: { __DEMO__: JSON.stringify(process.env.VITE_DEMO === "1") },
  build: {
    target: "es2020",
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/three")) return "three";
          if (id.includes("node_modules/genlayer-js") || id.includes("node_modules/viem") || id.includes("node_modules/@noble") || id.includes("node_modules/@scure") || id.includes("node_modules/abitype")) return "genlayer";
        },
      },
    },
  },
});

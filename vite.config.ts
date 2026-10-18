import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

/**
 * Two entry points sharing one runtime:
 *   index.html  — the published site (scroll-driven)
 *   editor.html — the scene editor
 *
 * `base: "./"` keeps asset URLs relative so an exported folder can be dropped
 * at any path on any static host.
 */
export default defineConfig({
  base: "./",
  server: { open: "/editor.html" },
  build: {
    target: "es2022",
    outDir: "dist",
    rollupOptions: {
      input: {
        site: fileURLToPath(new URL("./index.html", import.meta.url)),
        editor: fileURLToPath(new URL("./editor.html", import.meta.url)),
      },
    },
  },
});

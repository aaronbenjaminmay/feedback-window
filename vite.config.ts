import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

const inlineFigmaUiAssets = () => {
  return {
    name: "inline-figma-ui-assets",
    generateBundle(_options, bundle) {
      const htmlFile = bundle["index.html"];

      if (!htmlFile || htmlFile.type !== "asset") {
        return;
      }

      let html = String(htmlFile.source);

      html = html.replace(
        /<script type="module" crossorigin src="\/([^"]+)"><\/script>/,
        (_match, fileName) => {
          const scriptFile = bundle[fileName];

          if (!scriptFile || scriptFile.type !== "chunk") {
            return "";
          }

          delete bundle[fileName];
          return `<script type="module">${scriptFile.code}</script>`;
        }
      );

      html = html.replace(
        /<link rel="stylesheet" crossorigin href="\/([^"]+)">/,
        (_match, fileName) => {
          const styleFile = bundle[fileName];

          if (!styleFile || styleFile.type !== "asset") {
            return "";
          }

          delete bundle[fileName];
          return `<style>${styleFile.source}</style>`;
        }
      );

      htmlFile.source = html;
    }
  };
};

// Build targets (npm run build:verizon / build:agency) each load their own
// .env.<mode> file and land in their own output directory so both plugin
// builds can exist side by side from the same source. Plain `npm run build`
// (no --mode) keeps writing to dist/, unchanged. These live as siblings of
// dist/, not nested inside it — Vite empties its outDir on every build, so a
// nested dist/verizon would get wiped out by a later plain `npm run build`.
const targetOutDirs: Record<string, string> = {
  verizon: "builds/verizon",
  agency: "builds/agency"
};

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  build: {
    outDir: targetOutDirs[mode] ?? "dist",
    rollupOptions: {
      input: {
        ui: resolve(__dirname, "index.html"),
        main: resolve(__dirname, "src/main.ts")
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "[name].js",
        assetFileNames: "[name][extname]"
      },
      plugins: [inlineFigmaUiAssets()]
    }
  }
}));

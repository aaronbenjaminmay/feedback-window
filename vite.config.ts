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

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
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
});

import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const desktopRoot = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(desktopRoot, "../..");

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: path.join(projectRoot, "out/main"),
      rollupOptions: {
        input: path.join(desktopRoot, "src/main/index.ts"),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: path.join(projectRoot, "out/preload"),
      rollupOptions: {
        input: path.join(desktopRoot, "src/preload/index.ts"),
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs",
        },
      },
    },
  },
  renderer: {
    root: path.join(desktopRoot, "src/renderer"),
    build: {
      outDir: path.join(projectRoot, "out/renderer"),
      emptyOutDir: true,
      rollupOptions: {
        input: path.join(desktopRoot, "src/renderer/index.html"),
      },
    },
  },
});

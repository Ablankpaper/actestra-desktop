import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import type { Plugin } from "vite";

const desktopRoot = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(desktopRoot, "../..");
const contentSecurityPolicyPlaceholder = "__ACTESTRA_CONTENT_SECURITY_POLICY__";
const sharedContentSecurityPolicy =
  "default-src 'self'; script-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";
const packagedContentSecurityPolicy = `${sharedContentSecurityPolicy}; style-src 'self'; connect-src 'none'`;
const developmentContentSecurityPolicy = `${sharedContentSecurityPolicy}; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://localhost:* ws://127.0.0.1:*`;

const rendererContentSecurityPolicyPlugin: Plugin = {
  name: "actestra-renderer-content-security-policy",
  transformIndexHtml(html, context) {
    const policy = context.server
      ? developmentContentSecurityPolicy
      : packagedContentSecurityPolicy;

    if (!html.includes(contentSecurityPolicyPlaceholder)) {
      throw new Error("Actestra renderer CSP placeholder is missing");
    }

    return html.replace(contentSecurityPolicyPlaceholder, policy);
  },
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: path.join(projectRoot, "out/main"),
      rollupOptions: {
        input: {
          index: path.join(desktopRoot, "src/main/index.ts"),
          "persistence-utility": path.join(
            desktopRoot,
            "src/utility/persistence/persistenceUtilityEntry.ts",
          ),
          "general-worker": path.join(desktopRoot, "src/utility/worker/generalWorkerEntry.ts"),
        },
        output: {
          entryFileNames: "[name].js",
        },
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
    plugins: [rendererContentSecurityPolicyPlugin],
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

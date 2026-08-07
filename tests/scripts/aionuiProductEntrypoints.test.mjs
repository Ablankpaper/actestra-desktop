// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"));
const projectStatus = fs.readFileSync(path.join(repositoryRoot, "docs/PROJECT_STATUS.md"), "utf8");
const legacyProductPaths = [
  "apps/desktop/electron.vite.config.ts",
  "apps/desktop/electron-builder.yml",
  "apps/desktop/src/renderer/App.tsx",
  "apps/desktop/src/renderer/env.d.ts",
  "apps/desktop/src/renderer/index.html",
  "apps/desktop/src/renderer/main.tsx",
  "apps/desktop/src/renderer/styles.css",
  "tests/renderer/App.test.tsx",
];

describe("AionUI-first product entrypoints", () => {
  it("routes normal development, preview, package, and distribution commands through downstream AionUI", () => {
    const scripts = packageJson.scripts;

    expect(scripts.dev).toBe("bun run downstream:aionui:dev");
    expect(scripts.preview).toBe("bun run downstream:aionui:preview");
    expect(scripts.package).toBe("bun run downstream:aionui:package");
    expect(scripts["dist:dir"]).toBe("bun run downstream:aionui:dist:dir");
    expect(scripts["dist:mac"]).toBe("bun run downstream:aionui:dist:mac");

    for (const scriptName of ["dev", "preview", "package", "dist:dir", "dist:mac"]) {
      expect(scripts[scriptName]).not.toContain("apps/desktop/electron.vite.config.ts");
      expect(scripts[scriptName]).not.toContain("apps/desktop/electron-builder.yml");
    }
  });

  it("materializes the reviewed downstream overlay before preview and distribution", () => {
    for (const scriptName of [
      "downstream:aionui:preview",
      "downstream:aionui:dist:dir",
      "downstream:aionui:dist:mac",
    ]) {
      expect(packageJson.scripts[scriptName]).toContain("downstream:aionui:materialize");
      expect(packageJson.scripts[scriptName]).toContain(".actestra/aionui-v2.1.41");
    }
  });

  it("removes the legacy P2 renderer and its standalone product build chain", () => {
    for (const relativePath of legacyProductPaths) {
      expect(fs.existsSync(path.join(repositoryRoot, relativePath)), relativePath).toBe(false);
    }

    const boundaryCheck = fs.readFileSync(
      path.join(repositoryRoot, "scripts/check-product-boundary.mjs"),
      "utf8",
    );
    expect(boundaryCheck).not.toContain('"apps", "desktop", "electron-builder.yml"');
    expect(boundaryCheck).not.toContain("renderer remains unprivileged");
  });

  it("does not retain deleted renderer entrypoints as coverage exclusions", () => {
    const vitestConfig = fs.readFileSync(path.join(repositoryRoot, "vitest.config.ts"), "utf8");

    for (const relativePath of [
      "apps/desktop/src/renderer/main.tsx",
      "apps/desktop/src/renderer/env.d.ts",
    ]) {
      expect(vitestConfig, relativePath).not.toContain(`"${relativePath}"`);
    }

    const a2Evidence = projectStatus.match(
      /A2 local\s+focused evidence is exactly[\s\S]*?These are local focused checks only, not broad product or acceptance evidence\./,
    )?.[0];
    expect(a2Evidence).toBeDefined();
    expect(a2Evidence).toContain(
      "./node_modules/.bin/vitest run\ntests/scripts/aionuiProductEntrypoints.test.mjs",
    );
    expect(a2Evidence).toContain("Test Files 1 passed (1)");
    expect(a2Evidence).toContain("Tests 4 passed (4)");
    expect(a2Evidence).toContain("tests/scripts/aionuiProductEntrypoints.test.mjs");
    expect(a2Evidence).toContain("vitest.config.ts");
    expect(a2Evidence).not.toContain("tests/main/actestraCodingJourneyRuntime.test.ts");
  });
});

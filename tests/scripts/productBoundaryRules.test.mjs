import fs from "node:fs";
import os from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";
import * as productBoundaryRules from "../../scripts/product-boundary-rules.mjs";
import {
  extractStaticModuleSpecifiers,
  findGeneralWorkerAuthorityFindings,
} from "../../scripts/general-worker-authority-rules.mjs";

const { preloadPrivilegePatterns, rendererPrivilegePatterns } = productBoundaryRules;

const nodeImportRule = preloadPrivilegePatterns.find((rule) => rule.label === "Node import");
const rendererNodeImportRule = rendererPrivilegePatterns.find(
  (rule) => rule.label === "Node import",
);
const electronImportRule = rendererPrivilegePatterns.find(
  (rule) => rule.label === "Electron import",
);
const rendererGitAuthorityImportRule = rendererPrivilegePatterns.find(
  (rule) => rule.label === "Git authority import",
);
const preloadGitAuthorityImportRule = preloadPrivilegePatterns.find(
  (rule) => rule.label === "Git authority import",
);

describe("product boundary rules", () => {
  it("accepts the declared AionUi schedule compatibility source boundary", () => {
    const repositoryRoot = path.resolve(import.meta.dirname, "../..");
    const result = spawnSync(process.execPath, ["scripts/check-product-boundary.mjs"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  });

  it("detects bare and node-prefixed builtins across supported import forms", () => {
    expect(nodeImportRule).toBeDefined();
    for (const source of [
      'import fs from "fs";',
      'import { readFile } from "node:fs";',
      'import "path";',
      'export { randomUUID } from "node:crypto";',
      'const promises = import("fs/promises");',
      'const sqlite = import("node:sqlite", { with: { type: "module" } });',
    ]) {
      expect(nodeImportRule.pattern.test(source), source).toBe(true);
    }
  });

  it("does not confuse similarly named packages with Node builtins", () => {
    expect(nodeImportRule).toBeDefined();
    for (const source of [
      'import extra from "fs-extra";',
      'import route from "path-to-regexp";',
      'const client = import("buffer-crc32");',
    ]) {
      expect(nodeImportRule.pattern.test(source), source).toBe(false);
    }
  });

  it("applies complete Node and Electron import detection to renderer source", () => {
    expect(rendererNodeImportRule).toBeDefined();
    expect(electronImportRule).toBeDefined();
    for (const source of ['import "fs";', 'export * from "node:path";', 'import("node:crypto");']) {
      expect(rendererNodeImportRule.pattern.test(source), source).toBe(true);
    }
    for (const source of [
      'import "electron";',
      'export { ipcRenderer } from "electron/renderer";',
      'import("electron");',
    ]) {
      expect(electronImportRule.pattern.test(source), source).toBe(true);
    }
  });

  it("rejects runtime Git authority imports without matching ordinary Git UI text or types", () => {
    expect(rendererGitAuthorityImportRule).toBeDefined();
    expect(preloadGitAuthorityImportRule).toBeDefined();
    for (const source of [
      'import git from "isomorphic-git";',
      'export { simpleGit } from "simple-git";',
      'const git = import("dugite");',
    ]) {
      expect(rendererGitAuthorityImportRule?.pattern.test(source), source).toBe(true);
      expect(preloadGitAuthorityImportRule?.pattern.test(source), source).toBe(true);
    }
    for (const source of [
      'export const label = "Git status";',
      'import type { GitStatus } from "@/renderer/types";',
      'import parseGitUrl from "git-url-parse";',
    ]) {
      expect(rendererGitAuthorityImportRule?.pattern.test(source), source).toBe(false);
      expect(preloadGitAuthorityImportRule?.pattern.test(source), source).toBe(false);
    }
  });

  it("scans the declared downstream renderer files for direct privileged authority", () => {
    const inspect = productBoundaryRules.inspectSourceFilesForPrivilegePatterns;
    expect(inspect).toBeTypeOf("function");
    if (typeof inspect !== "function") return;

    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-renderer-boundary-"));
    try {
      fs.writeFileSync(
        path.join(fixtureRoot, "safe.ts"),
        "export const request = window.actestraTeam?.request;\n",
      );
      fs.writeFileSync(
        path.join(fixtureRoot, "unsafe.tsx"),
        'import { ipcRenderer } from "electron";\nexport const load = () => fetch("https://example.invalid");\n',
      );

      expect(
        inspect({
          rootPath: fixtureRoot,
          relativePaths: ["safe.ts", "unsafe.tsx"],
          rules: rendererPrivilegePatterns,
        }),
      ).toEqual([
        { relativePath: "unsafe.tsx", label: "Electron import" },
        { relativePath: "unsafe.tsx", label: "direct fetch client" },
      ]);
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("allows only the compile-time NODE_ENV flag in the Actestra Team renderer scope", () => {
    const inspect = productBoundaryRules.inspectSourceFilesForPrivilegePatterns;
    const rules = productBoundaryRules.actestraTeamRendererPrivilegePatterns;
    expect(inspect).toBeTypeOf("function");
    expect(rules).toBeInstanceOf(Array);
    if (typeof inspect !== "function" || !Array.isArray(rules)) return;

    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-team-renderer-scope-"));
    try {
      fs.writeFileSync(
        path.join(fixtureRoot, "debug.ts"),
        "export const debug = process.env.NODE_ENV !== 'production';\n",
      );
      fs.writeFileSync(
        path.join(fixtureRoot, "credential.ts"),
        "export const credential = process.env.ACTESTRA_SECRET;\n",
      );

      expect(
        inspect({
          rootPath: fixtureRoot,
          relativePaths: ["debug.ts", "credential.ts"],
          rules,
        }),
      ).toEqual([{ relativePath: "credential.ts", label: "Node process global" }]);
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("covers every downstream file that can carry Actestra Team renderer authority", () => {
    const repositoryRoot = path.resolve(import.meta.dirname, "../..");
    const overlay = JSON.parse(
      fs.readFileSync(path.join(repositoryRoot, "downstream/aionui-v2.1.41/overlay.json"), "utf8"),
    );
    const expectedPaths = overlay.expectedChangedFiles
      .filter(
        (relativePath) =>
          relativePath === "packages/desktop/src/common/adapter/actestraTeamClient.ts" ||
          relativePath ===
            "packages/desktop/src/renderer/components/layout/Sider/TeamSiderSection.tsx" ||
          relativePath.startsWith("packages/desktop/src/renderer/pages/team/"),
      )
      .sort();

    expect(productBoundaryRules.actestraTeamRendererAuthorityPaths).toEqual(expectedPaths);
  });

  it("extracts static imports, exports, dynamic imports, and require calls", () => {
    expect(
      extractStaticModuleSpecifiers(`
        import process from "node:process";
        import "node:fs";
        export { connect } from "node:net";
        const shell = require("node:child_process");
        const socket = import("node:dgram");
      `),
    ).toEqual(["node:process", "node:fs", "node:net", "node:dgram", "node:child_process"]);
  });

  it("allows only the parent-port process module in a General Worker", () => {
    expect(
      findGeneralWorkerAuthorityFindings(
        `
          import process from "node:process";
          import { service } from "./service";
          process.parentPort?.postMessage(service);
        `,
        "worker-entry",
      ),
    ).toEqual([]);
  });

  it("rejects Node, Electron, database, network, and dynamic module authority", () => {
    const forbiddenSources = [
      'import "node:fs/promises";',
      'export * from "fs";',
      'const shell = require("node:child_process");',
      'const network = import("node:https");',
      'const electron = require("electron/main");',
      "const database = new DatabaseSync('work.db');",
      "const module = require(candidate);",
      "const module = import(candidate);",
      "const builtin = process.getBuiltinModule(candidate);",
      "const response = fetch(url);",
      "const environment = process.env.SECRET;",
      "const code = eval(source);",
      "const factory = new Function(source);",
      "const globalObject = globalThis;",
      'const binding = process["binding"];',
      'const hiddenRequire = globalThis["require"];',
      'import client from "unapproved-package";',
    ];
    for (const source of forbiddenSources) {
      expect(findGeneralWorkerAuthorityFindings(source, "worker"), source).not.toEqual([]);
    }
  });
});

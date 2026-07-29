import { describe, expect, it } from "vitest";
import {
  preloadPrivilegePatterns,
  rendererPrivilegePatterns,
} from "../../scripts/product-boundary-rules.mjs";
import {
  extractStaticModuleSpecifiers,
  findGeneralWorkerAuthorityFindings,
} from "../../scripts/general-worker-authority-rules.mjs";

const nodeImportRule = preloadPrivilegePatterns.find((rule) => rule.label === "Node import");
const rendererNodeImportRule = rendererPrivilegePatterns.find(
  (rule) => rule.label === "Node import",
);
const electronImportRule = rendererPrivilegePatterns.find(
  (rule) => rule.label === "Electron import",
);

describe("product boundary rules", () => {
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

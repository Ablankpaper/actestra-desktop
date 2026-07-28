import { describe, expect, it } from "vitest";
import {
  preloadPrivilegePatterns,
  rendererPrivilegePatterns,
} from "../../scripts/product-boundary-rules.mjs";

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
});

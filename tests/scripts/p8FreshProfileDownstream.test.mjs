// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("P8.2d downstream fresh-profile hook", () => {
  it("declares one reversible R1 patch owned by Main", () => {
    const overlay = JSON.parse(read("downstream/aionui-v2.1.41/overlay.json"));
    expect(
      overlay.patches.find(
        (entry) => entry.path === "patches/0022-actestra-p8-fresh-profile-smoke.mjs",
      ),
    ).toMatchObject({
      classification: ["R1"],
      domains: expect.arrayContaining([
        "native Electron fresh-profile acceptance",
        "Main-owned Provider IPC empty-state evidence",
        "AionUI model-settings unavailable guidance",
      ]),
      authorityOwner: expect.stringContaining("Actestra Main"),
      rollback: expect.stringContaining("Regenerate without patch 0022"),
    });
  });

  it("adds only the stable empty-state selector and a Main-owned E2E probe", () => {
    const patchPath = "downstream/aionui-v2.1.41/patches/0022-actestra-p8-fresh-profile-smoke.mjs";
    expect(fs.existsSync(path.join(root, patchPath))).toBe(true);
    if (!fs.existsSync(path.join(root, patchPath))) return;
    const patch = read(patchPath);
    for (const fragment of [
      "data-testid='actestra-provider-unavailable'",
      "ACTESTRA_P8_FRESH_PROFILE_SMOKE",
      "ACTESTRA_P8_FRESH_PROFILE_READY",
      "window.electronAPI?.actestraProviderList",
      "direct-provider-fetch-not-denied",
      "window.location.hash = '/settings/model'",
      "[data-testid=model-header]",
      "[data-testid=actestra-provider-unavailable]",
      "providerUiTextPresent: true",
      "app.quit()",
    ]) {
      expect(patch).toContain(fragment);
    }
    expect(patch).toContain("process.env.ACTESTRA_P8_FRESH_PROFILE_SMOKE !== '1'");
    expect(patch).not.toContain("readFile(");
    expect(patch).not.toContain("exec(");
    expect(patch).not.toContain("api_key");
  });

  it("materializes a syntactically valid Main fresh-profile probe", () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-p8-fresh-profile-"));
    const outputRoot = path.join(temporaryRoot, "aionui-v2.1.41");
    const mainPath = path.join(outputRoot, "packages/desktop/src/index.ts");
    const modelPath = path.join(
      outputRoot,
      "packages/desktop/src/renderer/components/settings/SettingsModal/contents/ModelModalContent.tsx",
    );
    fs.mkdirSync(path.dirname(mainPath), { recursive: true });
    fs.mkdirSync(path.dirname(modelPath), { recursive: true });
    fs.writeFileSync(
      mainPath,
      `function installProbe(mainWindow: any) {
  if (
      process.env.ACTESTRA_E2E_TEST === '1' &&
      process.env.ACTESTRA_GENERAL_WORK_SMOKE_SCENARIO !== 'recover-worker-crash'
  ) {}
  mainWindow.webContents.once('did-finish-load', () => {
      if (process.env.ACTESTRA_E2E_TEST === '1') {
        const providerProbe = [];
      }
  });
}
`,
      "utf8",
    );
    fs.writeFileSync(
      modelPath,
      `const view = (
  <div className='flex flex-col items-center justify-center py-40px'>
            <Info theme='outline' size='48' className='text-t-secondary mb-16px' />
  </div>
);
`,
      "utf8",
    );

    try {
      const result = spawnSync(
        process.execPath,
        [
          path.join(
            root,
            "downstream/aionui-v2.1.41/patches/0022-actestra-p8-fresh-profile-smoke.mjs",
          ),
          outputRoot,
        ],
        { encoding: "utf8" },
      );
      expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" });
      const materializedMain = fs.readFileSync(mainPath, "utf8");
      const sourceFile = ts.createSourceFile(
        mainPath,
        materializedMain,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );
      expect(
        sourceFile.parseDiagnostics.map((diagnostic) =>
          ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
        ),
      ).toEqual([]);
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("keeps the two touched native files in the reviewed changed-file contract", () => {
    const overlay = JSON.parse(read("downstream/aionui-v2.1.41/overlay.json"));
    expect(overlay.expectedChangedFiles).toEqual(
      expect.arrayContaining([
        "packages/desktop/src/index.ts",
        "packages/desktop/src/renderer/components/settings/SettingsModal/contents/ModelModalContent.tsx",
      ]),
    );
    const checker = read("scripts/check-aionui-downstream.mjs");
    expect(checker).toContain('"patches/0022-actestra-p8-fresh-profile-smoke.mjs"');
    expect(checker).toContain("ACTESTRA_P8_FRESH_PROFILE_READY");
    expect(checker).toContain("actestra-provider-unavailable");
  });
});

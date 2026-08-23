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
      "ACTESTRA_P8_FRESH_PROFILE_FAILED",
      "p8-fresh-profile-result.json",
      "p8-fresh-profile-stage-",
      "renderer-probe-started",
      "bootstrap-isolation",
      "bootstrap-home",
      "bootstrap-temp",
      "bootstrap-app-data",
      "bootstrap-name",
      "bootstrap-directories",
      "bootstrap-user-data",
      "bootstrap-session-data",
      "bootstrap-logs",
      "bootstrap-crash-dumps",
      "bootstrap-complete",
      "window.electronAPI?.actestraProviderList",
      "direct-provider-fetch-not-denied",
      "window.location.hash = '/settings/model'",
      "[data-testid=model-header]",
      "[data-testid=actestra-provider-unavailable]",
      "provider-ui-route-missing",
      "provider-ui-header-missing",
      "provider-ui-empty-state-missing",
      "provider-ui-text-missing",
      "providerUiTextPresent: true",
      "writeFreshProfileResult({ status: 'verified', ...evidence })",
      "JSON.stringify(evidence)",
      "app.quit()",
    ]) {
      expect(patch).toContain(fragment);
    }
    expect(patch).toContain("process.env.ACTESTRA_P8_FRESH_PROFILE_SMOKE !== '1'");
    expect(patch).not.toContain("readFile(");
    expect(patch).not.toContain("exec(");
    expect(patch).not.toContain("api_key");
    expect(patch).toContain("fs.renameSync");
    expect(patch).toContain("flag: 'wx'");
    expect(patch).not.toContain("writeFreshProfileResult({ status: 'running'");
    expect(patch).not.toContain("const temporaryPath = resultPath + '.tmp'");
    expect(patch).not.toContain("throw new Error('provider-ui-state-missing')");
  });

  it("writes bootstrap evidence only after canonical isolation containment passes", () => {
    const patch = read(
      "downstream/aionui-v2.1.41/patches/0022-actestra-p8-fresh-profile-smoke.mjs",
    );
    const containmentCheck = patch.indexOf(
      "throw new Error('Actestra E2E runtime paths escaped their real isolated root')",
    );
    const firstBootstrapWrite = patch.indexOf(
      "writeFreshProfileBootstrapStage('bootstrap-isolation')",
    );
    expect(patch).not.toContain("bootstrap-start");
    expect(containmentCheck).toBeGreaterThanOrEqual(0);
    expect(firstBootstrapWrite).toBeGreaterThan(containmentCheck);
  });

  it("materializes a syntactically valid Main fresh-profile probe", () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-p8-fresh-profile-"));
    const outputRoot = path.join(temporaryRoot, "aionui-v2.1.41");
    const mainPath = path.join(outputRoot, "packages/desktop/src/index.ts");
    const modelPath = path.join(
      outputRoot,
      "packages/desktop/src/renderer/components/settings/SettingsModal/contents/ModelModalContent.tsx",
    );
    const chromiumPath = path.join(
      outputRoot,
      "packages/desktop/src/process/utils/configureChromium.ts",
    );
    fs.mkdirSync(path.dirname(mainPath), { recursive: true });
    fs.mkdirSync(path.dirname(modelPath), { recursive: true });
    fs.mkdirSync(path.dirname(chromiumPath), { recursive: true });
    fs.writeFileSync(
      mainPath,
      `const exposeBackendPort = (backendPort: number) => backendPort;
let backendStartedOk = false;
function installProbe(mainWindow: any) {
  if (
      process.env.ACTESTRA_E2E_TEST === '1' &&
      process.env.ACTESTRA_GENERAL_WORK_SMOKE_SCENARIO !== 'recover-worker-crash'
  ) {}
const handleAppReady = async (): Promise<void> => {
  const mark = (_label: string) => undefined;
  mark('start');

  if (!app.isPackaged) {}
  try {
    await initializeProcess();
    rendererInitialLanguage = ProcessConfig.getSync('language') ?? null;
    mark('initializeProcess');
  } catch {}
  if (true) {
    const backendStartup = await startBackendOrExit({});
    createWindow({ showOnReady: showMainWindowOnReady });
    appReadyDone = true;
  }
};
const markBackendReady = (backendPort: number) => {
  if (backendStartedOk) return;
  exposeBackendPort(backendPort);
  backendStartedOk = true;
};
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
    fs.writeFileSync(
      chromiumPath,
      `import * as fs from 'fs';
import * as path from 'path';
const isActestraE2ETest =
  process.env.ACTESTRA_E2E_TEST === '1' || process.env.AIONUI_E2E_TEST === '1';
const actestraE2EIsolationRoot = '/tmp/isolation';
const actestraE2EHomeDir = '/tmp/isolation/home';
const actestraE2ETempDir = '/tmp/isolation/temp';
if (isActestraE2ETest) {
  const realIsolationRoot = fs.realpathSync(actestraE2EIsolationRoot);
  if (true) {
    throw new Error('Actestra E2E runtime paths escaped their real isolated root');
  }
  app.setPath('home', actestraE2EHomeDir);
  app.setPath('temp', actestraE2ETempDir);
}
const actestraUserDataDir = resolveActestraUserDataPath({
  appDataRoot: app.getPath('appData'),
  explicitPath: '/tmp/isolation/user-data',
  development: false,
  multiInstance: false,
});
app.setName(ACTESTRA_PRODUCT.name);
for (const directory of [
  actestraUserDataDir,
  path.join(actestraUserDataDir, 'session'),
]) {
  ensureActestraPrivateDirectory(directory);
}
app.setPath('userData', actestraUserDataDir);
app.setPath('sessionData', path.join(actestraUserDataDir, 'session'));
app.setPath('logs', path.join(actestraUserDataDir, 'logs'));
app.setPath('crashDumps', path.join(actestraUserDataDir, 'crash-dumps'));
ensureActestraProfileLayout(actestraUserDataDir);
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
      const program = ts.createProgram({
        rootNames: [mainPath],
        options: { noEmit: true, noLib: true, noResolve: true, skipLibCheck: true },
      });
      expect(
        ts
          .getPreEmitDiagnostics(program)
          .filter((diagnostic) => diagnostic.code === 2300)
          .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")),
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

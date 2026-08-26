// @vitest-environment node

import { EventEmitter } from "node:events";
import fs from "node:fs";
import { mkdtemp, mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { P8_PRODUCT_JOURNEY_IDS } from "../../scripts/p8-product-journey-evidence.mjs";
import {
  P8_PRODUCT_JOURNEY_RESULT_FILE_NAME,
  normalizeP8ProductJourneyPackages,
  parseP8ProductJourneyArguments,
  parseP8ProductJourneyResultFile,
  resolveP8ProductJourneyIsolation,
  resolveP8ProductJourneyRuntime,
  runP8ProductJourneyCrashRestartRecovery,
  runP8ProductJourneySmoke,
} from "../../scripts/smoke-p8-product-journeys.mjs";

const roots = [];
const commit = "a".repeat(40);
const runId = "32879077165";

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

async function tempRoot() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "actestra-p8-journeys-test-")));
  roots.push(root);
  return root;
}

async function macFixture() {
  const root = await tempRoot();
  const app = path.join(root, "Actestra.app");
  const executable = path.join(app, "Contents", "MacOS", "Actestra");
  const appAsar = path.join(app, "Contents", "Resources", "app.asar");
  await mkdir(path.dirname(executable), { recursive: true });
  await mkdir(path.dirname(appAsar), { recursive: true });
  await writeFile(executable, "executable");
  await writeFile(appAsar, "asar");
  const packages = [
    { format: "dmg", path: path.join(root, "Actestra.dmg") },
    { format: "zip", path: path.join(root, "Actestra.zip") },
  ];
  for (const entry of packages) await writeFile(entry.path, `${entry.format}-package`);
  return { root, app, packages };
}

function verifiedJourneyResult() {
  return {
    schemaVersion: 1,
    status: "verified",
    journeys: P8_PRODUCT_JOURNEY_IDS.map((id) => ({
      id,
      status: "verified",
      residualProcessCount: 0,
    })),
  };
}

function emitClose(child, code, signal) {
  child.emit("exit", code, signal);
  child.emit("close", code, signal);
}

function fakeChild(onSpawn) {
  const child = new EventEmitter();
  child.pid = 42;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {
    emitClose(child, null, "SIGTERM");
    return true;
  };
  queueMicrotask(() => onSpawn(child));
  return child;
}

function smokeOptions(fixture, onSpawn, snapshotProcessTree = () => ({ ok: true, pids: [] })) {
  return {
    targetId: "macos-15-arm64",
    sourceCommit: commit,
    ciRunId: runId,
    runtimePath: fixture.app,
    packages: fixture.packages,
    runner: {
      manifestSha256: "b".repeat(64),
      executableSha256: "c".repeat(64),
      containmentEvidenceSha256: "d".repeat(64),
    },
    isolationRoot: path.join(fixture.root, "isolation"),
    spawnChild: (_executable, _arguments, options) =>
      fakeChild((child) => onSpawn(child, options.env)),
    snapshotProcessTree,
    timeoutMs: 100,
    cleanupTimeoutMs: 100,
    retainIsolation: true,
    crashRestartRecovery: false,
  };
}

describe("P8.2 packaged product-journey controller", () => {
  it("parses only the closed CLI arguments", () => {
    expect(
      parseP8ProductJourneyArguments([
        "--target",
        "macos-15-arm64",
        "--runtime",
        "/tmp/Actestra.app",
        "--package",
        "dmg=/tmp/Actestra.dmg",
        "--package",
        "zip=/tmp/Actestra.zip",
        "--source-commit",
        "a".repeat(40),
        "--ci-run-id",
        "32879077165",
        "--runner-manifest",
        "b".repeat(64),
        "--runner-executable",
        "c".repeat(64),
        "--runner-containment",
        "d".repeat(64),
        "--evidence",
        "/tmp/evidence.json",
      ]),
    ).toEqual({
      targetId: "macos-15-arm64",
      runtimePath: "/tmp/Actestra.app",
      packages: [
        { format: "dmg", path: "/tmp/Actestra.dmg" },
        { format: "zip", path: "/tmp/Actestra.zip" },
      ],
      sourceCommit: "a".repeat(40),
      ciRunId: "32879077165",
      runner: {
        manifestSha256: "b".repeat(64),
        executableSha256: "c".repeat(64),
        containmentEvidenceSha256: "d".repeat(64),
      },
      evidencePath: "/tmp/evidence.json",
    });
    expect(() => parseP8ProductJourneyArguments(["--unknown", "value"])).toThrow(
      "invalid-arguments",
    );
  });

  it("resolves a native runtime without accepting symlinks", async () => {
    const root = await tempRoot();
    const app = path.join(root, "Actestra.app");
    await mkdir(path.join(app, "Contents", "MacOS"), { recursive: true });
    await mkdir(path.join(app, "Contents", "Resources"), { recursive: true });
    await writeFile(path.join(app, "Contents", "MacOS", "Actestra"), "exe");
    await writeFile(path.join(app, "Contents", "Resources", "app.asar"), "asar");
    await expect(resolveP8ProductJourneyRuntime("macos-15-arm64", app)).resolves.toEqual({
      executable: path.join(app, "Contents", "MacOS", "Actestra"),
      appAsar: path.join(app, "Contents", "Resources", "app.asar"),
      launchPath: path.join(app, "Contents", "MacOS", "Actestra"),
      resourcesPath: path.join(app, "Contents", "Resources"),
    });
    const link = path.join(root, "linked.app");
    await symlink(app, link);
    await expect(resolveP8ProductJourneyRuntime("macos-15-arm64", link)).rejects.toMatchObject({
      code: "package-structure-invalid",
    });
  });

  it("requires exactly the target package formats and computes bounded package hashes", async () => {
    const root = await tempRoot();
    const deb = path.join(root, "Actestra.deb");
    await writeFile(deb, "package-bytes");
    await expect(
      normalizeP8ProductJourneyPackages("ubuntu-24.04-x64", [{ format: "deb", path: deb }]),
    ).resolves.toEqual([
      {
        format: "deb",
        path: deb,
        sha256: "9d7ec3059a3be4a437e8028d9a498f2fd4adfa7183af52ecc712704ee1dc8260",
      },
    ]);
    await expect(
      normalizeP8ProductJourneyPackages("ubuntu-24.04-x64", [{ format: "nsis", path: deb }]),
    ).rejects.toMatchObject({ code: "package-structure-invalid" });
  });

  it("creates contained private profile directories and rejects a symlink escape", async () => {
    const root = await tempRoot();
    await expect(resolveP8ProductJourneyIsolation(path.join(root, "isolation"))).resolves.toEqual({
      isolationRoot: path.join(root, "isolation"),
      userData: path.join(root, "isolation", "user-data"),
      home: path.join(root, "isolation", "home"),
      temp: path.join(root, "isolation", "temp"),
      workspace: path.join(root, "isolation", "workspace"),
    });
    const escaped = path.join(root, "escaped");
    await mkdir(escaped);
    const bad = path.join(root, "bad");
    await mkdir(bad);
    await symlink(escaped, path.join(bad, "user-data"));
    await expect(resolveP8ProductJourneyIsolation(bad)).rejects.toMatchObject({
      code: "profile-isolation-invalid",
    });
  });

  it("reads only a bounded exact result file", async () => {
    const root = await tempRoot();
    const value = {
      schemaVersion: 1,
      status: "verified",
      journeys: P8_PRODUCT_JOURNEY_IDS.map((id) => ({
        id,
        status: "verified",
        residualProcessCount: 0,
      })),
    };
    await writeFile(
      path.join(root, P8_PRODUCT_JOURNEY_RESULT_FILE_NAME),
      `${JSON.stringify(value)}\n`,
    );
    await expect(parseP8ProductJourneyResultFile(root)).resolves.toEqual(value);
    await writeFile(path.join(root, P8_PRODUCT_JOURNEY_RESULT_FILE_NAME), "not-json\n");
    await expect(parseP8ProductJourneyResultFile(root)).rejects.toMatchObject({
      code: "result-malformed",
    });
    expect(fs.existsSync(path.join(root, P8_PRODUCT_JOURNEY_RESULT_FILE_NAME))).toBe(true);
  });

  it("launches the package, binds the bounded Main result, and verifies zero residuals", async () => {
    const fixture = await macFixture();
    let launchedEnvironment;
    const result = await runP8ProductJourneySmoke(
      smokeOptions(fixture, async (child, environment) => {
        launchedEnvironment = environment;
        await writeFile(
          path.join(environment.ACTESTRA_USER_DATA_DIR, P8_PRODUCT_JOURNEY_RESULT_FILE_NAME),
          `${JSON.stringify(verifiedJourneyResult())}\n`,
        );
        emitClose(child, 0, null);
      }),
    );
    expect(result.evidence.status).toBe("verified");
    expect(result.evidence.targetId).toBe("macos-15-arm64");
    expect(result.evidence.ciRunId).toBe(runId);
    expect(result.evidence.runner).toEqual({
      packaged: true,
      manifestSha256: "b".repeat(64),
      executableSha256: "c".repeat(64),
      containmentEvidenceSha256: "d".repeat(64),
    });
    expect(result.evidence.journeys).toHaveLength(9);
    expect(result.evidence.residualProcessCount).toBe(0);
    expect(launchedEnvironment.ACTESTRA_P8_PRODUCT_JOURNEYS_WORKSPACE).toBe(
      path.join(fixture.root, "isolation", "workspace"),
    );
    expect(launchedEnvironment.ACTESTRA_P8_PRODUCT_JOURNEYS_RESULT).toBe(
      path.join(fixture.root, "isolation", "user-data", P8_PRODUCT_JOURNEY_RESULT_FILE_NAME),
    );
    expect(launchedEnvironment.ACTESTRA_P8_PRODUCT_JOURNEYS_TIMEOUT_MS).toBe("300000");
    expect(launchedEnvironment.ACTESTRA_P7_SECURITY_SMOKE).toBe("1");
    expect(launchedEnvironment.ACTESTRA_P7_RESOURCE_RELIABILITY_SMOKE).toBe("1");
    expect(launchedEnvironment.ACTESTRA_P7_DIAGNOSTIC_AUDIT_SMOKE).toBe("1");
    for (const name of [
      "ACTESTRA_P7_SECURITY_SMOKE_SENTINEL",
      "ACTESTRA_P7_SECURITY_SMOKE_WORKSPACE",
      "ACTESTRA_P7_SECURITY_SMOKE_EVIDENCE",
      "ACTESTRA_P7_SECURITY_SMOKE_HOST_READ_PROBE",
      "ACTESTRA_P7_RESOURCE_RELIABILITY_EVIDENCE",
      "ACTESTRA_P7_RESOURCE_GENERAL_CPU_PROBE",
      "ACTESTRA_P7_RESOURCE_GENERAL_MEMORY_PROBE",
      "ACTESTRA_P7_RESOURCE_GOOSE_FORK_PROBE",
      "ACTESTRA_P7_RESOURCE_GOOSE_PRIVATE_ROOT",
      "ACTESTRA_P7_DIAGNOSTIC_AUDIT_REPORT",
      "ACTESTRA_P7_DIAGNOSTIC_AUDIT_EVIDENCE",
    ]) {
      expect(typeof launchedEnvironment[name]).toBe("string");
      expect(path.isAbsolute(launchedEnvironment[name])).toBe(true);
    }
    expect(fs.statSync(launchedEnvironment.ACTESTRA_P7_RESOURCE_GENERAL_CPU_PROBE).isFile()).toBe(
      true,
    );
    expect(
      fs.statSync(launchedEnvironment.ACTESTRA_P7_RESOURCE_GENERAL_MEMORY_PROBE).isFile(),
    ).toBe(true);
    expect(fs.statSync(launchedEnvironment.ACTESTRA_P7_RESOURCE_GOOSE_FORK_PROBE).isFile()).toBe(
      true,
    );
    expect(result.binding).toMatchObject({
      targetId: "macos-15-arm64",
      sourceCommit: commit,
      ciRunId: runId,
    });
  });

  it("performs exactly one abnormal prepare launch followed by one recovery launch", async () => {
    const fixture = await macFixture();
    const journalPath = path.join(fixture.root, "p8-product-journeys-restart.json");
    let launchCount = 0;
    const outcome = await runP8ProductJourneyCrashRestartRecovery({
      launchPath: fixture.app,
      userDataPath: fixture.root,
      resultPath: path.join(fixture.root, P8_PRODUCT_JOURNEY_RESULT_FILE_NAME),
      restartJournalPath: journalPath,
      environment: { ACTESTRA_E2E_TEST: "1" },
      spawnChild: (_executable, _arguments, options) => {
        launchCount += 1;
        return fakeChild(async (child) => {
          if (options.env.ACTESTRA_P8_PRODUCT_JOURNEYS_RESTART_PHASE === "prepare") {
            await writeFile(
              journalPath,
              `${JSON.stringify({
                schemaVersion: 1,
                journey: "crash-restart-recovery",
                phase: "active-checkpoint",
                restartCount: 0,
              })}\n`,
              { mode: 0o600 },
            );
            emitClose(child, 86, null);
            return;
          }
          fs.writeFileSync(
            journalPath,
            `${JSON.stringify({
              schemaVersion: 1,
              journey: "crash-restart-recovery",
              phase: "recovered",
              restartCount: 1,
            })}\n`,
            { mode: 0o600 },
          );
          fs.writeFileSync(
            path.join(fixture.root, P8_PRODUCT_JOURNEY_RESULT_FILE_NAME),
            `${JSON.stringify(verifiedJourneyResult())}\n`,
            { mode: 0o600 },
          );
          emitClose(child, 0, null);
        });
      },
      snapshotProcessTree: () => ({ ok: true, pids: [] }),
      timeoutMs: 500,
      cleanupTimeoutMs: 100,
    });
    expect(launchCount).toBe(2);
    expect(outcome.restartCount).toBe(1);
    expect(outcome.journal).toMatchObject({
      phase: "recovered",
      restartCount: 1,
    });
  });

  it("fails closed when the prepare launch exits normally instead of proving a crash", async () => {
    const fixture = await macFixture();
    const journalPath = path.join(fixture.root, "p8-product-journeys-restart.json");
    let launchCount = 0;
    await expect(
      runP8ProductJourneyCrashRestartRecovery({
        launchPath: fixture.app,
        userDataPath: fixture.root,
        resultPath: path.join(fixture.root, P8_PRODUCT_JOURNEY_RESULT_FILE_NAME),
        restartJournalPath: journalPath,
        environment: {},
        spawnChild: (_executable, _arguments, _options) => {
          launchCount += 1;
          return fakeChild(async (child) => {
            await writeFile(
              journalPath,
              `${JSON.stringify({
                schemaVersion: 1,
                journey: "crash-restart-recovery",
                phase: "active-checkpoint",
                restartCount: 0,
              })}\n`,
              { mode: 0o600 },
            );
            emitClose(child, 0, null);
          });
        },
        snapshotProcessTree: () => ({ ok: true, pids: [] }),
        timeoutMs: 500,
      }),
    ).rejects.toMatchObject({ code: "journey-failed" });
    expect(launchCount).toBe(1);
  });

  it("terminates the recovery launch when its process probe fails", async () => {
    const fixture = await macFixture();
    const journalPath = path.join(fixture.root, "p8-product-journeys-restart.json");
    let launchCount = 0;
    let recoveryKillCount = 0;
    let probeCount = 0;
    await expect(
      runP8ProductJourneyCrashRestartRecovery({
        launchPath: fixture.app,
        userDataPath: fixture.root,
        resultPath: path.join(fixture.root, P8_PRODUCT_JOURNEY_RESULT_FILE_NAME),
        restartJournalPath: journalPath,
        environment: {},
        spawnChild: (_executable, _arguments, options) => {
          launchCount += 1;
          const recovery = options.env.ACTESTRA_P8_PRODUCT_JOURNEYS_RESTART_PHASE === "recover";
          const child = fakeChild(async (spawnedChild) => {
            if (recovery) return;
            await writeFile(
              journalPath,
              `${JSON.stringify({
                schemaVersion: 1,
                journey: "crash-restart-recovery",
                phase: "active-checkpoint",
                restartCount: 0,
              })}\n`,
              { mode: 0o600 },
            );
            emitClose(spawnedChild, 86, null);
          });
          if (recovery) {
            child.kill = () => {
              recoveryKillCount += 1;
              emitClose(child, null, "SIGTERM");
              return true;
            };
          }
          return child;
        },
        snapshotProcessTree: () => ({ ok: ++probeCount !== 4, pids: [] }),
        timeoutMs: 500,
        cleanupTimeoutMs: 100,
      }),
    ).rejects.toMatchObject({ code: "process-probe-failed" });
    expect(launchCount).toBe(2);
    expect(recoveryKillCount).toBe(1);
  });

  it.each([
    ["early exit", (child) => emitClose(child, 1, null), "early-exit"],
    [
      "malformed result",
      async (child, environment) => {
        await writeFile(
          path.join(environment.ACTESTRA_USER_DATA_DIR, P8_PRODUCT_JOURNEY_RESULT_FILE_NAME),
          "not-json\n",
        );
        emitClose(child, 1, null);
      },
      "result-malformed",
    ],
    ["journey timeout", () => {}, "journey-timeout"],
  ])("returns only a bounded failure for %s", async (_label, behavior, code) => {
    const fixture = await macFixture();
    const result = await runP8ProductJourneySmoke(smokeOptions(fixture, behavior));
    expect(result.evidence).toEqual({
      schemaVersion: 1,
      status: "failed",
      targetId: "macos-15-arm64",
      sourceCommit: commit,
      ciRunId: runId,
      code,
    });
  });

  it("fails closed on process inspection failure or a residual descendant", async () => {
    const fixture = await macFixture();
    const processProbeFailure = await runP8ProductJourneySmoke(
      smokeOptions(
        fixture,
        () => {},
        () => ({ ok: false }),
      ),
    );
    expect(processProbeFailure.evidence.code).toBe("process-probe-failed");

    let calls = 0;
    const residual = await runP8ProductJourneySmoke(
      smokeOptions(
        fixture,
        async (child, environment) => {
          await writeFile(
            path.join(environment.ACTESTRA_USER_DATA_DIR, P8_PRODUCT_JOURNEY_RESULT_FILE_NAME),
            `${JSON.stringify(verifiedJourneyResult())}\n`,
          );
          emitClose(child, 0, null);
        },
        () => ({ ok: true, pids: ++calls >= 3 ? [999] : [] }),
      ),
    );
    expect(residual.evidence.code).toBe("residual-processes");
  });
});

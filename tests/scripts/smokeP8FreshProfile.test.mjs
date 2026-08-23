// @vitest-environment node

import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { P8_FRESH_PROFILE_SUCCESS_KEYS } from "../../scripts/p8-fresh-profile-evidence.mjs";
import {
  P8_FRESH_PROFILE_MARKER_PREFIX,
  parseP8FreshProfileMarker,
  resolveP8FreshProfileIsolation,
  runP8FreshProfileSmoke,
} from "../../scripts/smoke-p8-fresh-profile.mjs";

const commit = "b".repeat(40);
const temporaryRoots = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function createMacPackageFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-p8-fresh-test-"));
  temporaryRoots.push(root);
  const app = path.join(root, "Actestra.app");
  const executable = path.join(app, "Contents", "MacOS", "Actestra");
  const asar = path.join(app, "Contents", "Resources", "app.asar");
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.mkdirSync(path.dirname(asar), { recursive: true });
  fs.writeFileSync(executable, "packaged executable");
  fs.writeFileSync(asar, "packaged asar");
  const packages = [
    { format: "dmg", path: path.join(root, "Actestra.dmg") },
    { format: "zip", path: path.join(root, "Actestra.zip") },
  ];
  for (const entry of packages) fs.writeFileSync(entry.path, `${entry.format} package`);
  return { root, app, executable, asar, packages };
}

function createFakeChild(onSpawn) {
  const child = new EventEmitter();
  child.pid = 42;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {
    emitExitAndClose(child, null, "SIGTERM");
    return true;
  };
  queueMicrotask(() => onSpawn(child));
  return child;
}

function emitExitAndClose(child, code, signal) {
  child.emit("exit", code, signal);
  child.emit("close", code, signal);
}

function makeRunOptions(fixture, onSpawn, snapshotProcessTree = () => ({ ok: true, pids: [] })) {
  return {
    targetId: "macos-15-arm64",
    sourceCommit: commit,
    runtimePath: fixture.app,
    packages: fixture.packages,
    isolationRoot: path.join(fixture.root, "isolation"),
    spawnChild: (_executable, _args, options) => {
      fs.mkdirSync(options.env.ACTESTRA_USER_DATA_DIR, { recursive: true });
      return createFakeChild((child) => onSpawn(child, options.env));
    },
    snapshotProcessTree,
    timeoutMs: 100,
    cleanupTimeoutMs: 100,
  };
}

function writeDurableState(environment, schemaVersion = 23) {
  fs.mkdirSync(path.join(environment.ACTESTRA_USER_DATA_DIR, "state"), { recursive: true });
  fs.writeFileSync(
    path.join(environment.ACTESTRA_USER_DATA_DIR, "actestra-profile.json"),
    '{"product":"Actestra","layoutVersion":1}\n',
  );
  const database = new DatabaseSync(
    path.join(environment.ACTESTRA_USER_DATA_DIR, "state", "actestra.sqlite3"),
  );
  database.exec(`PRAGMA user_version = ${schemaVersion}`);
  database.close();
}

function emitReady(child) {
  child.stdout.emit(
    "data",
    `${P8_FRESH_PROFILE_MARKER_PREFIX}${JSON.stringify({
      providerCount: 0,
      providerUiState: "provider-unavailable",
      providerUiTextPresent: true,
    })}\n`,
  );
  emitExitAndClose(child, 0, null);
}

describe("P8.2d packaged fresh-profile smoke", () => {
  it("parses exactly one bounded ready marker", () => {
    expect(
      parseP8FreshProfileMarker(
        `${P8_FRESH_PROFILE_MARKER_PREFIX}{"providerCount":0,"providerUiState":"provider-unavailable","providerUiTextPresent":true}\n`,
      ),
    ).toEqual({
      ok: true,
      value: {
        providerCount: 0,
        providerUiState: "provider-unavailable",
        providerUiTextPresent: true,
      },
    });
    expect(parseP8FreshProfileMarker("noise\n")).toEqual({ ok: false, code: "marker-missing" });
    expect(parseP8FreshProfileMarker(`${P8_FRESH_PROFILE_MARKER_PREFIX}{bad}\n`)).toEqual({
      ok: false,
      code: "marker-malformed",
    });
    expect(
      parseP8FreshProfileMarker(
        `${P8_FRESH_PROFILE_MARKER_PREFIX}{"providerCount":0,"providerUiState":"provider-unavailable","providerUiTextPresent":true}\n${P8_FRESH_PROFILE_MARKER_PREFIX}{"providerCount":0,"providerUiState":"provider-unavailable","providerUiTextPresent":true}\n`,
      ),
    ).toEqual({ ok: false, code: "marker-duplicate" });
  });

  it("accepts the bounded ready marker after the packaged Electron log prefix", async () => {
    const fixture = createMacPackageFixture();
    const result = await runP8FreshProfileSmoke(
      makeRunOptions(fixture, (child, environment) => {
        writeDurableState(environment);
        child.stdout.emit(
          "data",
          `22:02:53.589 › ${P8_FRESH_PROFILE_MARKER_PREFIX}${JSON.stringify({
            providerCount: 0,
            providerUiState: "provider-unavailable",
            providerUiTextPresent: true,
          })}\n`,
        );
        emitExitAndClose(child, 0, null);
      }),
    );
    expect(result.evidence.status).toBe("verified");
  });

  it("accepts a packaged app that writes durable state, reports the empty-provider UI, and exits normally", async () => {
    const fixture = createMacPackageFixture();
    const result = await runP8FreshProfileSmoke(
      makeRunOptions(fixture, (child, environment) => {
        writeDurableState(environment);
        emitReady(child);
      }),
    );
    expect(result.evidence.status).toBe("verified");
    expect(result.evidence.providerCount).toBe(0);
    expect(result.evidence.sqliteSchemaVersion).toBe(23);
    expect(result.evidence.residualProcessCount).toBe(0);
    expect(Object.keys(result.evidence).sort()).toEqual([...P8_FRESH_PROFILE_SUCCESS_KEYS].sort());
  });

  it("waits for stdio to drain after exit before classifying the ready marker", async () => {
    const fixture = createMacPackageFixture();
    const result = await runP8FreshProfileSmoke(
      makeRunOptions(fixture, (child, environment) => {
        writeDurableState(environment);
        child.emit("exit", 0, null);
        setTimeout(() => {
          child.stdout.emit(
            "data",
            `${P8_FRESH_PROFILE_MARKER_PREFIX}${JSON.stringify({
              providerCount: 0,
              providerUiState: "provider-unavailable",
              providerUiTextPresent: true,
            })}\n`,
          );
          child.emit("close", 0, null);
        }, 5);
      }),
    );
    expect(result.evidence.status).toBe("verified");
  });

  it.each([
    ["early exit", (child) => emitExitAndClose(child, 1, null), "early-exit"],
    ["startup timeout", () => {}, "startup-timeout"],
    [
      "malformed marker",
      (child) => {
        child.stdout.emit("data", `${P8_FRESH_PROFILE_MARKER_PREFIX}{bad}\n`);
        emitExitAndClose(child, 0, null);
      },
      "marker-malformed",
    ],
    [
      "non-empty Provider projection",
      (child) => {
        child.stdout.emit(
          "data",
          `${P8_FRESH_PROFILE_MARKER_PREFIX}${JSON.stringify({ providerCount: 1, providerUiState: "provider-unavailable", providerUiTextPresent: true })}\n`,
        );
        emitExitAndClose(child, 0, null);
      },
      "provider-projection-nonempty",
    ],
    [
      "missing Provider UI state",
      (child) => {
        child.stdout.emit(
          "data",
          `${P8_FRESH_PROFILE_MARKER_PREFIX}${JSON.stringify({ providerCount: 0, providerUiState: "ready", providerUiTextPresent: true })}\n`,
        );
        emitExitAndClose(child, 0, null);
      },
      "provider-ui-state-missing",
    ],
  ])("returns a bounded failure for %s", async (_name, behavior, expectedCode) => {
    const fixture = createMacPackageFixture();
    const result = await runP8FreshProfileSmoke(makeRunOptions(fixture, behavior));
    expect(result.evidence).toEqual({
      schemaVersion: 1,
      status: "failed",
      targetId: "macos-15-arm64",
      sourceCommit: commit,
      code: expectedCode,
    });
  });

  it("rejects an isolation path that escapes through a symlink", () => {
    const fixture = createMacPackageFixture();
    const root = path.join(fixture.root, "isolation");
    fs.mkdirSync(root, { recursive: true });
    const outside = path.join(fixture.root, "outside");
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(root, "user-data"), "dir");
    expect(() => resolveP8FreshProfileIsolation(root)).toThrow("isolation");
  });

  it.each([
    ["missing profile manifest", undefined, "profile-manifest-invalid"],
    ["wrong SQLite schema", 22, "sqlite-schema-invalid"],
  ])("fails closed for %s", async (_label, schemaVersion, expectedCode) => {
    const fixture = createMacPackageFixture();
    const result = await runP8FreshProfileSmoke(
      makeRunOptions(fixture, (child, environment) => {
        if (schemaVersion !== undefined) writeDurableState(environment, schemaVersion);
        emitReady(child);
      }),
    );
    expect(result.evidence.code).toBe(expectedCode);
  });

  it("fails closed when process inspection reports an error or a residual child", async () => {
    const fixture = createMacPackageFixture();
    const processProbeFailure = await runP8FreshProfileSmoke(
      makeRunOptions(
        fixture,
        (child, environment) => {
          writeDurableState(environment);
          emitReady(child);
        },
        () => ({ ok: false }),
      ),
    );
    expect(processProbeFailure.evidence.code).toBe("process-probe-failed");

    const residual = await runP8FreshProfileSmoke(
      makeRunOptions(
        fixture,
        (child, environment) => {
          writeDurableState(environment);
          emitReady(child);
        },
        () => ({ ok: true, pids: [999] }),
      ),
    );
    expect(residual.evidence.code).toBe("residual-processes");
  });
});

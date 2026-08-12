import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resolveTrustedPlannerWorkingDirectory,
  startActestraNativeTeamPlannerForTest,
  startTrustedActestraNativeTeamPlanner,
  type ActestraNativeTeamPlannerProcess,
} from "../../apps/desktop/src/main/orchestration/actestraNativeTeamPlannerProcess";
import {
  artifactId,
  correlationId,
  taskId,
  teamPlanId,
  teamRunId,
} from "../../apps/desktop/src/core";

const root = process.cwd();
const fixturePath = path.join(root, "tests/fixtures/actestraNativeTeamPlannerProbe.mjs");
const processWrapperPath = path.join(
  root,
  "apps/desktop/src/main/orchestration/actestraNativeTeamPlannerProcess.ts",
);
const sidecarProcessPath = path.join(
  root,
  "apps/desktop/src/main/orchestration/teamPlannerSidecarProcess.ts",
);
const request = {
  protocolVersion: 1,
  correlationId: correlationId("correlation-native-process"),
  planVersion: 1,
  goal: "Run one bounded Team plan.",
  workerCapabilities: ["general", "coding"],
  contextReferences: [],
  limits: { maxNodes: 3, maxDepth: 2, maxConcurrency: 2, maxTotalAttempts: 3 },
} as const;
const aggregate = {
  correlationId: request.correlationId,
  planId: teamPlanId(`team-plan-${"a".repeat(64)}`),
  runId: teamRunId(`team-run-${"b".repeat(64)}`),
  revision: 1,
  artifacts: [
    {
      artifactId: artifactId("artifact-one"),
      taskId: taskId("task-one"),
      kind: "file",
    },
  ],
} as const;

let workDirectory = "";
let planner: ActestraNativeTeamPlannerProcess | null = null;

beforeEach(() => {
  workDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-native-planner-process-"));
});

afterEach(async () => {
  await planner?.close().catch(() => undefined);
  planner = null;
  fs.rmSync(workDirectory, { recursive: true, force: true });
});

function options(mode = "normal", extra: Record<string, unknown> = {}) {
  return {
    executable: process.execPath,
    entryPath: fixturePath,
    entryArguments: mode === "normal" ? [] : [mode],
    workingDirectory: workDirectory,
    startupTimeoutMs: 1_000,
    requestTimeoutMs: 100,
    terminationGraceMs: 50,
    ...extra,
  };
}

describe("Actestra native Team planner supervisor", () => {
  it("fixes every production launch field internally and exposes arbitrary paths only to tests", () => {
    const source = fs.readFileSync(processWrapperPath, "utf8");
    const manifest = source.match(
      /export interface TrustedActestraNativeTeamPlannerManifest \{(?<body>[\s\S]*?)\n\}/u,
    )?.groups?.body;

    expect(manifest).toBeDefined();
    expect(manifest).not.toContain("executable");
    expect(manifest).not.toContain("entryPath");
    expect(manifest).not.toContain("workingDirectory");
    expect(manifest).not.toContain("sourceDigest");
    expect(manifest).toContain("schemaVersion");
    expect(manifest).toContain("entry");
    expect(source).toContain("path.join(__dirname, ACTESTRA_NATIVE_TEAM_PLANNER_ENTRY_FILE_NAME)");
    expect(source).toContain(
      "path.join(__dirname, ACTESTRA_NATIVE_TEAM_PLANNER_MANIFEST_FILE_NAME)",
    );
    expect(source).toContain("executable: process.execPath");
    expect(source).not.toContain("workingDirectory: __dirname");
    expect(source).toContain("resolveTrustedPlannerWorkingDirectory");
    expect(source).toContain("startActestraNativeTeamPlannerForTest");
    expect(source).not.toContain("PassThrough");
    expect(source).not.toContain("parentLivenessFd");
    expect(source).not.toMatch(
      /startTrustedActestraNativeTeamPlanner[\s\S]*?startWithOptions\(manifest\)/u,
    );
    expect(fs.readFileSync(sidecarProcessPath, "utf8")).toContain('ELECTRON_RUN_AS_NODE: "1"');
  });

  it("admits the exact engine handshake and preserves the closed request boundary", async () => {
    planner = await startActestraNativeTeamPlannerForTest(options());
    await expect(planner.propose(request, new AbortController().signal)).resolves.toMatchObject({
      correlationId: request.correlationId,
      planVersion: request.planVersion,
      nodes: expect.arrayContaining([expect.objectContaining({ capability: "coding" })]),
    });
    await expect(planner.aggregate(aggregate)).resolves.toEqual({
      summary: "bounded aggregate",
      artifacts: aggregate.artifacts,
    });
  });

  it("does not forward a parent credential environment value", async () => {
    const previous = process.env.ACTESTRA_TEST_SECRET;
    process.env.ACTESTRA_TEST_SECRET = "must-not-cross";
    try {
      planner = await startActestraNativeTeamPlannerForTest(options("assert-environment"));
      await expect(planner.propose(request, new AbortController().signal)).resolves.toMatchObject({
        summary: "bounded native planner probe",
      });
    } finally {
      if (previous === undefined) delete process.env.ACTESTRA_TEST_SECRET;
      else process.env.ACTESTRA_TEST_SECRET = previous;
    }
  });

  it("maps a request timeout to fail-closed cleanup", async () => {
    planner = await startActestraNativeTeamPlannerForTest(options("timeout"));
    await expect(planner.propose(request, new AbortController().signal)).rejects.toMatchObject({
      code: "request-timeout",
    });
    await expect(planner.close()).resolves.toBeUndefined();
  });

  it("aborts an in-flight request and makes repeated close idempotent", async () => {
    planner = await startActestraNativeTeamPlannerForTest(options("timeout"));
    const controller = new AbortController();
    const pending = planner.propose(request, controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
    await expect(planner.close()).resolves.toBeUndefined();
    await expect(planner.close()).resolves.toBeUndefined();
  });

  it("closes the wrapper and its stdin explicitly", async () => {
    planner = await startActestraNativeTeamPlannerForTest(options());
    const startedAt = Date.now();
    await expect(planner.close()).resolves.toBeUndefined();
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  it("exposes a zero-argument packaged factory with no caller-supplied trust fields", () => {
    expect(startTrustedActestraNativeTeamPlanner.length).toBe(0);
  });

  it("resolves an ASAR entry to Electron's physical resources directory", () => {
    const asarEntryDirectory = path.join(
      path.parse(process.cwd()).root,
      "Applications",
      "Actestra.app",
      "Contents",
      "Resources",
      "app.asar",
      "out",
      "main",
    );
    const resourcesPath = path.join(
      path.parse(process.cwd()).root,
      "Applications",
      "Actestra.app",
      "Contents",
      "Resources",
    );

    expect(resolveTrustedPlannerWorkingDirectory(asarEntryDirectory, resourcesPath)).toBe(
      resourcesPath,
    );
    expect(resolveTrustedPlannerWorkingDirectory("/worktree/apps/main", undefined)).toBe(
      "/worktree/apps/main",
    );
  });
});

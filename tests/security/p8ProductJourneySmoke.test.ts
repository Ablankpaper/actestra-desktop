// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  P8_PRODUCT_JOURNEY_IDS,
  P8_PRODUCT_JOURNEY_FAILURE_FILE_NAME,
  assertP8ProductJourneyPrivacy,
  createP8ProductJourneyCoordinator,
  parseP8ProductJourneyFailure,
  parseP8ProductJourneyRestartJournal,
  parseP8ProductJourneySmokeEnvironment,
  resolveP8ProductJourneyAuthorityFailureStage,
  withP8ProductJourneyFailureStageScope,
  writeP8ProductJourneyFailure,
  writeP8ProductJourneyRestartJournal,
  writeP8ProductJourneyResult,
  type P8ProductJourneyRunContext,
  type P8ProductJourneyFailureStage,
  type P8ProductJourneyRuntimeDiagnosticStage,
} from "../../apps/desktop/src/main/security/p8ProductJourneySmoke";
import {
  runP8CancellationNoOrphanJourney,
  runP8CrashRestartRecoveryPrepareJourney,
  runP8CrashRestartRecoveryVerifyJourney,
  runP8GooseIsolatedPatchJourney,
} from "../../apps/desktop/src/main/acceptance/p8ProductJourneySmoke";
import {
  createP8ProductJourneyLoopbackModelBinding,
  resolveP8ProductJourneyRuntimeConfig,
} from "../../apps/desktop/src/main/acceptance/p8ProductJourneyRuntime";

const root = "/tmp/actestra-p8-smoke";
const completeEnvironment = {
  ACTESTRA_E2E_TEST: "1",
  ACTESTRA_P8_PRODUCT_JOURNEYS_SMOKE: "1",
  ACTESTRA_E2E_ISOLATION_ROOT: root,
  ACTESTRA_USER_DATA_DIR: `${root}/user-data`,
  ACTESTRA_E2E_HOME_DIR: `${root}/home`,
  ACTESTRA_E2E_TEMP_DIR: `${root}/temp`,
  ACTESTRA_P8_PRODUCT_JOURNEYS_WORKSPACE: `${root}/workspace`,
  ACTESTRA_P8_PRODUCT_JOURNEYS_RESULT: `${root}/user-data/p8-product-journeys-result.json`,
  ACTESTRA_P8_PRODUCT_JOURNEYS_TIMEOUT_MS: "30000",
};

const runtimeDiagnosticStages: readonly P8ProductJourneyRuntimeDiagnosticStage[] = [
  "model-binding",
  "user-data",
  "runner-package",
  "runner-admission",
  "git-executable",
  "private-root",
  "runtime-startup",
];

function context(overrides: Partial<P8ProductJourneyRunContext> = {}): P8ProductJourneyRunContext {
  return {
    environment: completeEnvironment,
    appIsPackaged: true,
    executeJourney: async (id) => ({
      id,
      status: "verified",
      residualProcessCount: 0,
    }),
    cleanup: async () => ({ residualProcessCount: 0 }),
    ...overrides,
  };
}

describe("P8 packaged product-journey coordinator", () => {
  it("is inert unless the complete explicit environment is present", () => {
    expect(parseP8ProductJourneySmokeEnvironment({})).toBeNull();
    expect(parseP8ProductJourneySmokeEnvironment(completeEnvironment)?.resultPath).toBe(
      completeEnvironment.ACTESTRA_P8_PRODUCT_JOURNEYS_RESULT,
    );
    expect(
      parseP8ProductJourneySmokeEnvironment({
        ...completeEnvironment,
        ACTESTRA_P8_PRODUCT_JOURNEYS_RESULT: "/tmp/outside/result.json",
      }),
    ).toBeNull();
  });

  it("runs the fixed nine journeys in order and returns only bounded observations", async () => {
    const seen: string[] = [];
    const result = await createP8ProductJourneyCoordinator(
      context({
        executeJourney: async (id) => {
          seen.push(id);
          return { id, status: "verified", residualProcessCount: 0 };
        },
      }),
    ).run();
    expect(seen).toEqual(P8_PRODUCT_JOURNEY_IDS);
    expect(result).toEqual({
      schemaVersion: 1,
      status: "verified",
      journeys: P8_PRODUCT_JOURNEY_IDS.map((id) => ({
        id,
        status: "verified",
        residualProcessCount: 0,
      })),
    });
    expect(JSON.stringify(result)).not.toMatch(/path|credential|worker|pid|payload/i);
  });

  it("fails closed and never writes a success result when a journey or cleanup fails", async () => {
    const writeResult = vi.fn();
    await expect(
      createP8ProductJourneyCoordinator(
        context({
          writeResult,
          executeJourney: async (id) => {
            if (id === "goose-isolated-patch") throw new Error("journey-failed");
            return { id, status: "verified", residualProcessCount: 0 };
          },
        }),
      ).run(),
    ).rejects.toMatchObject({ code: "journey-failed" });
    expect(writeResult).not.toHaveBeenCalledWith(expect.objectContaining({ status: "verified" }));
  });

  it("rejects privacy leaks in bounded projections", () => {
    expect(() => assertP8ProductJourneyPrivacy({ status: "verified", journeys: [] })).not.toThrow();
    expect(() => assertP8ProductJourneyPrivacy({ privatePath: "/Users/private" })).toThrow(
      "privacy-redaction-failed",
    );
    expect(() => assertP8ProductJourneyPrivacy({ credential: "secret" })).toThrow(
      "privacy-redaction-failed",
    );
  });

  it("accepts only a bounded restart journal and writes it owner-only", () => {
    const journal = {
      schemaVersion: 1 as const,
      journey: "crash-restart-recovery" as const,
      phase: "active-checkpoint" as const,
      restartCount: 0 as const,
    };
    expect(parseP8ProductJourneyRestartJournal(journal)).toEqual(journal);
    expect(
      parseP8ProductJourneyRestartJournal({
        schemaVersion: 1,
        journey: "crash-restart-recovery",
        phase: "recovered",
        restartCount: 1,
        privatePath: "/Users/private",
      }),
    ).toBeNull();
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-p8-restart-"));
    const journalPath = path.join(directory, "p8-product-journeys-restart.json");
    try {
      writeP8ProductJourneyRestartJournal(journalPath, journal);
      expect(fs.readFileSync(journalPath, "utf8")).toBe(`${JSON.stringify(journal)}\n`);
      expect(fs.statSync(journalPath).mode & 0o777).toBe(0o600);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("accepts and writes only a closed private failure record", () => {
    const failure = {
      code: "journey-failed" as const,
      stage: "general-artifact" as const,
    };
    expect(parseP8ProductJourneyFailure(failure)).toEqual(failure);
    expect(
      parseP8ProductJourneyFailure({
        code: "journey-failed",
        stage: "coding-artifact-preview",
      }),
    ).toEqual({ code: "journey-failed", stage: "coding-artifact-preview" });
    expect(
      parseP8ProductJourneyFailure({
        ...failure,
        extra: "not-allowed",
      }),
    ).toBeNull();
    expect(
      parseP8ProductJourneyFailure({
        code: "journey-failed",
        stage: "/private/path",
      }),
    ).toBeNull();
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-p8-failure-"));
    const failurePath = path.join(directory, P8_PRODUCT_JOURNEY_FAILURE_FILE_NAME);
    try {
      writeP8ProductJourneyFailure(failurePath, failure);
      expect(fs.readFileSync(failurePath, "utf8")).toBe(`${JSON.stringify(failure)}\n`);
      expect(fs.statSync(failurePath).mode & 0o777).toBe(0o600);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each(runtimeDiagnosticStages)(
    "round-trips the precise runtime failure stage %s through the private failure file",
    (stage) => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-p8-runtime-failure-"));
      const failurePath = path.join(directory, P8_PRODUCT_JOURNEY_FAILURE_FILE_NAME);
      const failure = { code: "journey-failed" as const, stage };
      try {
        expect(parseP8ProductJourneyFailure(failure)).toEqual(failure);
        writeP8ProductJourneyFailure(failurePath, failure);
        expect(
          parseP8ProductJourneyFailure(JSON.parse(fs.readFileSync(failurePath, "utf8"))),
        ).toEqual(failure);
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    },
  );

  it("restores the caller failure stage after a successful scoped operation", async () => {
    let stage: P8ProductJourneyFailureStage = "workspace-apply-approval";
    await withP8ProductJourneyFailureStageScope(
      stage,
      (nextStage) => {
        stage = nextStage;
      },
      async () => {
        stage = "destination-workspace-grant-check";
        return "workspace-id";
      },
    );
    expect(stage).toBe("workspace-apply-approval");
  });

  it("keeps the precise inner failure stage when a scoped operation throws", async () => {
    let stage: P8ProductJourneyFailureStage = "general-goose-team";
    await expect(
      withP8ProductJourneyFailureStageScope(
        stage,
        (nextStage) => {
          stage = nextStage;
        },
        async () => {
          stage = "destination-workspace-grant-write";
          throw new Error("destination workspace write failed");
        },
      ),
    ).rejects.toThrow("destination workspace write failed");
    expect(stage).toBe("destination-workspace-grant-write");
  });

  it("refuses a pre-existing failure symlink without changing its target", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-p8-failure-link-"));
    const failurePath = path.join(directory, P8_PRODUCT_JOURNEY_FAILURE_FILE_NAME);
    const sentinelPath = path.join(directory, "sentinel.txt");
    fs.writeFileSync(sentinelPath, "protected\n");
    fs.symlinkSync(sentinelPath, failurePath);
    try {
      expect(() =>
        writeP8ProductJourneyFailure(failurePath, {
          code: "journey-failed",
          stage: "general-artifact",
        }),
      ).toThrow("result-write-failed");
      expect(fs.readFileSync(sentinelPath, "utf8")).toBe("protected\n");
      expect(fs.lstatSync(failurePath).isSymbolicLink()).toBe(true);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("refuses a pre-existing restart temporary path without changing its target", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-p8-restart-temp-"));
    const journalPath = path.join(directory, "p8-product-journeys-restart.json");
    const sentinelPath = path.join(directory, "sentinel.txt");
    const temporaryPath = `${journalPath}.tmp`;
    fs.writeFileSync(sentinelPath, "protected\n");
    fs.linkSync(sentinelPath, temporaryPath);
    try {
      expect(() =>
        writeP8ProductJourneyRestartJournal(journalPath, {
          schemaVersion: 1,
          journey: "crash-restart-recovery",
          phase: "active-checkpoint",
          restartCount: 0,
        }),
      ).toThrow("result-write-failed");
      expect(fs.readFileSync(sentinelPath, "utf8")).toBe("protected\n");
      expect(fs.existsSync(journalPath)).toBe(false);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("prepares an active General checkpoint from the registered ready graph and verifies one durable recovery without replay", async () => {
    const directory = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "actestra-p8-recovery-")),
    );
    const journalPath = path.join(directory, "p8-product-journeys-restart.json");
    const workspaceId = "workspace-p8-restart";
    const taskId = "task-p8-restart";
    const sessionId = "session-p8-restart";
    const workerId = "worker-p8-restart";
    let recovered = false;
    const service = {
      submitFromTrustedContext: vi.fn(async () => ({
        taskId,
        status: "running",
        canCancel: true,
      })),
      list: vi.fn(async () => [
        {
          taskId,
          status: recovered ? "failed" : "running",
          incidentCode: recovered ? "application-restart" : undefined,
          canCancel: false,
          artifacts: [],
        },
      ]),
    };
    const persistence = {
      loadDomainGraph: vi.fn(async () => ({
        tasks: [
          {
            id: taskId,
            workspaceId,
            state: recovered ? "failed" : "ready",
            activeSessionId: recovered ? undefined : sessionId,
          },
        ],
        sessions: [
          {
            id: sessionId,
            workspaceId,
            taskId,
            state: recovered ? "failed" : "created",
            workerId,
          },
        ],
        workers: [
          {
            id: workerId,
            workspaceId,
            adapterKind: "actestra.general-worker",
            state: recovered ? "stopped" : "created",
          },
        ],
        artifacts: [],
      })),
      getGeneralWorkCheckpoint: vi.fn(async () => ({
        phase: recovered ? "finalized" : "active",
        attempt: {
          workspaceId,
          taskId,
          sessionId,
          workerId,
          state: recovered ? "failed" : "running",
          taskState: recovered ? "failed" : "running",
          disposed: recovered,
          incident: recovered ? { code: "application-restart" } : undefined,
        },
        events: [],
      })),
      replayEvents: vi.fn(async () => [
        {
          type: "worker.failed",
          payload: { errorCode: "application-restart" },
        },
        { type: "task.failed", payload: { errorCode: "application-restart" } },
      ]),
      listRecentAgentAttemptEvidence: vi.fn(async () => [
        {
          sessionId,
          state: "failed",
          incident: { code: "application-restart" },
        },
      ]),
    };
    try {
      await expect(
        runP8CrashRestartRecoveryPrepareJourney({
          service: service as never,
          persistence: persistence as never,
          workspaceRoot: directory,
          restartJournalPath: journalPath,
        }),
      ).resolves.toMatchObject({ taskId });
      recovered = true;
      await expect(
        runP8CrashRestartRecoveryVerifyJourney({
          service: service as never,
          persistence: persistence as never,
          startupRecovery: [
            {
              recoveredFrom: "active",
              sessionId,
              eventStatuses: ["appended", "appended"],
              evidenceStatus: "appended",
              checkpoint: {
                phase: "finalized",
                attempt: {
                  workspaceId,
                  taskId,
                  sessionId,
                  workerId,
                  streamId: "stream-p8-restart",
                  state: "failed",
                  taskState: "failed",
                  disposed: true,
                  incident: { code: "application-restart" },
                },
                events: [],
              },
            },
          ] as never,
          restartJournalPath: journalPath,
          verifyNoDuplicateRecovery: async () => [],
        }),
      ).resolves.toBeUndefined();
      expect(
        parseP8ProductJourneyRestartJournal(JSON.parse(fs.readFileSync(journalPath, "utf8"))),
      ).toMatchObject({ phase: "recovered", restartCount: 1 });
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("preserves the earliest precise runtime failure instead of the coarse authority stage", () => {
    expect(
      resolveP8ProductJourneyAuthorityFailureStage(
        { code: "journey-failed", stage: "runner-package" },
        "coding-journey",
      ),
    ).toBe("runner-package");
    expect(resolveP8ProductJourneyAuthorityFailureStage(null, "coding-journey")).toBe(
      "coding-journey",
    );
    expect(
      resolveP8ProductJourneyAuthorityFailureStage(
        { code: "journey-timeout", stage: "runner-package" },
        "coding-journey",
      ),
    ).toBe("coding-journey");
    expect(
      resolveP8ProductJourneyAuthorityFailureStage(
        { code: "journey-failed", stage: "coding-submit" },
        "persistence",
      ),
    ).toBe("persistence");
  });

  it("rejects a legacy running graph that is not the prepared durable registration", async () => {
    const directory = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "actestra-p8-recovery-legacy-")),
    );
    const journalPath = path.join(directory, "p8-product-journeys-restart.json");
    const taskId = "task-p8-restart-legacy";
    const sessionId = "session-p8-restart-legacy";
    const stages: string[] = [];
    const service = {
      submitFromTrustedContext: vi.fn(async () => ({
        taskId,
        status: "running",
        canCancel: true,
      })),
      list: vi.fn(async () => []),
    };
    const persistence = {
      loadDomainGraph: vi.fn(async () => ({
        tasks: [{ id: taskId, state: "running" }],
        sessions: [
          {
            id: sessionId,
            taskId,
            state: "running",
            workerId: "worker-p8-restart-legacy",
          },
        ],
        workers: [{ id: "worker-p8-restart-legacy", state: "running" }],
        artifacts: [],
      })),
      getGeneralWorkCheckpoint: vi.fn(async () => ({
        phase: "active",
        attempt: {
          sessionId,
          state: "running",
          taskState: "running",
          disposed: false,
        },
        events: [],
      })),
    };
    try {
      await expect(
        runP8CrashRestartRecoveryPrepareJourney({
          service: service as never,
          persistence: persistence as never,
          workspaceRoot: directory,
          restartJournalPath: journalPath,
          onFailure: (stage) => stages.push(stage),
        }),
      ).rejects.toThrow("P8.2 crash/restart durable attempt is not active");
      expect(stages).toEqual(["crash-restart-prepare-checkpoint"]);
      expect(fs.existsSync(journalPath)).toBe(false);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("selects the task's active session when a historical session is also present", async () => {
    const directory = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "actestra-p8-recovery-active-session-")),
    );
    const journalPath = path.join(directory, "p8-product-journeys-restart.json");
    const workspaceId = "workspace-p8-restart-active-session";
    const taskId = "task-p8-restart-active-session";
    const historicalSessionId = "session-p8-restart-history";
    const activeSessionId = "session-p8-restart-active";
    const historicalWorkerId = "worker-p8-restart-history";
    const activeWorkerId = "worker-p8-restart-active";
    const stages: string[] = [];
    const service = {
      submitFromTrustedContext: vi.fn(async () => ({
        taskId,
        status: "running",
        canCancel: true,
      })),
      list: vi.fn(async () => []),
    };
    const persistence = {
      loadDomainGraph: vi.fn(async () => ({
        tasks: [{ id: taskId, workspaceId, state: "ready", activeSessionId }],
        sessions: [
          {
            id: historicalSessionId,
            workspaceId,
            taskId,
            state: "failed",
            workerId: historicalWorkerId,
          },
          {
            id: activeSessionId,
            workspaceId,
            taskId,
            state: "created",
            workerId: activeWorkerId,
          },
        ],
        workers: [
          {
            id: historicalWorkerId,
            workspaceId,
            adapterKind: "actestra.general-worker",
            state: "stopped",
          },
          {
            id: activeWorkerId,
            workspaceId,
            adapterKind: "actestra.general-worker",
            state: "created",
          },
        ],
        artifacts: [],
      })),
      getGeneralWorkCheckpoint: vi.fn(async (session: string) => {
        if (session !== activeSessionId) {
          throw new Error("historical session must not be inspected");
        }
        return {
          phase: "active",
          attempt: {
            workspaceId,
            taskId,
            sessionId: activeSessionId,
            workerId: activeWorkerId,
            state: "running",
            taskState: "running",
            disposed: false,
          },
          events: [],
        };
      }),
    };
    try {
      await expect(
        runP8CrashRestartRecoveryPrepareJourney({
          service: service as never,
          persistence: persistence as never,
          workspaceRoot: directory,
          restartJournalPath: journalPath,
          onFailure: (stage) => stages.push(stage),
        }),
      ).resolves.toMatchObject({ taskId, sessionId: activeSessionId });
      expect(stages).toEqual([]);
      expect(persistence.getGeneralWorkCheckpoint).toHaveBeenCalledWith(activeSessionId);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects an incomplete active checkpoint after the prepared registration", async () => {
    const directory = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "actestra-p8-recovery-checkpoint-")),
    );
    const journalPath = path.join(directory, "p8-product-journeys-restart.json");
    const workspaceId = "workspace-p8-restart-checkpoint";
    const taskId = "task-p8-restart-checkpoint";
    const sessionId = "session-p8-restart-checkpoint";
    const workerId = "worker-p8-restart-checkpoint";
    const stages: string[] = [];
    const service = {
      submitFromTrustedContext: vi.fn(async () => ({
        taskId,
        status: "running",
        canCancel: true,
      })),
      list: vi.fn(async () => []),
    };
    const persistence = {
      loadDomainGraph: vi.fn(async () => ({
        tasks: [{ id: taskId, workspaceId, state: "ready", activeSessionId: sessionId }],
        sessions: [
          {
            id: sessionId,
            workspaceId,
            taskId,
            state: "created",
            workerId,
          },
        ],
        workers: [
          {
            id: workerId,
            workspaceId,
            adapterKind: "actestra.general-worker",
            state: "created",
          },
        ],
        artifacts: [],
      })),
      getGeneralWorkCheckpoint: vi.fn(async () => ({
        phase: "finalized",
        attempt: {
          workspaceId,
          taskId,
          sessionId,
          workerId,
          state: "running",
          taskState: "running",
          disposed: false,
        },
        events: [],
      })),
    };
    try {
      await expect(
        runP8CrashRestartRecoveryPrepareJourney({
          service: service as never,
          persistence: persistence as never,
          workspaceRoot: directory,
          restartJournalPath: journalPath,
          onFailure: (stage) => stages.push(stage),
        }),
      ).rejects.toThrow("P8.2 crash/restart active checkpoint is incomplete");
      expect(stages).toEqual(["crash-restart-prepare-checkpoint"]);
      expect(fs.existsSync(journalPath)).toBe(false);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects an active checkpoint whose identities do not bind to the prepared graph", async () => {
    const directory = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "actestra-p8-recovery-identity-")),
    );
    const journalPath = path.join(directory, "p8-product-journeys-restart.json");
    const workspaceId = "workspace-p8-restart-identity";
    const taskId = "task-p8-restart-identity";
    const sessionId = "session-p8-restart-identity";
    const workerId = "worker-p8-restart-identity";
    const stages: string[] = [];
    const service = {
      submitFromTrustedContext: vi.fn(async () => ({
        taskId,
        status: "running",
        canCancel: true,
      })),
      list: vi.fn(async () => []),
    };
    const persistence = {
      loadDomainGraph: vi.fn(async () => ({
        tasks: [{ id: taskId, workspaceId, state: "ready", activeSessionId: sessionId }],
        sessions: [
          {
            id: sessionId,
            workspaceId,
            taskId,
            state: "created",
            workerId,
          },
        ],
        workers: [
          {
            id: workerId,
            workspaceId,
            adapterKind: "actestra.general-worker",
            state: "created",
          },
        ],
        artifacts: [],
      })),
      getGeneralWorkCheckpoint: vi.fn(async () => ({
        phase: "active",
        attempt: {
          workspaceId,
          taskId,
          sessionId,
          workerId: "worker-p8-restart-other",
          state: "running",
          taskState: "running",
          disposed: false,
        },
        events: [],
      })),
    };
    try {
      await expect(
        runP8CrashRestartRecoveryPrepareJourney({
          service: service as never,
          persistence: persistence as never,
          workspaceRoot: directory,
          restartJournalPath: journalPath,
          onFailure: (stage) => stages.push(stage),
        }),
      ).rejects.toThrow("P8.2 crash/restart active checkpoint is incomplete");
      expect(stages).toEqual(["crash-restart-prepare-checkpoint"]);
      expect(fs.existsSync(journalPath)).toBe(false);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reports a closed crash/restart phase when prepare submission fails", async () => {
    const directory = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "actestra-p8-recovery-diagnostic-")),
    );
    const stages: string[] = [];
    try {
      await expect(
        runP8CrashRestartRecoveryPrepareJourney({
          service: {
            submitFromTrustedContext: vi.fn(async () => {
              throw new Error("private provider detail");
            }),
            list: vi.fn(async () => []),
          } as never,
          persistence: {} as never,
          workspaceRoot: directory,
          restartJournalPath: path.join(directory, "p8-product-journeys-restart.json"),
          onFailure: (stage) => stages.push(stage),
        }),
      ).rejects.toThrow("private provider detail");
      expect(stages).toEqual(["crash-restart-prepare-submit"]);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reports a closed coding phase when submission fails", async () => {
    const directory = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "actestra-p8-coding-diagnostic-")),
    );
    const managedRoot = path.join(directory, "managed");
    fs.mkdirSync(managedRoot);
    const stages: string[] = [];
    try {
      await expect(
        runP8GooseIsolatedPatchJourney({
          service: {
            submitFromTrustedContext: vi.fn(async () => {
              throw new Error("private provider detail");
            }),
            list: vi.fn(async () => []),
            waitForIdle: vi.fn(async () => undefined),
            decideApproval: vi.fn(async () => undefined),
            decidePublish: vi.fn(async () => undefined),
            getArtifactPatchPreview: vi.fn(async () => ""),
          } as never,
          persistence: {} as never,
          workspaceRoot: directory,
          managedRoot,
          onFailure: (stage) => stages.push(stage),
        }),
      ).rejects.toThrow("private provider detail");
      expect(stages).toEqual(["coding-submit"]);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("recognizes the prepare phase without changing the loopback model response contract", async () => {
    const config = resolveP8ProductJourneyRuntimeConfig({
      packaged: true,
      environment: {
        ACTESTRA_E2E_TEST: "1",
        ACTESTRA_P8_PRODUCT_JOURNEYS_SMOKE: "1",
        ACTESTRA_P8_PRODUCT_JOURNEYS_RESTART_PHASE: "prepare",
      },
    });
    expect(config).toMatchObject({ restartPhase: "prepare" });
    const completion = await createP8ProductJourneyLoopbackModelBinding(config!).invokeModel(
      {
        purpose: "general-work",
        responseMode: "text",
        messages: [],
        tools: [],
      } as never,
      new AbortController().signal,
    );
    expect(completion.type).toBe("message");
  });

  it("aggregates residual processes as a closed cleanup failure", async () => {
    await expect(
      createP8ProductJourneyCoordinator(
        context({ cleanup: async () => ({ residualProcessCount: 1 }) }),
      ).run(),
    ).rejects.toMatchObject({ code: "residual-processes" });
  });

  it("still runs bounded cleanup after the caller cancels an active journey", async () => {
    const controller = new AbortController();
    const cleanup = vi.fn(async () => ({ residualProcessCount: 0 }));
    const result = createP8ProductJourneyCoordinator(
      context({
        signal: controller.signal,
        cleanup,
        executeJourney: async (_id, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            });
            queueMicrotask(() => controller.abort(new Error("journey-failed")));
          }),
      }),
    ).run();
    await expect(result).rejects.toMatchObject({ code: "journey-failed" });
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("times out a stalled journey and still completes cleanup", async () => {
    vi.useFakeTimers();
    try {
      const cleanup = vi.fn(async () => ({ residualProcessCount: 0 }));
      const result = createP8ProductJourneyCoordinator(
        context({
          environment: {
            ...completeEnvironment,
            ACTESTRA_P8_PRODUCT_JOURNEYS_TIMEOUT_MS: "1000",
          },
          cleanup,
          executeJourney: async () => new Promise(() => undefined),
        }),
      ).run();
      const rejection = expect(result).rejects.toMatchObject({
        code: "journey-timeout",
      });
      await vi.advanceTimersByTimeAsync(1_000);
      await rejection;
      expect(cleanup).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("writes the exact private newline-terminated result only once", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-p8-result-"));
    const resultPath = path.join(directory, "p8-product-journeys-result.json");
    const result = {
      schemaVersion: 1 as const,
      status: "verified" as const,
      journeys: P8_PRODUCT_JOURNEY_IDS.map((id) => ({
        id,
        status: "verified" as const,
        residualProcessCount: 0 as const,
      })),
    };
    try {
      writeP8ProductJourneyResult(resultPath, result);
      expect(fs.readFileSync(resultPath, "utf8")).toBe(`${JSON.stringify(result)}\n`);
      expect(fs.statSync(resultPath).mode & 0o777).toBe(0o600);
      expect(() => writeP8ProductJourneyResult(resultPath, result)).toThrow("result-write-failed");
      expect(fs.readFileSync(resultPath, "utf8")).toBe(`${JSON.stringify(result)}\n`);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("cancels an active Goose attempt and verifies durable cleanup without source mutation", async () => {
    const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-p8-cancel-"));
    const workspacePath = path.join(rootDirectory, "workspace");
    const managedPath = path.join(rootDirectory, "managed");
    fs.mkdirSync(workspacePath, { recursive: true, mode: 0o700 });
    fs.mkdirSync(managedPath, { recursive: true, mode: 0o700 });
    const workspaceRoot = fs.realpathSync(workspacePath);
    const managedRoot = fs.realpathSync(managedPath);
    const before = fs.readdirSync(managedRoot);
    const taskId = "task-p8-cancellation" as never;
    let cancelled = false;
    const service = {
      submitFromTrustedContext: vi.fn(async () => ({
        taskId,
        status: "running",
        canCancel: true,
      })),
      list: vi.fn(async () => [
        {
          taskId,
          status: cancelled ? "cancelled" : "running",
          canCancel: !cancelled,
        },
      ]),
      cancel: vi.fn(async () => {
        cancelled = true;
        return { taskId, status: "cancelled", canCancel: false };
      }),
      waitForIdle: vi.fn(async () => undefined),
    };
    const persistence = {
      loadDomainGraph: vi.fn(async () => ({
        workspaces: [],
        tasks: [
          {
            id: taskId,
            state: "cancelled",
            activeSessionId: undefined,
          },
        ],
        sessions: [{ taskId, state: "cancelled" }],
        workers: [{ workspaceId: "workspace-p8-cancellation", state: "stopped" }],
        artifacts: [],
      })),
    };
    try {
      await expect(
        runP8CancellationNoOrphanJourney({
          service: service as never,
          persistence: persistence as never,
          workspaceRoot,
          managedRoot,
        }),
      ).resolves.toBeUndefined();
      expect(service.cancel).toHaveBeenCalledOnce();
      expect(service.waitForIdle).toHaveBeenCalledOnce();
      expect(fs.readdirSync(managedRoot)).toEqual(before);
    } finally {
      fs.rmSync(rootDirectory, { recursive: true, force: true });
    }
  });
});

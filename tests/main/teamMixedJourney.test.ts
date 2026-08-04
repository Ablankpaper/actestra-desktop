// @vitest-environment node

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AionUiCodingJourneyProjection } from "../../apps/desktop/src/compatibility/aionui";
import {
  CODING_FILE_WRITE_TOOL_ID,
  CODING_TEST_TOOL_ID,
  eventId,
  instant,
  type ActestraPersistencePort,
  type Instant,
  type TeamPlanNodeId,
  type TeamRunId,
} from "../../apps/desktop/src/core";
import { AionUiCodingJourneyService } from "../../apps/desktop/src/main/compatibility/aionuiCodingJourneyService";
import { AionUiGeneralWorkJourneyService } from "../../apps/desktop/src/main/compatibility/aionuiGeneralWorkJourneyService";
import { createScopedNativeToolPlatform } from "../../apps/desktop/src/main/privileged/scopedNativeToolPlatform";
import {
  TeamJourneyWorkerRouter,
  deriveTeamJourneyBinding,
} from "../../apps/desktop/src/main/orchestration/teamJourneyWorkerRouter";
import {
  TeamOrchestratorService,
  type TeamResultAggregationPort,
} from "../../apps/desktop/src/main/orchestration/teamOrchestratorService";
import { DeterministicAgentClock } from "../../apps/desktop/src/main/workers/deterministicFakeAgentAdapter";
import { createIsolatedCodingMainService } from "../../apps/desktop/src/main/workers/isolatedCodingMainService";
import type { GooseLoopbackModelInvocation } from "../../apps/desktop/src/main/workers/gooseLoopbackModelServer";
import {
  admitGooseRunnerArtifact,
  type AdmittedGooseRunnerArtifact,
} from "../../apps/desktop/src/main/workers/gooseRunnerArtifact";
import type { IsolatedCodingMainService } from "../../apps/desktop/src/main/workers/isolatedCodingMainService";
import type {
  TeamPlannerAggregatePayload,
  TeamPlannerAggregateResult,
} from "../../apps/desktop/src/shared/teamPlannerSidecarProtocol";
import type { LoopbackGeneralWorkerTransport } from "../fixtures/generalWorker";
import { openTestGeneralWorker } from "../fixtures/generalWorker";
import { openTestPersistenceUtility } from "../fixtures/persistenceUtility";
import { createTeamRunFixture } from "../fixtures/teamRun";

const execFileAsync = promisify(execFile);
const artifactDirectory = process.env.ACTESTRA_GOOSE_RUNNER_ARTIFACT_DIR;
const trustedManifestSha256 = process.env.ACTESTRA_GOOSE_RUNNER_MANIFEST_SHA256;
const targetTriple =
  process.platform === "darwin" && process.arch === "arm64"
    ? "aarch64-apple-darwin"
    : process.platform === "darwin" && process.arch === "x64"
      ? "x86_64-apple-darwin"
      : undefined;
const GIT_ENVIRONMENT = Object.freeze({
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  LC_ALL: "C",
  PATH: "/usr/bin:/bin",
});

interface Deferred<T = void> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
}

interface MixedJourneyFixture {
  readonly root: string;
  readonly repositoryRoot: string;
  readonly sourceFile: string;
  readonly generalWorkspaceRoot: string;
  readonly managedRoot: string;
  readonly privateRootParent: string;
  readonly persistence: ActestraPersistencePort;
  readonly mainService: IsolatedCodingMainService;
  readonly generalJourney: AionUiGeneralWorkJourneyService;
  readonly codingJourney: AionUiCodingJourneyService;
  readonly router: TeamJourneyWorkerRouter;
  readonly orchestrator: TeamOrchestratorService;
  readonly transports: readonly LoopbackGeneralWorkerTransport[];
  readonly accepted: Awaited<ReturnType<TeamOrchestratorService["create"]>>;
  readonly nextInstant: () => Instant;
}

const fixtures: MixedJourneyFixture[] = [];
let admittedArtifact: Promise<AdmittedGooseRunnerArtifact> | undefined;

function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((release) => {
    resolve = release;
  });
  return { promise, resolve };
}

function advancingClock(start = Date.parse("2026-08-05T02:00:00.000Z")): () => Instant {
  let milliseconds = start;
  return () => {
    milliseconds += 1_000;
    return instant(new Date(milliseconds).toISOString());
  };
}

async function runGit(repositoryRoot: string, ...arguments_: readonly string[]): Promise<string> {
  const result = await execFileAsync("/usr/bin/git", ["-C", repositoryRoot, ...arguments_], {
    encoding: "utf8",
    env: GIT_ENVIRONMENT,
    maxBuffer: 64 * 1024,
  });
  return result.stdout.trim();
}

function requireAdmittedArtifact(): Promise<AdmittedGooseRunnerArtifact> {
  admittedArtifact ??= admitGooseRunnerArtifact(artifactDirectory!, {
    expectedTargetTriple: targetTriple!,
    trustedManifestSha256: trustedManifestSha256!,
  });
  return admittedArtifact;
}

async function openMixedFixture(
  suffix: string,
  modelInvoker: ConstructorParameters<typeof AionUiCodingJourneyService>[0]["modelInvoker"],
  aggregator: TeamResultAggregationPort,
  options: Readonly<{ holdGeneralWorker?: boolean }> = {},
): Promise<MixedJourneyFixture> {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "actestra-team-mixed-")));
  const repositoryRoot = path.join(root, "source");
  const sourceFile = path.join(repositoryRoot, "answer.txt");
  const generalWorkspaceRoot = path.join(root, "general-workspace");
  const productStateRoot = path.join(root, "product-state");
  const managedRoot = path.join(productStateRoot, "coding-worktrees");
  const privateRootParent = path.join(productStateRoot, "goose-private");
  fs.mkdirSync(repositoryRoot, { recursive: true });
  fs.mkdirSync(generalWorkspaceRoot, { recursive: true });
  fs.mkdirSync(privateRootParent, { recursive: true, mode: 0o700 });
  await runGit(repositoryRoot, "init", "--initial-branch=main");
  await runGit(repositoryRoot, "config", "user.name", "Actestra Test");
  await runGit(repositoryRoot, "config", "user.email", "actestra-test@example.invalid");
  fs.writeFileSync(sourceFile, "before\n", "utf8");
  await runGit(repositoryRoot, "add", "answer.txt");
  await runGit(repositoryRoot, "commit", "-m", "fixture");

  const { client: persistence } = await openTestPersistenceUtility(productStateRoot);
  const clock = new DeterministicAgentClock(instant("2026-08-05T02:00:00.000Z"));
  const nativeTools = createScopedNativeToolPlatform({ persistence, clock });
  const transports: LoopbackGeneralWorkerTransport[] = [];
  let generalEventSequence = 0;
  const generalJourney = new AionUiGeneralWorkJourneyService({
    persistence,
    nativeTools,
    clock,
    nativeContext: {
      async resolve() {
        throw new Error("Team General work must use its main-owned trusted context");
      },
    },
    launchWorker: async ({ journeyKind, requestId }) => {
      expect(journeyKind).toBe("writing-artifact");
      const opened = await openTestGeneralWorker(clock, {
        executionMode: "writing-artifact-fixture",
        newAttemptToken: () => `attempt-team-mixed-${suffix}`,
        newToolRequestId: () => requestId,
        newEventId: () => eventId(`event-team-mixed-${suffix}-${String(++generalEventSequence)}`),
      });
      if (options.holdGeneralWorker === true) opened.transport.dropNextResponse();
      transports.push(opened.transport);
      return opened.adapter;
    },
  });
  const mainService = createIsolatedCodingMainService({ persistence, clock, managedRoot });
  const codingJourney = new AionUiCodingJourneyService({
    persistence,
    clock,
    nativeContext: {
      async resolve() {
        return Object.freeze({
          rootPath: repositoryRoot,
          displayName: `Mixed Team Goose ${suffix}`,
        });
      },
    },
    codingAgent: {
      async requireAdmittedArtifact() {
        return requireAdmittedArtifact();
      },
    },
    getMainService: () => mainService,
    privateRootParent,
    modelId: `actestra-team-mixed-${suffix}`,
    modelInvoker,
    commands: {
      "format-check": Object.freeze({ executablePath: "/usr/bin/true", args: Object.freeze([]) }),
    },
    tests: {
      "focused-test": Object.freeze({
        executablePath: "/bin/test",
        args: Object.freeze(["-f", "team-output.txt"]),
      }),
    },
  });
  const teamFixture = await createTeamRunFixture(suffix);
  await persistence.persistAdmittedTeamPlan(teamFixture.plan);
  const router = new TeamJourneyWorkerRouter({
    persistence,
    workspaceContext: {
      async resolve(workspaceIdValue) {
        expect(workspaceIdValue).toBe(teamFixture.team.workspaceId);
        return Object.freeze({
          rootPath: generalWorkspaceRoot,
          displayName: `Mixed Team General ${suffix}`,
        });
      },
    },
    general: generalJourney,
    coding: codingJourney,
  });
  const nextInstant = advancingClock();
  const orchestrator = new TeamOrchestratorService({
    persistence,
    worker: router,
    aggregator,
    now: nextInstant,
  });
  const accepted = await orchestrator.create({
    team: teamFixture.team,
    planId: teamFixture.plan.planId,
    occurredAt: nextInstant(),
  });
  const fixture = {
    root,
    repositoryRoot,
    sourceFile,
    generalWorkspaceRoot,
    managedRoot,
    privateRootParent,
    persistence,
    mainService,
    generalJourney,
    codingJourney,
    router,
    orchestrator,
    transports,
    accepted,
    nextInstant,
  } as const;
  fixtures.push(fixture);
  return fixture;
}

async function waitForNode(
  orchestrator: TeamOrchestratorService,
  runId: TeamRunId,
  candidateKey: string,
  predicate: (
    node: Awaited<ReturnType<TeamOrchestratorService["get"]>>["nodes"][number],
  ) => boolean,
  timeoutMs = 30_000,
) {
  const deadline = Date.now() + timeoutMs;
  let latestSnapshot: Awaited<ReturnType<TeamOrchestratorService["get"]>> | undefined;
  let latest: Awaited<ReturnType<TeamOrchestratorService["get"]>>["nodes"][number] | undefined;
  while (Date.now() < deadline) {
    latestSnapshot = await orchestrator.get(runId);
    latest = latestSnapshot.nodes.find((candidate) => candidate.candidateKey === candidateKey);
    if (latest !== undefined && predicate(latest)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `Timed out waiting for Team node ${candidateKey}: ${JSON.stringify({ latest, latestSnapshot })}`,
  );
}

async function waitForCodingApproval(
  fixture: MixedJourneyFixture,
  codingNodeId: TeamPlanNodeId,
  seenApprovalIds: ReadonlySet<string>,
) {
  return waitForNode(
    fixture.orchestrator,
    fixture.accepted.runId,
    "coding",
    (node) =>
      node.nodeId === codingNodeId &&
      node.status === "approval-blocked" &&
      node.protectedApproval !== null &&
      node.protectedApproval.decision === null &&
      !seenApprovalIds.has(node.protectedApproval.approvalId),
  );
}

async function codingProjection(
  fixture: MixedJourneyFixture,
  nativeConversationId: string,
): Promise<AionUiCodingJourneyProjection> {
  const [projection] = await fixture.codingJourney.list(nativeConversationId, 1);
  if (projection === undefined) throw new Error("Missing mixed Team coding projection");
  return projection;
}

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await fixture.orchestrator.close().catch((): undefined => undefined);
    await fixture.generalJourney.close().catch((): undefined => undefined);
    await fixture.codingJourney.close().catch((): undefined => undefined);
    await fixture.mainService.close().catch((): undefined => undefined);
    await fixture.persistence.close().catch((): undefined => undefined);
    if (!fixture.root.startsWith(path.join(fs.realpathSync(os.tmpdir()), "actestra-team-mixed-"))) {
      throw new Error(`Refusing to remove unexpected mixed Team fixture ${fixture.root}`);
    }
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

describe("P6 mixed Team journey runner selection", () => {
  it("keeps the real mixed Team journey in the admitted Goose runner selector", () => {
    const selector = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../scripts/test-goose-runner.mjs"),
      "utf8",
    );
    expect(selector).toContain('"tests/main/teamMixedJourney.test.ts"');
  });
});

describe.skipIf(
  artifactDirectory === undefined ||
    trustedManifestSha256 === undefined ||
    targetTriple === undefined,
)("P6 real General and Goose mixed Team journey", () => {
  it("runs both journeys in parallel through three durable approvals and aggregates references", async () => {
    const codingStarted = deferred();
    const allowCoding = deferred();
    const modelInvocations: GooseLoopbackModelInvocation[] = [];
    const aggregate = vi.fn(
      async (input: TeamPlannerAggregatePayload): Promise<TeamPlannerAggregateResult> => ({
        summary: "The mixed Team Artifact references are complete.",
        artifacts: input.artifacts,
      }),
    );
    const fixture = await openMixedFixture(
      "complete",
      async (invocation) => {
        modelInvocations.push(invocation);
        if (modelInvocations.length === 1) {
          codingStarted.resolve();
          await allowCoding.promise;
          return Object.freeze({
            type: "tool-call" as const,
            callId: "call-team-mixed-write",
            name: `actestra-capability-proxy__${CODING_FILE_WRITE_TOOL_ID}`,
            arguments: Object.freeze({
              contractVersion: 1,
              relativePath: "team-output.txt",
              content: "real mixed Team journey\n",
            }),
            usage: Object.freeze({ promptTokens: 31, completionTokens: 7 }),
          });
        }
        if (modelInvocations.length === 2) {
          return Object.freeze({
            type: "tool-call" as const,
            callId: "call-team-mixed-test",
            name: `actestra-capability-proxy__${CODING_TEST_TOOL_ID}`,
            arguments: Object.freeze({ contractVersion: 1, testId: "focused-test" }),
            usage: Object.freeze({ promptTokens: 47, completionTokens: 5 }),
          });
        }
        if (modelInvocations.length === 3) {
          return Object.freeze({
            type: "message" as const,
            text: "The real mixed Team change and focused test are ready.",
            usage: Object.freeze({ promptTokens: 59, completionTokens: 8 }),
          });
        }
        throw new Error("Mixed Team Goose exceeded its admitted three-round exchange");
      },
      { aggregate },
    );
    const baseCommit = await runGit(fixture.repositoryRoot, "rev-parse", "HEAD");
    const sourceStatus = await runGit(fixture.repositoryRoot, "status", "--porcelain=v1");
    const codingNode = fixture.accepted.nodes.find(({ candidateKey }) => candidateKey === "coding");
    if (codingNode?.kind !== "worker") throw new Error("Missing mixed Team coding node");
    const codingBinding = deriveTeamJourneyBinding({
      runId: fixture.accepted.runId,
      nodeId: codingNode.nodeId,
      attemptNumber: 1,
      capability: "coding",
    });

    const started = await fixture.orchestrator.start(fixture.accepted.runId, fixture.nextInstant());
    expect(started.nodes.filter(({ status }) => status === "running")).toHaveLength(2);
    await codingStarted.promise;
    await waitForNode(
      fixture.orchestrator,
      fixture.accepted.runId,
      "general",
      ({ status }) => status === "completed",
    );
    expect(
      (await fixture.orchestrator.get(fixture.accepted.runId)).nodes.find(
        ({ candidateKey }) => candidateKey === "coding",
      )?.status,
    ).toBe("running");
    allowCoding.resolve();

    const seenApprovalIds = new Set<string>();
    const expectedApprovals = [
      { stage: "approval-required", kind: "tool", operationKind: "edit" },
      { stage: "approval-required", kind: "tool", operationKind: "execute" },
      { stage: "publish-approval-required", kind: "publish", operationKind: undefined },
    ] as const;
    for (const expected of expectedApprovals) {
      const blocked = await waitForCodingApproval(fixture, codingNode.nodeId, seenApprovalIds);
      const approval = blocked.protectedApproval;
      if (approval === null) throw new Error("Missing mixed Team protected Approval reference");
      seenApprovalIds.add(approval.approvalId);
      const projection = await codingProjection(fixture, codingBinding.nativeConversationId);
      expect(projection.stage).toBe(expected.stage);
      expect(projection.approval?.kind).toBe(expected.kind);
      if (expected.operationKind !== undefined) {
        expect(projection.approval).toMatchObject({ operationKind: expected.operationKind });
      }
      await fixture.orchestrator.decideApproval({
        runId: fixture.accepted.runId,
        nodeId: codingNode.nodeId,
        approvalId: approval.approvalId,
        decision: "approved",
        occurredAt: fixture.nextInstant(),
      });
    }
    expect(seenApprovalIds).toHaveLength(3);

    const codingAfterApprovals = await fixture.orchestrator.get(fixture.accepted.runId);
    const codingAttempt = codingAfterApprovals.nodes
      .find(({ nodeId }) => nodeId === codingNode.nodeId)
      ?.attempts.at(-1);
    if (codingAttempt === undefined) throw new Error("Missing mixed Team coding attempt");
    await fixture.codingJourney.waitForIdle(codingAttempt.workerTaskId);
    const finalCodingProjection = await codingProjection(
      fixture,
      codingBinding.nativeConversationId,
    );
    expect(finalCodingProjection).toMatchObject({ status: "completed", stage: "published" });
    const graphAfterCoding = await fixture.persistence.loadDomainGraph();
    expect(
      graphAfterCoding.artifacts.filter(({ taskId }) => taskId === codingAttempt.workerTaskId),
    ).toEqual([expect.objectContaining({ kind: "file", state: "available" })]);

    const codingSettled = await waitForNode(
      fixture.orchestrator,
      fixture.accepted.runId,
      "coding",
      ({ status }) => status === "completed" || status === "failed",
    );
    if (codingSettled.status === "failed") {
      throw new Error(`Mixed Team coding node failed: ${JSON.stringify(codingSettled)}`);
    }
    expect(codingSettled).toMatchObject({ status: "completed" });

    const feedback = await waitForNode(
      fixture.orchestrator,
      fixture.accepted.runId,
      "feedback",
      ({ status, blockedReason }) =>
        status === "approval-blocked" && blockedReason === "human-feedback",
    );
    await fixture.orchestrator.resolveFeedback({
      runId: fixture.accepted.runId,
      nodeId: feedback.nodeId,
      decision: "approved",
      note: "The real mixed General and Goose result is accepted.",
      occurredAt: fixture.nextInstant(),
    });
    await fixture.orchestrator.waitForIdle(fixture.accepted.runId);

    const completed = await fixture.orchestrator.get(fixture.accepted.runId);
    expect(completed).toMatchObject({
      status: "completed",
      result: { summary: "The mixed Team Artifact references are complete." },
    });
    expect(aggregate).toHaveBeenCalledTimes(1);
    const aggregateInput = aggregate.mock.calls[0]![0];
    expect(Object.keys(aggregateInput)).toEqual([
      "correlationId",
      "planId",
      "runId",
      "revision",
      "artifacts",
    ]);
    expect(aggregateInput.artifacts).toHaveLength(2);
    expect(aggregateInput.artifacts.map(({ kind }) => kind).sort()).toEqual(["document", "file"]);
    const serializedAggregation = JSON.stringify(aggregateInput);
    expect(serializedAggregation).not.toContain(fixture.repositoryRoot);
    expect(serializedAggregation).not.toContain(fixture.generalWorkspaceRoot);
    expect(serializedAggregation).not.toContain("real mixed Team journey");
    expect(serializedAggregation).not.toContain("audit-");

    const graph = await fixture.persistence.loadDomainGraph();
    expect(graph.approvals.filter(({ state }) => state === "approved")).toHaveLength(3);
    expect(await runGit(fixture.repositoryRoot, "rev-parse", "HEAD")).toBe(baseCommit);
    expect(await runGit(fixture.repositoryRoot, "status", "--porcelain=v1")).toBe(sourceStatus);
    expect(fs.readFileSync(fixture.sourceFile, "utf8")).toBe("before\n");
    expect(
      (await runGit(fixture.repositoryRoot, "worktree", "list", "--porcelain")).match(
        /^worktree /gmu,
      ),
    ).toHaveLength(1);
    expect(fs.readdirSync(fixture.privateRootParent)).toEqual([]);
    expect(fs.existsSync(fixture.managedRoot) ? fs.readdirSync(fixture.managedRoot) : []).toEqual(
      [],
    );
    expect(fixture.transports).toHaveLength(1);
    expect(fixture.transports[0]!.killCount).toBeGreaterThan(0);
  }, 120_000);

  it("denies a real Goose protected write without executing it", async () => {
    const aggregate = vi.fn(
      async (input: TeamPlannerAggregatePayload): Promise<TeamPlannerAggregateResult> => ({
        summary: "A denied Team run must not aggregate.",
        artifacts: input.artifacts,
      }),
    );
    const fixture = await openMixedFixture(
      "denied",
      async () =>
        Object.freeze({
          type: "tool-call" as const,
          callId: "call-team-mixed-denied-write",
          name: `actestra-capability-proxy__${CODING_FILE_WRITE_TOOL_ID}`,
          arguments: Object.freeze({
            contractVersion: 1,
            relativePath: "denied-output.txt",
            content: "this protected write must not execute\n",
          }),
          usage: Object.freeze({ promptTokens: 29, completionTokens: 6 }),
        }),
      { aggregate },
    );
    const baseCommit = await runGit(fixture.repositoryRoot, "rev-parse", "HEAD");
    const sourceStatus = await runGit(fixture.repositoryRoot, "status", "--porcelain=v1");
    const codingNode = fixture.accepted.nodes.find(({ candidateKey }) => candidateKey === "coding");
    if (codingNode?.kind !== "worker") throw new Error("Missing denied Team coding node");
    const binding = deriveTeamJourneyBinding({
      runId: fixture.accepted.runId,
      nodeId: codingNode.nodeId,
      attemptNumber: 1,
      capability: "coding",
    });

    await fixture.orchestrator.start(fixture.accepted.runId, fixture.nextInstant());
    const blocked = await waitForCodingApproval(fixture, codingNode.nodeId, new Set());
    const approval = blocked.protectedApproval;
    if (approval === null) throw new Error("Missing denied Team protected Approval reference");
    await expect(codingProjection(fixture, binding.nativeConversationId)).resolves.toMatchObject({
      status: "blocked",
      stage: "approval-required",
      approval: { kind: "tool", operationKind: "edit" },
    });
    const denied = await fixture.orchestrator.decideApproval({
      runId: fixture.accepted.runId,
      nodeId: codingNode.nodeId,
      approvalId: approval.approvalId,
      decision: "denied",
      occurredAt: fixture.nextInstant(),
    });
    await fixture.orchestrator.waitForIdle(fixture.accepted.runId);

    expect(denied.nodes.find(({ nodeId }) => nodeId === codingNode.nodeId)).toMatchObject({
      status: "failed",
      blockedReason: "attempt-failed",
      protectedApproval: {
        approvalId: approval.approvalId,
        decision: "denied",
        decisionAuditRecordId: expect.stringMatching(/^audit-/u),
        outcomeAuditRecordId: expect.stringMatching(/^audit-/u),
      },
    });
    expect(aggregate).not.toHaveBeenCalled();
    expect(await runGit(fixture.repositoryRoot, "rev-parse", "HEAD")).toBe(baseCommit);
    expect(await runGit(fixture.repositoryRoot, "status", "--porcelain=v1")).toBe(sourceStatus);
    expect(fs.readFileSync(fixture.sourceFile, "utf8")).toBe("before\n");
    expect(fs.existsSync(path.join(fixture.repositoryRoot, "denied-output.txt"))).toBe(false);
    expect(
      (await runGit(fixture.repositoryRoot, "worktree", "list", "--porcelain")).match(
        /^worktree /gmu,
      ),
    ).toHaveLength(1);
    expect(fs.readdirSync(fixture.privateRootParent)).toEqual([]);
    expect(fs.existsSync(fixture.managedRoot) ? fs.readdirSync(fixture.managedRoot) : []).toEqual(
      [],
    );
    const graph = await fixture.persistence.loadDomainGraph();
    expect(graph.approvals).toEqual([expect.objectContaining({ state: "denied" })]);
  }, 120_000);

  it("cancels the whole mixed Team and leaves no Worker process or coding worktree", async () => {
    const codingStarted = deferred();
    let codingSignalAborted = false;
    const aggregate = vi.fn(
      async (input: TeamPlannerAggregatePayload): Promise<TeamPlannerAggregateResult> => ({
        summary: "A cancelled Team run must not aggregate.",
        artifacts: input.artifacts,
      }),
    );
    const fixture = await openMixedFixture(
      "cancel",
      async (_invocation, signal) => {
        codingStarted.resolve();
        return new Promise<never>((_resolve, reject) => {
          const onAbort = (): void => {
            codingSignalAborted = true;
            reject(new Error("Mixed Team Goose model invocation cancelled"));
          };
          if (signal.aborted) {
            onAbort();
            return;
          }
          signal.addEventListener("abort", onAbort, { once: true });
        });
      },
      { aggregate },
      { holdGeneralWorker: true },
    );
    const baseCommit = await runGit(fixture.repositoryRoot, "rev-parse", "HEAD");
    const sourceStatus = await runGit(fixture.repositoryRoot, "status", "--porcelain=v1");

    await fixture.orchestrator.start(fixture.accepted.runId, fixture.nextInstant());
    await codingStarted.promise;
    await vi.waitFor(() => expect(fixture.transports).toHaveLength(1));
    const active = await fixture.orchestrator.get(fixture.accepted.runId);
    expect(active.nodes.filter(({ status }) => status === "running")).toHaveLength(2);

    const cancelled = await fixture.orchestrator.cancelRun({
      runId: fixture.accepted.runId,
      reason: "Cancel the complete mixed Team fixture.",
      occurredAt: fixture.nextInstant(),
    });
    await fixture.orchestrator.waitForIdle(fixture.accepted.runId);

    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.nodes.every(({ status }) => status === "cancelled")).toBe(true);
    expect(codingSignalAborted).toBe(true);
    expect(aggregate).not.toHaveBeenCalled();
    expect(fixture.transports[0]!.killCount).toBeGreaterThan(0);
    expect(await runGit(fixture.repositoryRoot, "rev-parse", "HEAD")).toBe(baseCommit);
    expect(await runGit(fixture.repositoryRoot, "status", "--porcelain=v1")).toBe(sourceStatus);
    expect(fs.readFileSync(fixture.sourceFile, "utf8")).toBe("before\n");
    expect(
      (await runGit(fixture.repositoryRoot, "worktree", "list", "--porcelain")).match(
        /^worktree /gmu,
      ),
    ).toHaveLength(1);
    expect(fs.readdirSync(fixture.privateRootParent)).toEqual([]);
    expect(fs.existsSync(fixture.managedRoot) ? fs.readdirSync(fixture.managedRoot) : []).toEqual(
      [],
    );
  }, 120_000);
});

// @vitest-environment node

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import type { AionUiCodingJourneyProjection } from "../../apps/desktop/src/compatibility/aionui";
import {
  CODING_FILE_WRITE_TOOL_ID,
  CODING_TEST_TOOL_ID,
  instant,
} from "../../apps/desktop/src/core";
import { AionUiCodingJourneyService } from "../../apps/desktop/src/main/compatibility/aionuiCodingJourneyService";
import { DeterministicAgentClock } from "../../apps/desktop/src/main/workers/deterministicFakeAgentAdapter";
import { createIsolatedCodingMainService } from "../../apps/desktop/src/main/workers/isolatedCodingMainService";
import type { GooseLoopbackModelInvocation } from "../../apps/desktop/src/main/workers/gooseLoopbackModelServer";
import {
  admitGooseRunnerArtifact,
  type AdmittedGooseRunnerArtifact,
} from "../../apps/desktop/src/main/workers/gooseRunnerArtifact";
import type { ActestraPersistencePort } from "../../apps/desktop/src/core";
import type { IsolatedCodingMainService } from "../../apps/desktop/src/main/workers/isolatedCodingMainService";
import { openTestPersistenceUtility } from "../fixtures/persistenceUtility";

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

interface RealJourneyFixture {
  readonly root: string;
  readonly repositoryRoot: string;
  readonly sourceFile: string;
  readonly managedRoot: string;
  readonly privateRootParent: string;
  readonly persistence: ActestraPersistencePort;
  readonly mainService: IsolatedCodingMainService;
  readonly journey: AionUiCodingJourneyService;
}

const fixtures: RealJourneyFixture[] = [];
let admittedArtifact: Promise<AdmittedGooseRunnerArtifact> | undefined;

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

async function openFixture(
  suffix: string,
  modelInvoker: ConstructorParameters<typeof AionUiCodingJourneyService>[0]["modelInvoker"],
): Promise<RealJourneyFixture> {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "actestra-aionui-real-goose-journey-")),
  );
  const repositoryRoot = path.join(root, "source");
  const sourceFile = path.join(repositoryRoot, "answer.txt");
  const managedRoot = path.join(root, "product-state", "coding-worktrees");
  const privateRootParent = path.join(root, "product-state", "goose-private");
  fs.mkdirSync(repositoryRoot, { recursive: true });
  fs.mkdirSync(privateRootParent, { recursive: true, mode: 0o700 });
  await runGit(repositoryRoot, "init", "--initial-branch=main");
  await runGit(repositoryRoot, "config", "user.name", "Actestra Test");
  await runGit(repositoryRoot, "config", "user.email", "actestra-test@example.invalid");
  fs.writeFileSync(sourceFile, "before\n", "utf8");
  await runGit(repositoryRoot, "add", "answer.txt");
  await runGit(repositoryRoot, "commit", "-m", "fixture");

  const { client: persistence } = await openTestPersistenceUtility(
    path.join(root, "product-state"),
  );
  const clock = new DeterministicAgentClock(instant("2026-08-04T08:00:00.000Z"));
  const mainService = createIsolatedCodingMainService({ persistence, clock, managedRoot });
  const artifact = await requireAdmittedArtifact();
  const journey = new AionUiCodingJourneyService({
    persistence,
    clock,
    nativeContext: {
      async resolve() {
        return Object.freeze({ rootPath: repositoryRoot, displayName: `Real Goose ${suffix}` });
      },
    },
    codingAgent: {
      async requireAdmittedArtifact() {
        return artifact;
      },
    },
    getMainService: () => mainService,
    privateRootParent,
    modelId: `actestra-real-journey-${suffix}`,
    modelInvoker,
    commands: {
      "format-check": Object.freeze({ executablePath: "/usr/bin/true", args: Object.freeze([]) }),
    },
    tests: {
      "focused-test": Object.freeze({
        executablePath: "/bin/test",
        args: Object.freeze(["-f", "journey-output.txt"]),
      }),
    },
  });
  const fixture = {
    root,
    repositoryRoot,
    sourceFile,
    managedRoot,
    privateRootParent,
    persistence,
    mainService,
    journey,
  };
  fixtures.push(fixture);
  return fixture;
}

async function waitForProjection(
  journey: AionUiCodingJourneyService,
  nativeConversationId: string,
  predicate: (projection: AionUiCodingJourneyProjection) => boolean,
  timeoutMs = 30_000,
): Promise<AionUiCodingJourneyProjection> {
  const deadline = Date.now() + timeoutMs;
  let latest: AionUiCodingJourneyProjection | undefined;
  while (Date.now() < deadline) {
    [latest] = await journey.list(nativeConversationId, 1);
    if (latest !== undefined && predicate(latest)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for real Goose journey projection: ${JSON.stringify(latest)}`);
}

function deferred(): {
  readonly promise: Promise<void>;
  resolve(): void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await fixture.journey.close().catch((): undefined => undefined);
    await fixture.mainService.close().catch((): undefined => undefined);
    await fixture.persistence.close().catch((): undefined => undefined);
    if (
      !fixture.root.startsWith(
        path.join(fs.realpathSync(os.tmpdir()), "actestra-aionui-real-goose-journey-"),
      )
    ) {
      throw new Error(`Refusing to remove unexpected real-Goose fixture ${fixture.root}`);
    }
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

describe.skipIf(
  artifactDirectory === undefined ||
    trustedManifestSha256 === undefined ||
    targetTriple === undefined,
)("P5.3 retained AionUI real Goose coding journey", () => {
  it("approves a real file write and focused test before exact patch publication", async () => {
    const modelInvocations: GooseLoopbackModelInvocation[] = [];
    const fixture = await openFixture("publish", async (invocation) => {
      modelInvocations.push(invocation);
      if (modelInvocations.length === 1) {
        return Object.freeze({
          type: "tool-call" as const,
          callId: "call-real-journey-write",
          name: `actestra-capability-proxy__${CODING_FILE_WRITE_TOOL_ID}`,
          arguments: Object.freeze({
            contractVersion: 1,
            relativePath: "journey-output.txt",
            content: "real retained AionUI journey\n",
          }),
          usage: Object.freeze({ promptTokens: 31, completionTokens: 7 }),
        });
      }
      if (modelInvocations.length === 2) {
        return Object.freeze({
          type: "tool-call" as const,
          callId: "call-real-journey-test",
          name: `actestra-capability-proxy__${CODING_TEST_TOOL_ID}`,
          arguments: Object.freeze({ contractVersion: 1, testId: "focused-test" }),
          usage: Object.freeze({ promptTokens: 47, completionTokens: 5 }),
        });
      }
      if (modelInvocations.length === 3) {
        return Object.freeze({
          type: "message" as const,
          text: "The isolated change and focused test are ready for review.",
          usage: Object.freeze({ promptTokens: 59, completionTokens: 8 }),
        });
      }
      throw new Error("Real Goose exceeded the three-round retained-journey exchange");
    });
    const nativeConversationId = "native-real-goose-publish";
    const baseCommit = await runGit(fixture.repositoryRoot, "rev-parse", "HEAD");
    const sourceStatus = await runGit(fixture.repositoryRoot, "status", "--porcelain=v1");
    const submitted = await fixture.journey.submit({
      contractVersion: 1,
      nativeConversationId,
      submissionId: "submission-real-goose-publish",
      prompt: "Create journey-output.txt, run the registered focused test, and report the result.",
    });

    const writeApproval = await waitForProjection(
      fixture.journey,
      nativeConversationId,
      (projection) => projection.stage === "approval-required",
    );
    expect(writeApproval.approval).toMatchObject({
      kind: "tool",
      operationKind: "edit",
      title: "Edit isolated workspace file",
    });
    const writeApprovalId = writeApproval.approval!.approvalId;
    await fixture.journey.decideApproval(
      nativeConversationId,
      submitted.taskId,
      writeApprovalId,
      "approved",
    );

    const testApproval = await waitForProjection(
      fixture.journey,
      nativeConversationId,
      (projection) =>
        projection.stage === "approval-required" &&
        projection.approval?.approvalId !== writeApprovalId,
    );
    expect(testApproval.approval).toMatchObject({
      kind: "tool",
      operationKind: "execute",
      title: "Run admitted focused test",
    });
    await fixture.journey.decideApproval(
      nativeConversationId,
      submitted.taskId,
      testApproval.approval!.approvalId,
      "approved",
    );

    const publishApproval = await waitForProjection(
      fixture.journey,
      nativeConversationId,
      (projection) => projection.stage === "publish-approval-required",
    );
    expect(publishApproval).toMatchObject({
      status: "blocked",
      approval: {
        kind: "publish",
        title: "Save Actestra coding patch",
        snapshot: {
          baseCommit,
          patchByteLength: expect.any(Number),
          patchSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        },
      },
      messages: [
        expect.objectContaining({
          text: "The isolated change and focused test are ready for review.",
        }),
      ],
      tools: expect.arrayContaining([
        expect.objectContaining({ kind: "edit", surface: "diff", status: "completed" }),
        expect.objectContaining({ kind: "execute", surface: "test", status: "completed" }),
      ]),
    });
    expect(publishApproval.approval?.kind).toBe("publish");
    if (publishApproval.approval?.kind !== "publish") {
      throw new Error("Expected an exact retained-journey publish approval");
    }
    expect(publishApproval.approval.snapshot.patchByteLength).toBeGreaterThan(0);
    expect(modelInvocations[1]!.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          toolCalls: expect.arrayContaining([
            expect.objectContaining({ callId: "call-real-journey-write" }),
          ]),
        }),
        expect.objectContaining({
          role: "tool",
          callId: "call-real-journey-write",
          content: expect.stringContaining("file-written"),
        }),
      ]),
    );
    expect(modelInvocations[2]!.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          toolCalls: expect.arrayContaining([
            expect.objectContaining({ callId: "call-real-journey-test" }),
          ]),
        }),
        expect.objectContaining({
          role: "tool",
          callId: "call-real-journey-test",
          content: expect.stringContaining("focused-test"),
        }),
      ]),
    );
    await fixture.journey.decidePublish(
      nativeConversationId,
      submitted.taskId,
      publishApproval.approval.approvalId,
      "approved",
    );
    await fixture.journey.waitForIdle(submitted.taskId);

    const [published] = await fixture.journey.list(nativeConversationId, 1);
    expect(published).toMatchObject({
      taskId: submitted.taskId,
      status: "completed",
      stage: "published",
      canCancel: false,
      artifacts: [
        {
          artifactId: expect.stringMatching(/^artifact-coding-[a-f0-9]{64}$/u),
          label: "Actestra coding patch",
          state: "available",
        },
      ],
    });
    expect(await runGit(fixture.repositoryRoot, "rev-parse", "HEAD")).toBe(baseCommit);
    expect(await runGit(fixture.repositoryRoot, "status", "--porcelain=v1")).toBe(sourceStatus);
    expect(fs.readFileSync(fixture.sourceFile, "utf8")).toBe("before\n");
    expect(
      (await runGit(fixture.repositoryRoot, "worktree", "list", "--porcelain")).match(
        /^worktree /gmu,
      ),
    ).toHaveLength(1);
    expect(fs.readdirSync(fixture.privateRootParent)).toEqual([]);
  }, 90_000);

  it("cancels a real in-flight Goose prompt and removes all isolated authority", async () => {
    const modelStarted = deferred();
    let modelSignalAborted = false;
    const fixture = await openFixture("cancel", async (_invocation, signal) => {
      modelStarted.resolve();
      return new Promise<never>((_resolve, reject) => {
        const onAbort = (): void => {
          modelSignalAborted = true;
          reject(new Error("Real Goose journey model invocation cancelled"));
        };
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      });
    });
    const nativeConversationId = "native-real-goose-cancel";
    const baseCommit = await runGit(fixture.repositoryRoot, "rev-parse", "HEAD");
    const submitted = await fixture.journey.submit({
      contractVersion: 1,
      nativeConversationId,
      submissionId: "submission-real-goose-cancel",
      prompt: "Wait for the retained AionUI user to cancel this real Goose prompt.",
    });
    await Promise.race([
      modelStarted.promise,
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error("Real Goose model invocation did not start")), 30_000),
      ),
    ]);

    await expect(
      fixture.journey.cancel(nativeConversationId, submitted.taskId, "Stopped from ACP SendBox."),
    ).resolves.toMatchObject({
      taskId: submitted.taskId,
      status: "cancelled",
      stage: "cancelled",
      canCancel: false,
    });
    expect(modelSignalAborted).toBe(true);
    const graph = await fixture.persistence.loadDomainGraph();
    await expect(
      fixture.persistence.getActiveWorkspaceGrant(graph.workspaces[0]!.id),
    ).resolves.toBeNull();
    expect(await runGit(fixture.repositoryRoot, "rev-parse", "HEAD")).toBe(baseCommit);
    expect(await runGit(fixture.repositoryRoot, "status", "--porcelain=v1")).toBe("");
    expect(fs.readFileSync(fixture.sourceFile, "utf8")).toBe("before\n");
    expect(
      (await runGit(fixture.repositoryRoot, "worktree", "list", "--porcelain")).match(
        /^worktree /gmu,
      ),
    ).toHaveLength(1);
    expect(fs.readdirSync(fixture.privateRootParent)).toEqual([]);
  }, 90_000);
});

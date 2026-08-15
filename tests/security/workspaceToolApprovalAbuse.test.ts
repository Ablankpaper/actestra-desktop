// @vitest-environment node

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ARTIFACT_DELIVERY_CONTRACT_VERSION,
  PRIVILEGED_CONTRACT_VERSION,
  ARTIFACT_APPLY_TOOL_ID,
  ProtectedToolExecutionError,
  TASK_OUTPUT_WRITE_TEXT_TOOL_ID,
  WORKSPACE_READ_TEXT_TOOL_ID,
  approvalActorId,
  approvalId,
  artifactId,
  auditRecordId,
  authorizationGrantId,
  credentialLeaseId,
  instant,
  policyDecisionId,
  policyRevision,
  policyRuleId,
  parseScopedNativeToolInput,
  sessionId,
  taskId,
  toolId,
  toolInputReference,
  toolOutputReference,
  toolRequestId,
  workerId,
  workspaceGrantId,
  workspaceId,
  type ApprovalRequestSnapshot,
  type ArtifactDeliveryRecord,
  type AuditTrail,
  type Instant,
  type PolicyRule,
  type PrivilegedClock,
  type ProtectedOperation,
  type ProtectedToolExecutor,
  type ToolGateway,
  type ToolExecutionRequest,
  type ToolExecutionResult,
  type WorkspaceGrant,
} from "../../apps/desktop/src/core";
import {
  ArtifactWorkspaceApplicatorError,
  applyArtifactToWorkspace,
} from "../../apps/desktop/src/main/workers/artifactWorkspaceApplicator";
import {
  REPOSITORY_LOCK_FILENAME,
  WorkspaceRepositoryLockError,
  acquireWorkspaceRepositoryLock,
} from "../../apps/desktop/src/main/workers/workspaceRepositoryLock";
import { PrivilegedToolGateway } from "../../apps/desktop/src/main/privileged/toolGateway";
import { DeterministicPolicyEngine } from "../../apps/desktop/src/main/privileged/deterministicPolicyEngine";
import { InMemoryApprovalService } from "../../apps/desktop/src/main/privileged/inMemoryApprovalService";
import { InMemoryAuditTrail } from "../../apps/desktop/src/main/privileged/inMemoryAuditTrail";
import { ReferenceCredentialBroker } from "../../apps/desktop/src/main/privileged/referenceCredentialBroker";
import {
  createAuthorizationGrant,
  createPolicyDecision,
  createPolicyRule,
  createPolicySnapshot,
  createProtectedOperation,
  createToolManifest,
} from "../fixtures/privilegedServices";

const execFileAsync = promisify(execFile);
const roots: string[] = [];
const PATCH = `diff --git a/tracked.txt b/tracked.txt
index 7bfc4eb..a1b2c3d 100644
--- a/tracked.txt
+++ b/tracked.txt
@@ -1 +1 @@
-original
+applied by p7
`;
const now = instant("2026-08-13T00:00:00.000Z");
const clock: PrivilegedClock = { now: () => now };

function approvalSnapshot(
  id: ReturnType<typeof approvalId>,
  operation: ProtectedOperation,
  state: ApprovalRequestSnapshot["state"] = "approved",
): ApprovalRequestSnapshot {
  return {
    approvalId: id,
    operation,
    policyRevision: policyRevision("policy-p7-abuse"),
    state,
    requestedAt: operation.requestedAt,
    expiresAt: instant("2026-08-13T00:05:00.000Z"),
  } as ApprovalRequestSnapshot;
}

class MutableGatewayClock implements PrivilegedClock {
  constructor(private current: Instant = instant("2026-07-28T08:00:00.000Z")) {}

  now(): Instant {
    return this.current;
  }

  advance(milliseconds: number): void {
    this.current = instant(new Date(Date.parse(this.current) + milliseconds).toISOString());
  }
}

class GatewayTestExecutor implements ProtectedToolExecutor {
  readonly executions: ToolExecutionRequest[] = [];
  manifestCalls = 0;
  manifestFailure: Error | undefined;
  failure: Error | undefined;

  constructor(readonly manifestValue = createToolManifest()) {}

  async manifest(requestedTool: ReturnType<typeof toolId>) {
    this.manifestCalls += 1;
    if (this.manifestFailure !== undefined) {
      throw this.manifestFailure;
    }
    if (requestedTool !== this.manifestValue.toolId) {
      throw new Error("Tool is not registered");
    }
    return this.manifestValue;
  }

  async execute(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    this.executions.push(request);
    if (this.failure !== undefined) {
      throw this.failure;
    }
    return {
      status: "succeeded",
      outputRef: toolOutputReference("output-p7-gateway"),
    };
  }
}

function createGatewayHarness(
  options: {
    readonly rules?: readonly PolicyRule[];
    readonly executor?: GatewayTestExecutor;
    readonly auditTrail?: AuditTrail;
  } = {},
) {
  const gatewayClock = new MutableGatewayClock();
  let decisionSequence = 0;
  let approvalSequence = 0;
  let grantSequence = 0;
  let leaseSequence = 0;
  let auditSequence = 0;
  const auditTrail =
    options.auditTrail ??
    new InMemoryAuditTrail(gatewayClock, () =>
      auditRecordId(`audit-p7-gateway-${String(++auditSequence)}`),
    );
  const policyEngine = new DeterministicPolicyEngine(
    createPolicySnapshot(options.rules),
    gatewayClock,
    () => policyDecisionId(`decision-p7-gateway-${String(++decisionSequence)}`),
  );
  const approvalService = new InMemoryApprovalService({
    clock: gatewayClock,
    auditTrail,
    ttlMs: 1_000,
    newApprovalId: () => approvalId(`approval-p7-gateway-${String(++approvalSequence)}`),
    newGrantId: () => authorizationGrantId(`authorization-p7-gateway-${String(++grantSequence)}`),
  });
  const credentialBroker = new ReferenceCredentialBroker({
    clock: gatewayClock,
    auditTrail,
    leaseTtlMs: 500,
    historyRetentionMs: 5_000,
    newLeaseId: () => credentialLeaseId(`lease-p7-gateway-${String(++leaseSequence)}`),
  });
  const executor = options.executor ?? new GatewayTestExecutor();
  const gateway = new PrivilegedToolGateway({
    policyEngine,
    approvalService,
    credentialBroker,
    auditTrail,
    executor,
  });
  return {
    approvalService,
    auditTrail,
    clock: gatewayClock,
    credentialBroker,
    executor,
    gateway,
  };
}

const APPROVAL_PURPOSES = {
  protected: {
    requestId: toolRequestId("request-p7-protected"),
    toolId: toolId("actestra.workspace.modify"),
    inputRef: toolInputReference("input-p7-protected"),
    action: "workspace.modify",
    resourceKind: "workspace",
  },
  "workflow-feedback": {
    requestId: toolRequestId("request-p7-workflow-feedback"),
    toolId: toolId("actestra.team.workflow-feedback"),
    inputRef: toolInputReference("input-p7-workflow-feedback"),
    action: "message.send",
    resourceKind: "external-service",
  },
  publish: {
    requestId: toolRequestId("request-p7-publish"),
    toolId: toolId("actestra.coding.publish"),
    inputRef: toolInputReference("input-p7-publish"),
    action: "publish.execute",
    resourceKind: "repository",
  },
  "workspace-apply": {
    requestId: toolRequestId("request-p7-workspace-apply"),
    toolId: ARTIFACT_APPLY_TOOL_ID,
    inputRef: toolInputReference("input-p7-workspace-apply"),
    action: "artifact.apply",
    resourceKind: "repository",
  },
} as const;

type ApprovalPurpose = keyof typeof APPROVAL_PURPOSES;

function purposeOperation(purpose: ApprovalPurpose): ProtectedOperation {
  const definition = APPROVAL_PURPOSES[purpose];
  return createProtectedOperation({
    ...definition,
    summary: `P7 ${purpose} approval`,
  });
}

let approvalDecisionSequence = 0;
function approvalDecisionFor(operation: ProtectedOperation) {
  return createPolicyDecision({
    decisionId: policyDecisionId(`decision-p7-approval-${String(++approvalDecisionSequence)}`),
    requestId: operation.requestId,
    effect: "require-approval",
    reasonCode: "matching-rule-approval",
    matchedRuleIds: [policyRuleId("rule-p7-approval")],
    evaluatedAt: instant("2026-07-28T08:00:00.000Z"),
  });
}

async function requestGatewayApproval(
  harness: ReturnType<typeof createGatewayHarness>,
  operation: ProtectedOperation,
) {
  const result = await harness.gateway.invoke(operation);
  if (result.status !== "approval-required") {
    throw new Error("Expected approval-required");
  }
  return result.approval;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function git(root: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync("/usr/bin/git", ["-C", root, ...args], {
    encoding: "utf8",
    env: { GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", HOME: tmpdir(), LC_ALL: "C" },
  });
  return result.stdout.trim();
}

async function repository(): Promise<{ root: string; head: string }> {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "actestra-p7-workspace-")));
  roots.push(root);
  await git(root, "init", "--initial-branch=main");
  await git(root, "config", "user.name", "P7");
  await git(root, "config", "user.email", "p7@example.invalid");
  await writeFile(path.join(root, "tracked.txt"), "original\n", "utf8");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "base");
  return { root, head: await git(root, "rev-parse", "HEAD") };
}

function grant(root: string, overrides: Partial<WorkspaceGrant> = {}): WorkspaceGrant {
  return {
    contractVersion: 1,
    grantId: workspaceGrantId("grant-p7-destination"),
    workspaceId: workspaceId("workspace-p7-abuse"),
    rootPath: root,
    displayName: "P7 fixture",
    state: "active",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as WorkspaceGrant;
}

function delivery(
  root: string,
  head: string,
  overrides: Partial<ArtifactDeliveryRecord> = {},
): ArtifactDeliveryRecord {
  const patchSha256 = createHash("sha256").update(PATCH, "utf8").digest("hex");
  return {
    contractVersion: ARTIFACT_DELIVERY_CONTRACT_VERSION,
    artifactId: artifactId("artifact-p7-abuse"),
    workspaceId: workspaceId("workspace-p7-abuse"),
    destinationWorkspaceId: null,
    taskId: taskId("task-p7-abuse"),
    sessionId: sessionId("session-p7-abuse"),
    state: "pending",
    patchOwnerGrantId: workspaceGrantId("grant-p7-isolated"),
    patchOwnerWorkerId: workerId("worker-p7-abuse"),
    patchRequestId: toolRequestId("request-p7-patch"),
    destinationGrantId: null,
    patchReference: toolInputReference("input-p7-patch"),
    patchSha256,
    patchByteLength: Buffer.byteLength(PATCH, "utf8"),
    baseCommit: head,
    changedFileCount: 1,
    approvalId: null,
    verifiedHead: null,
    failureCode: null,
    failureMessage: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function persistence(record: ArtifactDeliveryRecord, patch = PATCH) {
  let current = record;
  const persisted: ArtifactDeliveryRecord[] = [];
  return {
    persisted,
    current: () => current,
    persistence: {
      loadDomainGraph: async () => ({
        artifacts: [
          { id: record.artifactId, workspaceId: record.workspaceId, taskId: record.taskId },
        ],
      }),
      getArtifactDelivery: async () => current,
      persistArtifactDelivery: async (next: ArtifactDeliveryRecord) => {
        current = next;
        persisted.push(next);
      },
      resolveContentReference: async () => ({
        metadata: {
          contractVersion: 1,
          reference: record.patchReference,
          kind: "tool-input",
          owner: {
            workspaceId: record.workspaceId,
            taskId: record.taskId,
            sessionId: record.sessionId,
            workerId: workerId(record.patchOwnerWorkerId ?? "worker-p7-abuse"),
            requestId: toolRequestId(record.patchRequestId ?? "request-p7-patch"),
            grantId: workspaceGrantId(record.patchOwnerGrantId),
          },
          classification: "task-content",
          mediaType: "text/plain; charset=utf-8",
          byteLength: Buffer.byteLength(patch, "utf8"),
          sha256: createHash("sha256").update(patch, "utf8").digest("hex"),
          createdAt: now,
        },
        content: patch,
      }),
    },
  };
}

interface ApplyTestOptions {
  readonly patch?: string;
  readonly bench?: ReturnType<typeof persistence>;
  readonly toolGateway?: ToolGateway;
  readonly onOperation?: (operation: ProtectedOperation) => void;
  readonly awaitApprovalDecision?: (
    approval: ReturnType<typeof approvalId>,
    signal: AbortSignal,
  ) => Promise<ApprovalRequestSnapshot>;
}

function expectNativePathRejected(
  tool: typeof WORKSPACE_READ_TEXT_TOOL_ID | typeof TASK_OUTPUT_WRITE_TEXT_TOOL_ID,
  relativePath: string,
): void {
  const serialized =
    tool === WORKSPACE_READ_TEXT_TOOL_ID
      ? JSON.stringify({ contractVersion: 1, relativePath })
      : JSON.stringify({
          contractVersion: 1,
          relativePath,
          mediaType: "text/plain; charset=utf-8",
          content: "must not escape",
        });
  let rejection: unknown;
  try {
    parseScopedNativeToolInput(tool, serialized);
  } catch (error) {
    rejection = error;
  }
  expect(rejection).toMatchObject({ code: "invalid-relative-path" });
}

async function apply(
  root: string,
  record: ArtifactDeliveryRecord,
  destination = grant(root),
  options: ApplyTestOptions = {},
) {
  const bench = options.bench ?? persistence(record, options.patch);
  let requestedOperation: ProtectedOperation | undefined;
  const defaultGateway: ToolGateway = {
    invoke: async (operation) => {
      requestedOperation = operation;
      options.onOperation?.(operation);
      return {
        status: "approval-required" as const,
        decision: {
          contractVersion: PRIVILEGED_CONTRACT_VERSION,
          decisionId: policyDecisionId("decision-p7-abuse"),
          policyRevision: policyRevision("policy-p7-abuse"),
          requestId: operation.requestId,
          effect: "require-approval" as const,
          reasonCode: "matching-rule-approval" as const,
          matchedRuleIds: [policyRuleId("rule-p7-abuse")],
          evaluatedAt: now,
        },
        approval: {
          approvalId: approvalId("approval-p7-abuse"),
          operation,
          policyRevision: policyRevision("policy-p7-abuse"),
          state: "pending",
          requestedAt: now,
          expiresAt: instant("2026-08-13T00:05:00.000Z"),
        } as ApprovalRequestSnapshot,
      };
    },
  };
  const gateway = options.toolGateway ?? defaultGateway;
  const result = await applyArtifactToWorkspace({
    artifactId: record.artifactId,
    workspaceRoot: root,
    grant: destination,
    persistence: bench.persistence as never,
    clock,
    toolGateway: gateway,
    awaitApprovalDecision:
      options.awaitApprovalDecision ??
      (async (approval) => {
        if (requestedOperation === undefined) {
          throw new Error("approval operation was not captured");
        }
        return approvalSnapshot(approval, requestedOperation);
      }),
    signal: new AbortController().signal,
  }).then(
    (value) => ({ value, error: undefined, bench }),
    (error: unknown) => ({ value: undefined, error, bench }),
  );
  return result;
}

describe("P7 workspace, delivery, tool, and approval abuse baseline", () => {
  it("normal apply control reaches the protected write", async () => {
    const repo = await repository();
    const result = await apply(repo.root, delivery(repo.root, repo.head));
    expect(result.error).toBeUndefined();
    expect(await readFile(path.join(repo.root, "tracked.txt"), "utf8")).toBe("applied by p7\n");
  });

  it("P7-A-WORKSPACE-002 P7-V-WORKSPACE-002-REPLACED-GIT-POINTER", async () => {
    const repo = await repository();
    const relocatedGitDirectory = `${repo.root}.git-relocated`;
    roots.push(relocatedGitDirectory);
    await rename(path.join(repo.root, ".git"), relocatedGitDirectory);
    await writeFile(path.join(repo.root, ".git"), `gitdir: ${relocatedGitDirectory}\n`, "utf8");

    const result = await apply(repo.root, delivery(repo.root, repo.head));

    expect(result.error).toMatchObject({ code: "workspace-grant-invalid" });
    expect(await readFile(path.join(repo.root, "tracked.txt"), "utf8")).toBe("original\n");
    expect(result.bench.persisted).toHaveLength(0);
  });

  for (const unsafeConfiguration of [
    {
      title: "P7-A-WORKSPACE-003 P7-V-WORKSPACE-003-HOOKS",
      configure: async (root: string) => {
        await git(root, "config", "core.hooksPath", path.join(tmpdir(), "actestra-p7-hooks"));
      },
    },
    {
      title: "P7-A-WORKSPACE-003 P7-V-WORKSPACE-003-FILTERS",
      configure: async (root: string) => {
        await git(root, "config", "filter.p7.clean", "/bin/cat");
      },
    },
    {
      title: "P7-A-WORKSPACE-003 P7-V-WORKSPACE-003-INCLUDES",
      configure: async (root: string) => {
        const included = await mkdtemp(path.join(tmpdir(), "actestra-p7-include-"));
        roots.push(included);
        const includePath = path.join(included, "config");
        await writeFile(includePath, "[core]\n\tfsmonitor = false\n", "utf8");
        await git(root, "config", "include.path", includePath);
      },
    },
  ] as const) {
    it(unsafeConfiguration.title, async () => {
      const repo = await repository();
      await unsafeConfiguration.configure(repo.root);

      const result = await apply(repo.root, delivery(repo.root, repo.head));

      expect(result.error).toMatchObject({ code: "workspace-grant-invalid" });
      expect(await readFile(path.join(repo.root, "tracked.txt"), "utf8")).toBe("original\n");
      expect(result.bench.persisted).toHaveLength(0);
    });
  }

  it("P7-A-WORKSPACE-003 P7-V-WORKSPACE-003-FSMONITOR", async () => {
    const repo = await repository();
    let operation: ProtectedOperation | undefined;
    const result = await apply(repo.root, delivery(repo.root, repo.head), grant(repo.root), {
      onOperation: (value) => {
        operation = value;
      },
      awaitApprovalDecision: async (id) => {
        await git(repo.root, "config", "core.fsmonitor", "/bin/false");
        return approvalSnapshot(id, operation!);
      },
    });

    expect(result.error).toMatchObject({ code: "workspace-grant-invalid" });
    expect(await readFile(path.join(repo.root, "tracked.txt"), "utf8")).toBe("original\n");
    expect(result.bench.current()).toMatchObject({
      state: "failed",
      failureCode: "workspace-grant-invalid",
    });
  });

  for (const attack of [
    {
      title: "P7-A-WORKSPACE-001 P7-V-WORKSPACE-001-TRAVERSAL",
      tool: WORKSPACE_READ_TEXT_TOOL_ID,
      relativePath: "notes/../../outside.txt",
    },
    {
      title: "P7-A-WORKSPACE-001 P7-V-WORKSPACE-001-ABSOLUTE-PATH",
      tool: WORKSPACE_READ_TEXT_TOOL_ID,
      relativePath: "/tmp/outside.txt",
    },
    {
      title: "P7-A-WORKSPACE-001 P7-V-WORKSPACE-001-EMBEDDED-NUL",
      tool: WORKSPACE_READ_TEXT_TOOL_ID,
      relativePath: "notes/safe\0outside.txt",
    },
    {
      title: "P7-A-WORKSPACE-001 P7-V-WORKSPACE-001-WORKSPACE-EXTERNAL-READ",
      tool: WORKSPACE_READ_TEXT_TOOL_ID,
      relativePath: "../outside-read.txt",
    },
    {
      title: "P7-A-WORKSPACE-001 P7-V-WORKSPACE-001-WORKSPACE-EXTERNAL-WRITE",
      tool: TASK_OUTPUT_WRITE_TEXT_TOOL_ID,
      relativePath: "../../outside-write.txt",
    },
  ] as const) {
    it(attack.title, () => {
      expectNativePathRejected(attack.tool, attack.relativePath);
    });
  }

  it("P7-A-WORKSPACE-001 P7-V-WORKSPACE-001-SYMLINK-ESCAPE", async () => {
    const repo = await repository();
    const alias = `${repo.root}-symlink`;
    roots.push(alias);
    await symlink(repo.root, alias, "dir");

    const result = await apply(alias, delivery(repo.root, repo.head), grant(alias));

    expect(result.error).toMatchObject({ code: "workspace-grant-invalid" });
    expect(await readFile(path.join(repo.root, "tracked.txt"), "utf8")).toBe("original\n");
    expect(result.bench.persisted).toHaveLength(0);
  });

  it("P7-A-WORKSPACE-002 P7-V-WORKSPACE-002-WRONG-CANONICAL-ROOT", async () => {
    const repo = await repository();
    const nested = path.join(repo.root, "nested");
    await mkdir(nested);
    const noncanonical = `${nested}${path.sep}..`;

    const result = await apply(noncanonical, delivery(repo.root, repo.head), grant(noncanonical));

    expect(result.error).toMatchObject({ code: "workspace-grant-invalid" });
    expect(await readFile(path.join(repo.root, "tracked.txt"), "utf8")).toBe("original\n");
    expect(result.bench.persisted).toHaveLength(0);
  });

  it("P7-A-WORKSPACE-002 P7-V-WORKSPACE-002-SUBDIRECTORY", async () => {
    const repo = await repository();
    const nested = path.join(repo.root, "nested");
    await mkdir(nested);

    const result = await apply(nested, delivery(repo.root, repo.head), grant(nested));

    expect(result.error).toMatchObject({ code: "workspace-grant-invalid" });
    expect(await readFile(path.join(repo.root, "tracked.txt"), "utf8")).toBe("original\n");
    expect(result.bench.persisted).toHaveLength(0);
  });

  it("P7-A-WORKSPACE-002 P7-V-WORKSPACE-002-LINKED-WORKTREE", async () => {
    const repo = await repository();
    const linked = `${repo.root}-linked`;
    roots.push(linked);
    await git(repo.root, "worktree", "add", linked, "-b", "linked");

    const result = await apply(linked, delivery(repo.root, repo.head), grant(linked));

    expect(result.error).toMatchObject({ code: "workspace-grant-invalid" });
    expect(await readFile(path.join(linked, "tracked.txt"), "utf8")).toBe("original\n");
    expect(result.bench.persisted).toHaveLength(0);
  });

  it("P7-A-WORKSPACE-002 P7-V-WORKSPACE-002-REVOKED-GRANT", async () => {
    const repo = await repository();
    const result = await apply(
      repo.root,
      delivery(repo.root, repo.head),
      grant(repo.root, { state: "revoked" }),
    );

    expect(result.error).toMatchObject({ code: "workspace-grant-invalid" });
    expect(await readFile(path.join(repo.root, "tracked.txt"), "utf8")).toBe("original\n");
    expect(result.bench.persisted).toHaveLength(0);
  });

  it("P7-A-WORKSPACE-003 P7-V-WORKSPACE-003-DIRTY-TREE", async () => {
    const repo = await repository();
    await writeFile(path.join(repo.root, "tracked.txt"), "user work\n", "utf8");

    const result = await apply(repo.root, delivery(repo.root, repo.head));

    expect(result.error).toMatchObject({ code: "workspace-dirty" });
    expect(await readFile(path.join(repo.root, "tracked.txt"), "utf8")).toBe("user work\n");
    expect(result.bench.persisted).toHaveLength(0);
  });

  it("P7-A-WORKSPACE-003 P7-V-WORKSPACE-003-HEAD-DRIFT", async () => {
    const repo = await repository();
    const result = await apply(repo.root, delivery(repo.root, "1".repeat(40)));

    expect(result.error).toMatchObject({ code: "head-drift" });
    expect(await readFile(path.join(repo.root, "tracked.txt"), "utf8")).toBe("original\n");
    expect(result.bench.persisted).toHaveLength(0);
  });

  it("P7-A-DELIVERY-001 P7-V-DELIVERY-001-SOURCE-WRITE-BEFORE-APPLY-APPROVAL", async () => {
    const repo = await repository();
    const bench = persistence(delivery(repo.root, repo.head));
    let operation: ProtectedOperation | undefined;
    let pendingApproval: ReturnType<typeof approvalId> | undefined;
    let settle: ((decision: ApprovalRequestSnapshot) => void) | undefined;
    const completion = apply(repo.root, bench.current(), grant(repo.root), {
      bench,
      onOperation: (value) => {
        operation = value;
      },
      awaitApprovalDecision: async (id) => {
        pendingApproval = id;
        return new Promise<ApprovalRequestSnapshot>((resolve) => {
          settle = resolve;
        });
      },
    });

    await vi.waitFor(() => {
      expect(operation).toBeDefined();
      expect(pendingApproval).toBeDefined();
      expect(settle).toBeDefined();
    });
    expect(await readFile(path.join(repo.root, "tracked.txt"), "utf8")).toBe("original\n");
    expect(bench.current()).toMatchObject({ state: "applying", approvalId: pendingApproval });

    settle?.(approvalSnapshot(pendingApproval!, operation!));
    const result = await completion;
    expect(result.error).toBeUndefined();
    expect(await readFile(path.join(repo.root, "tracked.txt"), "utf8")).toBe("applied by p7\n");
  });

  it("P7-A-DELIVERY-001 P7-V-DELIVERY-001-CONFLICTING-PATCH", async () => {
    const repo = await repository();
    const conflicting = PATCH.replace("-original", "-not-on-disk");
    const result = await apply(
      repo.root,
      delivery(repo.root, repo.head, {
        patchSha256: createHash("sha256").update(conflicting, "utf8").digest("hex"),
        patchByteLength: Buffer.byteLength(conflicting, "utf8"),
      }),
      grant(repo.root),
      { patch: conflicting },
    );

    expect(result.error).toMatchObject({ code: "patch-conflict" });
    expect(await readFile(path.join(repo.root, "tracked.txt"), "utf8")).toBe("original\n");
    expect(result.bench.persisted).toHaveLength(0);
  });

  it("P7-A-DELIVERY-001 P7-V-DELIVERY-001-DIGEST-DRIFT", async () => {
    const repo = await repository();
    const result = await apply(
      repo.root,
      delivery(repo.root, repo.head, { patchSha256: "f".repeat(64) }),
    );

    expect(result.error).toMatchObject({ code: "patch-digest-mismatch" });
    expect(await readFile(path.join(repo.root, "tracked.txt"), "utf8")).toBe("original\n");
    expect(result.bench.persisted).toHaveLength(0);
  });

  it("P7-A-DELIVERY-001 P7-V-DELIVERY-001-MULTI-FILE-ATOMIC-DENIAL", async () => {
    const repo = await repository();
    const partial = `${PATCH}diff --git a/missing.txt b/missing.txt
index 9c2a7f1..b3c4d5e 100644
--- a/missing.txt
+++ b/missing.txt
@@ -1 +1 @@
-not present
+must not be partially applied
`;
    const result = await apply(
      repo.root,
      delivery(repo.root, repo.head, {
        patchSha256: createHash("sha256").update(partial, "utf8").digest("hex"),
        patchByteLength: Buffer.byteLength(partial, "utf8"),
        changedFileCount: 2,
      }),
      grant(repo.root),
      { patch: partial },
    );

    expect(result.error).toMatchObject({ code: "patch-conflict" });
    expect(await readFile(path.join(repo.root, "tracked.txt"), "utf8")).toBe("original\n");
    expect(await git(repo.root, "status", "--porcelain")).toBe("");
    expect(result.bench.persisted).toHaveLength(0);
  });

  it("P7-A-DELIVERY-002 P7-V-DELIVERY-002-CONCURRENT-APPLY", async () => {
    const repo = await repository();
    const bench = persistence(delivery(repo.root, repo.head));
    let operation: ProtectedOperation | undefined;
    let pendingApproval: ReturnType<typeof approvalId> | undefined;
    let settle: ((decision: ApprovalRequestSnapshot) => void) | undefined;
    const first = apply(repo.root, bench.current(), grant(repo.root), {
      bench,
      onOperation: (value) => {
        operation = value;
      },
      awaitApprovalDecision: async (id) => {
        pendingApproval = id;
        return new Promise<ApprovalRequestSnapshot>((resolve) => {
          settle = resolve;
        });
      },
    });
    await vi.waitFor(() => expect(bench.current().state).toBe("applying"));

    const second = await apply(repo.root, bench.current(), grant(repo.root), { bench });
    expect(second.error).toMatchObject({ code: "apply-in-progress" });
    expect(await readFile(path.join(repo.root, "tracked.txt"), "utf8")).toBe("original\n");

    settle?.(approvalSnapshot(pendingApproval!, operation!));
    const completed = await first;
    expect(completed.error).toBeUndefined();
    expect(bench.persisted.filter(({ state }) => state === "applied")).toHaveLength(1);
  });

  it("P7-A-DELIVERY-002 P7-V-DELIVERY-002-ALREADY-APPLIED-RETRY", async () => {
    const repo = await repository();
    const result = await apply(
      repo.root,
      delivery(repo.root, repo.head, {
        state: "applied",
        destinationGrantId: grant(repo.root).grantId,
        approvalId: approvalId("approval-p7-applied"),
        verifiedHead: repo.head,
      }),
    );

    expect(result.error).toMatchObject({ code: "already-applied" });
    expect(await readFile(path.join(repo.root, "tracked.txt"), "utf8")).toBe("original\n");
    expect(result.bench.persisted).toHaveLength(0);
  });

  it("P7-A-DELIVERY-002 P7-V-DELIVERY-002-LOST-RESPONSE", async () => {
    const repo = await repository();
    const bench = persistence(delivery(repo.root, repo.head));
    const first = await apply(repo.root, bench.current(), grant(repo.root), { bench });
    expect(first.error).toBeUndefined();
    expect(bench.current().state).toBe("applied");

    const retry = await apply(repo.root, bench.current(), grant(repo.root), { bench });

    expect(retry.error).toMatchObject({ code: "already-applied" });
    expect(await readFile(path.join(repo.root, "tracked.txt"), "utf8")).toBe("applied by p7\n");
    expect(bench.persisted.filter(({ state }) => state === "applied")).toHaveLength(1);
  });

  it("P7-A-DELIVERY-002 P7-V-DELIVERY-002-REPOSITORY-LOCK", async () => {
    const repo = await repository();
    const lock = await acquireWorkspaceRepositoryLock({
      gitDirectory: path.join(repo.root, ".git"),
      clock,
      holder: "first",
    });
    try {
      const result = await apply(repo.root, delivery(repo.root, repo.head));
      expect(result.error).toBeInstanceOf(ArtifactWorkspaceApplicatorError);
      expect(result.error).toMatchObject({ code: "lock-unavailable" });
      expect((result.error as Error).cause).toBeInstanceOf(WorkspaceRepositoryLockError);
      expect(await readFile(path.join(repo.root, "tracked.txt"), "utf8")).toBe("original\n");
      expect(path.basename(lock.lockPath)).toBe(REPOSITORY_LOCK_FILENAME);
    } finally {
      await lock.release();
    }
    await expect(readFile(lock.lockPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("P7-A-DELIVERY-002 P7-V-DELIVERY-002-IDEMPOTENT-RECOVERY", async () => {
    const repo = await repository();
    const bench = persistence(
      delivery(repo.root, repo.head, {
        state: "cancelled",
        destinationGrantId: grant(repo.root).grantId,
        approvalId: approvalId("approval-p7-cancelled"),
      }),
    );

    const recovered = await apply(repo.root, bench.current(), grant(repo.root), { bench });
    expect(recovered.error).toBeUndefined();
    const duplicate = await apply(repo.root, bench.current(), grant(repo.root), { bench });

    expect(duplicate.error).toMatchObject({ code: "already-applied" });
    expect(await readFile(path.join(repo.root, "tracked.txt"), "utf8")).toBe("applied by p7\n");
    expect(bench.persisted.filter(({ state }) => state === "applied")).toHaveLength(1);
  });

  it("P7-A-TOOL-001 P7-V-TOOL-001-UNKNOWN-TOOL", async () => {
    const harness = createGatewayHarness();
    const operation = createProtectedOperation({ toolId: toolId("tool-p7-unknown") });

    await expect(harness.gateway.invoke(operation)).rejects.toMatchObject({
      code: "manifest-unavailable",
      mayHaveExecuted: false,
    });
    expect(harness.executor.manifestCalls).toBe(1);
    expect(harness.executor.executions).toHaveLength(0);
    expect((harness.auditTrail as InMemoryAuditTrail).snapshot()).toHaveLength(0);
  });

  it("P7-A-TOOL-001 P7-V-TOOL-001-MISSING-MANIFEST", async () => {
    const executor = new GatewayTestExecutor();
    executor.manifestFailure = new Error("manifest missing");
    const harness = createGatewayHarness({ executor });

    await expect(harness.gateway.invoke(createProtectedOperation())).rejects.toMatchObject({
      code: "manifest-unavailable",
      mayHaveExecuted: false,
    });
    expect(executor.executions).toHaveLength(0);
    expect((harness.auditTrail as InMemoryAuditTrail).snapshot()).toHaveLength(0);
  });

  it("P7-A-TOOL-001 P7-V-TOOL-001-NO-POLICY", async () => {
    const harness = createGatewayHarness({ rules: [] });

    await expect(harness.gateway.invoke(createProtectedOperation())).rejects.toMatchObject({
      code: "policy-denied",
      mayHaveExecuted: false,
    });
    expect(harness.executor.executions).toHaveLength(0);
    expect((harness.auditTrail as InMemoryAuditTrail).snapshot()).toHaveLength(1);
  });

  it("P7-A-TOOL-001 P7-V-TOOL-001-CONFLICTING-POLICY", async () => {
    const harness = createGatewayHarness({
      rules: [
        createPolicyRule({ id: policyRuleId("rule-p7-allow") }),
        createPolicyRule({ id: policyRuleId("rule-p7-deny"), effect: "deny" }),
      ],
    });

    await expect(harness.gateway.invoke(createProtectedOperation())).rejects.toMatchObject({
      code: "policy-denied",
      mayHaveExecuted: false,
    });
    expect(harness.executor.executions).toHaveLength(0);
    expect((harness.auditTrail as InMemoryAuditTrail).snapshot()).toHaveLength(1);
  });

  it("P7-A-TOOL-001 P7-V-TOOL-001-MALFORMED-INPUT", async () => {
    const harness = createGatewayHarness();
    const malformed = {
      ...createProtectedOperation(),
      unexpectedAuthority: "workspace.modify",
    } as never;

    await expect(harness.gateway.invoke(malformed)).rejects.toMatchObject({
      code: "invalid-contract",
      mayHaveExecuted: false,
    });
    expect(harness.executor.manifestCalls).toBe(0);
    expect(harness.executor.executions).toHaveLength(0);
    expect((harness.auditTrail as InMemoryAuditTrail).snapshot()).toHaveLength(0);
  });

  it("P7-A-TOOL-001 P7-V-TOOL-001-WIDENED-MANIFEST", async () => {
    const harness = createGatewayHarness();
    const widened = createProtectedOperation({ action: "workspace.modify" });

    await expect(harness.gateway.invoke(widened)).rejects.toMatchObject({
      code: "manifest-mismatch",
      mayHaveExecuted: false,
    });
    expect(harness.executor.executions).toHaveLength(0);
    expect((harness.auditTrail as InMemoryAuditTrail).snapshot()).toHaveLength(0);
  });

  it("P7-A-TOOL-002 P7-V-TOOL-002-INVALID-CREDENTIAL-REFERENCE", async () => {
    const harness = createGatewayHarness();
    const operation = {
      ...createProtectedOperation(),
      credentialRefs: [" invalid credential reference "],
    } as never;

    await expect(harness.gateway.invoke(operation)).rejects.toMatchObject({
      code: "invalid-contract",
      mayHaveExecuted: false,
    });
    expect(harness.executor.manifestCalls).toBe(0);
    expect(harness.executor.executions).toHaveLength(0);
  });

  it("P7-A-TOOL-002 P7-V-TOOL-002-STALE-AUTHORIZATION", async () => {
    const harness = createGatewayHarness({
      rules: [createPolicyRule({ effect: "require-approval" })],
    });
    const operation = createProtectedOperation();
    const pending = await harness.gateway.invoke(operation);
    if (pending.status !== "approval-required") {
      throw new Error("Expected approval-required");
    }
    await harness.approvalService.resolve(
      pending.approval.approvalId,
      "approved",
      approvalActorId("p7-user"),
    );

    await expect(
      harness.gateway.invoke(
        { ...operation, inputRef: toolInputReference("input-p7-substituted") },
        pending.approval.approvalId,
      ),
    ).rejects.toMatchObject({ code: "approval-mismatch", mayHaveExecuted: false });
    expect(harness.executor.executions).toHaveLength(0);
  });

  it("P7-A-TOOL-002 P7-V-TOOL-002-EXECUTOR-MISMATCH", async () => {
    const operation = createProtectedOperation();
    const gatewayClock = new MutableGatewayClock();
    let auditSequence = 0;
    const auditTrail = new InMemoryAuditTrail(gatewayClock, () =>
      auditRecordId(`audit-p7-executor-mismatch-${String(++auditSequence)}`),
    );
    const executor = new GatewayTestExecutor();
    const gateway = new PrivilegedToolGateway({
      policyEngine: {
        evaluate: async () => createPolicyDecision({ requestId: operation.requestId }),
      },
      approvalService: {
        authorize: async () => ({
          status: "granted" as const,
          authorization: createAuthorizationGrant({ taskId: taskId("task-p7-impostor") }),
        }),
        resolve: async () => {
          throw new Error("must not resolve");
        },
        get: async () => undefined,
      },
      credentialBroker: {
        lease: async () => {
          throw new Error("must not lease");
        },
        release: async () => {
          throw new Error("must not release");
        },
      },
      auditTrail,
      executor,
    });

    await expect(gateway.invoke(operation)).rejects.toMatchObject({
      code: "approval-mismatch",
      mayHaveExecuted: false,
    });
    expect(executor.executions).toHaveLength(0);
  });

  it("P7-A-TOOL-002 P7-V-TOOL-002-AMBIGUOUS-POST-EFFECT-RETRY", async () => {
    const executor = new GatewayTestExecutor();
    executor.failure = new ProtectedToolExecutionError(
      "ambiguous-effect",
      "The effect may have occurred",
      { mayHaveExecuted: true },
    );
    const harness = createGatewayHarness({ executor });
    const operation = createProtectedOperation();

    await expect(harness.gateway.invoke(operation)).rejects.toMatchObject({
      code: "tool-execution-failed",
      mayHaveExecuted: true,
    });
    await expect(harness.gateway.invoke(operation)).rejects.toMatchObject({
      code: "tool-execution-failed",
      mayHaveExecuted: true,
    });
    expect(executor.executions).toHaveLength(1);
  });

  it("P7-A-APPROVAL-001 P7-V-APPROVAL-001-DENY", async () => {
    const harness = createGatewayHarness({
      rules: [createPolicyRule({ effect: "require-approval" })],
    });
    const operation = createProtectedOperation();
    const pending = await requestGatewayApproval(harness, operation);
    await harness.approvalService.resolve(pending.approvalId, "denied", approvalActorId("p7-user"));

    await expect(harness.gateway.invoke(operation, pending.approvalId)).rejects.toMatchObject({
      code: "approval-not-granted",
      mayHaveExecuted: false,
    });
    expect(harness.executor.executions).toHaveLength(0);
  });

  it("P7-A-APPROVAL-001 P7-V-APPROVAL-001-EXPIRE", async () => {
    const harness = createGatewayHarness({
      rules: [createPolicyRule({ effect: "require-approval" })],
    });
    const operation = createProtectedOperation();
    const pending = await requestGatewayApproval(harness, operation);
    harness.clock.advance(1_000);

    await expect(harness.gateway.invoke(operation, pending.approvalId)).rejects.toMatchObject({
      code: "approval-expired",
      mayHaveExecuted: false,
    });
    expect(harness.executor.executions).toHaveLength(0);
  });

  it("P7-A-APPROVAL-001 P7-V-APPROVAL-001-CANCEL", async () => {
    const harness = createGatewayHarness({
      rules: [createPolicyRule({ effect: "require-approval" })],
    });
    const operation = createProtectedOperation();
    const pending = await requestGatewayApproval(harness, operation);
    await harness.approvalService.resolve(
      pending.approvalId,
      "cancelled",
      approvalActorId("p7-user"),
    );

    await expect(harness.gateway.invoke(operation, pending.approvalId)).rejects.toMatchObject({
      code: "approval-not-granted",
      mayHaveExecuted: false,
    });
    expect(harness.executor.executions).toHaveLength(0);
  });

  it("P7-A-APPROVAL-001 P7-V-APPROVAL-001-REUSE", async () => {
    const harness = createGatewayHarness({
      rules: [createPolicyRule({ effect: "require-approval" })],
    });
    const operation = createProtectedOperation();
    const pending = await requestGatewayApproval(harness, operation);
    await harness.approvalService.resolve(
      pending.approvalId,
      "approved",
      approvalActorId("p7-user"),
    );
    await expect(harness.gateway.invoke(operation, pending.approvalId)).resolves.toMatchObject({
      status: "executed",
    });

    await expect(harness.gateway.invoke(operation, pending.approvalId)).rejects.toMatchObject({
      code: "approval-replayed",
      mayHaveExecuted: false,
    });
    expect(harness.executor.executions).toHaveLength(1);
  });

  it("P7-A-APPROVAL-001 P7-V-APPROVAL-001-WRONG-OPERATION", async () => {
    const executor = new GatewayTestExecutor(
      createToolManifest({ actions: ["workspace.read", "workspace.modify"] }),
    );
    const harness = createGatewayHarness({
      rules: [
        createPolicyRule({
          effect: "require-approval",
          actions: ["workspace.read", "workspace.modify"],
        }),
      ],
      executor,
    });
    const operation = createProtectedOperation();
    const pending = await requestGatewayApproval(harness, operation);
    await harness.approvalService.resolve(
      pending.approvalId,
      "approved",
      approvalActorId("p7-user"),
    );

    await expect(
      harness.gateway.invoke({ ...operation, action: "workspace.modify" }, pending.approvalId),
    ).rejects.toMatchObject({ code: "approval-mismatch", mayHaveExecuted: false });
    expect(executor.executions).toHaveLength(0);
  });

  it("P7-A-APPROVAL-001 P7-V-APPROVAL-001-WRONG-ATTEMPT", async () => {
    const harness = createGatewayHarness({
      rules: [createPolicyRule({ effect: "require-approval" })],
    });
    const operation = createProtectedOperation();
    const pending = await requestGatewayApproval(harness, operation);
    await harness.approvalService.resolve(
      pending.approvalId,
      "approved",
      approvalActorId("p7-user"),
    );

    await expect(
      harness.gateway.invoke(
        { ...operation, taskId: taskId("task-p7-other-attempt") },
        pending.approvalId,
      ),
    ).rejects.toMatchObject({ code: "approval-mismatch", mayHaveExecuted: false });
    expect(harness.executor.executions).toHaveLength(0);
  });

  it("P7-A-APPROVAL-001 P7-V-APPROVAL-001-STALE-SNAPSHOT", async () => {
    const repo = await repository();
    let operation: ProtectedOperation | undefined;
    const result = await apply(repo.root, delivery(repo.root, repo.head), grant(repo.root), {
      onOperation: (value) => {
        operation = value;
      },
      awaitApprovalDecision: async (id) => approvalSnapshot(id, operation!, "pending"),
    });

    expect(result.error).toMatchObject({ code: "approval-failed" });
    expect(await readFile(path.join(repo.root, "tracked.txt"), "utf8")).toBe("original\n");
    expect(result.bench.current().state).toBe("cancelled");
  });

  for (const substitution of [
    ["PROTECTED-AS-WORKFLOW-FEEDBACK", "protected", "workflow-feedback"],
    ["PROTECTED-AS-PUBLISH", "protected", "publish"],
    ["PROTECTED-AS-WORKSPACE-APPLY", "protected", "workspace-apply"],
    ["WORKFLOW-FEEDBACK-AS-PROTECTED", "workflow-feedback", "protected"],
    ["WORKFLOW-FEEDBACK-AS-PUBLISH", "workflow-feedback", "publish"],
    ["WORKFLOW-FEEDBACK-AS-WORKSPACE-APPLY", "workflow-feedback", "workspace-apply"],
    ["PUBLISH-AS-PROTECTED", "publish", "protected"],
    ["PUBLISH-AS-WORKFLOW-FEEDBACK", "publish", "workflow-feedback"],
    ["PUBLISH-AS-WORKSPACE-APPLY", "publish", "workspace-apply"],
    ["WORKSPACE-APPLY-AS-PROTECTED", "workspace-apply", "protected"],
    ["WORKSPACE-APPLY-AS-WORKFLOW-FEEDBACK", "workspace-apply", "workflow-feedback"],
    ["WORKSPACE-APPLY-AS-PUBLISH", "workspace-apply", "publish"],
  ] as const) {
    it(`P7-A-APPROVAL-002 P7-V-APPROVAL-002-${substitution[0]}`, async () => {
      const [, sourcePurpose, targetPurpose] = substitution;
      const harness = createGatewayHarness();
      const source = purposeOperation(sourcePurpose);
      const target = purposeOperation(targetPurpose);
      const requested = await harness.approvalService.authorize(
        source,
        approvalDecisionFor(source),
      );
      if (requested.status !== "approval-required") {
        throw new Error("Expected approval-required");
      }
      await harness.approvalService.resolve(
        requested.approval.approvalId,
        "approved",
        approvalActorId("p7-user"),
      );

      await expect(
        harness.approvalService.authorize(
          target,
          approvalDecisionFor(target),
          requested.approval.approvalId,
        ),
      ).rejects.toMatchObject({ code: "approval-mismatch", mayHaveExecuted: false });
      expect(harness.executor.executions).toHaveLength(0);
      expect((harness.auditTrail as InMemoryAuditTrail).snapshot()).toHaveLength(2);
    });
  }
});

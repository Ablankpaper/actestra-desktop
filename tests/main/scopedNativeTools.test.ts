// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_WORKLOAD_CONTENT_BYTES,
  PRIVILEGED_CONTRACT_VERSION,
  TASK_OUTPUT_WRITE_OFFICE_DOCUMENT_TOOL_ID,
  TASK_OUTPUT_WRITE_TEXT_TOOL_ID,
  WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
  WORKSPACE_READ_TEXT_TOOL_ID,
  approvalId,
  auditRecordId,
  authorizationGrantId,
  correlationId,
  credentialReference,
  credentialLeaseId,
  eventId,
  eventStreamId,
  instant,
  policyDecisionId,
  sessionId,
  taskId,
  toolInputReference,
  toolOutputReference,
  toolRequestId,
  workerId,
  workspaceGrantId,
  workspaceId,
  serializeScopedNativeToolInput,
  type AgentStartRequest,
  type DomainGraph,
  type ProtectedAction,
  type TaskId,
  type ToolInputReference,
  type WorkspaceGrant,
} from "../../apps/desktop/src/core";
import {
  SCOPED_NATIVE_POLICY_REVISION,
  createScopedNativeToolPlatform,
} from "../../apps/desktop/src/main/privileged/scopedNativeToolPlatform";
import {
  AgentAdapterSupervisor,
  type AgentAdapterSupervisorConfig,
} from "../../apps/desktop/src/main/workers/agentAdapterSupervisor";
import { DeterministicAgentClock } from "../../apps/desktop/src/main/workers/deterministicFakeAgentAdapter";
import { ScopedNativeToolCoordinator } from "../../apps/desktop/src/main/workers/scopedNativeToolCoordinator";
import {
  GENERAL_WORKER_ADAPTER_KIND,
  type GeneralWorkerProcessAdapter,
} from "../../apps/desktop/src/main/workers/generalWorkerProcessAdapter";
import type { GeneralWorkerExecutionMode } from "../../apps/desktop/src/shared/generalWorkerProtocol";
import type { PersistenceUtilityClient } from "../../apps/desktop/src/main/persistence/persistenceUtilityClient";
import { resolveCoreDatabasePath } from "../../apps/desktop/src/utility/persistence/sqliteCorePersistence";
import { openTestGeneralWorker } from "../fixtures/generalWorker";
import { openTestPersistenceUtility } from "../fixtures/persistenceUtility";

const STARTED_AT = "2026-07-30T04:00:00.000Z";
const SUPERVISOR_CONFIG = {
  expectedAdapterKind: GENERAL_WORKER_ADAPTER_KIND,
  requiredCapabilities: ["messages", "cancellation", "heartbeats", "tool-results"],
  startupTimeoutMs: 2_000,
  heartbeatTimeoutMs: 3_000,
  cancellationTimeoutMs: 1_000,
  maxRestarts: 0,
} as const satisfies AgentAdapterSupervisorConfig;

interface NativeToolHarness {
  readonly directory: string;
  readonly workspaceRoot: string;
  readonly clock: DeterministicAgentClock;
  readonly request: AgentStartRequest;
  readonly requestId: ReturnType<typeof toolRequestId>;
  readonly grant: WorkspaceGrant;
  readonly persistence: PersistenceUtilityClient;
  readonly adapter: GeneralWorkerProcessAdapter;
  readonly supervisor: AgentAdapterSupervisor;
  readonly platform: ReturnType<typeof createScopedNativeToolPlatform>;
  readonly coordinator: ReturnType<
    ReturnType<typeof createScopedNativeToolPlatform>["createCoordinator"]
  >;
}

const harnesses: NativeToolHarness[] = [];

function removeHarnessDirectory(directory: string): void {
  if (!directory.startsWith(path.join(os.tmpdir(), "actestra-scoped-tools-test-"))) {
    throw new Error(`Refusing to remove unexpected test directory ${directory}`);
  }
  fs.rmSync(directory, { recursive: true, force: true });
}

function domainGraph(request: AgentStartRequest): DomainGraph {
  return {
    workspaces: [
      {
        id: request.workspaceId,
        name: "Scoped native tool workspace",
        state: "active",
        createdAt: request.startedAt,
        updatedAt: request.startedAt,
      },
    ],
    tasks: [
      {
        id: request.taskId,
        workspaceId: request.workspaceId,
        title: "Exercise scoped native tools",
        state: "running",
        activeSessionId: request.sessionId,
        createdAt: request.startedAt,
        updatedAt: request.startedAt,
      },
    ],
    workers: [
      {
        id: request.workerId,
        workspaceId: request.workspaceId,
        adapterKind: GENERAL_WORKER_ADAPTER_KIND,
        state: "busy",
        createdAt: request.startedAt,
        updatedAt: request.startedAt,
      },
    ],
    sessions: [
      {
        id: request.sessionId,
        workspaceId: request.workspaceId,
        taskId: request.taskId,
        workerId: request.workerId,
        state: "running",
        createdAt: request.startedAt,
        updatedAt: request.startedAt,
      },
    ],
    approvals: [],
    artifacts: [],
  };
}

function zipEntryNames(bytes: Buffer): readonly string[] {
  let end = bytes.length - 22;
  while (end >= 0 && bytes.readUInt32LE(end) !== 0x06054b50) {
    end -= 1;
  }
  if (end < 0) {
    throw new Error("DOCX output has no ZIP end-of-central-directory record");
  }
  const entries = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  const names: string[] = [];
  for (let index = 0; index < entries; index += 1) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("DOCX output has an invalid ZIP central directory");
    }
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    names.push(bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8"));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

async function openHarness(
  suffix: string,
  executionMode: GeneralWorkerExecutionMode,
  taskIdentity?: TaskId,
): Promise<NativeToolHarness> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-scoped-tools-test-"));
  let persistence: PersistenceUtilityClient | undefined;
  let adapter: GeneralWorkerProcessAdapter | undefined;
  try {
    const workspaceRoot = path.join(directory, "workspace");
    fs.mkdirSync(workspaceRoot);
    const clock = new DeterministicAgentClock(instant(STARTED_AT));
    const request: AgentStartRequest = {
      workspaceId: workspaceId(`workspace-native-${suffix}`),
      taskId: taskIdentity ?? taskId(`task-native-${suffix}`),
      sessionId: sessionId(`session-native-${suffix}`),
      workerId: workerId(`worker-native-${suffix}`),
      streamId: eventStreamId(`stream-native-${suffix}`),
      correlationId: correlationId(`correlation-native-${suffix}`),
      taskState: "ready",
      startedAt: clock.now(),
      initialPrompt:
        executionMode === "office-document-artifact-fixture"
          ? [
              "Document: Quarterly operating brief",
              "Owner: Product operations",
              "Summary: Record the approved launch decision in a portable Word document.",
              "Section: Decision | Ship the verified desktop workflow.",
              "Section: Evidence | Include the exact acceptance boundary.",
            ].join("\n")
          : "Exercise one scoped native text tool.",
    };
    const requestId = toolRequestId(`request-native-${suffix}`);
    ({ client: persistence } = await openTestPersistenceUtility(directory));
    await persistence.replaceDomainGraph(domainGraph(request));
    const grant = {
      contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
      grantId: workspaceGrantId(`grant-native-${suffix}`),
      workspaceId: request.workspaceId,
      rootPath: fs.realpathSync(workspaceRoot),
      displayName: "Scoped native tool fixture",
      state: "active",
      createdAt: clock.now(),
      updatedAt: clock.now(),
    } as const satisfies WorkspaceGrant;
    await persistence.persistWorkspaceGrant(grant);

    let eventSequence = 0;
    ({ adapter } = await openTestGeneralWorker(clock, {
      executionMode,
      newAttemptToken: () => `attempt-native-${suffix}`,
      newToolRequestId: () => requestId,
      newEventId: () => eventId(`event-native-${suffix}-${String(++eventSequence)}`),
    }));
    const supervisor = new AgentAdapterSupervisor(adapter, clock, SUPERVISOR_CONFIG);
    const platform = createScopedNativeToolPlatform({
      persistence,
      clock,
      identifiers: {
        newAuditRecordId: (() => {
          let sequence = 0;
          return () => auditRecordId(`audit-native-${suffix}-${String(++sequence)}`);
        })(),
        newPolicyDecisionId: (() => {
          let sequence = 0;
          return () => policyDecisionId(`decision-native-${suffix}-${String(++sequence)}`);
        })(),
        newApprovalId: () => approvalId(`approval-native-${suffix}`),
        newAuthorizationGrantId: (() => {
          let sequence = 0;
          return () => authorizationGrantId(`grant-auth-native-${suffix}-${String(++sequence)}`);
        })(),
        newCredentialLeaseId: () => credentialLeaseId(`lease-native-${suffix}`),
        newOutputReference: (() => {
          let sequence = 0;
          return () => toolOutputReference(`output-native-${suffix}-${String(++sequence)}`);
        })(),
      },
    });
    const coordinator = platform.createCoordinator(supervisor);
    await supervisor.start(request);
    expect(supervisor.snapshot(request.sessionId)).toMatchObject({
      state: "blocked",
      taskState: "blocked",
      disposed: false,
    });

    const harness = {
      directory,
      workspaceRoot,
      clock,
      request,
      requestId,
      grant,
      persistence,
      adapter,
      supervisor,
      platform,
      coordinator,
    };
    harnesses.push(harness);
    return harness;
  } catch (error) {
    await adapter?.close().catch((): undefined => undefined);
    await persistence?.close().catch((): undefined => undefined);
    removeHarnessDirectory(directory);
    throw error;
  }
}

async function storeInput(
  harness: NativeToolHarness,
  tool:
    | typeof WORKSPACE_READ_TEXT_TOOL_ID
    | typeof TASK_OUTPUT_WRITE_TEXT_TOOL_ID
    | typeof TASK_OUTPUT_WRITE_OFFICE_DOCUMENT_TOOL_ID,
  input: Parameters<typeof serializeScopedNativeToolInput>[1],
  suffix: string,
  requestIdValue = harness.requestId,
): Promise<ToolInputReference> {
  const reference = toolInputReference(`input-native-${suffix}`);
  await harness.persistence.storeContentReference({
    contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
    reference,
    kind: "tool-input",
    owner: {
      workspaceId: harness.request.workspaceId,
      taskId: harness.request.taskId,
      sessionId: harness.request.sessionId,
      workerId: harness.request.workerId,
      requestId: requestIdValue,
      grantId: harness.grant.grantId,
    },
    classification: "task-content",
    mediaType: "text/plain; charset=utf-8",
    content: serializeScopedNativeToolInput(tool, input),
    createdAt: harness.clock.now(),
  });
  return reference;
}

async function expectTerminal(
  harness: NativeToolHarness,
  state: "completed" | "failed" | "cancelled",
): Promise<void> {
  await vi.waitFor(() => {
    expect(harness.supervisor.snapshot(harness.request.sessionId)).toMatchObject({
      state,
      disposed: true,
    });
  });
}

afterEach(async () => {
  for (const harness of harnesses.splice(0).reverse()) {
    await harness.adapter.close().catch(() => undefined);
    await harness.persistence.close().catch(() => undefined);
    removeHarnessDirectory(harness.directory);
  }
});

describe("GW-P4.4 scoped native tool execution", () => {
  it("creates one valid task-scoped DOCX and persists only its bounded preview model", async () => {
    const harness = await openHarness("office-document", "office-document-artifact-fixture");
    const document = {
      contractVersion: 1,
      title: "Quarterly operating brief",
      owner: "Product operations",
      summary: "Record the approved launch decision in a portable Word document.",
      sections: [
        {
          heading: "Decision",
          body: "Ship the verified desktop workflow.",
        },
        {
          heading: "Evidence",
          body: "Include the exact acceptance boundary.",
        },
      ],
    } as const;
    const inputRef = await storeInput(
      harness,
      TASK_OUTPUT_WRITE_OFFICE_DOCUMENT_TOOL_ID,
      {
        contractVersion: 1,
        relativePath: "brief.docx",
        document,
      },
      "office-document",
    );

    const result = await harness.coordinator.invoke({
      sessionId: harness.request.sessionId,
      requestId: harness.requestId,
      inputRef,
    });
    expect(result).toMatchObject({
      status: "succeeded",
      outputRef: toolOutputReference("output-native-office-document-1"),
    });
    if (result.status !== "succeeded" || result.outputRef === undefined) {
      throw new Error("Expected an Office-document output reference");
    }
    const outputPath = path.join(
      harness.workspaceRoot,
      ".actestra",
      "task-output",
      harness.request.taskId,
      "brief.docx",
    );
    const bytes = fs.readFileSync(outputPath);
    expect(bytes.subarray(0, 2).toString("ascii")).toBe("PK");
    expect(zipEntryNames(bytes)).toEqual(
      expect.arrayContaining(["[Content_Types].xml", "_rels/.rels", "word/document.xml"]),
    );
    await expect(
      harness.persistence.resolveContentReference({
        contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
        reference: result.outputRef,
        kind: "tool-output",
        owner: {
          workspaceId: harness.request.workspaceId,
          taskId: harness.request.taskId,
          sessionId: harness.request.sessionId,
          workerId: harness.request.workerId,
          requestId: harness.requestId,
          grantId: harness.grant.grantId,
        },
        resolvedAt: harness.clock.now(),
        consume: false,
      }),
    ).resolves.toMatchObject({
      content: JSON.stringify(document),
      metadata: {
        classification: "task-content",
        mediaType: "application/vnd.actestra.office-document-preview+json",
      },
    });
    await expectTerminal(harness, "completed");
  });

  it("reads bounded UTF-8 through an active attempt and returns only an opaque output reference", async () => {
    const harness = await openHarness("read-success", "workspace-read-text-fixture");
    fs.mkdirSync(path.join(harness.workspaceRoot, "notes"));
    fs.writeFileSync(path.join(harness.workspaceRoot, "notes", "source.txt"), "verified content");
    const inputRef = await storeInput(
      harness,
      WORKSPACE_READ_TEXT_TOOL_ID,
      {
        contractVersion: 1,
        relativePath: "notes/source.txt",
      },
      "read-success",
    );

    const result = await harness.coordinator.invoke({
      sessionId: harness.request.sessionId,
      requestId: harness.requestId,
      inputRef,
    });
    expect(result).toMatchObject({
      status: "succeeded",
      outputRef: toolOutputReference("output-native-read-success-1"),
    });
    if (result.status !== "succeeded" || result.outputRef === undefined) {
      throw new Error("Expected a scoped read output reference");
    }
    await expect(
      harness.persistence.resolveContentReference({
        contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
        reference: result.outputRef,
        kind: "tool-output",
        owner: {
          workspaceId: harness.request.workspaceId,
          taskId: harness.request.taskId,
          sessionId: harness.request.sessionId,
          workerId: harness.request.workerId,
          requestId: harness.requestId,
          grantId: harness.grant.grantId,
        },
        resolvedAt: harness.clock.now(),
        consume: false,
      }),
    ).resolves.toMatchObject({
      content: "verified content",
      metadata: {
        classification: "workspace-content",
      },
    });
    await expectTerminal(harness, "completed");
    await expect(harness.persistence.summarizePrivilegedAudit()).resolves.toEqual({
      recordCount: 3,
      lastSequence: 3,
    });
  });

  it("shares one in-flight request guard across platform coordinator lookups", async () => {
    const harness = await openHarness("duplicate-invocation", "workspace-read-text-fixture");
    fs.writeFileSync(path.join(harness.workspaceRoot, "source.txt"), "bounded");
    const inputRef = await storeInput(
      harness,
      WORKSPACE_READ_TEXT_TOOL_ID,
      { contractVersion: 1, relativePath: "source.txt" },
      "duplicate-invocation",
    );
    const sameCoordinator = harness.platform.createCoordinator(harness.supervisor);
    expect(sameCoordinator).toBe(harness.coordinator);

    const firstInvocation = harness.coordinator.invoke({
      sessionId: harness.request.sessionId,
      requestId: harness.requestId,
      inputRef,
    });
    await expect(
      sameCoordinator.invoke({
        sessionId: harness.request.sessionId,
        requestId: harness.requestId,
        inputRef,
      }),
    ).rejects.toMatchObject({
      code: "duplicate-invocation",
    });
    await expect(firstInvocation).resolves.toMatchObject({
      status: "succeeded",
    });
    await expectTerminal(harness, "completed");
  });

  it("releases the in-flight request guard when coordination setup throws", async () => {
    const harness = await openHarness("clock-failure", "workspace-read-text-fixture");
    fs.writeFileSync(path.join(harness.workspaceRoot, "source.txt"), "bounded");
    const inputRef = await storeInput(
      harness,
      WORKSPACE_READ_TEXT_TOOL_ID,
      { contractVersion: 1, relativePath: "source.txt" },
      "clock-failure",
    );
    const now = vi.spyOn(harness.clock, "now").mockImplementationOnce(() => {
      throw new Error("Injected clock failure");
    });

    await expect(
      harness.coordinator.invoke({
        sessionId: harness.request.sessionId,
        requestId: harness.requestId,
        inputRef,
      }),
    ).rejects.toThrow("Injected clock failure");
    now.mockRestore();
    await expect(
      harness.coordinator.invoke({
        sessionId: harness.request.sessionId,
        requestId: harness.requestId,
        inputRef,
      }),
    ).resolves.toMatchObject({
      status: "succeeded",
    });
    await expectTerminal(harness, "completed");
  });

  it("reuses a retained terminal result when the persistence barrier retries", async () => {
    const harness = await openHarness("retained-result", "task-output-write-text-fixture");
    const input = {
      contractVersion: 1,
      relativePath: "retained.txt",
      mediaType: "text/plain; charset=utf-8",
      content: "execute exactly once",
    } as const;
    const inputRef = await storeInput(
      harness,
      TASK_OUTPUT_WRITE_TEXT_TOOL_ID,
      input,
      "retained-result",
    );
    const gateway = vi.spyOn(harness.platform.toolGateway, "invoke");
    let barrierAttempts = 0;
    const coordinator = new ScopedNativeToolCoordinator(
      harness.supervisor,
      harness.platform.toolGateway,
      harness.clock,
      async () => {
        barrierAttempts += 1;
        if (barrierAttempts === 1) {
          throw new Error("Injected durable barrier failure");
        }
      },
    );
    const invocation = {
      sessionId: harness.request.sessionId,
      requestId: harness.requestId,
      inputRef,
    };

    await expect(coordinator.invoke(invocation)).rejects.toThrow(
      "Injected durable barrier failure",
    );
    expect(gateway).toHaveBeenCalledTimes(1);
    await expect(coordinator.invoke(invocation)).resolves.toMatchObject({
      status: "succeeded",
    });
    expect(gateway).toHaveBeenCalledTimes(1);
    expect(barrierAttempts).toBe(2);
    expect(
      fs.readFileSync(
        path.join(
          harness.workspaceRoot,
          ".actestra",
          "task-output",
          harness.request.taskId,
          "retained.txt",
        ),
        "utf8",
      ),
    ).toBe(input.content);
    await expectTerminal(harness, "completed");
  });

  it("rejects an executor timeout above the registered manifest ceiling", async () => {
    const harness = await openHarness("timeout-ceiling", "workspace-read-text-fixture");
    const inputRef = toolInputReference("input-native-timeout-ceiling");
    const operation = {
      contractVersion: PRIVILEGED_CONTRACT_VERSION,
      requestId: harness.requestId,
      workspaceId: harness.request.workspaceId,
      taskId: harness.request.taskId,
      sessionId: harness.request.sessionId,
      workerId: harness.request.workerId,
      toolId: WORKSPACE_READ_TEXT_TOOL_ID,
      inputRef,
      action: "workspace.read",
      resourceKind: "workspace",
      summary: "Attempt to widen the manifest timeout.",
      credentialRefs: [],
      requestedAt: harness.clock.now(),
    } as const;

    await expect(
      harness.platform.executor.execute({
        operation,
        authorization: {
          grantId: authorizationGrantId("grant-auth-native-timeout-ceiling-direct"),
          requestId: operation.requestId,
          workspaceId: operation.workspaceId,
          taskId: operation.taskId,
          sessionId: operation.sessionId,
          workerId: operation.workerId,
          toolId: operation.toolId,
          inputRef: operation.inputRef,
          action: operation.action,
          resourceKind: operation.resourceKind,
          credentialRefs: [],
          policyDecisionId: policyDecisionId("decision-native-timeout-ceiling-direct"),
          policyRevision: SCOPED_NATIVE_POLICY_REVISION,
          method: "policy",
          issuedAt: harness.clock.now(),
        },
        credentialLeases: [],
        timeoutMs: 5_001,
      }),
    ).rejects.toMatchObject({
      errorCode: "authorization-mismatch",
      mayHaveExecuted: false,
    });
  });

  it("creates a task-scoped output once and reports an explicit non-executed conflict", async () => {
    const harness = await openHarness("write-conflict", "task-output-write-text-fixture");
    const input = {
      contractVersion: 1,
      relativePath: "reports/result.md",
      mediaType: "text/markdown; charset=utf-8",
      content: "# Verified\n",
    } as const;
    const inputRef = await storeInput(
      harness,
      TASK_OUTPUT_WRITE_TEXT_TOOL_ID,
      input,
      "write-conflict",
    );
    await expect(
      harness.coordinator.invoke({
        sessionId: harness.request.sessionId,
        requestId: harness.requestId,
        inputRef,
      }),
    ).resolves.toMatchObject({
      status: "succeeded",
    });
    await expectTerminal(harness, "completed");
    const outputPath = path.join(
      harness.workspaceRoot,
      ".actestra",
      "task-output",
      harness.request.taskId,
      "reports",
      "result.md",
    );
    expect(fs.readFileSync(outputPath, "utf8")).toBe(input.content);

    harness.clock.advance(1);
    const conflictRequest = toolRequestId("request-native-write-conflict-retry");
    const conflictInput = await storeInput(
      harness,
      TASK_OUTPUT_WRITE_TEXT_TOOL_ID,
      input,
      "write-conflict-retry",
      conflictRequest,
    );
    await expect(
      harness.platform.toolGateway.invoke({
        contractVersion: PRIVILEGED_CONTRACT_VERSION,
        requestId: conflictRequest,
        workspaceId: harness.request.workspaceId,
        taskId: harness.request.taskId,
        sessionId: harness.request.sessionId,
        workerId: harness.request.workerId,
        toolId: TASK_OUTPUT_WRITE_TEXT_TOOL_ID,
        inputRef: conflictInput,
        action: "artifact.create",
        resourceKind: "task-output",
        summary: "Retry the same create-only task output.",
        credentialRefs: [],
        requestedAt: harness.clock.now(),
      }),
    ).rejects.toMatchObject({
      code: "tool-execution-failed",
      mayHaveExecuted: false,
      cause: {
        errorCode: "output-conflict",
        mayHaveExecuted: false,
      },
    });
    expect(fs.readFileSync(outputPath, "utf8")).toBe(input.content);
  });

  it("marks a published output as possibly executed when its opaque reference cannot persist", async () => {
    const harness = await openHarness("write-reference-failure", "task-output-write-text-fixture");
    const input = {
      contractVersion: 1,
      relativePath: "result.txt",
      mediaType: "text/plain; charset=utf-8",
      content: "published before reference failure",
    } as const;
    const inputRef = await storeInput(
      harness,
      TASK_OUTPUT_WRITE_TEXT_TOOL_ID,
      input,
      "write-reference-failure",
    );
    vi.spyOn(harness.persistence, "storeContentReference").mockRejectedValueOnce(
      Object.assign(new Error("Injected output reference failure"), {
        code: "injected-output-reference-failure",
      }),
    );

    await expect(
      harness.platform.toolGateway.invoke({
        contractVersion: PRIVILEGED_CONTRACT_VERSION,
        requestId: harness.requestId,
        workspaceId: harness.request.workspaceId,
        taskId: harness.request.taskId,
        sessionId: harness.request.sessionId,
        workerId: harness.request.workerId,
        toolId: TASK_OUTPUT_WRITE_TEXT_TOOL_ID,
        inputRef,
        action: "artifact.create",
        resourceKind: "task-output",
        summary: "Prove ambiguous output-reference persistence.",
        credentialRefs: [],
        requestedAt: harness.clock.now(),
      }),
    ).rejects.toMatchObject({
      code: "tool-execution-failed",
      mayHaveExecuted: true,
      cause: {
        errorCode: "output-reference-unavailable",
        mayHaveExecuted: true,
      },
    });
    expect(
      fs.readFileSync(
        path.join(
          harness.workspaceRoot,
          ".actestra",
          "task-output",
          harness.request.taskId,
          "result.txt",
        ),
        "utf8",
      ),
    ).toBe(input.content);
    await expect(harness.persistence.summarizePrivilegedAudit()).resolves.toEqual({
      recordCount: 3,
      lastSequence: 3,
    });
    const database = new DatabaseSync(resolveCoreDatabasePath(harness.directory), {
      readOnly: true,
    });
    const row = database
      .prepare(
        `SELECT record_json
         FROM privileged_audit_records
         WHERE event_type = 'tool.failed'`,
      )
      .get() as { readonly record_json: string };
    database.close();
    expect(JSON.parse(row.record_json)).toMatchObject({
      event: {
        type: "tool.failed",
        errorCode: "output-reference-unavailable",
        mayHaveExecuted: true,
      },
    });
  });

  it("keeps a published output successful when temporary-file cleanup fails", async () => {
    const harness = await openHarness("write-cleanup-failure", "task-output-write-text-fixture");
    const input = {
      contractVersion: 1,
      relativePath: "result.txt",
      mediaType: "text/plain; charset=utf-8",
      content: "published despite cleanup failure",
    } as const;
    const inputRef = await storeInput(
      harness,
      TASK_OUTPUT_WRITE_TEXT_TOOL_ID,
      input,
      "write-cleanup-failure",
    );
    const unlink = vi
      .spyOn(fs.promises, "unlink")
      .mockRejectedValueOnce(Object.assign(new Error("Injected cleanup failure"), { code: "EIO" }));

    await expect(
      harness.coordinator.invoke({
        sessionId: harness.request.sessionId,
        requestId: harness.requestId,
        inputRef,
      }),
    ).resolves.toMatchObject({
      status: "succeeded",
    });
    unlink.mockRestore();
    expect(
      fs.readFileSync(
        path.join(
          harness.workspaceRoot,
          ".actestra",
          "task-output",
          harness.request.taskId,
          "result.txt",
        ),
        "utf8",
      ),
    ).toBe(input.content);
    await expectTerminal(harness, "completed");
  });

  it("rejects traversal, symbolic links, invalid UTF-8, and oversized reads without output", async () => {
    const traversal = await openHarness("read-traversal", "workspace-read-text-fixture");
    const traversalRef = toolInputReference("input-native-read-traversal");
    await traversal.persistence.storeContentReference({
      contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
      reference: traversalRef,
      kind: "tool-input",
      owner: {
        workspaceId: traversal.request.workspaceId,
        taskId: traversal.request.taskId,
        sessionId: traversal.request.sessionId,
        workerId: traversal.request.workerId,
        requestId: traversal.requestId,
        grantId: traversal.grant.grantId,
      },
      classification: "task-content",
      mediaType: "text/plain; charset=utf-8",
      content: JSON.stringify({ contractVersion: 1, relativePath: "../outside.txt" }),
      createdAt: traversal.clock.now(),
    });
    await expect(
      traversal.coordinator.invoke({
        sessionId: traversal.request.sessionId,
        requestId: traversal.requestId,
        inputRef: traversalRef,
      }),
    ).resolves.toMatchObject({
      status: "failed",
      errorCode: "invalid-input",
    });
    await expectTerminal(traversal, "failed");

    if (process.platform !== "win32") {
      const symlink = await openHarness("read-symlink", "workspace-read-text-fixture");
      const outside = path.join(symlink.directory, "outside.txt");
      fs.writeFileSync(outside, "must not be read");
      fs.symlinkSync(outside, path.join(symlink.workspaceRoot, "linked.txt"));
      const symlinkRef = await storeInput(
        symlink,
        WORKSPACE_READ_TEXT_TOOL_ID,
        { contractVersion: 1, relativePath: "linked.txt" },
        "read-symlink",
      );
      await expect(
        symlink.coordinator.invoke({
          sessionId: symlink.request.sessionId,
          requestId: symlink.requestId,
          inputRef: symlinkRef,
        }),
      ).resolves.toMatchObject({
        status: "failed",
        errorCode: "symlink-denied",
      });
      await expectTerminal(symlink, "failed");

      const outputSymlink = await openHarness("write-symlink", "task-output-write-text-fixture");
      const escapedOutput = path.join(outputSymlink.directory, "escaped-output");
      fs.mkdirSync(escapedOutput);
      fs.symlinkSync(escapedOutput, path.join(outputSymlink.workspaceRoot, ".actestra"), "dir");
      const outputSymlinkRef = await storeInput(
        outputSymlink,
        TASK_OUTPUT_WRITE_TEXT_TOOL_ID,
        {
          contractVersion: 1,
          relativePath: "escaped.txt",
          mediaType: "text/plain; charset=utf-8",
          content: "must stay contained",
        },
        "write-symlink",
      );
      await expect(
        outputSymlink.coordinator.invoke({
          sessionId: outputSymlink.request.sessionId,
          requestId: outputSymlink.requestId,
          inputRef: outputSymlinkRef,
        }),
      ).resolves.toMatchObject({
        status: "failed",
        errorCode: "symlink-denied",
      });
      await expectTerminal(outputSymlink, "failed");
      expect(fs.readdirSync(escapedOutput)).toEqual([]);
    }

    const invalidUtf8 = await openHarness("read-invalid-utf8", "workspace-read-text-fixture");
    fs.writeFileSync(path.join(invalidUtf8.workspaceRoot, "invalid.txt"), Buffer.from([0xff]));
    const invalidRef = await storeInput(
      invalidUtf8,
      WORKSPACE_READ_TEXT_TOOL_ID,
      { contractVersion: 1, relativePath: "invalid.txt" },
      "read-invalid-utf8",
    );
    await expect(
      invalidUtf8.coordinator.invoke({
        sessionId: invalidUtf8.request.sessionId,
        requestId: invalidUtf8.requestId,
        inputRef: invalidRef,
      }),
    ).resolves.toMatchObject({
      status: "failed",
      errorCode: "invalid-utf8",
    });
    await expectTerminal(invalidUtf8, "failed");

    const oversized = await openHarness("read-oversized", "workspace-read-text-fixture");
    fs.writeFileSync(
      path.join(oversized.workspaceRoot, "oversized.txt"),
      Buffer.alloc(MAX_WORKLOAD_CONTENT_BYTES + 1, 0x61),
    );
    const oversizedRef = await storeInput(
      oversized,
      WORKSPACE_READ_TEXT_TOOL_ID,
      { contractVersion: 1, relativePath: "oversized.txt" },
      "read-oversized",
    );
    await expect(
      oversized.coordinator.invoke({
        sessionId: oversized.request.sessionId,
        requestId: oversized.requestId,
        inputRef: oversizedRef,
      }),
    ).resolves.toMatchObject({
      status: "failed",
      errorCode: "content-too-large",
    });
    await expectTerminal(oversized, "failed");
  });

  it("rejects wrong-attempt input ownership and unregistered worker tools", async () => {
    const ownership = await openHarness("wrong-owner", "workspace-read-text-fixture");
    fs.writeFileSync(path.join(ownership.workspaceRoot, "source.txt"), "protected");
    const wrongOwnerRef = await storeInput(
      ownership,
      WORKSPACE_READ_TEXT_TOOL_ID,
      { contractVersion: 1, relativePath: "source.txt" },
      "wrong-owner",
      toolRequestId("request-native-impostor"),
    );
    await expect(
      ownership.coordinator.invoke({
        sessionId: ownership.request.sessionId,
        requestId: ownership.requestId,
        inputRef: wrongOwnerRef,
      }),
    ).resolves.toMatchObject({
      status: "failed",
      errorCode: "input-ownership-denied",
    });
    await expectTerminal(ownership, "failed");

    const unsupported = await openHarness("unsupported", "tool-fixture");
    const unsupportedRef = toolInputReference("input-native-unsupported");
    await expect(
      unsupported.coordinator.invoke({
        sessionId: unsupported.request.sessionId,
        requestId: unsupported.requestId,
        inputRef: unsupportedRef,
      }),
    ).resolves.toMatchObject({
      status: "failed",
      errorCode: "unsupported-tool",
    });
    await expectTerminal(unsupported, "failed");
    await expect(unsupported.persistence.summarizePrivilegedAudit()).resolves.toEqual({
      recordCount: 0,
      lastSequence: 0,
    });

    const forbiddenActions: readonly ProtectedAction[] = [
      "workspace.modify",
      "workspace.delete",
      "shell.execute",
      "system.change",
      "network.request",
      "message.send",
      "publish.execute",
      "git.push",
      "credential.use",
      "tool.invoke",
    ];
    for (const [index, action] of forbiddenActions.entries()) {
      await expect(
        unsupported.platform.policyEngine.evaluate({
          contractVersion: PRIVILEGED_CONTRACT_VERSION,
          requestId: toolRequestId(`request-native-forbidden-${String(index)}`),
          workspaceId: unsupported.request.workspaceId,
          taskId: unsupported.request.taskId,
          sessionId: unsupported.request.sessionId,
          workerId: unsupported.request.workerId,
          toolId: WORKSPACE_READ_TEXT_TOOL_ID,
          inputRef: unsupportedRef,
          action,
          resourceKind: action === "workspace.modify" ? "workspace" : "system",
          summary: "Attempt a capability outside GW-P4.4.",
          credentialRefs:
            action === "credential.use" ? [credentialReference("credential-native-forbidden")] : [],
          requestedAt: unsupported.clock.now(),
        }),
      ).resolves.toMatchObject({
        effect: "deny",
        reasonCode: "no-matching-rule",
      });
    }
  });

  it("rejects task identities that could escape the reserved output directory", async () => {
    const harness = await openHarness(
      "task-identity",
      "task-output-write-text-fixture",
      taskId("../escape"),
    );
    const inputRef = await storeInput(
      harness,
      TASK_OUTPUT_WRITE_TEXT_TOOL_ID,
      {
        contractVersion: 1,
        relativePath: "result.txt",
        mediaType: "text/plain; charset=utf-8",
        content: "must remain inside",
      },
      "task-identity",
    );
    await expect(
      harness.coordinator.invoke({
        sessionId: harness.request.sessionId,
        requestId: harness.requestId,
        inputRef,
      }),
    ).resolves.toMatchObject({
      status: "failed",
      errorCode: "task-identity-denied",
    });
    await expectTerminal(harness, "failed");
    expect(fs.existsSync(path.join(harness.directory, "escape", "result.txt"))).toBe(false);
  });

  it("cancels before filesystem mutation and records a typed cancelled result", async () => {
    const harness = await openHarness("write-cancelled", "task-output-write-text-fixture");
    const inputRef = await storeInput(
      harness,
      TASK_OUTPUT_WRITE_TEXT_TOOL_ID,
      {
        contractVersion: 1,
        relativePath: "cancelled.txt",
        mediaType: "text/plain; charset=utf-8",
        content: "must not be created",
      },
      "write-cancelled",
    );
    const controller = new AbortController();
    controller.abort("User cancelled the output");
    await expect(
      harness.coordinator.invoke({
        sessionId: harness.request.sessionId,
        requestId: harness.requestId,
        inputRef,
        signal: controller.signal,
      }),
    ).resolves.toMatchObject({
      status: "cancelled",
      reason: "User cancelled the output",
    });
    await expectTerminal(harness, "cancelled");
    expect(
      fs.existsSync(
        path.join(
          harness.workspaceRoot,
          ".actestra",
          "task-output",
          harness.request.taskId,
          "cancelled.txt",
        ),
      ),
    ).toBe(false);
    await expect(harness.persistence.summarizePrivilegedAudit()).resolves.toEqual({
      recordCount: 3,
      lastSequence: 3,
    });
  });
});

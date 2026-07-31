// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hashAionUiGeneralWorkConversation } from "../../apps/desktop/src/compatibility/aionui";
import { eventId, instant } from "../../apps/desktop/src/core";
import { createScopedNativeToolPlatform } from "../../apps/desktop/src/main/privileged/scopedNativeToolPlatform";
import { AionUiGeneralWorkJourneyService } from "../../apps/desktop/src/main/compatibility/aionuiGeneralWorkJourneyService";
import { DeterministicAgentClock } from "../../apps/desktop/src/main/workers/deterministicFakeAgentAdapter";
import { MAX_GENERAL_WORKER_SEND_CONTENT_BYTES } from "../../apps/desktop/src/shared/generalWorkerProtocol";
import type { LoopbackGeneralWorkerTransport } from "../fixtures/generalWorker";
import { openTestGeneralWorker } from "../fixtures/generalWorker";
import { openTestPersistenceUtility } from "../fixtures/persistenceUtility";

const testDirectories: string[] = [];
const persistenceClients: Array<Awaited<ReturnType<typeof openTestPersistenceUtility>>["client"]> =
  [];

afterEach(async () => {
  for (const persistence of persistenceClients.splice(0)) {
    await persistence.close().catch(() => undefined);
  }
  for (const directory of testDirectories.splice(0)) {
    if (!directory.startsWith(path.join(os.tmpdir(), "actestra-aionui-journey-service-test-"))) {
      throw new Error(`Refusing to remove unexpected test directory ${directory}`);
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("AionUiGeneralWorkJourneyService", () => {
  it("rejects a filesystem-root workspace before registering or launching a Worker", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "actestra-aionui-journey-service-test-"),
    );
    testDirectories.push(directory);
    const persistence = (await openTestPersistenceUtility(directory)).client;
    persistenceClients.push(persistence);
    const clock = new DeterministicAgentClock(instant("2026-07-30T06:44:00.000Z"));
    const nativeTools = createScopedNativeToolPlatform({ persistence, clock });
    const launchWorker = vi.fn(async () => {
      throw new Error("A filesystem-root workspace must not launch a Worker");
    });
    const service = new AionUiGeneralWorkJourneyService({
      persistence,
      nativeTools,
      clock,
      nativeContext: {
        resolve: async () => ({
          rootPath: path.parse(process.cwd()).root,
          displayName: "Unsafe root workspace",
        }),
      },
      launchWorker,
    });

    await expect(
      service.submit({
        contractVersion: 1,
        nativeConversationId: "conversation-native-root-workspace",
        submissionId: "submission-native-root-workspace",
        prompt: "Do not grant access to the filesystem root.",
      }),
    ).rejects.toThrow(/workspace root/u);
    expect(launchWorker).not.toHaveBeenCalled();
    await expect(persistence.loadDomainGraph()).resolves.toEqual({
      workspaces: [],
      tasks: [],
      sessions: [],
      workers: [],
      approvals: [],
      artifacts: [],
    });
  });

  it("persists one real Worker attempt and deduplicates the native submission", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "actestra-aionui-journey-service-test-"),
    );
    testDirectories.push(directory);
    const persistence = (await openTestPersistenceUtility(directory)).client;
    persistenceClients.push(persistence);
    const workspaceRoot = path.join(directory, "workspace");
    fs.mkdirSync(workspaceRoot);
    const clock = new DeterministicAgentClock(instant("2026-07-30T06:45:00.000Z"));
    const nativeTools = createScopedNativeToolPlatform({ persistence, clock });
    let launchCount = 0;
    let workerEventSequence = 0;
    let transport: LoopbackGeneralWorkerTransport | undefined;
    const service = new AionUiGeneralWorkJourneyService({
      persistence,
      nativeTools,
      clock,
      nativeContext: {
        resolve: async () => ({
          rootPath: fs.realpathSync(workspaceRoot),
          displayName: "AionUI preserved workspace",
        }),
      },
      launchWorker: async ({ requestId }) => {
        launchCount += 1;
        const opened = await openTestGeneralWorker(clock, {
          executionMode: "task-output-write-text-fixture",
          newAttemptToken: () => "attempt-aionui-journey-1",
          newToolRequestId: () => requestId,
          newEventId: () => eventId(`event-aionui-journey-worker-${String(++workerEventSequence)}`),
        });
        opened.transport.deliverMessagesOnSeparateTurns();
        transport = opened.transport;
        return opened.adapter;
      },
    });
    const intent = {
      contractVersion: 1,
      nativeConversationId: "conversation-native-journey-1",
      submissionId: "submission-native-journey-1",
      prompt: "Summarize the bounded Actestra task.",
    } as const;

    const [first, duplicate] = await Promise.all([service.submit(intent), service.submit(intent)]);

    expect(first).toEqual({
      contractVersion: 1,
      taskId: expect.stringMatching(/^task-aionui-/u),
      status: "blocked",
      title: intent.prompt,
      canCancel: true,
      createdAt: "2026-07-30T06:45:00.000Z",
      updatedAt: "2026-07-30T06:45:00.000Z",
      artifacts: [],
    });
    expect(duplicate).toEqual(first);
    expect(launchCount).toBe(1);

    await service.waitForIdle();
    const [completed] = await service.list(intent.nativeConversationId);
    expect(completed).toEqual({
      ...first,
      status: "completed",
      summary: "Actestra created 1 task artifact.",
      canCancel: false,
      artifacts: [
        {
          artifactId: expect.stringMatching(/^artifact-aionui-/u),
          kind: "file",
          label: "Actestra result",
          state: "available",
        },
      ],
    });
    expect(transport?.killCount).toBe(1);

    const links = await persistence.listAionUiGeneralWorkJourneyLinks(
      hashAionUiGeneralWorkConversation(intent.nativeConversationId),
      10,
    );
    expect(links).toHaveLength(1);
    expect(links[0]?.taskId).toBe(completed?.taskId);

    const graph = await persistence.loadDomainGraph();
    expect(graph.tasks).toEqual([
      expect.objectContaining({
        id: first.taskId,
        state: "completed",
        activeSessionId: undefined,
      }),
    ]);
    expect(graph.sessions).toEqual([expect.objectContaining({ state: "completed" })]);
    expect(graph.workers).toEqual([expect.objectContaining({ state: "stopped" })]);
    expect(graph.artifacts).toEqual([
      expect.objectContaining({
        id: completed!.artifacts[0]!.artifactId,
        taskId: completed!.taskId,
        state: "available",
      }),
    ]);
    expect(
      fs.readFileSync(
        path.join(workspaceRoot, ".actestra", "task-output", completed!.taskId, "result.md"),
        "utf8",
      ),
    ).toContain(intent.prompt);
    await expect(
      service.preview(
        intent.nativeConversationId,
        completed!.taskId,
        completed!.artifacts[0]!.artifactId,
      ),
    ).resolves.toEqual({
      contractVersion: 1,
      taskId: completed!.taskId,
      artifactId: completed!.artifacts[0]!.artifactId,
      label: "Actestra result",
      mediaType: "text/markdown; charset=utf-8",
      content: expect.stringContaining(intent.prompt),
    });
    await expect(
      service.preview(
        "conversation-native-other",
        completed!.taskId,
        completed!.artifacts[0]!.artifactId,
      ),
    ).rejects.toMatchObject({
      code: "task-not-owned",
    });

    const checkpoint = await persistence.getGeneralWorkCheckpoint(graph.sessions[0]!.id);
    expect(checkpoint).toMatchObject({
      phase: "finalized",
      attempt: {
        taskId: first.taskId,
        state: "completed",
        taskState: "completed",
        disposed: true,
      },
      artifactBinding: {
        artifact: {
          id: completed!.artifacts[0]!.artifactId,
        },
      },
    });
    expect(checkpoint?.events.map(({ type }) => type)).toEqual(
      expect.arrayContaining([
        "task.started",
        "tool.requested",
        "artifact.created",
        "tool.started",
        "tool.completed",
        "task.completed",
      ]),
    );
    if (checkpoint === null) {
      throw new Error("Expected the completed journey checkpoint");
    }
    const checkpointSpy = vi.spyOn(persistence, "getGeneralWorkCheckpoint").mockResolvedValue(
      Object.freeze({
        ...checkpoint,
        phase: "terminal-pending",
      }),
    );
    await expect(
      service.preview(
        intent.nativeConversationId,
        completed!.taskId,
        completed!.artifacts[0]!.artifactId,
      ),
    ).rejects.toMatchObject({
      code: "task-conflict",
    });
    checkpointSpy.mockRestore();

    const graphSpy = vi.spyOn(persistence, "loadDomainGraph").mockResolvedValue({
      ...graph,
      artifacts: graph.artifacts.map((artifact) => ({
        ...artifact,
        label: "Tampered projection label",
      })),
    });
    await expect(
      service.preview(
        intent.nativeConversationId,
        completed!.taskId,
        completed!.artifacts[0]!.artifactId,
      ),
    ).rejects.toMatchObject({
      code: "task-conflict",
    });
    graphSpy.mockRestore();
  });

  it("reads the reserved workspace file privately and previews its create-only artifact", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "actestra-aionui-journey-service-test-"),
    );
    testDirectories.push(directory);
    const persistence = (await openTestPersistenceUtility(directory)).client;
    persistenceClients.push(persistence);
    const workspaceRoot = path.join(directory, "workspace");
    fs.mkdirSync(workspaceRoot);
    const sourceText = "Private representative workspace source.\nSecond line.\n";
    fs.writeFileSync(path.join(workspaceRoot, "actestra-input.txt"), sourceText);
    const clock = new DeterministicAgentClock(instant("2026-07-30T06:47:00.000Z"));
    const nativeTools = createScopedNativeToolPlatform({ persistence, clock });
    let workerEventSequence = 0;
    const service = new AionUiGeneralWorkJourneyService({
      persistence,
      nativeTools,
      clock,
      nativeContext: {
        resolve: async () => ({
          rootPath: fs.realpathSync(workspaceRoot),
          displayName: "AionUI representative file workspace",
        }),
      },
      launchWorker: async ({ requestId, readRequestId }) => {
        const requestIds = [readRequestId, requestId];
        let requestIndex = 0;
        return (
          await openTestGeneralWorker(clock, {
            executionMode: "workspace-read-then-task-output-write-fixture",
            newAttemptToken: () => "attempt-aionui-representative-file-1",
            newToolRequestId: () => requestIds[requestIndex++]!,
            newEventId: () =>
              eventId(`event-aionui-representative-file-${String(++workerEventSequence)}`),
          })
        ).adapter;
      },
    });
    const intent = {
      contractVersion: 1,
      nativeConversationId: "conversation-native-representative-file-1",
      submissionId: "submission-native-representative-file-1",
      prompt: "Turn the reserved workspace text into a reviewable Markdown artifact.",
      journeyKind: "workspace-file-artifact",
    } as const;

    await expect(service.submit(intent)).resolves.toMatchObject({
      status: "blocked",
      canCancel: true,
      artifacts: [],
    });
    await service.waitForIdle();

    const [completed] = await service.list(intent.nativeConversationId);
    expect(completed).toMatchObject({
      status: "completed",
      canCancel: false,
      artifacts: [
        {
          kind: "file",
          label: "Actestra file result",
          state: "available",
        },
      ],
    });
    if (completed === undefined || completed.artifacts[0] === undefined) {
      throw new Error("Expected the representative file journey artifact");
    }
    const outputPath = path.join(
      workspaceRoot,
      ".actestra",
      "task-output",
      completed.taskId,
      "result.md",
    );
    expect(fs.readFileSync(outputPath, "utf8")).toContain(sourceText);
    await expect(
      service.preview(
        intent.nativeConversationId,
        completed.taskId,
        completed.artifacts[0].artifactId,
      ),
    ).resolves.toMatchObject({
      label: "Actestra file result",
      mediaType: "text/markdown; charset=utf-8",
      content: expect.stringContaining(sourceText),
    });

    const links = await persistence.listAionUiGeneralWorkJourneyLinks(
      hashAionUiGeneralWorkConversation(intent.nativeConversationId),
      10,
    );
    expect(links).toEqual([
      expect.objectContaining({
        taskId: completed.taskId,
        journeyKind: "workspace-file-artifact",
      }),
    ]);
    const graph = await persistence.loadDomainGraph();
    const checkpoint = await persistence.getGeneralWorkCheckpoint(graph.sessions[0]!.id);
    expect(checkpoint?.events.filter(({ type }) => type === "tool.requested")).toHaveLength(2);
    const serializedEvents = JSON.stringify(checkpoint?.events);
    for (const sourceLine of sourceText.split(/\r?\n/u).filter((line) => line.length > 0)) {
      expect(serializedEvents).not.toContain(sourceLine);
    }
  });

  it("creates a local research brief from one main-owned source", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "actestra-aionui-journey-service-test-"),
    );
    testDirectories.push(directory);
    const persistence = (await openTestPersistenceUtility(directory)).client;
    persistenceClients.push(persistence);
    const workspaceRoot = path.join(directory, "workspace");
    fs.mkdirSync(workspaceRoot);
    const sourceText = "Alpha evidence\nBeta evidence\n";
    fs.writeFileSync(path.join(workspaceRoot, "actestra-research.txt"), sourceText);
    const clock = new DeterministicAgentClock(instant("2026-07-30T06:47:30.000Z"));
    const nativeTools = createScopedNativeToolPlatform({ persistence, clock });
    let workerEventSequence = 0;
    const service = new AionUiGeneralWorkJourneyService({
      persistence,
      nativeTools,
      clock,
      nativeContext: {
        resolve: async () => ({
          rootPath: fs.realpathSync(workspaceRoot),
          displayName: "AionUI local research workspace",
        }),
      },
      launchWorker: async ({ journeyKind, requestId, readRequestId }) => {
        expect(journeyKind).toBe("local-research-artifact");
        const requestIds = [readRequestId, requestId];
        let requestIndex = 0;
        return (
          await openTestGeneralWorker(clock, {
            executionMode: "local-research-artifact-fixture",
            newAttemptToken: () => "attempt-aionui-local-research-1",
            newToolRequestId: () => requestIds[requestIndex++]!,
            newEventId: () =>
              eventId(`event-aionui-local-research-${String(++workerEventSequence)}`),
          })
        ).adapter;
      },
    });
    const intent = {
      contractVersion: 1,
      nativeConversationId: "conversation-native-local-research-1",
      submissionId: "submission-native-local-research-1",
      prompt: "Compare the approved local source notes.",
      journeyKind: "local-research-artifact",
    } as const;

    await expect(service.submit(intent)).resolves.toMatchObject({
      status: "blocked",
      canCancel: true,
      artifacts: [],
    });
    await service.waitForIdle();

    const [completed] = await service.list(intent.nativeConversationId);
    expect(completed).toMatchObject({
      status: "completed",
      canCancel: false,
      artifacts: [
        {
          kind: "file",
          label: "Actestra local research brief",
          state: "available",
        },
      ],
    });
    if (completed === undefined || completed.artifacts[0] === undefined) {
      throw new Error("Expected the local research journey artifact");
    }
    const outputPath = path.join(
      workspaceRoot,
      ".actestra",
      "task-output",
      completed.taskId,
      "research.md",
    );
    expect(fs.readFileSync(outputPath, "utf8")).toBe(
      "# Actestra local research brief\n\n" +
        "Instruction: Compare the approved local source notes.\n\n" +
        "## Evidence notes\n\n" +
        "- Alpha evidence\n" +
        "- Beta evidence\n",
    );
    await expect(
      service.preview(
        intent.nativeConversationId,
        completed.taskId,
        completed.artifacts[0].artifactId,
      ),
    ).resolves.toMatchObject({
      label: "Actestra local research brief",
      mediaType: "text/markdown; charset=utf-8",
      content: expect.stringContaining("## Evidence notes"),
    });

    const links = await persistence.listAionUiGeneralWorkJourneyLinks(
      hashAionUiGeneralWorkConversation(intent.nativeConversationId),
      10,
    );
    expect(links).toEqual([
      expect.objectContaining({
        taskId: completed.taskId,
        journeyKind: "local-research-artifact",
      }),
    ]);
    const graph = await persistence.loadDomainGraph();
    const checkpoint = await persistence.getGeneralWorkCheckpoint(graph.sessions[0]!.id);
    expect(checkpoint?.events.filter(({ type }) => type === "tool.requested")).toHaveLength(2);
    const serializedEvents = JSON.stringify(checkpoint?.events);
    for (const sourceLine of sourceText.split(/\r?\n/u).filter((line) => line.length > 0)) {
      expect(serializedEvents).not.toContain(sourceLine);
    }
  });

  it("prepares writing from the persisted brief without placeholder tool input authority", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "actestra-aionui-journey-service-test-"),
    );
    testDirectories.push(directory);
    const persistence = (await openTestPersistenceUtility(directory)).client;
    persistenceClients.push(persistence);
    const workspaceRoot = path.join(directory, "workspace");
    fs.mkdirSync(workspaceRoot);
    const clock = new DeterministicAgentClock(instant("2026-07-30T06:48:30.000Z"));
    const nativeTools = createScopedNativeToolPlatform({ persistence, clock });
    const intent = {
      contractVersion: 1,
      nativeConversationId: "conversation-native-writing-prepared-1",
      submissionId: "submission-native-writing-prepared-1",
      journeyKind: "writing-artifact",
      prompt: [
        "Title: Quarterly launch note",
        "Audience: Product leadership",
        "Purpose: Explain the approved launch sequence.",
        "Point: Start with the verified customer outcome.",
        "Point: Close with the bounded next step.",
      ].join("\n"),
    } as const;
    const service = new AionUiGeneralWorkJourneyService({
      persistence,
      nativeTools,
      clock,
      nativeContext: {
        resolve: async () => ({
          rootPath: fs.realpathSync(workspaceRoot),
          displayName: "AionUI writing workspace",
        }),
      },
      launchWorker: async ({ journeyKind }) => {
        expect(journeyKind).toBe("writing-artifact");
        throw new Error("fixture restart before writing Worker launch");
      },
    });

    await expect(service.submit(intent)).rejects.toThrow(/fixture restart/u);
    await expect(persistence.listPreparedAionUiGeneralWorkJourneyLinks(10)).resolves.toEqual([
      expect.objectContaining({
        journeyKind: "writing-artifact",
      }),
    ]);
    const graph = await persistence.loadDomainGraph();
    expect(graph).toMatchObject({
      tasks: [{ state: "ready" }],
      sessions: [{ state: "created" }],
      workers: [{ state: "created" }],
      artifacts: [],
    });
  });

  it("persists the Worker-authored draft before creating a document Artifact and Preview", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "actestra-aionui-journey-service-test-"),
    );
    testDirectories.push(directory);
    const persistence = (await openTestPersistenceUtility(directory)).client;
    persistenceClients.push(persistence);
    const workspaceRoot = path.join(directory, "workspace");
    fs.mkdirSync(workspaceRoot);
    const clock = new DeterministicAgentClock(instant("2026-07-30T06:48:40.000Z"));
    const nativeTools = createScopedNativeToolPlatform({ persistence, clock });
    let workerEventSequence = 0;
    const service = new AionUiGeneralWorkJourneyService({
      persistence,
      nativeTools,
      clock,
      nativeContext: {
        resolve: async () => ({
          rootPath: fs.realpathSync(workspaceRoot),
          displayName: "AionUI writing workspace",
        }),
      },
      launchWorker: async ({ journeyKind, requestId }) => {
        expect(journeyKind).toBe("writing-artifact");
        return (
          await openTestGeneralWorker(clock, {
            executionMode: "writing-artifact-fixture",
            newAttemptToken: () => "attempt-aionui-writing-1",
            newToolRequestId: () => requestId,
            newEventId: () => eventId(`event-aionui-writing-${String(++workerEventSequence)}`),
          })
        ).adapter;
      },
    });
    const intent = {
      contractVersion: 1,
      nativeConversationId: "conversation-native-writing-1",
      submissionId: "submission-native-writing-1",
      journeyKind: "writing-artifact",
      prompt: [
        "Title: Quarterly launch note",
        "Audience: Product leadership",
        "Purpose: Explain the approved launch sequence.",
        "Point: Start with the verified customer outcome.",
        "Point: Close with the bounded next step.",
      ].join("\n"),
    } as const;

    await expect(service.submit(intent)).resolves.toMatchObject({
      status: "blocked",
      title: "Quarterly launch note",
      canCancel: true,
    });
    await service.waitForIdle();

    const [completed] = await service.list(intent.nativeConversationId);
    expect(completed).toMatchObject({
      status: "completed",
      canCancel: false,
      artifacts: [
        expect.objectContaining({
          kind: "document",
          label: "Actestra writing draft",
          state: "available",
        }),
      ],
    });
    if (completed === undefined || completed.artifacts[0] === undefined) {
      throw new Error("Expected the completed writing journey");
    }
    const expectedDraft =
      "# Quarterly launch note\n\n" +
      "Audience: Product leadership\n\n" +
      "Explain the approved launch sequence.\n\n" +
      "Start with the verified customer outcome.\n\n" +
      "Close with the bounded next step.\n";
    expect(
      fs.readFileSync(
        path.join(workspaceRoot, ".actestra", "task-output", completed.taskId, "draft.md"),
        "utf8",
      ),
    ).toBe(expectedDraft);
    await expect(
      service.preview(
        intent.nativeConversationId,
        completed.taskId,
        completed.artifacts[0].artifactId,
      ),
    ).resolves.toEqual({
      contractVersion: 1,
      taskId: completed.taskId,
      artifactId: completed.artifacts[0].artifactId,
      label: "Actestra writing draft",
      mediaType: "text/markdown; charset=utf-8",
      content: expectedDraft,
    });
    const graph = await persistence.loadDomainGraph();
    const checkpoint = await persistence.getGeneralWorkCheckpoint(graph.sessions[0]!.id);
    expect(checkpoint).toMatchObject({
      phase: "finalized",
      attempt: {
        state: "completed",
        taskState: "completed",
        disposed: true,
      },
      artifactBinding: {
        artifact: {
          kind: "document",
          label: "Actestra writing draft",
        },
      },
    });
    expect(checkpoint?.events.filter(({ type }) => type === "tool.requested")).toHaveLength(1);
    expect(JSON.stringify(checkpoint?.events)).not.toContain("draft.md");
    expect(JSON.stringify(checkpoint?.events)).not.toContain("# Quarterly launch note");
  });

  it("persists the Worker-authored Office model before creating a DOCX and bounded Preview", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "actestra-aionui-journey-service-test-"),
    );
    testDirectories.push(directory);
    const persistence = (await openTestPersistenceUtility(directory)).client;
    persistenceClients.push(persistence);
    const workspaceRoot = path.join(directory, "workspace");
    fs.mkdirSync(workspaceRoot);
    const clock = new DeterministicAgentClock(instant("2026-07-30T06:48:50.000Z"));
    const nativeTools = createScopedNativeToolPlatform({ persistence, clock });
    let workerEventSequence = 0;
    const service = new AionUiGeneralWorkJourneyService({
      persistence,
      nativeTools,
      clock,
      nativeContext: {
        resolve: async () => ({
          rootPath: fs.realpathSync(workspaceRoot),
          displayName: "AionUI Office document workspace",
        }),
      },
      launchWorker: async ({ journeyKind, requestId }) => {
        expect(journeyKind).toBe("office-document-artifact");
        return (
          await openTestGeneralWorker(clock, {
            executionMode: "office-document-artifact-fixture",
            newAttemptToken: () => "attempt-aionui-office-document-1",
            newToolRequestId: () => requestId,
            newEventId: () =>
              eventId(`event-aionui-office-document-${String(++workerEventSequence)}`),
          })
        ).adapter;
      },
    });
    const document = {
      contractVersion: 1,
      title: "Quarterly operating brief",
      owner: "Product operations",
      summary: "Record the approved launch decision in a portable Word document.",
      sections: [
        { heading: "Decision", body: "Ship the verified desktop workflow." },
        { heading: "Evidence", body: "Include the exact acceptance boundary." },
      ],
    } as const;
    const intent = {
      contractVersion: 1,
      nativeConversationId: "conversation-native-office-document-1",
      submissionId: "submission-native-office-document-1",
      journeyKind: "office-document-artifact",
      prompt: [
        `Document: ${document.title}`,
        `Owner: ${document.owner}`,
        `Summary: ${document.summary}`,
        ...document.sections.map(({ heading, body }) => `Section: ${heading} | ${body}`),
      ].join("\n"),
    } as const;

    await expect(service.submit(intent)).resolves.toMatchObject({
      status: "blocked",
      title: document.title,
      canCancel: true,
    });
    await service.waitForIdle();

    const [completed] = await service.list(intent.nativeConversationId);
    expect(completed).toMatchObject({
      status: "completed",
      canCancel: false,
      artifacts: [
        expect.objectContaining({
          kind: "document",
          label: "Actestra Office document",
          state: "available",
        }),
      ],
    });
    if (completed === undefined || completed.artifacts[0] === undefined) {
      throw new Error("Expected the completed Office-document journey");
    }
    const output = fs.readFileSync(
      path.join(workspaceRoot, ".actestra", "task-output", completed.taskId, "brief.docx"),
    );
    expect(output.subarray(0, 2).toString("ascii")).toBe("PK");
    await expect(
      service.preview(
        intent.nativeConversationId,
        completed.taskId,
        completed.artifacts[0].artifactId,
      ),
    ).resolves.toEqual({
      contractVersion: 1,
      taskId: completed.taskId,
      artifactId: completed.artifacts[0].artifactId,
      label: "Actestra Office document",
      mediaType: "application/vnd.actestra.office-document-preview+json",
      document,
    });
    const graph = await persistence.loadDomainGraph();
    const checkpoint = await persistence.getGeneralWorkCheckpoint(graph.sessions[0]!.id);
    expect(checkpoint).toMatchObject({
      phase: "finalized",
      attempt: {
        state: "completed",
        taskState: "completed",
        disposed: true,
      },
      artifactBinding: {
        artifact: {
          kind: "document",
          label: "Actestra Office document",
        },
      },
    });
    expect(checkpoint?.events.filter(({ type }) => type === "tool.requested")).toHaveLength(1);
    const serializedEvents = JSON.stringify(checkpoint?.events);
    for (const privateValue of [
      document.owner,
      document.summary,
      ...document.sections.flatMap(({ heading, body }) => [heading, body]),
    ]) {
      expect(serializedEvents).not.toContain(privateValue);
    }
  });

  it("fails an oversized representative file before Worker transport without leaking content", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "actestra-aionui-journey-service-test-"),
    );
    testDirectories.push(directory);
    const persistence = (await openTestPersistenceUtility(directory)).client;
    persistenceClients.push(persistence);
    const workspaceRoot = path.join(directory, "workspace");
    fs.mkdirSync(workspaceRoot);
    const sourceText = "x".repeat(MAX_GENERAL_WORKER_SEND_CONTENT_BYTES + 1);
    fs.writeFileSync(path.join(workspaceRoot, "actestra-input.txt"), sourceText);
    const clock = new DeterministicAgentClock(instant("2026-07-30T06:48:00.000Z"));
    const nativeTools = createScopedNativeToolPlatform({ persistence, clock });
    let workerEventSequence = 0;
    const service = new AionUiGeneralWorkJourneyService({
      persistence,
      nativeTools,
      clock,
      nativeContext: {
        resolve: async () => ({
          rootPath: fs.realpathSync(workspaceRoot),
          displayName: "AionUI oversized representative file workspace",
        }),
      },
      launchWorker: async ({ requestId, readRequestId }) => {
        const requestIds = [readRequestId, requestId];
        let requestIndex = 0;
        return (
          await openTestGeneralWorker(clock, {
            executionMode: "workspace-read-then-task-output-write-fixture",
            newAttemptToken: () => "attempt-aionui-representative-file-oversized",
            newToolRequestId: () => requestIds[requestIndex++]!,
            newEventId: () =>
              eventId(
                `event-aionui-representative-file-oversized-${String(++workerEventSequence)}`,
              ),
          })
        ).adapter;
      },
    });
    const intent = {
      contractVersion: 1,
      nativeConversationId: "conversation-native-representative-file-oversized",
      submissionId: "submission-native-representative-file-oversized",
      prompt: "Process only a file that fits the bounded Worker transport.",
      journeyKind: "workspace-file-artifact",
    } as const;

    await expect(service.submit(intent)).resolves.toMatchObject({
      status: "blocked",
      canCancel: true,
    });
    await service.waitForIdle();

    await expect(service.list(intent.nativeConversationId)).resolves.toEqual([
      expect.objectContaining({
        status: "failed",
        incidentCode: "content-too-large",
        canCancel: false,
        artifacts: [],
      }),
    ]);
    const graph = await persistence.loadDomainGraph();
    const checkpoint = await persistence.getGeneralWorkCheckpoint(graph.sessions[0]!.id);
    expect(checkpoint).toMatchObject({
      phase: "finalized",
      tool: {
        state: "failed",
        errorCode: "content-too-large",
        mayHaveExecuted: false,
      },
      attempt: {
        state: "failed",
        taskState: "failed",
      },
    });
    expect(checkpoint?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool.failed",
          payload: expect.objectContaining({ errorCode: "content-too-large" }),
        }),
        expect.objectContaining({
          type: "task.failed",
          payload: expect.objectContaining({ errorCode: "content-too-large" }),
        }),
      ]),
    );
    expect(checkpoint?.events.some(({ type }) => type === "task.cancelled")).toBe(false);
    expect(JSON.stringify(checkpoint?.events)).not.toContain(sourceText.slice(0, 1_024));
  });

  it("fails a file journey against its active read request when the grant is revoked", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "actestra-aionui-journey-service-test-"),
    );
    testDirectories.push(directory);
    const persistence = (await openTestPersistenceUtility(directory)).client;
    persistenceClients.push(persistence);
    const workspaceRoot = path.join(directory, "workspace");
    fs.mkdirSync(workspaceRoot);
    fs.writeFileSync(
      path.join(workspaceRoot, "actestra-input.txt"),
      "Authorized only before launch",
    );
    const clock = new DeterministicAgentClock(instant("2026-07-30T06:49:00.000Z"));
    const nativeTools = createScopedNativeToolPlatform({ persistence, clock });
    const service = new AionUiGeneralWorkJourneyService({
      persistence,
      nativeTools,
      clock,
      nativeContext: {
        resolve: async () => ({
          rootPath: fs.realpathSync(workspaceRoot),
          displayName: "AionUI revoked file workspace",
        }),
      },
      launchWorker: async ({ requestId, readRequestId }) => {
        const graph = await persistence.loadDomainGraph();
        const grant = await persistence.getActiveWorkspaceGrant(graph.tasks[0]!.workspaceId);
        if (grant === null) {
          throw new Error("Expected the registered file-journey grant");
        }
        await persistence.persistWorkspaceGrant({
          ...grant,
          state: "revoked",
          updatedAt: clock.now(),
        });
        const requestIds = [readRequestId, requestId];
        let requestIndex = 0;
        return (
          await openTestGeneralWorker(clock, {
            executionMode: "workspace-read-then-task-output-write-fixture",
            newAttemptToken: () => "attempt-aionui-representative-file-revoked",
            newToolRequestId: () => requestIds[requestIndex++]!,
          })
        ).adapter;
      },
    });
    const intent = {
      contractVersion: 1,
      nativeConversationId: "conversation-native-representative-file-revoked",
      submissionId: "submission-native-representative-file-revoked",
      prompt: "Fail closed when the prepared workspace grant is no longer active.",
      journeyKind: "workspace-file-artifact",
    } as const;

    await expect(service.submit(intent)).resolves.toMatchObject({
      status: "blocked",
      canCancel: true,
    });
    await service.waitForIdle();

    await expect(service.list(intent.nativeConversationId)).resolves.toEqual([
      expect.objectContaining({
        status: "failed",
        incidentCode: "workspace-grant-unavailable",
        canCancel: false,
        artifacts: [],
      }),
    ]);
    const graph = await persistence.loadDomainGraph();
    const checkpoint = await persistence.getGeneralWorkCheckpoint(graph.sessions[0]!.id);
    expect(checkpoint).toMatchObject({
      phase: "finalized",
      attempt: {
        state: "failed",
        taskState: "failed",
      },
    });
    expect(checkpoint?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "task.failed",
          payload: expect.objectContaining({ errorCode: "workspace-grant-unavailable" }),
        }),
      ]),
    );
  });

  it("cancels only the active task owned by the native conversation", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "actestra-aionui-journey-service-test-"),
    );
    testDirectories.push(directory);
    const persistence = (await openTestPersistenceUtility(directory)).client;
    persistenceClients.push(persistence);
    const workspaceRoot = path.join(directory, "workspace");
    fs.mkdirSync(workspaceRoot);
    const clock = new DeterministicAgentClock(instant("2026-07-30T06:50:00.000Z"));
    const nativeTools = createScopedNativeToolPlatform({ persistence, clock });
    let transport: LoopbackGeneralWorkerTransport | undefined;
    const service = new AionUiGeneralWorkJourneyService({
      persistence,
      nativeTools,
      clock,
      nativeContext: {
        resolve: async () => ({
          rootPath: fs.realpathSync(workspaceRoot),
          displayName: "AionUI cancellation workspace",
        }),
      },
      launchWorker: async () => {
        const opened = await openTestGeneralWorker(clock, {
          executionMode: "hold",
          newAttemptToken: () => "attempt-aionui-cancel-1",
        });
        transport = opened.transport;
        return opened.adapter;
      },
    });
    const intent = {
      contractVersion: 1,
      nativeConversationId: "conversation-native-cancel-1",
      submissionId: "submission-native-cancel-1",
      prompt: "Keep this bounded task active until it is cancelled.",
    } as const;
    const running = await service.submit(intent);

    await expect(
      service.cancel("conversation-native-other", running.taskId, "User stopped the task."),
    ).rejects.toThrow(/does not own/u);
    const cancelled = await service.cancel(
      intent.nativeConversationId,
      running.taskId,
      "User stopped the task.",
    );

    expect(cancelled).toMatchObject({
      taskId: running.taskId,
      status: "cancelled",
      canCancel: false,
    });
    expect(transport?.killCount).toBe(1);
    await expect(service.list(intent.nativeConversationId)).resolves.toEqual([cancelled]);

    const graph = await persistence.loadDomainGraph();
    expect(graph.tasks).toEqual([
      expect.objectContaining({
        id: running.taskId,
        state: "cancelled",
        activeSessionId: undefined,
      }),
    ]);
    const checkpoint = await persistence.getGeneralWorkCheckpoint(graph.sessions[0]!.id);
    expect(checkpoint).toMatchObject({
      phase: "finalized",
      attempt: {
        state: "cancelled",
        taskState: "cancelled",
        disposed: true,
      },
    });
    expect(checkpoint?.events.map(({ type }) => type)).toContain("task.cancelled");
  });

  it("resumes an atomically prepared journey after restart without native path replay", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "actestra-aionui-journey-service-test-"),
    );
    testDirectories.push(directory);
    const workspaceRoot = path.join(directory, "workspace");
    fs.mkdirSync(workspaceRoot);
    const persistence = (await openTestPersistenceUtility(directory)).client;
    persistenceClients.push(persistence);
    const clock = new DeterministicAgentClock(instant("2026-07-30T06:55:00.000Z"));
    const nativeTools = createScopedNativeToolPlatform({ persistence, clock });
    const intent = {
      contractVersion: 1,
      nativeConversationId: "conversation-native-restart-1",
      submissionId: "submission-native-restart-1",
      prompt: "Create a restart-safe bounded artifact.",
    } as const;
    const interrupted = new AionUiGeneralWorkJourneyService({
      persistence,
      nativeTools,
      clock,
      nativeContext: {
        resolve: async () => ({
          rootPath: fs.realpathSync(workspaceRoot),
          displayName: "AionUI restart workspace",
        }),
      },
      launchWorker: async () => {
        throw new Error("fixture restart before Worker launch");
      },
    });

    await expect(interrupted.submit(intent)).rejects.toThrow(/fixture restart/u);
    await expect(persistence.listPreparedAionUiGeneralWorkJourneyLinks(10)).resolves.toHaveLength(
      1,
    );

    const preparedGraph = await persistence.loadDomainGraph();
    await persistence.replaceDomainGraph({
      ...preparedGraph,
      workers: preparedGraph.workers.map((worker) => ({
        ...worker,
        adapterKind: "unknown.general-worker.v99",
      })),
    });
    let incompatibleLaunchCount = 0;
    const incompatible = new AionUiGeneralWorkJourneyService({
      persistence,
      nativeTools,
      clock,
      nativeContext: {
        resolve: async () => {
          throw new Error("recovery must not replay native workspace context");
        },
      },
      launchWorker: async () => {
        incompatibleLaunchCount += 1;
        throw new Error("an incompatible prepared Worker must not launch");
      },
    });
    await expect(incompatible.recoverPrepared()).resolves.toEqual({
      attempted: 1,
      started: 0,
      failed: 1,
    });
    expect(incompatibleLaunchCount).toBe(0);
    await expect(incompatible.list(intent.nativeConversationId)).resolves.toEqual([
      expect.objectContaining({
        status: "ready",
        canCancel: false,
      }),
    ]);
    await persistence.replaceDomainGraph(preparedGraph);

    let nativeContextReplayCount = 0;
    const recovered = new AionUiGeneralWorkJourneyService({
      persistence,
      nativeTools,
      clock,
      nativeContext: {
        resolve: async () => {
          nativeContextReplayCount += 1;
          throw new Error("recovery must not replay native workspace context");
        },
      },
      launchWorker: async ({ requestId }) =>
        (
          await openTestGeneralWorker(clock, {
            executionMode: "task-output-write-text-fixture",
            newAttemptToken: () => "attempt-aionui-restart-1",
            newToolRequestId: () => requestId,
          })
        ).adapter,
    });

    await expect(recovered.recoverPrepared()).resolves.toEqual({
      attempted: 1,
      started: 1,
      failed: 0,
    });
    await recovered.waitForIdle();
    expect(nativeContextReplayCount).toBe(0);
    await expect(recovered.list(intent.nativeConversationId)).resolves.toEqual([
      expect.objectContaining({
        status: "completed",
        canCancel: false,
        artifacts: [expect.objectContaining({ label: "Actestra result" })],
      }),
    ]);
  });

  it("recovers a prepared file journey from its durable kind through both scoped tools", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "actestra-aionui-journey-service-test-"),
    );
    testDirectories.push(directory);
    const workspaceRoot = path.join(directory, "workspace");
    fs.mkdirSync(workspaceRoot);
    const sourceText = "Private restart-safe file journey source.\n";
    fs.writeFileSync(path.join(workspaceRoot, "actestra-input.txt"), sourceText);
    const persistence = (await openTestPersistenceUtility(directory)).client;
    persistenceClients.push(persistence);
    const clock = new DeterministicAgentClock(instant("2026-07-30T06:57:00.000Z"));
    const nativeTools = createScopedNativeToolPlatform({ persistence, clock });
    const intent = {
      contractVersion: 1,
      nativeConversationId: "conversation-native-file-restart-1",
      submissionId: "submission-native-file-restart-1",
      prompt: "Recover the reserved workspace file into a Markdown artifact.",
      journeyKind: "workspace-file-artifact",
    } as const;
    const interrupted = new AionUiGeneralWorkJourneyService({
      persistence,
      nativeTools,
      clock,
      nativeContext: {
        resolve: async () => ({
          rootPath: fs.realpathSync(workspaceRoot),
          displayName: "AionUI file restart workspace",
        }),
      },
      launchWorker: async () => {
        throw new Error("fixture restart before file Worker launch");
      },
    });

    await expect(interrupted.submit(intent)).rejects.toThrow(/fixture restart/u);
    await expect(persistence.listPreparedAionUiGeneralWorkJourneyLinks(10)).resolves.toEqual([
      expect.objectContaining({
        journeyKind: "workspace-file-artifact",
      }),
    ]);

    let nativeContextReplayCount = 0;
    let workerEventSequence = 0;
    const recovered = new AionUiGeneralWorkJourneyService({
      persistence,
      nativeTools,
      clock,
      nativeContext: {
        resolve: async () => {
          nativeContextReplayCount += 1;
          throw new Error("file recovery must not replay native workspace context");
        },
      },
      launchWorker: async ({ journeyKind, requestId, readRequestId }) => {
        expect(journeyKind).toBe("workspace-file-artifact");
        const requestIds = [readRequestId, requestId];
        let requestIndex = 0;
        return (
          await openTestGeneralWorker(clock, {
            executionMode: "workspace-read-then-task-output-write-fixture",
            newAttemptToken: () => "attempt-aionui-file-restart-1",
            newToolRequestId: () => requestIds[requestIndex++]!,
            newEventId: () => eventId(`event-aionui-file-restart-${String(++workerEventSequence)}`),
          })
        ).adapter;
      },
    });

    await expect(recovered.recoverPrepared()).resolves.toEqual({
      attempted: 1,
      started: 1,
      failed: 0,
    });
    await recovered.waitForIdle();
    expect(nativeContextReplayCount).toBe(0);
    const [completed] = await recovered.list(intent.nativeConversationId);
    expect(completed).toMatchObject({
      status: "completed",
      canCancel: false,
      artifacts: [expect.objectContaining({ label: "Actestra file result" })],
    });
    if (completed === undefined) {
      throw new Error("Expected the recovered file journey");
    }
    expect(
      fs.readFileSync(
        path.join(workspaceRoot, ".actestra", "task-output", completed.taskId, "result.md"),
        "utf8",
      ),
    ).toContain(sourceText);
    const graph = await persistence.loadDomainGraph();
    const checkpoint = await persistence.getGeneralWorkCheckpoint(graph.sessions[0]!.id);
    expect(checkpoint?.events.filter(({ type }) => type === "tool.requested")).toHaveLength(2);
  });

  it("reopens persistence and recovers a prepared local-research journey without native replay", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "actestra-aionui-journey-service-test-"),
    );
    testDirectories.push(directory);
    const workspaceRoot = path.join(directory, "workspace");
    fs.mkdirSync(workspaceRoot);
    const sourceText = "Restart alpha evidence\nRestart beta evidence\n";
    fs.writeFileSync(path.join(workspaceRoot, "actestra-research.txt"), sourceText);
    const firstPersistence = (await openTestPersistenceUtility(directory)).client;
    persistenceClients.push(firstPersistence);
    const clock = new DeterministicAgentClock(instant("2026-07-30T06:58:00.000Z"));
    const firstNativeTools = createScopedNativeToolPlatform({
      persistence: firstPersistence,
      clock,
    });
    const intent = {
      contractVersion: 1,
      nativeConversationId: "conversation-native-local-research-restart-1",
      submissionId: "submission-native-local-research-restart-1",
      prompt: "Recover the approved local source notes into a research brief.",
      journeyKind: "local-research-artifact",
    } as const;
    const interrupted = new AionUiGeneralWorkJourneyService({
      persistence: firstPersistence,
      nativeTools: firstNativeTools,
      clock,
      nativeContext: {
        resolve: async () => ({
          rootPath: fs.realpathSync(workspaceRoot),
          displayName: "AionUI local research restart workspace",
        }),
      },
      launchWorker: async () => {
        throw new Error("fixture restart before local research Worker launch");
      },
    });

    await expect(interrupted.submit(intent)).rejects.toThrow(/fixture restart/u);
    await expect(firstPersistence.listPreparedAionUiGeneralWorkJourneyLinks(10)).resolves.toEqual([
      expect.objectContaining({
        journeyKind: "local-research-artifact",
      }),
    ]);
    await firstPersistence.close();
    persistenceClients.splice(persistenceClients.indexOf(firstPersistence), 1);

    const reopenedPersistence = (await openTestPersistenceUtility(directory)).client;
    persistenceClients.push(reopenedPersistence);
    const reopenedNativeTools = createScopedNativeToolPlatform({
      persistence: reopenedPersistence,
      clock,
    });
    let nativeContextReplayCount = 0;
    let workerEventSequence = 0;
    const recovered = new AionUiGeneralWorkJourneyService({
      persistence: reopenedPersistence,
      nativeTools: reopenedNativeTools,
      clock,
      nativeContext: {
        resolve: async () => {
          nativeContextReplayCount += 1;
          throw new Error("local research recovery must not replay native workspace context");
        },
      },
      launchWorker: async ({ journeyKind, requestId, readRequestId }) => {
        expect(journeyKind).toBe("local-research-artifact");
        const requestIds = [readRequestId, requestId];
        let requestIndex = 0;
        return (
          await openTestGeneralWorker(clock, {
            executionMode: "local-research-artifact-fixture",
            newAttemptToken: () => "attempt-aionui-local-research-restart-1",
            newToolRequestId: () => requestIds[requestIndex++]!,
            newEventId: () =>
              eventId(`event-aionui-local-research-restart-${String(++workerEventSequence)}`),
          })
        ).adapter;
      },
    });

    await expect(recovered.recoverPrepared()).resolves.toEqual({
      attempted: 1,
      started: 1,
      failed: 0,
    });
    await recovered.waitForIdle();
    expect(nativeContextReplayCount).toBe(0);
    const [completed] = await recovered.list(intent.nativeConversationId);
    expect(completed).toMatchObject({
      status: "completed",
      canCancel: false,
      artifacts: [
        expect.objectContaining({
          kind: "file",
          label: "Actestra local research brief",
          state: "available",
        }),
      ],
    });
    if (completed === undefined || completed.artifacts[0] === undefined) {
      throw new Error("Expected the recovered local research journey");
    }
    const outputPath = path.join(
      workspaceRoot,
      ".actestra",
      "task-output",
      completed.taskId,
      "research.md",
    );
    expect(fs.readFileSync(outputPath, "utf8")).toContain("- Restart alpha evidence");
    await expect(
      recovered.preview(
        intent.nativeConversationId,
        completed.taskId,
        completed.artifacts[0].artifactId,
      ),
    ).resolves.toMatchObject({
      label: "Actestra local research brief",
      content: expect.stringContaining("- Restart beta evidence"),
    });
    const graph = await reopenedPersistence.loadDomainGraph();
    const checkpoint = await reopenedPersistence.getGeneralWorkCheckpoint(graph.sessions[0]!.id);
    expect(checkpoint).toMatchObject({
      phase: "finalized",
      attempt: {
        state: "completed",
        disposed: true,
      },
    });
    expect(checkpoint?.events.filter(({ type }) => type === "tool.requested")).toHaveLength(2);
    const serializedEvents = JSON.stringify(checkpoint?.events);
    for (const sourceLine of sourceText.split(/\r?\n/u).filter((line) => line.length > 0)) {
      expect(serializedEvents).not.toContain(sourceLine);
    }
  });

  it("reopens persistence and recovers a prepared writing journey from its owned brief", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "actestra-aionui-journey-service-test-"),
    );
    testDirectories.push(directory);
    const workspaceRoot = path.join(directory, "workspace");
    fs.mkdirSync(workspaceRoot);
    const firstPersistence = (await openTestPersistenceUtility(directory)).client;
    persistenceClients.push(firstPersistence);
    const clock = new DeterministicAgentClock(instant("2026-07-30T06:58:30.000Z"));
    const firstNativeTools = createScopedNativeToolPlatform({
      persistence: firstPersistence,
      clock,
    });
    const intent = {
      contractVersion: 1,
      nativeConversationId: "conversation-native-writing-restart-1",
      submissionId: "submission-native-writing-restart-1",
      journeyKind: "writing-artifact",
      prompt: [
        "Title: Restart-safe launch note",
        "Audience: Product leadership",
        "Purpose: Explain the verified release sequence.",
        "Point: Preserve the approved opening.",
        "Point: End with the bounded next step.",
      ].join("\n"),
    } as const;
    const interrupted = new AionUiGeneralWorkJourneyService({
      persistence: firstPersistence,
      nativeTools: firstNativeTools,
      clock,
      nativeContext: {
        resolve: async () => ({
          rootPath: fs.realpathSync(workspaceRoot),
          displayName: "AionUI writing restart workspace",
        }),
      },
      launchWorker: async () => {
        throw new Error("fixture restart before writing Worker launch");
      },
    });

    await expect(interrupted.submit(intent)).rejects.toThrow(/fixture restart/u);
    await expect(firstPersistence.listPreparedAionUiGeneralWorkJourneyLinks(10)).resolves.toEqual([
      expect.objectContaining({ journeyKind: "writing-artifact" }),
    ]);
    await firstPersistence.close();
    persistenceClients.splice(persistenceClients.indexOf(firstPersistence), 1);

    const reopenedPersistence = (await openTestPersistenceUtility(directory)).client;
    persistenceClients.push(reopenedPersistence);
    const reopenedNativeTools = createScopedNativeToolPlatform({
      persistence: reopenedPersistence,
      clock,
    });
    let nativeContextReplayCount = 0;
    let workerEventSequence = 0;
    const recovered = new AionUiGeneralWorkJourneyService({
      persistence: reopenedPersistence,
      nativeTools: reopenedNativeTools,
      clock,
      nativeContext: {
        resolve: async () => {
          nativeContextReplayCount += 1;
          throw new Error("writing recovery must not replay native workspace context");
        },
      },
      launchWorker: async ({ journeyKind, requestId }) => {
        expect(journeyKind).toBe("writing-artifact");
        return (
          await openTestGeneralWorker(clock, {
            executionMode: "writing-artifact-fixture",
            newAttemptToken: () => "attempt-aionui-writing-restart-1",
            newToolRequestId: () => requestId,
            newEventId: () =>
              eventId(`event-aionui-writing-restart-${String(++workerEventSequence)}`),
          })
        ).adapter;
      },
    });

    await expect(recovered.recoverPrepared()).resolves.toEqual({
      attempted: 1,
      started: 1,
      failed: 0,
    });
    await recovered.waitForIdle();
    expect(nativeContextReplayCount).toBe(0);
    const [completed] = await recovered.list(intent.nativeConversationId);
    expect(completed).toMatchObject({
      status: "completed",
      artifacts: [
        expect.objectContaining({
          kind: "document",
          label: "Actestra writing draft",
        }),
      ],
    });
    if (completed === undefined) {
      throw new Error("Expected the recovered writing journey");
    }
    expect(
      fs.readFileSync(
        path.join(workspaceRoot, ".actestra", "task-output", completed.taskId, "draft.md"),
        "utf8",
      ),
    ).toContain("# Restart-safe launch note");
  });

  it("reopens persistence and recovers a prepared Office-document journey from its owned brief", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "actestra-aionui-journey-service-test-"),
    );
    testDirectories.push(directory);
    const workspaceRoot = path.join(directory, "workspace");
    fs.mkdirSync(workspaceRoot);
    const firstPersistence = (await openTestPersistenceUtility(directory)).client;
    persistenceClients.push(firstPersistence);
    const clock = new DeterministicAgentClock(instant("2026-07-30T06:59:00.000Z"));
    const firstNativeTools = createScopedNativeToolPlatform({
      persistence: firstPersistence,
      clock,
    });
    const document = {
      contractVersion: 1,
      title: "Restart-safe operating brief",
      owner: "Product operations",
      summary: "Record the verified Office recovery sequence.",
      sections: [
        { heading: "Recovery", body: "Resume from the persisted brief." },
        { heading: "Boundary", body: "Keep document authority in Actestra Core." },
      ],
    } as const;
    const intent = {
      contractVersion: 1,
      nativeConversationId: "conversation-native-office-restart-1",
      submissionId: "submission-native-office-restart-1",
      journeyKind: "office-document-artifact",
      prompt: [
        `Document: ${document.title}`,
        `Owner: ${document.owner}`,
        `Summary: ${document.summary}`,
        ...document.sections.map(({ heading, body }) => `Section: ${heading} | ${body}`),
      ].join("\n"),
    } as const;
    const interrupted = new AionUiGeneralWorkJourneyService({
      persistence: firstPersistence,
      nativeTools: firstNativeTools,
      clock,
      nativeContext: {
        resolve: async () => ({
          rootPath: fs.realpathSync(workspaceRoot),
          displayName: "AionUI Office restart workspace",
        }),
      },
      launchWorker: async () => {
        throw new Error("fixture restart before Office Worker launch");
      },
    });

    await expect(interrupted.submit(intent)).rejects.toThrow(/fixture restart/u);
    await expect(firstPersistence.listPreparedAionUiGeneralWorkJourneyLinks(10)).resolves.toEqual([
      expect.objectContaining({ journeyKind: "office-document-artifact" }),
    ]);
    await firstPersistence.close();
    persistenceClients.splice(persistenceClients.indexOf(firstPersistence), 1);

    const reopenedPersistence = (await openTestPersistenceUtility(directory)).client;
    persistenceClients.push(reopenedPersistence);
    const reopenedNativeTools = createScopedNativeToolPlatform({
      persistence: reopenedPersistence,
      clock,
    });
    let nativeContextReplayCount = 0;
    let workerEventSequence = 0;
    const recovered = new AionUiGeneralWorkJourneyService({
      persistence: reopenedPersistence,
      nativeTools: reopenedNativeTools,
      clock,
      nativeContext: {
        resolve: async () => {
          nativeContextReplayCount += 1;
          throw new Error("Office recovery must not replay native workspace context");
        },
      },
      launchWorker: async ({ journeyKind, requestId }) => {
        expect(journeyKind).toBe("office-document-artifact");
        return (
          await openTestGeneralWorker(clock, {
            executionMode: "office-document-artifact-fixture",
            newAttemptToken: () => "attempt-aionui-office-restart-1",
            newToolRequestId: () => requestId,
            newEventId: () =>
              eventId(`event-aionui-office-restart-${String(++workerEventSequence)}`),
          })
        ).adapter;
      },
    });

    await expect(recovered.recoverPrepared()).resolves.toEqual({
      attempted: 1,
      started: 1,
      failed: 0,
    });
    await recovered.waitForIdle();
    expect(nativeContextReplayCount).toBe(0);
    const [completed] = await recovered.list(intent.nativeConversationId);
    expect(completed).toMatchObject({
      status: "completed",
      artifacts: [
        expect.objectContaining({
          kind: "document",
          label: "Actestra Office document",
        }),
      ],
    });
    if (completed === undefined || completed.artifacts[0] === undefined) {
      throw new Error("Expected the recovered Office-document journey");
    }
    const packageBytes = fs.readFileSync(
      path.join(workspaceRoot, ".actestra", "task-output", completed.taskId, "brief.docx"),
    );
    expect(packageBytes.subarray(0, 2).toString("ascii")).toBe("PK");
    await expect(
      recovered.preview(
        intent.nativeConversationId,
        completed.taskId,
        completed.artifacts[0].artifactId,
      ),
    ).resolves.toMatchObject({
      label: "Actestra Office document",
      mediaType: "application/vnd.actestra.office-document-preview+json",
      document,
    });
  });

  it("surfaces grant denial and create-only conflicts as terminal evidence", async () => {
    for (const scenario of ["grant-denied", "artifact-conflict"] as const) {
      const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), "actestra-aionui-journey-service-test-"),
      );
      testDirectories.push(directory);
      const workspaceRoot = path.join(directory, "workspace");
      fs.mkdirSync(workspaceRoot);
      const persistence = (await openTestPersistenceUtility(directory)).client;
      persistenceClients.push(persistence);
      const clock = new DeterministicAgentClock(instant("2026-07-30T07:00:00.000Z"));
      const nativeTools = createScopedNativeToolPlatform({ persistence, clock });
      let transport: LoopbackGeneralWorkerTransport | undefined;
      const service = new AionUiGeneralWorkJourneyService({
        persistence,
        nativeTools,
        clock,
        nativeContext: {
          resolve: async () => ({
            rootPath: fs.realpathSync(workspaceRoot),
            displayName: `AionUI ${scenario} workspace`,
          }),
        },
        launchWorker: async ({ requestId }) => {
          const graph = await persistence.loadDomainGraph();
          const task = graph.tasks[0]!;
          if (scenario === "grant-denied") {
            const grant = await persistence.getActiveWorkspaceGrant(task.workspaceId);
            if (grant === null) {
              throw new Error("fixture grant is missing");
            }
            await persistence.persistWorkspaceGrant({
              ...grant,
              state: "revoked",
              updatedAt: clock.now(),
            });
          } else {
            const outputDirectory = path.join(workspaceRoot, ".actestra", "task-output", task.id);
            fs.mkdirSync(outputDirectory, { recursive: true });
            fs.writeFileSync(path.join(outputDirectory, "result.md"), "conflicting output");
          }
          const opened = await openTestGeneralWorker(clock, {
            executionMode: "task-output-write-text-fixture",
            newAttemptToken: () => `attempt-aionui-${scenario}`,
            newToolRequestId: () => requestId,
          });
          transport = opened.transport;
          return opened.adapter;
        },
      });
      const intent = {
        contractVersion: 1,
        nativeConversationId: `conversation-native-${scenario}`,
        submissionId: `submission-native-${scenario}`,
        prompt: `Exercise the ${scenario} terminal path.`,
      } as const;

      const blocked = await service.submit(intent);
      expect(blocked).toMatchObject({ status: "blocked", canCancel: true });
      await service.waitForIdle();
      await expect(service.list(intent.nativeConversationId)).resolves.toEqual([
        expect.objectContaining({
          taskId: blocked.taskId,
          status: "failed",
          canCancel: false,
          incidentCode: expect.any(String),
          artifacts: [],
        }),
      ]);
      expect(transport?.killCount).toBe(1);
    }
  });
});

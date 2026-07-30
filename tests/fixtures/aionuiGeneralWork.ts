import fs from "node:fs";
import {
  instant,
  sessionId,
  taskId,
  toolInputReference,
  toolRequestId,
  workerId,
  workspaceGrantId,
  workspaceId,
} from "../../apps/desktop/src/core";
import type { AionUiPromptArtifactRegistration } from "../../apps/desktop/src/compatibility/aionui";
import { GENERAL_WORKER_ADAPTER_KIND } from "../../apps/desktop/src/main/workers/generalWorkerProcessAdapter";

export const AIONUI_GENERAL_WORK_FIXTURE_CONVERSATION_HASH =
  "8d67d46a10371f76a7a3cfbf44cfdc87d14c3f8b62328e48ac8e7aca70153961";

export function createAionUiGeneralWorkRegistration(
  suffix = "1",
  rootPath = fs.realpathSync(process.cwd()),
): AionUiPromptArtifactRegistration {
  const createdAt = instant("2026-07-30T06:30:00.000Z");
  const workspace = workspaceId(`workspace-journey-${suffix}`);
  const task = taskId(`task-journey-${suffix}`);
  const session = sessionId(`session-journey-${suffix}`);
  const worker = workerId(`worker-journey-${suffix}`);
  const grant = workspaceGrantId(`grant-journey-${suffix}`);
  const request = toolRequestId(`request-journey-${suffix}`);
  return {
    link: {
      contractVersion: 1,
      conversationHash: AIONUI_GENERAL_WORK_FIXTURE_CONVERSATION_HASH,
      taskId: task,
      journeyKind: "prompt-artifact",
      createdAt,
    },
    workspace: {
      id: workspace,
      name: "AionUI general work",
      state: "active",
      createdAt,
      updatedAt: createdAt,
    },
    task: {
      id: task,
      workspaceId: workspace,
      title: "Summarize the approved workspace file.",
      state: "ready",
      activeSessionId: session,
      createdAt,
      updatedAt: createdAt,
    },
    session: {
      id: session,
      workspaceId: workspace,
      taskId: task,
      workerId: worker,
      state: "created",
      createdAt,
      updatedAt: createdAt,
    },
    worker: {
      id: worker,
      workspaceId: workspace,
      adapterKind: GENERAL_WORKER_ADAPTER_KIND,
      state: "created",
      createdAt,
      updatedAt: createdAt,
    },
    workspaceGrant: {
      contractVersion: 1,
      grantId: grant,
      workspaceId: workspace,
      rootPath,
      displayName: "AionUI general work",
      state: "active",
      createdAt,
      updatedAt: createdAt,
    },
    promptReference: {
      contractVersion: 1,
      reference: toolInputReference(`input-journey-prompt-${suffix}`),
      kind: "tool-input",
      owner: {
        workspaceId: workspace,
        taskId: task,
        sessionId: session,
        workerId: worker,
        grantId: grant,
      },
      classification: "task-content",
      mediaType: "text/plain; charset=utf-8",
      content: "Summarize the approved workspace file.",
      createdAt,
    },
    toolInputReference: {
      contractVersion: 1,
      reference: toolInputReference(`input-journey-output-${suffix}`),
      kind: "tool-input",
      owner: {
        workspaceId: workspace,
        taskId: task,
        sessionId: session,
        workerId: worker,
        requestId: request,
        grantId: grant,
      },
      classification: "task-content",
      mediaType: "text/plain; charset=utf-8",
      content: JSON.stringify({
        contractVersion: 1,
        relativePath: "result.md",
        mediaType: "text/markdown; charset=utf-8",
        content: "# Actestra result\n\nSummarize the approved workspace file.",
      }),
      createdAt,
    },
  };
}

export function createAionUiWorkspaceFileRegistration(
  suffix = "1",
  rootPath = fs.realpathSync(process.cwd()),
) {
  const registration = createAionUiGeneralWorkRegistration(suffix, rootPath);
  const { toolInputReference: readInputReference, ...base } = registration;
  return {
    ...base,
    link: {
      ...base.link,
      journeyKind: "workspace-file-artifact",
    },
    readInputReference: {
      ...readInputReference,
      content: JSON.stringify({
        contractVersion: 1,
        relativePath: "actestra-input.txt",
        maximumBytes: 64 * 1024,
      }),
    },
  } as const;
}

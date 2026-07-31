import fs from "node:fs";
import {
  deriveAionUiScheduleIdentity,
  type AionUiScheduleRegistration,
} from "../../apps/desktop/src/compatibility/aionui";
import {
  WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
  instant,
  workspaceGrantId,
  workspaceId,
} from "../../apps/desktop/src/core";

const CREATED_AT_MS = Date.parse("2026-07-31T00:00:00.000Z");

export function createAionUiScheduleRegistration(
  suffix = "1",
  rootPath = fs.realpathSync(process.cwd()),
): AionUiScheduleRegistration {
  const canonicalRootPath = fs.realpathSync(rootPath);
  const input = {
    name: `Actestra schedule ${suffix}`,
    description: "Bounded existing-conversation General Work",
    schedule: {
      kind: "every" as const,
      everyMs: 60_000,
      description: "Every minute",
    },
    prompt: `/actestra Produce scheduled artifact ${suffix}.`,
    conversation_id: `conversation-native-schedule-${suffix}`,
    conversation_title: `Schedule conversation ${suffix}`,
    created_by: "user" as const,
    execution_mode: "existing" as const,
    queue_enabled: false as const,
  };
  const identity = deriveAionUiScheduleIdentity(input);
  const workspace = workspaceId(`workspace-aionui-schedule-${suffix}`);
  const grant = workspaceGrantId(`grant-aionui-schedule-${suffix}`);
  const createdAt = instant(new Date(CREATED_AT_MS).toISOString());
  return {
    job: {
      contractVersion: 1,
      id: identity.id,
      conversationHash: identity.conversationHash,
      nativeConversationId: input.conversation_id,
      nativeConversationTitle: input.conversation_title,
      workspaceId: workspace,
      workspaceGrantId: grant,
      name: input.name,
      description: input.description,
      prompt: input.prompt,
      schedule: input.schedule,
      enabled: true,
      nextRunAtMs: CREATED_AT_MS + input.schedule.everyMs,
      runSequence: 0,
      runCount: 0,
      retryCount: 0,
      maxRetries: 0,
      queueEnabled: false,
      createdAtMs: CREATED_AT_MS,
      updatedAtMs: CREATED_AT_MS,
    },
    workspace: {
      id: workspace,
      name: `Actestra scheduled workspace ${suffix}`,
      state: "active",
      createdAt,
      updatedAt: createdAt,
    },
    workspaceGrant: {
      contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
      grantId: grant,
      workspaceId: workspace,
      rootPath: canonicalRootPath,
      displayName: `Actestra scheduled workspace ${suffix}`,
      state: "active",
      createdAt,
      updatedAt: createdAt,
    },
  };
}

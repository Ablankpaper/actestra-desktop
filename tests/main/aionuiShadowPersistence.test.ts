// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectAionUiHttpObservations,
  collectAionUiWebSocketObservations,
  projectAionUiObservation,
} from "../../apps/desktop/src/compatibility/aionui";
import {
  openSqliteCorePersistence,
  resolveCoreDatabasePath,
} from "../../apps/desktop/src/main/persistence/sqliteCorePersistence";

const testDirectories: string[] = [];
const OBSERVED_AT = Date.parse("2026-07-29T03:00:00.000Z");

function createTestDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-aionui-shadow-test-"));
  testDirectories.push(directory);
  return directory;
}

function conversationEvidence() {
  const [observation] = collectAionUiHttpObservations({
    method: "GET",
    path: "/api/conversations/conversation-1",
    observedAtMs: OBSERVED_AT,
    response: {
      id: "conversation-1",
      type: "acp",
      status: "running",
      created_at: OBSERVED_AT - 1_000,
      modified_at: OBSERVED_AT,
      extra: {
        workspace: "/private/workspace",
        backend: "codex",
      },
    },
  });
  return projectAionUiObservation(observation);
}

function taskEvidence() {
  const [observation] = collectAionUiWebSocketObservations({
    eventName: "turn.completed",
    observedAtMs: OBSERVED_AT + 1_000,
    payload: {
      session_id: "conversation-1",
      turn_id: "turn-1",
      status: "finished",
      state: "ai_waiting_input",
      runtime: {
        state: "idle",
        turn_id: "turn-1",
      },
    },
  });
  return projectAionUiObservation(observation);
}

afterEach(() => {
  for (const directory of testDirectories.splice(0)) {
    if (!directory.startsWith(path.join(os.tmpdir(), "actestra-aionui-shadow-test-"))) {
      throw new Error(`Refusing to remove unexpected test directory: ${directory}`);
    }
    fs.rmSync(directory, {
      recursive: true,
      force: true,
    });
  }
});

describe("AionUi F2 SQLite shadow evidence", () => {
  it("keeps a gapless idempotent sequence across restart without changing the P3 graph", async () => {
    const userDataPath = createTestDirectory();
    const first = openSqliteCorePersistence(userDataPath);
    const conversation = conversationEvidence();
    const task = taskEvidence();

    await expect(first.appendAionUiShadowEvidence(conversation)).resolves.toEqual({
      status: "appended",
      sequence: 1,
    });
    await expect(first.appendAionUiShadowEvidence(conversation)).resolves.toEqual({
      status: "duplicate",
      sequence: 1,
    });
    await expect(first.appendAionUiShadowEvidence(task)).resolves.toEqual({
      status: "appended",
      sequence: 2,
    });
    await expect(first.loadDomainGraph()).resolves.toEqual({
      workspaces: [],
      tasks: [],
      sessions: [],
      workers: [],
      approvals: [],
      artifacts: [],
    });
    await first.close();

    const reopened = openSqliteCorePersistence(userDataPath);
    await expect(reopened.summarizeAionUiShadowEvidence()).resolves.toEqual({
      recordCount: 2,
      lastSequence: 2,
    });
    await expect(reopened.listRecentAionUiShadowEvidence(2)).resolves.toEqual([
      {
        sequence: 2,
        evidence: task,
      },
      {
        sequence: 1,
        evidence: conversation,
      },
    ]);
    await reopened.close();
  });

  it("detects indexed projection corruption on read", async () => {
    const userDataPath = createTestDirectory();
    const persistence = openSqliteCorePersistence(userDataPath);
    await persistence.appendAionUiShadowEvidence(conversationEvidence());
    await persistence.close();

    const database = new DatabaseSync(resolveCoreDatabasePath(userDataPath));
    database
      .prepare("UPDATE aionui_shadow_evidence SET domain = ? WHERE sequence = 1")
      .run("provider");
    database.close();

    const reopened = openSqliteCorePersistence(userDataPath);
    await expect(reopened.listRecentAionUiShadowEvidence(1)).rejects.toMatchObject({
      code: "corrupt-database",
    });
    await reopened.close();
  });
});

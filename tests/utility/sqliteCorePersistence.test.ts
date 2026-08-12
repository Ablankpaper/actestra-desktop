// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  CoreContractError,
  MAX_RECOVERABLE_GENERAL_WORK_CHECKPOINTS,
  PersistenceError,
  artifactId,
  correlationId,
  coreEventCursor,
  eventId,
  eventStreamId,
  approvalId,
  instant,
  sessionId,
  taskId,
  workerId,
  type DomainGraph,
} from "../../apps/desktop/src/core";
import {
  CORE_DATABASE_FILENAME,
  openSqliteCorePersistence,
  resolveCoreDatabasePath,
} from "../../apps/desktop/src/utility/persistence/sqliteCorePersistence";
import {
  createArtifactDeliveryRecord,
  createDomainGraph,
  createEvent,
  createStartedEvent,
  FIXTURE_ARTIFACT_ID,
  FIXTURE_DESTINATION_GRANT_ID,
  FIXTURE_STREAM_ID,
  FIXTURE_TASK_ID,
} from "../fixtures/core";
import { createGeneralWorkCheckpoint } from "../fixtures/generalWorkRecovery";

const testDirectories: string[] = [];

function createTestDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-persistence-test-"));
  testDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of testDirectories.splice(0)) {
    if (!directory.startsWith(path.join(os.tmpdir(), "actestra-persistence-test-"))) {
      throw new Error(`Refusing to remove unexpected test directory: ${directory}`);
    }
    fs.rmSync(directory, {
      recursive: true,
      force: true,
    });
  }
});

describe("Actestra SQLite core persistence", () => {
  it("creates a private database and restores a validated domain graph after reopen", async () => {
    const userDataPath = createTestDirectory();
    const databasePath = path.join(userDataPath, "state", CORE_DATABASE_FILENAME);
    expect(resolveCoreDatabasePath(userDataPath)).toBe(databasePath);

    const first = openSqliteCorePersistence(userDataPath);
    const graph = createDomainGraph();
    await first.replaceDomainGraph(graph);
    await first.close();

    if (process.platform !== "win32") {
      expect(fs.statSync(path.dirname(databasePath)).mode & 0o777).toBe(0o700);
      expect(fs.statSync(databasePath).mode & 0o777).toBe(0o600);
    }

    const reopened = openSqliteCorePersistence(userDataPath);
    await expect(reopened.loadDomainGraph()).resolves.toEqual(graph);
    await reopened.close();
  });

  it("atomically preserves the prior graph when replacement validation fails", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    const graph = createDomainGraph();
    await persistence.replaceDomainGraph(graph);
    const invalidGraph: DomainGraph = {
      ...graph,
      sessions: graph.sessions.map((session) => ({
        ...session,
        id: sessionId("session-missing-from-task"),
      })),
    };

    await expect(persistence.replaceDomainGraph(invalidGraph)).rejects.toBeInstanceOf(
      CoreContractError,
    );
    await expect(persistence.loadDomainGraph()).resolves.toEqual(graph);
    await persistence.close();
  });

  it("persists, deduplicates, and cursor-replays one ordered event stream", async () => {
    const userDataPath = createTestDirectory();
    const persistence = openSqliteCorePersistence(userDataPath);
    await persistence.replaceDomainGraph(createDomainGraph());
    const started = createStartedEvent();
    const message = createEvent(2, "agent.message", {
      role: "assistant",
      content: "The persisted worker stream is ordered.",
    });

    await expect(persistence.appendEvent(started)).resolves.toEqual({
      status: "appended",
    });
    await expect(persistence.appendEvent(started)).resolves.toEqual({
      status: "duplicate",
    });
    await expect(persistence.appendEvent(message)).resolves.toEqual({
      status: "appended",
    });
    await expect(
      persistence.appendEvent(
        createStartedEvent({
          streamId: eventStreamId("stream-conflicting"),
        }),
      ),
    ).rejects.toMatchObject({
      code: "event-id-conflict",
    });
    await persistence.close();

    const reopened = openSqliteCorePersistence(userDataPath);
    await expect(reopened.replayEvents(FIXTURE_STREAM_ID)).resolves.toEqual([started, message]);
    await expect(
      reopened.replayEvents(FIXTURE_STREAM_ID, coreEventCursor(started)),
    ).resolves.toEqual([message]);

    await reopened.replaceDomainGraph({
      workspaces: [],
      tasks: [],
      workers: [],
      sessions: [],
      approvals: [],
      artifacts: [],
    });
    await expect(reopened.appendEvent(started)).resolves.toEqual({
      status: "duplicate",
    });
    await reopened.close();
  });

  it("rejects event identities that are absent from the current domain graph", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    await persistence.replaceDomainGraph(createDomainGraph());

    await expect(
      persistence.appendEvent(
        createStartedEvent({
          eventId: eventId("event-missing-session"),
          sessionId: sessionId("session-missing"),
        }),
      ),
    ).rejects.toMatchObject({
      code: "domain-reference",
    });
    await expect(persistence.replayEvents(FIXTURE_STREAM_ID)).resolves.toEqual([]);
    await persistence.close();
  });

  it("persists recoverable checkpoints with compare-and-swap revisions across reopen", async () => {
    const userDataPath = createTestDirectory();
    const active = createGeneralWorkCheckpoint();
    const persistence = openSqliteCorePersistence(userDataPath);
    await expect(persistence.persistGeneralWorkCheckpoint(active)).resolves.toMatchObject({
      status: "stored",
      checkpoint: active,
    });
    await expect(persistence.persistGeneralWorkCheckpoint(active)).resolves.toMatchObject({
      status: "duplicate",
    });
    await expect(persistence.listRecoverableGeneralWorkCheckpoints(100)).resolves.toEqual([active]);
    await persistence.close();

    const reopened = openSqliteCorePersistence(userDataPath);
    await expect(reopened.getGeneralWorkCheckpoint(active.attempt.sessionId)).resolves.toEqual(
      active,
    );
    await expect(
      reopened.persistGeneralWorkCheckpoint({
        ...active,
        revision: 3,
        updatedAt: active.updatedAt,
      }),
    ).rejects.toMatchObject({
      code: "general-work-conflict",
    });
    await expect(reopened.getGeneralWorkCheckpoint(active.attempt.sessionId)).resolves.toEqual(
      active,
    );
    await reopened.close();
  });

  it("bounds the number of recoverable general-work checkpoints", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    const fixture = createGeneralWorkCheckpoint();
    for (let index = 0; index < MAX_RECOVERABLE_GENERAL_WORK_CHECKPOINTS; index += 1) {
      const suffix = String(index + 1);
      const checkpointSession = sessionId(`session-recovery-bound-${suffix}`);
      const checkpointWorker = workerId(`worker-recovery-bound-${suffix}`);
      const checkpointStream = eventStreamId(`stream-recovery-bound-${suffix}`);
      const checkpointCorrelation = correlationId(`correlation-recovery-bound-${suffix}`);
      await persistence.persistGeneralWorkCheckpoint({
        ...fixture,
        attempt: {
          ...fixture.attempt,
          sessionId: checkpointSession,
          workerId: checkpointWorker,
          streamId: checkpointStream,
          correlationId: checkpointCorrelation,
        },
        events: fixture.events.map((event) => ({
          ...event,
          eventId: eventId(`event-recovery-bound-${suffix}-${String(event.sequence)}`),
          sessionId: checkpointSession,
          workerId: checkpointWorker,
          streamId: checkpointStream,
          correlationId: checkpointCorrelation,
        })),
      });
    }

    await expect(
      persistence.persistGeneralWorkCheckpoint({
        ...fixture,
        attempt: {
          ...fixture.attempt,
          sessionId: sessionId("session-recovery-bound-overflow"),
          workerId: workerId("worker-recovery-bound-overflow"),
          streamId: eventStreamId("stream-recovery-bound-overflow"),
          correlationId: correlationId("correlation-recovery-bound-overflow"),
        },
        events: fixture.events.map((event) => ({
          ...event,
          eventId: eventId(`event-recovery-bound-overflow-${String(event.sequence)}`),
          sessionId: sessionId("session-recovery-bound-overflow"),
          workerId: workerId("worker-recovery-bound-overflow"),
          streamId: eventStreamId("stream-recovery-bound-overflow"),
          correlationId: correlationId("correlation-recovery-bound-overflow"),
        })),
      }),
    ).rejects.toMatchObject({
      code: "general-work-conflict",
    });
    await persistence.close();
  });

  it("rolls back an invalid sequence so the next valid event can still commit", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    await persistence.replaceDomainGraph(createDomainGraph());
    await persistence.appendEvent(createStartedEvent());

    await expect(
      persistence.appendEvent(
        createEvent(3, "agent.message", {
          role: "assistant",
          content: "This event skips sequence two.",
        }),
      ),
    ).rejects.toMatchObject({
      code: "event-sequence-gap",
    });
    const validSecond = createEvent(2, "agent.message", {
      role: "assistant",
      content: "This event follows sequence one.",
    });
    await expect(persistence.appendEvent(validSecond)).resolves.toEqual({
      status: "appended",
    });
    await expect(persistence.replayEvents(FIXTURE_STREAM_ID)).resolves.toEqual([
      createStartedEvent(),
      validSecond,
    ]);
    await persistence.close();
  });

  it("fails closed after the port has been closed", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    await persistence.close();

    await expect(persistence.loadDomainGraph()).rejects.toBeInstanceOf(PersistenceError);
    await expect(persistence.loadDomainGraph()).rejects.toMatchObject({
      code: "closed",
    });
    await expect(persistence.close()).resolves.toBeUndefined();
  });

  it("rejects a stored event whose indexed projection was corrupted", async () => {
    const userDataPath = createTestDirectory();
    const persistence = openSqliteCorePersistence(userDataPath);
    await persistence.replaceDomainGraph(createDomainGraph());
    await persistence.appendEvent(createStartedEvent());
    await persistence.close();

    const database = new DatabaseSync(resolveCoreDatabasePath(userDataPath));
    database.prepare("UPDATE core_events SET sequence = ? WHERE event_id = ?").run(9, "event-1");
    database.close();

    const reopened = openSqliteCorePersistence(userDataPath);
    await expect(reopened.replayEvents(FIXTURE_STREAM_ID)).rejects.toMatchObject({
      code: "corrupt-database",
    });
    await reopened.close();
  });

  it("recovers Artifact delivery state after a restart", async () => {
    const userDataPath = createTestDirectory();
    const first = openSqliteCorePersistence(userDataPath);
    await first.replaceDomainGraph(createDomainGraph());

    const pending = createArtifactDeliveryRecord();
    expect(await first.persistArtifactDelivery(pending)).toEqual({
      status: "stored",
      delivery: pending,
    });
    expect(await first.persistArtifactDelivery(pending)).toEqual({
      status: "duplicate",
      delivery: pending,
    });
    await first.close();

    const reopened = openSqliteCorePersistence(userDataPath);
    expect(await reopened.getArtifactDelivery(FIXTURE_ARTIFACT_ID)).toEqual(pending);
    expect(await reopened.listArtifactDeliveriesForTask(FIXTURE_TASK_ID, 10)).toEqual([pending]);

    // "applying" is the durable crash-recovery marker recorded before the repository is touched.
    const applying = createArtifactDeliveryRecord({
      state: "applying",
      destinationGrantId: FIXTURE_DESTINATION_GRANT_ID,
      approvalId: approvalId("approval-apply-primary"),
      updatedAt: instant("2026-07-28T06:10:00.000Z"),
    });
    expect((await reopened.persistArtifactDelivery(applying)).status).toBe("stored");

    const applied = createArtifactDeliveryRecord({
      state: "applied",
      destinationGrantId: FIXTURE_DESTINATION_GRANT_ID,
      approvalId: approvalId("approval-apply-primary"),
      verifiedHead: "b".repeat(40),
      updatedAt: instant("2026-07-28T06:11:00.000Z"),
    });
    expect(await reopened.persistArtifactDelivery(applied)).toEqual({
      status: "stored",
      delivery: applied,
    });
    await reopened.close();

    const third = openSqliteCorePersistence(userDataPath);
    expect(await third.getArtifactDelivery(FIXTURE_ARTIFACT_ID)).toEqual(applied);
    await third.close();
  });

  it("keeps a failed Artifact delivery recoverable and its Artifact intact", async () => {
    const userDataPath = createTestDirectory();
    const persistence = openSqliteCorePersistence(userDataPath);
    await persistence.replaceDomainGraph(createDomainGraph());
    await persistence.persistArtifactDelivery(createArtifactDeliveryRecord());
    await persistence.persistArtifactDelivery(
      createArtifactDeliveryRecord({
        state: "applying",
        destinationGrantId: FIXTURE_DESTINATION_GRANT_ID,
        approvalId: approvalId("approval-apply-primary"),
        updatedAt: instant("2026-07-28T06:09:00.000Z"),
      }),
    );

    const failed = createArtifactDeliveryRecord({
      state: "conflict",
      destinationGrantId: FIXTURE_DESTINATION_GRANT_ID,
      approvalId: approvalId("approval-apply-primary"),
      failureCode: "patch-conflict",
      failureMessage: "The reviewed patch does not apply to the current workspace tree.",
      updatedAt: instant("2026-07-28T06:10:00.000Z"),
    });
    expect(await persistence.persistArtifactDelivery(failed)).toEqual({
      status: "stored",
      delivery: failed,
    });

    // A failed delivery is retryable, and the Artifact itself is untouched.
    const retry = createArtifactDeliveryRecord({
      state: "applying",
      destinationGrantId: FIXTURE_DESTINATION_GRANT_ID,
      approvalId: approvalId("approval-apply-retry"),
      updatedAt: instant("2026-07-28T06:11:00.000Z"),
    });
    expect((await persistence.persistArtifactDelivery(retry)).status).toBe("stored");
    const graph = await persistence.loadDomainGraph();
    expect(graph?.artifacts).toEqual(createDomainGraph().artifacts);
    await persistence.close();
  });

  it("rejects Artifact delivery records that conflict with durable authority", async () => {
    const userDataPath = createTestDirectory();
    const persistence = openSqliteCorePersistence(userDataPath);
    await persistence.replaceDomainGraph(createDomainGraph());

    // An outcome without a pending delivery intent has no provenance.
    await expect(
      persistence.persistArtifactDelivery(
        createArtifactDeliveryRecord({
          state: "applied",
          destinationGrantId: FIXTURE_DESTINATION_GRANT_ID,
          approvalId: approvalId("approval-apply-primary"),
          verifiedHead: "b".repeat(40),
        }),
      ),
    ).rejects.toMatchObject({ code: "artifact-delivery-conflict" });

    await persistence.persistArtifactDelivery(createArtifactDeliveryRecord());

    // The reviewed patch identity is immutable once a delivery exists.
    await expect(
      persistence.persistArtifactDelivery(
        createArtifactDeliveryRecord({
          patchSha256: "d".repeat(64),
          updatedAt: instant("2026-07-28T06:10:00.000Z"),
        }),
      ),
    ).rejects.toMatchObject({ code: "artifact-delivery-conflict" });

    // A delivery cannot jump straight to an outcome without its durable "applying" marker.
    await expect(
      persistence.persistArtifactDelivery(
        createArtifactDeliveryRecord({
          state: "applied",
          destinationGrantId: FIXTURE_DESTINATION_GRANT_ID,
          approvalId: approvalId("approval-apply-primary"),
          verifiedHead: "b".repeat(40),
          updatedAt: instant("2026-07-28T06:10:00.000Z"),
        }),
      ),
    ).rejects.toMatchObject({ code: "artifact-delivery-conflict" });

    // An applied delivery is terminal.
    await persistence.persistArtifactDelivery(
      createArtifactDeliveryRecord({
        state: "applying",
        destinationGrantId: FIXTURE_DESTINATION_GRANT_ID,
        approvalId: approvalId("approval-apply-primary"),
        updatedAt: instant("2026-07-28T06:09:00.000Z"),
      }),
    );
    await persistence.persistArtifactDelivery(
      createArtifactDeliveryRecord({
        state: "applied",
        destinationGrantId: FIXTURE_DESTINATION_GRANT_ID,
        approvalId: approvalId("approval-apply-primary"),
        verifiedHead: "b".repeat(40),
        updatedAt: instant("2026-07-28T06:10:00.000Z"),
      }),
    );
    await expect(
      persistence.persistArtifactDelivery(
        createArtifactDeliveryRecord({
          state: "pending",
          updatedAt: instant("2026-07-28T06:11:00.000Z"),
        }),
      ),
    ).rejects.toMatchObject({ code: "artifact-delivery-conflict" });
    await persistence.close();
  });

  it("refuses an Artifact delivery whose ownership does not match its Artifact", async () => {
    const userDataPath = createTestDirectory();
    const persistence = openSqliteCorePersistence(userDataPath);
    await persistence.replaceDomainGraph(createDomainGraph());

    await expect(
      persistence.persistArtifactDelivery(
        createArtifactDeliveryRecord({ artifactId: artifactId("artifact-unknown") }),
      ),
    ).rejects.toMatchObject({ code: "domain-reference" });

    await expect(
      persistence.persistArtifactDelivery(
        createArtifactDeliveryRecord({ taskId: taskId("task-other") }),
      ),
    ).rejects.toMatchObject({ code: "artifact-delivery-conflict" });
    await persistence.close();
  });

  it("fails closed when the database file is not valid SQLite", () => {
    const userDataPath = createTestDirectory();
    const databasePath = resolveCoreDatabasePath(userDataPath);
    fs.mkdirSync(path.dirname(databasePath), {
      recursive: true,
    });
    fs.writeFileSync(databasePath, "not a SQLite database");

    expect(() => openSqliteCorePersistence(userDataPath)).toThrowError(
      expect.objectContaining({
        code: "corrupt-database",
      }),
    );
  });
});

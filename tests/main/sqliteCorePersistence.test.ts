// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  CoreContractError,
  PersistenceError,
  coreEventCursor,
  eventId,
  eventStreamId,
  sessionId,
  type DomainGraph,
} from "../../apps/desktop/src/core";
import {
  CORE_DATABASE_FILENAME,
  openSqliteCorePersistence,
  resolveCoreDatabasePath,
} from "../../apps/desktop/src/main/persistence/sqliteCorePersistence";
import {
  createDomainGraph,
  createEvent,
  createStartedEvent,
  FIXTURE_STREAM_ID,
} from "../fixtures/core";

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

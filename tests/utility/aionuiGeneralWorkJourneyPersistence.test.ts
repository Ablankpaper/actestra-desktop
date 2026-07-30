// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  AionUiGeneralWorkLink,
  AionUiGeneralWorkRegistration,
} from "../../apps/desktop/src/compatibility/aionui";
import { WORKLOAD_PERSISTENCE_CONTRACT_VERSION, instant } from "../../apps/desktop/src/core";
import { openSqliteCorePersistence } from "../../apps/desktop/src/utility/persistence/sqliteCorePersistence";
import {
  createAionUiGeneralWorkRegistration,
  createAionUiLocalResearchRegistration,
  createAionUiWorkspaceFileRegistration,
} from "../fixtures/aionuiGeneralWork";

const testDirectories: string[] = [];

function createTestDirectory(): string {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "actestra-aionui-general-work-store-test-"),
  );
  testDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of testDirectories.splice(0)) {
    if (!directory.startsWith(path.join(os.tmpdir(), "actestra-aionui-general-work-store-test-"))) {
      throw new Error(`Refusing to remove unexpected test directory: ${directory}`);
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

type JourneyPersistence = {
  registerAionUiGeneralWorkJourney(
    value: AionUiGeneralWorkRegistration,
  ): Promise<{ readonly status: "stored" | "duplicate"; readonly link: AionUiGeneralWorkLink }>;
  listAionUiGeneralWorkJourneyLinks(
    conversationHash: string,
    limit: number,
  ): Promise<readonly AionUiGeneralWorkLink[]>;
  listPreparedAionUiGeneralWorkJourneyLinks(
    limit: number,
  ): Promise<readonly AionUiGeneralWorkLink[]>;
};

describe("SQLite AionUI general-work journey persistence", () => {
  it("atomically restores the link and initial domain graph after reopen", async () => {
    const userDataPath = createTestDirectory();
    const expected = createAionUiGeneralWorkRegistration("store-1");
    const first = openSqliteCorePersistence(userDataPath);
    const journey = first as unknown as JourneyPersistence;

    expect(journey.registerAionUiGeneralWorkJourney).toBeTypeOf("function");
    expect(journey.listAionUiGeneralWorkJourneyLinks).toBeTypeOf("function");
    await expect(journey.registerAionUiGeneralWorkJourney(expected)).resolves.toEqual({
      status: "stored",
      link: expected.link,
    });
    await first.close();

    const reopened = openSqliteCorePersistence(userDataPath);
    const reopenedJourney = reopened as unknown as JourneyPersistence;
    await expect(
      reopenedJourney.listAionUiGeneralWorkJourneyLinks(expected.link.conversationHash, 10),
    ).resolves.toEqual([expected.link]);
    await expect(reopened.loadDomainGraph()).resolves.toEqual({
      workspaces: [expected.workspace],
      tasks: [expected.task],
      sessions: [expected.session],
      workers: [expected.worker],
      approvals: [],
      artifacts: [],
    });
    await expect(reopened.getActiveWorkspaceGrant(expected.workspace.id)).resolves.toEqual(
      expected.workspaceGrant,
    );
    await expect(
      reopened.resolveContentReference({
        contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
        reference: expected.promptReference.reference,
        kind: "tool-input",
        owner: expected.promptReference.owner,
        resolvedAt: expected.link.createdAt,
        consume: false,
      }),
    ).resolves.toMatchObject({
      content: expected.promptReference.content,
      metadata: {
        owner: expected.promptReference.owner,
      },
    });
    await reopened.close();
  });

  it("deduplicates and restores a workspace-file read input after reopen", async () => {
    const userDataPath = createTestDirectory();
    const expected = createAionUiWorkspaceFileRegistration("file-store");
    const first = openSqliteCorePersistence(userDataPath);
    const journey = first as unknown as JourneyPersistence;

    await expect(
      journey.registerAionUiGeneralWorkJourney(
        expected as unknown as AionUiGeneralWorkRegistration,
      ),
    ).resolves.toEqual({
      status: "stored",
      link: expected.link,
    });
    await expect(
      journey.registerAionUiGeneralWorkJourney(
        expected as unknown as AionUiGeneralWorkRegistration,
      ),
    ).resolves.toEqual({
      status: "duplicate",
      link: expected.link,
    });
    await first.close();

    const reopened = openSqliteCorePersistence(userDataPath);
    const reopenedJourney = reopened as unknown as JourneyPersistence;
    await expect(
      reopenedJourney.listAionUiGeneralWorkJourneyLinks(expected.link.conversationHash, 10),
    ).resolves.toEqual([expected.link]);
    await expect(
      reopened.resolveContentReference({
        contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
        reference: expected.readInputReference.reference,
        kind: "tool-input",
        owner: expected.readInputReference.owner,
        resolvedAt: expected.link.createdAt,
        consume: false,
      }),
    ).resolves.toMatchObject({
      content: expected.readInputReference.content,
      metadata: {
        owner: expected.readInputReference.owner,
      },
    });
    await reopened.close();
  });

  it("deduplicates and restores a local-research read input after reopen", async () => {
    const userDataPath = createTestDirectory();
    const expected = createAionUiLocalResearchRegistration("research-store");
    const first = openSqliteCorePersistence(userDataPath);
    const journey = first as unknown as JourneyPersistence;

    await expect(journey.registerAionUiGeneralWorkJourney(expected)).resolves.toEqual({
      status: "stored",
      link: expected.link,
    });
    await expect(journey.registerAionUiGeneralWorkJourney(expected)).resolves.toEqual({
      status: "duplicate",
      link: expected.link,
    });
    await first.close();

    const reopened = openSqliteCorePersistence(userDataPath);
    const reopenedJourney = reopened as unknown as JourneyPersistence;
    await expect(
      reopenedJourney.listAionUiGeneralWorkJourneyLinks(expected.link.conversationHash, 10),
    ).resolves.toEqual([expected.link]);
    await expect(
      reopened.resolveContentReference({
        contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
        reference: expected.readInputReference.reference,
        kind: "tool-input",
        owner: expected.readInputReference.owner,
        resolvedAt: expected.link.createdAt,
        consume: false,
      }),
    ).resolves.toMatchObject({
      content: expected.readInputReference.content,
      metadata: {
        owner: expected.readInputReference.owner,
      },
    });
    await reopened.close();
  });

  it("rolls back every authority record when the atomic grant is invalid", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    const journey = persistence as unknown as JourneyPersistence;
    const expected = createAionUiGeneralWorkRegistration("rollback-1");
    const invalid = {
      ...expected,
      workspaceGrant: {
        ...expected.workspaceGrant,
        rootPath: path.join(expected.workspaceGrant.rootPath, "..", "workspace"),
      },
    };

    await expect(journey.registerAionUiGeneralWorkJourney(invalid)).rejects.toThrow(
      /workspace|canonical|register/u,
    );
    await expect(persistence.loadDomainGraph()).resolves.toEqual({
      workspaces: [],
      tasks: [],
      sessions: [],
      workers: [],
      approvals: [],
      artifacts: [],
    });
    await expect(
      journey.listAionUiGeneralWorkJourneyLinks(expected.link.conversationHash, 10),
    ).resolves.toEqual([]);
    await persistence.close();
  });

  it("lists only prepared linked journeys with no durable attempt", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    const journey = persistence as unknown as JourneyPersistence;
    const expected = createAionUiGeneralWorkRegistration("prepared-1");
    const failedAt = instant("2026-07-30T06:31:00.000Z");
    await journey.registerAionUiGeneralWorkJourney(expected);

    await expect(journey.listPreparedAionUiGeneralWorkJourneyLinks(10)).resolves.toEqual([
      expected.link,
    ]);
    await persistence.replaceDomainGraph({
      ...(await persistence.loadDomainGraph()),
      tasks: [
        {
          ...expected.task,
          state: "failed",
          activeSessionId: undefined,
          updatedAt: failedAt,
        },
      ],
      sessions: [
        {
          ...expected.session,
          state: "failed",
          updatedAt: failedAt,
        },
      ],
      workers: [
        {
          ...expected.worker,
          state: "stopped",
          updatedAt: failedAt,
        },
      ],
    });
    await expect(journey.listPreparedAionUiGeneralWorkJourneyLinks(10)).resolves.toEqual([]);
    await persistence.close();
  });

  it("deduplicates a lost submit response after authoritative state advances", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    const journey = persistence as unknown as JourneyPersistence;
    const expected = createAionUiGeneralWorkRegistration("store-1");
    await journey.registerAionUiGeneralWorkJourney(expected);
    const completedAt = instant("2026-07-30T06:31:00.000Z");
    await persistence.replaceDomainGraph({
      workspaces: [
        {
          ...expected.workspace,
          updatedAt: completedAt,
        },
      ],
      tasks: [
        {
          ...expected.task,
          state: "completed",
          activeSessionId: undefined,
          updatedAt: completedAt,
        },
      ],
      sessions: [
        {
          ...expected.session,
          state: "completed",
          updatedAt: completedAt,
        },
      ],
      workers: [
        {
          ...expected.worker,
          state: "stopped",
          updatedAt: completedAt,
        },
      ],
      approvals: [],
      artifacts: [],
    });
    await persistence.persistWorkspaceGrant({
      ...expected.workspaceGrant,
      state: "revoked",
      updatedAt: completedAt,
    });

    await expect(journey.registerAionUiGeneralWorkJourney(expected)).resolves.toEqual({
      status: "duplicate",
      link: expected.link,
    });
    await expect(persistence.loadDomainGraph()).resolves.toMatchObject({
      tasks: [{ state: "completed", activeSessionId: undefined }],
      sessions: [{ state: "completed" }],
      workers: [{ state: "stopped" }],
    });
    await expect(persistence.getActiveWorkspaceGrant(expected.workspace.id)).resolves.toBeNull();
    await persistence.close();
  });

  it("does not yield the SQLite transaction while checking a duplicate registration", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    const journey = persistence as unknown as JourneyPersistence;
    const existing = createAionUiGeneralWorkRegistration("concurrent-existing");
    const next = createAionUiGeneralWorkRegistration("concurrent-next");
    await journey.registerAionUiGeneralWorkJourney(existing);

    await expect(
      Promise.all([
        journey.registerAionUiGeneralWorkJourney(existing),
        journey.registerAionUiGeneralWorkJourney(next),
      ]),
    ).resolves.toEqual([
      { status: "duplicate", link: existing.link },
      { status: "stored", link: next.link },
    ]);
    await expect(persistence.loadDomainGraph()).resolves.toMatchObject({
      workspaces: [{ id: existing.workspace.id }, { id: next.workspace.id }],
      tasks: [{ id: existing.task.id }, { id: next.task.id }],
    });
    await persistence.close();
  });

  it("enforces the per-conversation journey bound inside the write transaction", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    const journey = persistence as unknown as JourneyPersistence;
    const conversationHash = "a".repeat(64);
    for (let index = 0; index < 100; index += 1) {
      const registration = createAionUiGeneralWorkRegistration(`bounded-${String(index)}`);
      await journey.registerAionUiGeneralWorkJourney({
        ...registration,
        link: {
          ...registration.link,
          conversationHash,
        },
      });
    }
    const overflow = createAionUiGeneralWorkRegistration("bounded-overflow");

    await expect(
      journey.registerAionUiGeneralWorkJourney({
        ...overflow,
        link: {
          ...overflow.link,
          conversationHash,
        },
      }),
    ).rejects.toMatchObject({
      code: "general-work-journey-conflict",
    });
    await expect(
      journey.listAionUiGeneralWorkJourneyLinks(conversationHash, 100),
    ).resolves.toHaveLength(100);
    await persistence.close();
  });
});

// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  instant,
  taskId,
  toolInputReference,
  toolOutputReference,
  toolRequestId,
  workspaceGrantId,
} from "../../apps/desktop/src/core";
import {
  openSqliteCorePersistence,
  resolveCoreDatabasePath,
} from "../../apps/desktop/src/utility/persistence/sqliteCorePersistence";
import {
  createDomainGraph,
  FIXTURE_SESSION_ID,
  FIXTURE_TASK_ID,
  FIXTURE_WORKER_ID,
  FIXTURE_WORKSPACE_ID,
} from "../fixtures/core";

const testDirectories: string[] = [];
const CREATED_AT = instant("2026-07-29T01:00:00.000Z");

function createTestDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-workload-store-test-"));
  testDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of testDirectories.splice(0)) {
    if (!directory.startsWith(path.join(os.tmpdir(), "actestra-workload-store-test-"))) {
      throw new Error(`Refusing to remove unexpected test directory: ${directory}`);
    }
    fs.rmSync(directory, {
      recursive: true,
      force: true,
    });
  }
});

describe("SQLite workload persistence", () => {
  it("persists one active canonical workspace grant and an explicit revocation", async () => {
    const userDataPath = createTestDirectory();
    const workspaceRoot = path.join(userDataPath, "workspace");
    fs.mkdirSync(workspaceRoot);
    const persistence = openSqliteCorePersistence(userDataPath);
    await persistence.replaceDomainGraph(createDomainGraph());
    const grant = {
      contractVersion: 1,
      grantId: workspaceGrantId("grant-primary"),
      workspaceId: FIXTURE_WORKSPACE_ID,
      rootPath: fs.realpathSync(workspaceRoot),
      displayName: "Primary fixture",
      state: "active",
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    } as const;

    await expect(persistence.persistWorkspaceGrant(grant)).resolves.toEqual({
      status: "stored",
      grant,
    });
    await expect(persistence.persistWorkspaceGrant(grant)).resolves.toEqual({
      status: "duplicate",
      grant,
    });
    const differentRoot = path.join(userDataPath, "different");
    fs.mkdirSync(differentRoot);
    await expect(
      persistence.persistWorkspaceGrant({
        ...grant,
        rootPath: fs.realpathSync(differentRoot),
      }),
    ).rejects.toMatchObject({
      code: "workspace-grant-conflict",
    });
    await expect(
      persistence.persistWorkspaceGrant({
        ...grant,
        grantId: workspaceGrantId("grant-conflicting-active"),
      }),
    ).rejects.toMatchObject({
      code: "workspace-grant-conflict",
    });

    const revoked = {
      ...grant,
      state: "revoked",
      updatedAt: instant("2026-07-29T01:05:00.000Z"),
    } as const;
    fs.rmSync(workspaceRoot, {
      recursive: true,
    });
    await expect(persistence.persistWorkspaceGrant(revoked)).resolves.toEqual({
      status: "updated",
      grant: revoked,
    });
    await expect(
      persistence.persistWorkspaceGrant({
        ...revoked,
        grantId: workspaceGrantId("grant-new-revoked"),
        rootPath: path.join(userDataPath, "missing-workspace"),
      }),
    ).rejects.toMatchObject({
      code: "invalid-record",
    });
    await expect(persistence.getActiveWorkspaceGrant(FIXTURE_WORKSPACE_ID)).resolves.toBeNull();
    await persistence.close();

    const reopened = openSqliteCorePersistence(userDataPath);
    await expect(reopened.getActiveWorkspaceGrant(FIXTURE_WORKSPACE_ID)).resolves.toBeNull();
    await reopened.close();
  });

  it("hides a stale active grant after its workspace leaves the current domain graph", async () => {
    const userDataPath = createTestDirectory();
    const workspaceRoot = path.join(userDataPath, "workspace");
    fs.mkdirSync(workspaceRoot);
    const persistence = openSqliteCorePersistence(userDataPath);
    await persistence.replaceDomainGraph(createDomainGraph());
    const grant = {
      contractVersion: 1,
      grantId: workspaceGrantId("grant-stale-workspace"),
      workspaceId: FIXTURE_WORKSPACE_ID,
      rootPath: fs.realpathSync(workspaceRoot),
      displayName: "Stale fixture",
      state: "active",
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    } as const;
    await persistence.persistWorkspaceGrant(grant);
    await expect(persistence.getActiveWorkspaceGrant(FIXTURE_WORKSPACE_ID)).resolves.toEqual(grant);
    const owner = {
      workspaceId: FIXTURE_WORKSPACE_ID,
      taskId: FIXTURE_TASK_ID,
      sessionId: FIXTURE_SESSION_ID,
      workerId: FIXTURE_WORKER_ID,
    } as const;
    const workspaceContent = {
      contractVersion: 1,
      reference: toolInputReference("input-stale-workspace"),
      kind: "tool-input",
      owner: {
        ...owner,
        grantId: grant.grantId,
      },
      classification: "workspace-content",
      mediaType: "text/plain; charset=utf-8",
      content: "workspace snapshot",
      createdAt: CREATED_AT,
    } as const;
    const taskContent = {
      contractVersion: 1,
      reference: toolOutputReference("output-retained-task"),
      kind: "tool-output",
      owner,
      classification: "task-content",
      mediaType: "text/markdown; charset=utf-8",
      content: "# Retained task output",
      createdAt: CREATED_AT,
    } as const;
    await persistence.storeContentReference(workspaceContent);
    await persistence.storeContentReference(taskContent);

    await persistence.replaceDomainGraph({
      workspaces: [],
      tasks: [],
      workers: [],
      sessions: [],
      approvals: [],
      artifacts: [],
    });
    await expect(persistence.getActiveWorkspaceGrant(FIXTURE_WORKSPACE_ID)).resolves.toBeNull();
    await expect(
      persistence.resolveContentReference({
        contractVersion: 1,
        reference: workspaceContent.reference,
        kind: workspaceContent.kind,
        owner: workspaceContent.owner,
        resolvedAt: instant("2026-07-29T01:05:00.000Z"),
        consume: false,
      }),
    ).rejects.toMatchObject({
      code: "content-ownership",
    });
    await expect(
      persistence.resolveContentReference({
        contractVersion: 1,
        reference: taskContent.reference,
        kind: taskContent.kind,
        owner: taskContent.owner,
        resolvedAt: instant("2026-07-29T01:05:00.000Z"),
        consume: false,
      }),
    ).resolves.toMatchObject({
      content: taskContent.content,
    });
    await persistence.close();
  });

  it("stores, deduplicates, resolves, consumes, and restart-restores bounded content", async () => {
    const userDataPath = createTestDirectory();
    const workspaceRoot = path.join(userDataPath, "workspace");
    fs.mkdirSync(workspaceRoot);
    const persistence = openSqliteCorePersistence(userDataPath);
    const graph = createDomainGraph();
    await persistence.replaceDomainGraph(graph);
    const grant = {
      contractVersion: 1,
      grantId: workspaceGrantId("grant-content"),
      workspaceId: FIXTURE_WORKSPACE_ID,
      rootPath: fs.realpathSync(workspaceRoot),
      displayName: "Content fixture",
      state: "active",
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    } as const;
    await persistence.persistWorkspaceGrant(grant);
    const input = {
      contractVersion: 1,
      reference: toolInputReference("input-content-primary"),
      kind: "tool-input",
      owner: {
        workspaceId: FIXTURE_WORKSPACE_ID,
        taskId: FIXTURE_TASK_ID,
        sessionId: FIXTURE_SESSION_ID,
        workerId: FIXTURE_WORKER_ID,
        requestId: toolRequestId("request-content-primary"),
        grantId: grant.grantId,
      },
      classification: "workspace-content",
      mediaType: "text/plain; charset=utf-8",
      content: "bounded workspace content",
      createdAt: CREATED_AT,
      expiresAt: instant("2026-07-29T02:00:00.000Z"),
    } as const;

    const stored = await persistence.storeContentReference(input);
    expect(stored).toMatchObject({
      status: "stored",
      metadata: {
        reference: input.reference,
        byteLength: 25,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
    await expect(persistence.storeContentReference(input)).resolves.toEqual({
      status: "duplicate",
      metadata: stored.metadata,
    });
    await persistence.close();

    const reopened = openSqliteCorePersistence(userDataPath);
    const resolved = await reopened.resolveContentReference({
      contractVersion: 1,
      reference: input.reference,
      kind: input.kind,
      owner: input.owner,
      resolvedAt: instant("2026-07-29T01:10:00.000Z"),
      consume: true,
    });
    expect(resolved).toEqual({
      metadata: {
        ...stored.metadata,
        consumedAt: instant("2026-07-29T01:10:00.000Z"),
      },
      content: input.content,
    });
    await expect(
      reopened.resolveContentReference({
        contractVersion: 1,
        reference: input.reference,
        kind: input.kind,
        owner: input.owner,
        resolvedAt: instant("2026-07-29T01:20:00.000Z"),
        consume: true,
      }),
    ).resolves.toEqual(resolved);
    await expect(
      reopened.resolveContentReference({
        contractVersion: 1,
        reference: input.reference,
        kind: input.kind,
        owner: input.owner,
        resolvedAt: instant("2026-07-29T01:09:00.000Z"),
        consume: false,
      }),
    ).rejects.toMatchObject({
      code: "invalid-record",
    });
    await reopened.close();
  });

  it("fails closed for wrong ownership, expiry, conflicts, and digest corruption", async () => {
    const userDataPath = createTestDirectory();
    const workspaceRoot = path.join(userDataPath, "workspace");
    fs.mkdirSync(workspaceRoot);
    const persistence = openSqliteCorePersistence(userDataPath);
    await persistence.replaceDomainGraph(createDomainGraph());
    const grant = {
      contractVersion: 1,
      grantId: workspaceGrantId("grant-failure"),
      workspaceId: FIXTURE_WORKSPACE_ID,
      rootPath: fs.realpathSync(workspaceRoot),
      displayName: "Failure fixture",
      state: "active",
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    } as const;
    await persistence.persistWorkspaceGrant(grant);
    const input = {
      contractVersion: 1,
      reference: toolInputReference("input-failure"),
      kind: "tool-input",
      owner: {
        workspaceId: FIXTURE_WORKSPACE_ID,
        taskId: FIXTURE_TASK_ID,
        sessionId: FIXTURE_SESSION_ID,
        workerId: FIXTURE_WORKER_ID,
        grantId: grant.grantId,
      },
      classification: "workspace-content",
      mediaType: "text/plain; charset=utf-8",
      content: "content that must remain intact",
      createdAt: CREATED_AT,
      expiresAt: instant("2026-07-29T01:30:00.000Z"),
    } as const;
    await persistence.storeContentReference(input);
    await expect(
      persistence.resolveContentReference({
        contractVersion: 1,
        reference: input.reference,
        kind: input.kind,
        owner: {
          ...input.owner,
          taskId: taskId("task-wrong-owner"),
        },
        resolvedAt: instant("2026-07-29T01:10:00.000Z"),
        consume: false,
      }),
    ).rejects.toMatchObject({
      code: "content-ownership",
    });
    await expect(
      persistence.resolveContentReference({
        contractVersion: 1,
        reference: input.reference,
        kind: input.kind,
        owner: input.owner,
        resolvedAt: instant("2026-07-29T01:30:00.000Z"),
        consume: false,
      }),
    ).rejects.toMatchObject({
      code: "content-expired",
    });
    await expect(
      persistence.storeContentReference({
        ...input,
        content: "conflicting replacement",
      }),
    ).rejects.toMatchObject({
      code: "content-conflict",
    });
    await persistence.close();

    const database = new DatabaseSync(resolveCoreDatabasePath(userDataPath));
    database
      .prepare("UPDATE content_references SET content_blob = ? WHERE reference = ?")
      .run(Buffer.from("x".repeat(Buffer.byteLength(input.content))), input.reference);
    database.close();

    const reopened = openSqliteCorePersistence(userDataPath);
    await expect(
      reopened.resolveContentReference({
        contractVersion: 1,
        reference: input.reference,
        kind: input.kind,
        owner: input.owner,
        resolvedAt: instant("2026-07-29T01:10:00.000Z"),
        consume: false,
      }),
    ).rejects.toMatchObject({
      code: "content-integrity",
    });
    await reopened.close();
  });
});

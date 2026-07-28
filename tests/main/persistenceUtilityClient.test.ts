// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { instant, toolInputReference, workspaceGrantId } from "../../apps/desktop/src/core";
import { PersistenceUtilityError } from "../../apps/desktop/src/main/persistence/persistenceUtilityClient";
import { createDomainGraph, FIXTURE_WORKSPACE_ID } from "../fixtures/core";
import { openTestPersistenceUtility } from "../fixtures/persistenceUtility";

const testDirectories: string[] = [];

function createTestDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-utility-client-test-"));
  testDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of testDirectories.splice(0)) {
    if (!directory.startsWith(path.join(os.tmpdir(), "actestra-utility-client-test-"))) {
      throw new Error(`Refusing to remove unexpected test directory: ${directory}`);
    }
    fs.rmSync(directory, {
      recursive: true,
      force: true,
    });
  }
});

describe("persistence utility client", () => {
  it("round-trips P4.2 records and rejects response content digest drift", async () => {
    const userDataPath = createTestDirectory();
    const workspaceRoot = path.join(userDataPath, "fixture-workspace");
    fs.mkdirSync(workspaceRoot);
    const { client, transport } = await openTestPersistenceUtility(userDataPath);
    const graph = createDomainGraph();
    await client.replaceDomainGraph(graph);
    await expect(client.loadDomainGraph()).resolves.toEqual(graph);

    const grant = {
      contractVersion: 1,
      grantId: workspaceGrantId("grant-utility"),
      workspaceId: FIXTURE_WORKSPACE_ID,
      rootPath: fs.realpathSync(workspaceRoot),
      displayName: "Utility fixture",
      state: "active",
      createdAt: instant("2026-07-29T01:00:00.000Z"),
      updatedAt: instant("2026-07-29T01:00:00.000Z"),
    } as const;
    await expect(client.persistWorkspaceGrant(grant)).resolves.toMatchObject({
      status: "stored",
      grant,
    });
    await expect(client.getActiveWorkspaceGrant(FIXTURE_WORKSPACE_ID)).resolves.toEqual(grant);

    const contentInput = {
      contractVersion: 1,
      reference: toolInputReference("input-utility"),
      kind: "tool-input",
      owner: {
        workspaceId: graph.workspaces[0].id,
        taskId: graph.tasks[0].id,
        sessionId: graph.sessions[0].id,
        workerId: graph.workers[0].id,
        grantId: grant.grantId,
      },
      classification: "workspace-content",
      mediaType: "text/plain; charset=utf-8",
      content: "utility process content",
      createdAt: instant("2026-07-29T01:00:00.000Z"),
    } as const;
    await expect(client.storeContentReference(contentInput)).resolves.toMatchObject({
      status: "stored",
      metadata: {
        reference: "input-utility",
        byteLength: 23,
      },
    });
    const resolution = {
      contractVersion: 1,
      reference: contentInput.reference,
      kind: contentInput.kind,
      owner: contentInput.owner,
      resolvedAt: instant("2026-07-29T01:01:00.000Z"),
      consume: false,
    } as const;
    await expect(client.resolveContentReference(resolution)).resolves.toMatchObject({
      content: contentInput.content,
    });

    transport.transformNextResponse((response) => {
      if (
        response.type !== "response" ||
        response.status !== "ok" ||
        response.operation !== "resolve-content-reference"
      ) {
        throw new Error("Expected a successful content resolution response");
      }
      return {
        ...response,
        result: {
          ...response.result,
          content: "x".repeat(response.result.metadata.byteLength),
        },
      };
    });
    await expect(client.resolveContentReference(resolution)).rejects.toMatchObject({
      code: "invalid-message",
    });
    await expect(client.loadDomainGraph()).rejects.toMatchObject({
      code: "unavailable",
    });
    await client.close();
  });

  it("fails pending and future calls after utility exit without a fallback", async () => {
    const { client, transport } = await openTestPersistenceUtility(createTestDirectory());
    transport.holdNextResponse();
    const pending = client.loadDomainGraph();
    transport.crash(23);

    await expect(pending).rejects.toMatchObject({
      code: "unavailable",
    });
    await expect(client.loadDomainGraph()).rejects.toBeInstanceOf(PersistenceUtilityError);
    await expect(client.loadDomainGraph()).rejects.toMatchObject({
      code: "unavailable",
    });
    await expect(client.close()).resolves.toBeUndefined();
  });

  it("fails closed on malformed responses and request timeout", async () => {
    const malformed = await openTestPersistenceUtility(createTestDirectory());
    malformed.transport.transformNextResponse((response) => ({
      ...response,
      unexpected: true,
    }));
    await expect(malformed.client.loadDomainGraph()).rejects.toMatchObject({
      code: "invalid-message",
    });
    await expect(malformed.client.close()).resolves.toBeUndefined();

    const timedOut = await openTestPersistenceUtility(createTestDirectory(), {
      requestTimeoutMs: 20,
      startupTimeoutMs: 100,
    });
    timedOut.transport.dropNextResponse();
    await expect(timedOut.client.loadDomainGraph()).rejects.toMatchObject({
      code: "request-timeout",
    });
    await expect(timedOut.client.loadDomainGraph()).rejects.toMatchObject({
      code: "unavailable",
    });
    await expect(timedOut.client.close()).resolves.toBeUndefined();
  });
});

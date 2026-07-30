// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectAionUiHttpObservations,
  normalizeAionUiApprovalDecisionRequest,
  projectAionUiObservation,
} from "../../apps/desktop/src/compatibility/aionui";
import { instant, toolInputReference, workspaceGrantId } from "../../apps/desktop/src/core";
import { PersistenceUtilityError } from "../../apps/desktop/src/main/persistence/persistenceUtilityClient";
import { createDomainGraph, FIXTURE_WORKSPACE_ID } from "../fixtures/core";
import { createGeneralWorkCheckpoint } from "../fixtures/generalWorkRecovery";
import { createAionUiGeneralWorkRegistration } from "../fixtures/aionuiGeneralWork";
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
  it("preserves AionUI shadow evidence and approval authority through the utility boundary", async () => {
    const { client } = await openTestPersistenceUtility(createTestDirectory());
    await expect(
      client.getAionUiApprovalDecision("approval-decision-does-not-exist"),
    ).resolves.toBeUndefined();
    const [observation] = collectAionUiHttpObservations({
      method: "GET",
      path: "/api/conversations/conversation-utility",
      observedAtMs: Date.parse("2026-07-29T03:00:00.000Z"),
      response: {
        id: "conversation-utility",
        type: "acp",
        status: "running",
        created_at: Date.parse("2026-07-29T02:59:59.000Z"),
        modified_at: Date.parse("2026-07-29T03:00:00.000Z"),
      },
    });
    const evidence = projectAionUiObservation(observation);
    await expect(client.appendAionUiShadowEvidence(evidence)).resolves.toEqual({
      status: "appended",
      sequence: 1,
    });
    await expect(client.listRecentAionUiShadowEvidence(1)).resolves.toEqual([
      {
        sequence: 1,
        evidence,
      },
    ]);
    await expect(client.summarizeAionUiShadowEvidence()).resolves.toEqual({
      recordCount: 1,
      lastSequence: 1,
    });

    const decision = normalizeAionUiApprovalDecisionRequest({
      contractVersion: 1,
      method: "POST",
      path: "/api/conversations/conversation-utility/confirmations/call-utility/confirm",
      body: {
        msg_id: "message-utility",
        data: {
          value: "proceed_once",
        },
      },
    });
    await expect(
      client.reserveAionUiApprovalDecision(decision, "2026-07-29T05:00:00.000Z"),
    ).resolves.toMatchObject({
      status: "created",
      record: {
        decisionId: decision.decisionId,
        deliveryState: "pending-delivery",
      },
    });
    await expect(client.getAionUiApprovalDecision(decision.decisionId)).resolves.toMatchObject({
      decisionId: decision.decisionId,
    });
    await expect(client.listPendingAionUiApprovalDecisions(10)).resolves.toHaveLength(1);
    await expect(client.summarizeAionUiApprovalAuthority()).resolves.toEqual({
      recordCount: 1,
      pendingCount: 1,
      deliveredCount: 0,
    });
    await client.close();
  });

  it("round-trips P4.2 records and rejects response content digest drift", async () => {
    const userDataPath = createTestDirectory();
    const workspaceRoot = path.join(userDataPath, "fixture-workspace");
    fs.mkdirSync(workspaceRoot);
    const { client, transport } = await openTestPersistenceUtility(userDataPath);
    expect(client.schemaVersion).toBe(8);
    const graph = createDomainGraph();
    await client.replaceDomainGraph(graph);
    await expect(client.loadDomainGraph()).resolves.toEqual(graph);
    const checkpoint = createGeneralWorkCheckpoint();
    await expect(client.persistGeneralWorkCheckpoint(checkpoint)).resolves.toMatchObject({
      status: "stored",
      checkpoint,
    });
    await expect(client.getGeneralWorkCheckpoint(checkpoint.attempt.sessionId)).resolves.toEqual(
      checkpoint,
    );
    await expect(client.listRecoverableGeneralWorkCheckpoints(100)).resolves.toEqual([checkpoint]);

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

  it("round-trips AionUI general-work links through the utility process", async () => {
    const { client } = await openTestPersistenceUtility(createTestDirectory());
    const registration = createAionUiGeneralWorkRegistration("utility-journey");

    expect(client.registerAionUiGeneralWorkJourney).toBeTypeOf("function");
    expect(client.listAionUiGeneralWorkJourneyLinks).toBeTypeOf("function");
    expect(client.listPreparedAionUiGeneralWorkJourneyLinks).toBeTypeOf("function");
    await expect(client.registerAionUiGeneralWorkJourney(registration)).resolves.toEqual({
      status: "stored",
      link: registration.link,
    });
    await expect(client.registerAionUiGeneralWorkJourney(registration)).resolves.toEqual({
      status: "duplicate",
      link: registration.link,
    });
    await expect(
      client.listAionUiGeneralWorkJourneyLinks(registration.link.conversationHash, 10),
    ).resolves.toEqual([registration.link]);
    await expect(client.listPreparedAionUiGeneralWorkJourneyLinks(10)).resolves.toEqual([
      registration.link,
    ]);
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

  it("handles utility fatal errors and fixture transform failures without unhandled rejection", async () => {
    const fatal = await openTestPersistenceUtility(createTestDirectory());
    fatal.transport.holdNextResponse();
    const pending = fatal.client.loadDomainGraph();
    fatal.transport.fatalError();
    await expect(pending).rejects.toMatchObject({
      code: "unavailable",
    });
    await expect(fatal.client.close()).resolves.toBeUndefined();

    const transformFailure = await openTestPersistenceUtility(createTestDirectory());
    transformFailure.transport.transformNextResponse(() => {
      throw new Error("intentional transform failure");
    });
    await expect(transformFailure.client.loadDomainGraph()).rejects.toMatchObject({
      code: "unavailable",
    });
    await expect(transformFailure.client.close()).resolves.toBeUndefined();
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

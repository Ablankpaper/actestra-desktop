// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectAionUiHttpObservations,
  normalizeAionUiApprovalDecisionRequest,
  projectAionUiObservation,
} from "../../apps/desktop/src/compatibility/aionui";
import {
  admitTeamPlanCandidate,
  instant,
  normalizeTeamDefinition,
  normalizeTeamExperienceBinding,
  normalizeStandardTeamMessageDelivery,
  toolInputReference,
  transitionTeamRun,
  workspaceGrantId,
  type AdmittedTeamPlan,
  type PersistAdmittedTeamPlanResult,
  type TeamDefinition,
  type TeamExperienceBinding,
  type StandardTeamMessageDelivery,
  type TeamId,
  type TeamRunId,
  type TeamRunSnapshot,
} from "../../apps/desktop/src/core";
import { PersistenceUtilityError } from "../../apps/desktop/src/main/persistence/persistenceUtilityClient";
import { resolveCoreDatabasePath } from "../../apps/desktop/src/utility/persistence/sqliteCorePersistence";
import { CURRENT_CORE_SCHEMA_VERSION } from "../../apps/desktop/src/utility/persistence/sqliteMigrations";
import { createDomainGraph, FIXTURE_WORKSPACE_ID } from "../fixtures/core";
import { createGeneralWorkCheckpoint } from "../fixtures/generalWorkRecovery";
import { createAionUiGeneralWorkRegistration } from "../fixtures/aionuiGeneralWork";
import { createAionUiScheduleRegistration } from "../fixtures/aionuiSchedule";
import { openTestPersistenceUtility } from "../fixtures/persistenceUtility";
import { createTeamRunFixture } from "../fixtures/teamRun";

const testDirectories: string[] = [];

const TEAM_PLAN_REQUEST = {
  protocolVersion: 1,
  correlationId: "correlation-persistence-team-plan",
  planVersion: 1,
  goal: "Persist one bounded mixed team plan before scheduling.",
  workerCapabilities: ["general", "coding"],
  contextReferences: [],
  limits: {
    maxNodes: 3,
    maxDepth: 2,
    maxConcurrency: 2,
    maxTotalAttempts: 3,
  },
} as const;

const TEAM_PLAN_CANDIDATE = {
  protocolVersion: 1,
  correlationId: TEAM_PLAN_REQUEST.correlationId,
  planVersion: TEAM_PLAN_REQUEST.planVersion,
  summary: "Run bounded General and coding work in parallel, then request feedback.",
  nodes: [
    {
      candidateKey: "general",
      title: "Prepare the bounded brief",
      kind: "worker",
      capability: "general",
      dependsOn: [],
      expectedArtifactKind: "document",
      completionCriteria: "One bounded brief is available.",
      risk: "low",
      maxAttempts: 1,
    },
    {
      candidateKey: "coding",
      title: "Prepare the bounded patch",
      kind: "worker",
      capability: "coding",
      dependsOn: [],
      expectedArtifactKind: "file",
      completionCriteria: "One reviewed patch is available.",
      risk: "medium",
      maxAttempts: 1,
    },
    {
      candidateKey: "feedback",
      title: "Request user feedback",
      kind: "human-feedback",
      dependsOn: ["general", "coding"],
      completionCriteria: "The user accepts or rejects the bounded result.",
      risk: "medium",
    },
  ],
} as const;

interface TeamPlanPersistenceClient {
  persistAdmittedTeamPlan(plan: AdmittedTeamPlan): Promise<PersistAdmittedTeamPlanResult>;
  getAdmittedTeamPlan(planId: string): Promise<AdmittedTeamPlan | null>;
  close(): Promise<void>;
}

interface TeamRunPersistenceClient extends TeamPlanPersistenceClient {
  persistTeamExperienceBinding(binding: TeamExperienceBinding): Promise<{
    readonly status: "stored" | "duplicate";
    readonly binding: TeamExperienceBinding;
  }>;
  getTeamExperienceBinding(teamId: string): Promise<TeamExperienceBinding | null>;
  persistStandardTeamMessageDelivery(delivery: StandardTeamMessageDelivery): Promise<{
    readonly status: "stored" | "duplicate";
    readonly delivery: StandardTeamMessageDelivery;
  }>;
  getStandardTeamMessageDelivery(deliveryId: string): Promise<StandardTeamMessageDelivery | null>;
  listUnresolvedStandardTeamMessageDeliveries(
    limit: number,
  ): Promise<readonly StandardTeamMessageDelivery[]>;
  persistTeamDefinition(
    team: TeamDefinition,
  ): Promise<{ readonly status: "stored" | "duplicate"; readonly team: TeamDefinition }>;
  getTeamDefinition(teamId: TeamId): Promise<TeamDefinition | null>;
  listTeamDefinitions(limit: number): Promise<readonly TeamDefinition[]>;
  replaceTeamDefinition(
    expected: TeamDefinition,
    replacement: TeamDefinition,
  ): Promise<{ readonly status: "stored" | "duplicate"; readonly team: TeamDefinition }>;
  removeTeamDefinition(
    expected: TeamDefinition,
    removedAt: ReturnType<typeof instant>,
  ): Promise<{ readonly status: "removed" | "duplicate"; readonly teamId: TeamId }>;
  persistTeamRunSnapshot(snapshot: TeamRunSnapshot): Promise<{
    readonly status: "stored" | "duplicate";
    readonly snapshot: TeamRunSnapshot;
  }>;
  getTeamRunSnapshot(runId: TeamRunId): Promise<TeamRunSnapshot | null>;
  listRecoverableTeamRuns(limit: number): Promise<readonly TeamRunSnapshot[]>;
  listTeamRunsForTeam(teamId: TeamId, limit: number): Promise<readonly TeamRunSnapshot[]>;
}

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
    expect(client.schemaVersion).toBe(CURRENT_CORE_SCHEMA_VERSION);
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

  it("persists an admitted team plan idempotently and restores it after reopening", async () => {
    const userDataPath = createTestDirectory();
    const plan = await admitTeamPlanCandidate(TEAM_PLAN_REQUEST, TEAM_PLAN_CANDIDATE);
    const opened = await openTestPersistenceUtility(userDataPath);
    const client = opened.client as unknown as TeamPlanPersistenceClient;

    expect(client.persistAdmittedTeamPlan).toBeTypeOf("function");
    expect(client.getAdmittedTeamPlan).toBeTypeOf("function");
    await expect(client.persistAdmittedTeamPlan(plan)).resolves.toEqual({
      status: "stored",
      plan,
    });
    await expect(client.persistAdmittedTeamPlan(plan)).resolves.toEqual({
      status: "duplicate",
      plan,
    });
    await expect(client.getAdmittedTeamPlan(plan.planId)).resolves.toEqual(plan);
    await client.close();

    const reopened = await openTestPersistenceUtility(userDataPath);
    const reopenedClient = reopened.client as unknown as TeamPlanPersistenceClient;
    reopened.transport.transformNextResponse(
      (response) => JSON.parse(JSON.stringify(response)) as unknown,
    );
    const restored = await reopenedClient.getAdmittedTeamPlan(plan.planId);
    expect(restored).toEqual(plan);
    expect(Object.isFrozen(restored)).toBe(true);
    expect(restored?.nodes.every(Object.isFrozen)).toBe(true);
    await reopenedClient.close();
  });

  it("round-trips schema 15 Team definitions and run revisions after reopening", async () => {
    const userDataPath = createTestDirectory();
    const { plan, team, accepted } = await createTeamRunFixture("client-round-trip");
    const opened = await openTestPersistenceUtility(userDataPath);
    const client = opened.client as unknown as TeamRunPersistenceClient;
    await client.persistAdmittedTeamPlan(plan);

    await expect(client.persistTeamDefinition(team)).resolves.toEqual({
      status: "stored",
      team,
    });
    const replacement = normalizeTeamDefinition({
      ...team,
      name: "Client replacement Team",
      updatedAt: "2026-08-04T01:00:02.000Z",
    });
    await expect(client.replaceTeamDefinition(team, replacement)).resolves.toEqual({
      status: "stored",
      team: replacement,
    });
    await expect(client.persistTeamRunSnapshot(accepted)).resolves.toEqual({
      status: "stored",
      snapshot: accepted,
    });
    await expect(client.getTeamDefinition(team.teamId)).resolves.toEqual(replacement);
    await expect(client.getTeamRunSnapshot(accepted.runId)).resolves.toEqual(accepted);
    await expect(client.listTeamDefinitions(100)).resolves.toEqual([replacement]);
    await expect(client.listRecoverableTeamRuns(100)).resolves.toEqual([accepted]);
    await expect(client.listTeamRunsForTeam(team.teamId, 100)).resolves.toEqual([accepted]);
    const cancelled = transitionTeamRun(accepted, {
      type: "cancel-run",
      reason: "Close the client fixture before Team removal.",
      occurredAt: instant("2026-08-04T01:00:03.000Z"),
    });
    await client.persistTeamRunSnapshot(cancelled);
    await expect(
      client.removeTeamDefinition(replacement, instant("2026-08-04T01:00:04.000Z")),
    ).resolves.toEqual({ status: "removed", teamId: team.teamId });
    await expect(client.getTeamDefinition(team.teamId)).resolves.toBeNull();
    await client.close();

    const reopened = await openTestPersistenceUtility(userDataPath);
    const reopenedClient = reopened.client as unknown as TeamRunPersistenceClient;
    const restored = await reopenedClient.getTeamRunSnapshot(accepted.runId);
    expect(restored).toEqual(cancelled);
    expect(Object.isFrozen(restored)).toBe(true);
    await reopenedClient.close();
  });

  it("round-trips the first immutable Team experience binding and accepts same-type retries", async () => {
    const userDataPath = createTestDirectory();
    const opened = await openTestPersistenceUtility(userDataPath);
    const client = opened.client as unknown as TeamRunPersistenceClient;
    const binding = normalizeTeamExperienceBinding({
      contractVersion: 1,
      teamId: "native-team-client-binding",
      experience: "standard",
      boundAt: "2026-08-06T02:15:00.000Z",
    });

    await expect(client.persistTeamExperienceBinding(binding)).resolves.toEqual({
      status: "stored",
      binding,
    });
    await expect(
      client.persistTeamExperienceBinding(
        normalizeTeamExperienceBinding({ ...binding, boundAt: "2026-08-06T02:16:00.000Z" }),
      ),
    ).resolves.toEqual({ status: "duplicate", binding });
    await client.close();

    const reopened = await openTestPersistenceUtility(userDataPath);
    const reopenedClient = reopened.client as unknown as TeamRunPersistenceClient;
    await expect(reopenedClient.getTeamExperienceBinding(binding.teamId)).resolves.toEqual(binding);
    await reopenedClient.close();
  });

  it("round-trips metadata-only Standard Team message delivery authority through utility SQLite", async () => {
    const userDataPath = createTestDirectory();
    const delivery = normalizeStandardTeamMessageDelivery({
      contractVersion: 1,
      deliveryId: `standard-team-delivery-${"7".repeat(64)}`,
      clientRequestNonce: `team-request-${"8".repeat(64)}`,
      requestSha256: "9".repeat(64),
      teamId: "native-team-client-message",
      targetSlotId: null,
      state: "pending-effect",
      providerEnqueueStatus: null,
      providerMessageId: null,
      providerRunId: null,
      createdAt: "2026-08-06T08:20:00.000Z",
      updatedAt: "2026-08-06T08:20:00.000Z",
    });
    const opened = await openTestPersistenceUtility(userDataPath);
    const client = opened.client as unknown as TeamRunPersistenceClient;

    expect(client.persistStandardTeamMessageDelivery).toBeTypeOf("function");
    expect(client.getStandardTeamMessageDelivery).toBeTypeOf("function");
    await expect(client.persistStandardTeamMessageDelivery(delivery)).resolves.toEqual({
      status: "stored",
      delivery,
    });
    expect(client.listUnresolvedStandardTeamMessageDeliveries).toBeTypeOf("function");
    await expect(client.listUnresolvedStandardTeamMessageDeliveries(100)).resolves.toEqual([
      delivery,
    ]);
    const observed = normalizeStandardTeamMessageDelivery({
      ...delivery,
      state: "effect-observed",
      providerEnqueueStatus: "queued",
      providerMessageId: "native-message-client",
      providerRunId: "native-run-client",
      updatedAt: "2026-08-06T08:20:01.000Z",
    });
    await expect(client.persistStandardTeamMessageDelivery(observed)).resolves.toEqual({
      status: "stored",
      delivery: observed,
    });
    await expect(client.listUnresolvedStandardTeamMessageDeliveries(100)).resolves.toEqual([]);
    await client.close();

    const reopened = await openTestPersistenceUtility(userDataPath);
    const reopenedClient = reopened.client as unknown as TeamRunPersistenceClient;
    await expect(
      reopenedClient.getStandardTeamMessageDelivery(delivery.deliveryId),
    ).resolves.toEqual(observed);
    await reopenedClient.close();
  });

  it("fails closed when a Standard Team delivery persistence response substitutes authoritative bytes", async () => {
    const userDataPath = createTestDirectory();
    const delivery = normalizeStandardTeamMessageDelivery({
      contractVersion: 1,
      deliveryId: `standard-team-delivery-${"a".repeat(64)}`,
      clientRequestNonce: `team-request-${"b".repeat(64)}`,
      requestSha256: "c".repeat(64),
      teamId: "native-team-client-delivery-substitution",
      targetSlotId: null,
      state: "pending-effect",
      providerEnqueueStatus: null,
      providerMessageId: null,
      providerRunId: null,
      createdAt: "2026-08-06T08:30:00.000Z",
      updatedAt: "2026-08-06T08:30:00.000Z",
    });
    const opened = await openTestPersistenceUtility(userDataPath);
    const client = opened.client as unknown as TeamRunPersistenceClient;
    opened.transport.transformNextResponse((response) => {
      if (
        response.type !== "response" ||
        response.status !== "ok" ||
        response.operation !== "persist-standard-team-message-delivery"
      ) {
        throw new Error("Expected a successful Standard Team delivery persistence response");
      }
      return {
        ...response,
        result: {
          ...response.result,
          delivery: {
            ...response.result.delivery,
            targetSlotId: "native-slot-substituted",
            state: "effect-uncertain",
            providerMessageId: "native-message-substituted",
            providerRunId: "native-run-substituted",
            createdAt: "2026-08-06T08:29:00.000Z",
            updatedAt: "2026-08-06T08:31:00.000Z",
          },
        },
      };
    });

    await expect(client.persistStandardTeamMessageDelivery(delivery)).rejects.toMatchObject({
      name: "PersistenceUtilityError",
      code: "invalid-message",
    });
    await expect(client.getStandardTeamMessageDelivery(delivery.deliveryId)).rejects.toMatchObject({
      code: "unavailable",
    });
    await client.close();
  });

  it("fails closed when an unresolved Standard Team delivery list contains an observed item", async () => {
    const userDataPath = createTestDirectory();
    const delivery = normalizeStandardTeamMessageDelivery({
      contractVersion: 1,
      deliveryId: `standard-team-delivery-${"d".repeat(64)}`,
      clientRequestNonce: `team-request-${"e".repeat(64)}`,
      requestSha256: "f".repeat(64),
      teamId: "native-team-client-unresolved-substitution",
      targetSlotId: null,
      state: "pending-effect",
      providerEnqueueStatus: null,
      providerMessageId: null,
      providerRunId: null,
      createdAt: "2026-08-06T08:40:00.000Z",
      updatedAt: "2026-08-06T08:40:00.000Z",
    });
    const opened = await openTestPersistenceUtility(userDataPath);
    const client = opened.client as unknown as TeamRunPersistenceClient;
    await client.persistStandardTeamMessageDelivery(delivery);
    opened.transport.transformNextResponse((response) => {
      if (
        response.type !== "response" ||
        response.status !== "ok" ||
        response.operation !== "list-unresolved-standard-team-message-deliveries"
      ) {
        throw new Error("Expected a successful unresolved Standard Team delivery list response");
      }
      return {
        ...response,
        result: response.result.map((candidate) => ({
          ...candidate,
          state: "effect-observed" as const,
          providerEnqueueStatus: "accepted" as const,
          providerMessageId: "native-message-observed",
          providerRunId: "native-run-observed",
        })),
      };
    });

    await expect(client.listUnresolvedStandardTeamMessageDeliveries(100)).rejects.toMatchObject({
      name: "PersistenceUtilityError",
      code: "invalid-message",
    });
    await expect(client.getStandardTeamMessageDelivery(delivery.deliveryId)).rejects.toMatchObject({
      code: "unavailable",
    });
    await client.close();
  });

  it("fails closed when an unresolved Standard Team delivery list exceeds its requested limit", async () => {
    const userDataPath = createTestDirectory();
    const delivery = normalizeStandardTeamMessageDelivery({
      contractVersion: 1,
      deliveryId: `standard-team-delivery-${"1".repeat(64)}`,
      clientRequestNonce: `team-request-${"2".repeat(64)}`,
      requestSha256: "3".repeat(64),
      teamId: "native-team-client-unresolved-limit",
      targetSlotId: null,
      state: "pending-effect",
      providerEnqueueStatus: null,
      providerMessageId: null,
      providerRunId: null,
      createdAt: "2026-08-06T08:50:00.000Z",
      updatedAt: "2026-08-06T08:50:00.000Z",
    });
    const opened = await openTestPersistenceUtility(userDataPath);
    const client = opened.client as unknown as TeamRunPersistenceClient;
    await client.persistStandardTeamMessageDelivery(delivery);
    opened.transport.transformNextResponse((response) => {
      if (
        response.type !== "response" ||
        response.status !== "ok" ||
        response.operation !== "list-unresolved-standard-team-message-deliveries"
      ) {
        throw new Error("Expected a successful unresolved Standard Team delivery list response");
      }
      return {
        ...response,
        result: [
          ...response.result,
          {
            ...response.result[0]!,
            deliveryId: `standard-team-delivery-${"4".repeat(64)}`,
            clientRequestNonce: `team-request-${"5".repeat(64)}`,
            requestSha256: "6".repeat(64),
            teamId: "native-team-client-unresolved-limit-substituted",
          },
        ],
      };
    });

    await expect(client.listUnresolvedStandardTeamMessageDeliveries(1)).rejects.toMatchObject({
      name: "PersistenceUtilityError",
      code: "invalid-message",
    });
    await expect(client.getStandardTeamMessageDelivery(delivery.deliveryId)).rejects.toMatchObject({
      code: "unavailable",
    });
    await client.close();
  });

  it("fails closed when a Team definition persistence response substitutes authoritative bytes", async () => {
    const userDataPath = createTestDirectory();
    const { plan, team } = await createTeamRunFixture("client-substitution");
    const opened = await openTestPersistenceUtility(userDataPath);
    const client = opened.client as unknown as TeamRunPersistenceClient;
    await client.persistAdmittedTeamPlan(plan);
    opened.transport.transformNextResponse((response) => {
      if (
        response.type !== "response" ||
        response.status !== "ok" ||
        response.operation !== "persist-team-definition"
      ) {
        throw new Error("Expected a successful Team definition response");
      }
      return {
        ...response,
        result: {
          ...response.result,
          team: {
            ...response.result.team,
            name: "Substituted but structurally valid Team bytes",
          },
        },
      };
    });

    await expect(client.persistTeamDefinition(team)).rejects.toMatchObject({
      name: "PersistenceUtilityError",
      code: "invalid-message",
    });
    await expect(client.getTeamDefinition(team.teamId)).rejects.toMatchObject({
      code: "unavailable",
    });
    await client.close();
  });

  it("fails closed when a Team run lookup substitutes another run identity", async () => {
    const userDataPath = createTestDirectory();
    const first = await createTeamRunFixture("client-lookup-first");
    const second = await createTeamRunFixture("client-lookup-second");
    const opened = await openTestPersistenceUtility(userDataPath);
    const client = opened.client as unknown as TeamRunPersistenceClient;
    for (const fixture of [first, second]) {
      await client.persistAdmittedTeamPlan(fixture.plan);
      await client.persistTeamDefinition(fixture.team);
      await client.persistTeamRunSnapshot(fixture.accepted);
    }
    opened.transport.transformNextResponse((response) => {
      if (
        response.type !== "response" ||
        response.status !== "ok" ||
        response.operation !== "get-team-run-snapshot"
      ) {
        throw new Error("Expected a successful Team run lookup response");
      }
      return { ...response, result: second.accepted };
    });

    await expect(client.getTeamRunSnapshot(first.accepted.runId)).rejects.toMatchObject({
      name: "PersistenceUtilityError",
      code: "invalid-message",
    });
    await expect(client.getTeamRunSnapshot(first.accepted.runId)).rejects.toMatchObject({
      code: "unavailable",
    });
    await client.close();
  });

  it("rejects structurally valid team-plan bytes that drift from the durable record digest", async () => {
    const userDataPath = createTestDirectory();
    const plan = await admitTeamPlanCandidate(TEAM_PLAN_REQUEST, TEAM_PLAN_CANDIDATE);
    const opened = await openTestPersistenceUtility(userDataPath);
    const client = opened.client as unknown as TeamPlanPersistenceClient;
    await client.persistAdmittedTeamPlan(plan);
    await client.close();

    const database = new DatabaseSync(resolveCoreDatabasePath(userDataPath));
    const row = database
      .prepare("SELECT plan_json FROM team_plans WHERE plan_id = ?")
      .get(plan.planId) as { plan_json: string };
    const drifted = JSON.parse(row.plan_json) as Record<string, unknown>;
    drifted.summary = "A different but still structurally valid summary.";
    database
      .prepare("UPDATE team_plans SET plan_json = ? WHERE plan_id = ?")
      .run(JSON.stringify(drifted), plan.planId);
    database.close();

    const reopened = await openTestPersistenceUtility(userDataPath);
    const reopenedClient = reopened.client as unknown as TeamPlanPersistenceClient;
    await expect(reopenedClient.getAdmittedTeamPlan(plan.planId)).rejects.toMatchObject({
      name: "PersistenceError",
      code: "corrupt-database",
    });
    await reopenedClient.close();
  });

  it("fails the utility client when a persisted team-plan response drifts from its request", async () => {
    const userDataPath = createTestDirectory();
    const plan = await admitTeamPlanCandidate(TEAM_PLAN_REQUEST, TEAM_PLAN_CANDIDATE);
    const opened = await openTestPersistenceUtility(userDataPath);
    const client = opened.client as unknown as TeamPlanPersistenceClient;
    opened.transport.transformNextResponse((response) => {
      if (
        response.type !== "response" ||
        response.status !== "ok" ||
        response.operation !== "persist-admitted-team-plan"
      ) {
        throw new Error("Expected a successful team-plan persistence response");
      }
      return {
        ...response,
        result: {
          ...response.result,
          plan: {
            ...response.result.plan,
            summary: "A valid-looking but substituted response summary.",
          },
        },
      };
    });

    await expect(client.persistAdmittedTeamPlan(plan)).rejects.toMatchObject({
      name: "PersistenceUtilityError",
      code: "invalid-message",
    });
    await expect(client.getAdmittedTeamPlan(plan.planId)).rejects.toMatchObject({
      code: "unavailable",
    });
    await client.close();

    const reopened = await openTestPersistenceUtility(userDataPath);
    const reopenedClient = reopened.client as unknown as TeamPlanPersistenceClient;
    await expect(reopenedClient.persistAdmittedTeamPlan(plan)).resolves.toMatchObject({
      status: "duplicate",
      plan,
    });
    await reopenedClient.close();
  });

  it("fails the utility client when a team-plan lookup response substitutes another identity", async () => {
    const userDataPath = createTestDirectory();
    const plan = await admitTeamPlanCandidate(TEAM_PLAN_REQUEST, TEAM_PLAN_CANDIDATE);
    const substituted = await admitTeamPlanCandidate(TEAM_PLAN_REQUEST, {
      ...TEAM_PLAN_CANDIDATE,
      summary: "A different admitted candidate with another deterministic plan identity.",
    });
    const opened = await openTestPersistenceUtility(userDataPath);
    const client = opened.client as unknown as TeamPlanPersistenceClient;
    await client.persistAdmittedTeamPlan(plan);
    opened.transport.transformNextResponse((response) => {
      if (
        response.type !== "response" ||
        response.status !== "ok" ||
        response.operation !== "get-admitted-team-plan"
      ) {
        throw new Error("Expected a successful team-plan lookup response");
      }
      return { ...response, result: substituted };
    });

    await expect(client.getAdmittedTeamPlan(plan.planId)).rejects.toMatchObject({
      name: "PersistenceUtilityError",
      code: "invalid-message",
    });
    await expect(client.getAdmittedTeamPlan(plan.planId)).rejects.toMatchObject({
      code: "unavailable",
    });
    await client.close();
  });

  it("rejects a different admitted plan for the same durable correlation and version", async () => {
    const userDataPath = createTestDirectory();
    const plan = await admitTeamPlanCandidate(TEAM_PLAN_REQUEST, TEAM_PLAN_CANDIDATE);
    const conflicting = await admitTeamPlanCandidate(TEAM_PLAN_REQUEST, {
      ...TEAM_PLAN_CANDIDATE,
      summary: "A conflicting candidate for the same authoritative request version.",
    });
    const opened = await openTestPersistenceUtility(userDataPath);
    const client = opened.client as unknown as TeamPlanPersistenceClient;

    await client.persistAdmittedTeamPlan(plan);
    await expect(client.persistAdmittedTeamPlan(conflicting)).rejects.toMatchObject({
      name: "PersistenceError",
      code: "team-plan-conflict",
    });
    await expect(client.getAdmittedTeamPlan(plan.planId)).resolves.toEqual(plan);
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

  it("round-trips schedule authority and run claims through the utility process", async () => {
    const userDataPath = createTestDirectory();
    const { client } = await openTestPersistenceUtility(userDataPath);
    const registration = createAionUiScheduleRegistration("utility-schedule", userDataPath);
    const updatedAtMs = registration.job.updatedAtMs + 1_000;

    await expect(client.registerAionUiSchedule(registration)).resolves.toEqual({
      status: "stored",
      job: registration.job,
    });
    await expect(client.registerAionUiSchedule(registration)).resolves.toEqual({
      status: "duplicate",
      job: registration.job,
    });
    await expect(
      client.listAionUiSchedules({
        limit: 100,
        conversationHash: registration.job.conversationHash,
      }),
    ).resolves.toEqual([registration.job]);
    await expect(client.getAionUiSchedule(registration.job.id)).resolves.toEqual(registration.job);
    await expect(
      client.updateAionUiSchedule({
        jobId: registration.job.id,
        updatedAtMs,
        name: "Utility schedule updated",
      }),
    ).resolves.toMatchObject({
      status: "updated",
      job: { name: "Utility schedule updated" },
    });

    await expect(
      client.claimAionUiScheduleRun({
        jobId: registration.job.id,
        claim: "claim-utility-schedule-1",
        claimedAtMs: updatedAtMs + 1,
      }),
    ).resolves.toMatchObject({ status: "claimed", job: { runSequence: 1 } });
    await expect(
      client.completeAionUiScheduleRun({
        jobId: registration.job.id,
        claim: "claim-utility-schedule-1",
        completedAtMs: updatedAtMs + 2,
        status: "ok",
        nextRunAtMs: updatedAtMs + 60_000,
      }),
    ).resolves.toMatchObject({ status: "completed", job: { runCount: 1 } });
    await client.claimAionUiScheduleRun({
      jobId: registration.job.id,
      claim: "claim-utility-schedule-2",
      claimedAtMs: updatedAtMs + 3,
    });
    await expect(
      client.recoverAionUiScheduleRuns({ recoveredAtMs: updatedAtMs + 4 }),
    ).resolves.toEqual([
      expect.objectContaining({
        lastStatus: "error",
        lastIncidentCode: "interrupted",
        runSequence: 2,
        runCount: 2,
      }),
    ]);
    await expect(
      client.deleteAionUiSchedule({
        jobId: registration.job.id,
        deletedAtMs: updatedAtMs + 5,
      }),
    ).resolves.toMatchObject({ status: "deleted" });
    await expect(client.getAionUiSchedule(registration.job.id)).resolves.toBeNull();
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

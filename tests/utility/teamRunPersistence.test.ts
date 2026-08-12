// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  artifactId,
  instant,
  normalizeTeamDefinition,
  normalizeTeamExperienceBinding,
  normalizeTeamRunSnapshot,
  taskId,
  transitionTeamRun,
  type TeamDefinition,
  type TeamExperienceBinding,
  type TeamId,
  type TeamRunId,
  type TeamRunSnapshot,
} from "../../apps/desktop/src/core";
import {
  openSqliteCorePersistence,
  resolveCoreDatabasePath,
} from "../../apps/desktop/src/utility/persistence/sqliteCorePersistence";
import { createTeamRunFixture } from "../fixtures/teamRun";

interface TeamRunPersistence {
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

interface TeamExperiencePersistence {
  persistTeamExperienceBinding(binding: TeamExperienceBinding): Promise<{
    readonly status: "stored" | "duplicate";
    readonly binding: TeamExperienceBinding;
  }>;
  getTeamExperienceBinding(teamId: string): Promise<TeamExperienceBinding | null>;
}

type StandardTeamMessageDelivery = Readonly<{
  contractVersion: 1;
  deliveryId: string;
  clientRequestNonce: string;
  requestSha256: string;
  teamId: string;
  targetSlotId: string | null;
  state: "pending-effect" | "effect-observed" | "effect-uncertain";
  providerEnqueueStatus: "accepted" | "queued" | "blocked_runtime_starting" | null;
  providerMessageId: string | null;
  providerRunId: string | null;
  createdAt: ReturnType<typeof instant>;
  updatedAt: ReturnType<typeof instant>;
}>;

interface StandardTeamMessageDeliveryPersistence {
  persistStandardTeamMessageDelivery(delivery: StandardTeamMessageDelivery): Promise<{
    readonly status: "stored" | "duplicate";
    readonly delivery: StandardTeamMessageDelivery;
  }>;
  getStandardTeamMessageDelivery(deliveryId: string): Promise<StandardTeamMessageDelivery | null>;
  listUnresolvedStandardTeamMessageDeliveries(
    limit: number,
  ): Promise<readonly StandardTeamMessageDelivery[]>;
}

const testDirectories: string[] = [];

function createTestDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-team-run-store-test-"));
  testDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of testDirectories.splice(0)) {
    if (!directory.startsWith(path.join(os.tmpdir(), "actestra-team-run-store-test-"))) {
      throw new Error(`Refusing to remove unexpected test directory: ${directory}`);
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("schema 15 Team run persistence", () => {
  it("persists one immutable Core-owned experience binding for standard and orchestrated Team identities", async () => {
    const userDataPath = createTestDirectory();
    const persistence = openSqliteCorePersistence(userDataPath);
    const experiencePersistence = persistence as unknown as TeamExperiencePersistence;
    const standard = normalizeTeamExperienceBinding({
      contractVersion: 1,
      teamId: "019fd31e-a4bd-7b41-ba88-2bf6cddae0aa",
      experience: "standard",
      boundAt: "2026-08-06T02:15:00.000Z",
    });

    expect(experiencePersistence.persistTeamExperienceBinding).toBeTypeOf("function");
    expect(experiencePersistence.getTeamExperienceBinding).toBeTypeOf("function");
    await expect(experiencePersistence.persistTeamExperienceBinding(standard)).resolves.toEqual({
      status: "stored",
      binding: standard,
    });
    await expect(experiencePersistence.persistTeamExperienceBinding(standard)).resolves.toEqual({
      status: "duplicate",
      binding: standard,
    });
    await expect(
      experiencePersistence.persistTeamExperienceBinding(
        normalizeTeamExperienceBinding({ ...standard, boundAt: "2026-08-06T02:16:00.000Z" }),
      ),
    ).resolves.toEqual({ status: "duplicate", binding: standard });
    await expect(
      experiencePersistence.persistTeamExperienceBinding(
        normalizeTeamExperienceBinding({ ...standard, experience: "orchestrated" }),
      ),
    ).rejects.toMatchObject({ code: "team-experience-conflict" });
    await persistence.close();

    const reopened = openSqliteCorePersistence(
      userDataPath,
    ) as unknown as TeamExperiencePersistence;
    await expect(reopened.getTeamExperienceBinding(standard.teamId)).resolves.toEqual(standard);
    await (reopened as unknown as { close(): Promise<void> }).close();
  });

  it("persists standard Team message intent before effect and replays only an observed acknowledgement", async () => {
    const userDataPath = createTestDirectory();
    const persistence = openSqliteCorePersistence(
      userDataPath,
    ) as unknown as StandardTeamMessageDeliveryPersistence & { close(): Promise<void> };
    const pending = Object.freeze({
      contractVersion: 1 as const,
      deliveryId: `standard-team-delivery-${"a".repeat(64)}`,
      clientRequestNonce: `team-request-${"b".repeat(64)}`,
      requestSha256: "c".repeat(64),
      teamId: "native-team-message-authority",
      targetSlotId: null,
      state: "pending-effect" as const,
      providerEnqueueStatus: null,
      providerMessageId: null,
      providerRunId: null,
      createdAt: instant("2026-08-06T08:00:00.000Z"),
      updatedAt: instant("2026-08-06T08:00:00.000Z"),
    });

    expect(persistence.persistStandardTeamMessageDelivery).toBeTypeOf("function");
    expect(persistence.getStandardTeamMessageDelivery).toBeTypeOf("function");
    await expect(persistence.persistStandardTeamMessageDelivery(pending)).resolves.toEqual({
      status: "stored",
      delivery: pending,
    });
    await expect(persistence.persistStandardTeamMessageDelivery(pending)).resolves.toEqual({
      status: "duplicate",
      delivery: pending,
    });

    const secondPending = Object.freeze({
      ...pending,
      deliveryId: `standard-team-delivery-${"d".repeat(64)}`,
      clientRequestNonce: `team-request-${"e".repeat(64)}`,
      requestSha256: "f".repeat(64),
    });
    await expect(
      persistence.persistStandardTeamMessageDelivery(secondPending),
    ).rejects.toMatchObject({
      code: "team-message-delivery-conflict",
    });

    const observed = Object.freeze({
      ...pending,
      state: "effect-observed" as const,
      providerEnqueueStatus: "queued" as const,
      providerMessageId: "native-message-1",
      providerRunId: "native-run-1",
      updatedAt: instant("2026-08-06T08:00:01.000Z"),
    });
    await expect(persistence.persistStandardTeamMessageDelivery(observed)).resolves.toEqual({
      status: "stored",
      delivery: observed,
    });
    await expect(persistence.persistStandardTeamMessageDelivery(observed)).resolves.toEqual({
      status: "duplicate",
      delivery: observed,
    });
    await expect(
      persistence.persistStandardTeamMessageDelivery({
        ...observed,
        requestSha256: "9".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "team-message-delivery-conflict" });
    await persistence.close();

    const reopened = openSqliteCorePersistence(
      userDataPath,
    ) as unknown as StandardTeamMessageDeliveryPersistence & { close(): Promise<void> };
    await expect(reopened.getStandardTeamMessageDelivery(observed.deliveryId)).resolves.toEqual(
      observed,
    );
    await expect(reopened.persistStandardTeamMessageDelivery(secondPending)).resolves.toEqual({
      status: "stored",
      delivery: secondPending,
    });
    await reopened.close();
  });

  it("recovers an interrupted standard Team message as uncertain without allowing another effect", async () => {
    const userDataPath = createTestDirectory();
    const pending = Object.freeze({
      contractVersion: 1 as const,
      deliveryId: `standard-team-delivery-${"1".repeat(64)}`,
      clientRequestNonce: `team-request-${"2".repeat(64)}`,
      requestSha256: "3".repeat(64),
      teamId: "native-team-message-recovery",
      targetSlotId: "native-slot-claude",
      state: "pending-effect" as const,
      providerEnqueueStatus: null,
      providerMessageId: null,
      providerRunId: null,
      createdAt: instant("2026-08-06T08:10:00.000Z"),
      updatedAt: instant("2026-08-06T08:10:00.000Z"),
    });
    const persistence = openSqliteCorePersistence(
      userDataPath,
    ) as unknown as StandardTeamMessageDeliveryPersistence & { close(): Promise<void> };
    await persistence.persistStandardTeamMessageDelivery(pending);
    await persistence.close();

    const reopened = openSqliteCorePersistence(
      userDataPath,
    ) as unknown as StandardTeamMessageDeliveryPersistence & { close(): Promise<void> };
    await expect(reopened.getStandardTeamMessageDelivery(pending.deliveryId)).resolves.toEqual(
      pending,
    );
    expect(reopened.listUnresolvedStandardTeamMessageDeliveries).toBeTypeOf("function");
    await expect(reopened.listUnresolvedStandardTeamMessageDeliveries(100)).resolves.toEqual([
      pending,
    ]);
    const uncertain = Object.freeze({
      ...pending,
      state: "effect-uncertain" as const,
      updatedAt: instant("2026-08-06T08:11:00.000Z"),
    });
    await expect(reopened.persistStandardTeamMessageDelivery(uncertain)).resolves.toEqual({
      status: "stored",
      delivery: uncertain,
    });
    await expect(reopened.listUnresolvedStandardTeamMessageDeliveries(100)).resolves.toEqual([
      uncertain,
    ]);
    await expect(
      reopened.persistStandardTeamMessageDelivery({
        ...pending,
        deliveryId: `standard-team-delivery-${"4".repeat(64)}`,
        clientRequestNonce: `team-request-${"5".repeat(64)}`,
        requestSha256: "6".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "team-message-delivery-conflict" });
    await reopened.close();
  });

  it("stores immutable Team definitions idempotently and rejects conflicting bytes", async () => {
    const { plan, team } = await createTeamRunFixture("definition");
    const persistence = openSqliteCorePersistence(createTestDirectory());
    const teamPersistence = persistence as unknown as TeamRunPersistence;
    await persistence.persistAdmittedTeamPlan(plan);

    expect(teamPersistence.persistTeamDefinition).toBeTypeOf("function");
    expect(teamPersistence.getTeamDefinition).toBeTypeOf("function");
    expect(teamPersistence.listTeamDefinitions).toBeTypeOf("function");
    await expect(teamPersistence.persistTeamDefinition(team)).resolves.toEqual({
      status: "stored",
      team,
    });
    await expect(teamPersistence.persistTeamDefinition(team)).resolves.toEqual({
      status: "duplicate",
      team,
    });
    await expect(teamPersistence.getTeamDefinition(team.teamId)).resolves.toEqual(team);
    await expect(teamPersistence.listTeamDefinitions(10)).resolves.toEqual([team]);

    const conflicting = normalizeTeamDefinition({
      ...team,
      name: "Conflicting Team definition bytes",
      updatedAt: "2026-08-04T01:00:02.000Z",
    });
    await expect(teamPersistence.persistTeamDefinition(conflicting)).rejects.toMatchObject({
      name: "PersistenceError",
      code: "team-definition-conflict",
    });
    await expect(teamPersistence.getTeamDefinition(team.teamId)).resolves.toEqual(team);
    await persistence.close();
  });

  it("CAS-updates two-to-five-member Teams, protects active runs, lists heads, and soft-removes terminal Teams", async () => {
    const userDataPath = createTestDirectory();
    const { plan, team, accepted } = await createTeamRunFixture("definition-lifecycle");
    const persistence = openSqliteCorePersistence(userDataPath);
    const teamPersistence = persistence as unknown as TeamRunPersistence;
    await persistence.persistAdmittedTeamPlan(plan);
    await teamPersistence.persistTeamDefinition(team);

    const expanded = normalizeTeamDefinition({
      ...team,
      name: "Expanded durable Team",
      members: [
        ...team.members,
        {
          memberId: `team-member-${"9".repeat(64)}`,
          role: "teammate",
          capability: "general",
          displayName: "General researcher",
        },
      ],
      updatedAt: "2026-08-04T01:00:02.000Z",
    });
    expect(expanded.members).toHaveLength(3);
    await expect(teamPersistence.replaceTeamDefinition(team, expanded)).resolves.toEqual({
      status: "stored",
      team: expanded,
    });
    await expect(teamPersistence.replaceTeamDefinition(team, expanded)).resolves.toEqual({
      status: "duplicate",
      team: expanded,
    });

    const staleReplacement = normalizeTeamDefinition({
      ...expanded,
      name: "Stale Team replacement",
      updatedAt: "2026-08-04T01:00:03.000Z",
    });
    await expect(
      teamPersistence.replaceTeamDefinition(team, staleReplacement),
    ).rejects.toMatchObject({ code: "team-definition-conflict" });

    const acceptedForExpandedTeam = accepted;
    await teamPersistence.persistTeamRunSnapshot(acceptedForExpandedTeam);
    const activeReplacement = normalizeTeamDefinition({
      ...expanded,
      name: "Must not replace an active Team",
      updatedAt: "2026-08-04T01:00:05.000Z",
    });
    await expect(
      teamPersistence.replaceTeamDefinition(expanded, activeReplacement),
    ).rejects.toMatchObject({ code: "team-definition-conflict" });

    const cancelled = transitionTeamRun(acceptedForExpandedTeam, {
      type: "cancel-run",
      reason: "Close the run before editing or removing its Team.",
      occurredAt: instant("2026-08-04T01:00:05.000Z"),
    });
    await teamPersistence.persistTeamRunSnapshot(cancelled);
    await expect(teamPersistence.listTeamRunsForTeam(team.teamId, 10)).resolves.toEqual([
      cancelled,
    ]);
    await expect(
      teamPersistence.replaceTeamDefinition(expanded, activeReplacement),
    ).resolves.toEqual({ status: "stored", team: activeReplacement });

    await expect(
      teamPersistence.removeTeamDefinition(activeReplacement, instant("2026-08-04T01:00:06.000Z")),
    ).resolves.toEqual({ status: "removed", teamId: team.teamId });
    await expect(teamPersistence.getTeamDefinition(team.teamId)).resolves.toBeNull();
    await expect(teamPersistence.listTeamDefinitions(10)).resolves.toEqual([]);
    await expect(
      teamPersistence.removeTeamDefinition(activeReplacement, instant("2026-08-04T01:00:07.000Z")),
    ).resolves.toEqual({ status: "duplicate", teamId: team.teamId });

    const database = new DatabaseSync(resolveCoreDatabasePath(userDataPath));
    expect(
      database
        .prepare("SELECT team_id, removed_at FROM team_definitions WHERE team_id = ?")
        .get(team.teamId),
    ).toEqual({ team_id: team.teamId, removed_at: "2026-08-04T01:00:06.000Z" });
    database.close();
    await persistence.close();
  });

  it("atomically compare-and-swaps the current run and appends every revision", async () => {
    const userDataPath = createTestDirectory();
    const { plan, team, accepted } = await createTeamRunFixture("revisions");
    const persistence = openSqliteCorePersistence(userDataPath);
    const teamPersistence = persistence as unknown as TeamRunPersistence;
    await persistence.persistAdmittedTeamPlan(plan);
    await teamPersistence.persistTeamDefinition(team);

    expect(teamPersistence.persistTeamRunSnapshot).toBeTypeOf("function");
    await expect(teamPersistence.persistTeamRunSnapshot(accepted)).resolves.toEqual({
      status: "stored",
      snapshot: accepted,
    });
    await expect(teamPersistence.persistTeamRunSnapshot(accepted)).resolves.toEqual({
      status: "duplicate",
      snapshot: accepted,
    });

    const started = transitionTeamRun(accepted, {
      type: "start-run",
      occurredAt: instant("2026-08-04T01:00:02.000Z"),
    });
    const readyNode = started.nodes.find(({ status }) => status === "ready")!;
    const skipped = transitionTeamRun(started, {
      type: "start-node",
      nodeId: readyNode.nodeId,
      workerTaskId: taskId("task-team-run-skipped-revision"),
      occurredAt: instant("2026-08-04T01:00:03.000Z"),
    });
    await expect(teamPersistence.persistTeamRunSnapshot(skipped)).rejects.toMatchObject({
      code: "team-run-conflict",
    });
    await expect(teamPersistence.persistTeamRunSnapshot(started)).resolves.toEqual({
      status: "stored",
      snapshot: started,
    });
    await expect(teamPersistence.persistTeamRunSnapshot(accepted)).rejects.toMatchObject({
      code: "team-run-conflict",
    });

    const conflictingRevision = normalizeTeamRunSnapshot({
      ...started,
      statusExplanation: "Conflicting bytes under the same current revision.",
    });
    await expect(teamPersistence.persistTeamRunSnapshot(conflictingRevision)).rejects.toMatchObject(
      { code: "team-run-conflict" },
    );

    const other = await createTeamRunFixture("cross-plan");
    await persistence.persistAdmittedTeamPlan(other.plan);
    const crossPlan = normalizeTeamRunSnapshot({
      ...other.accepted,
      runId: accepted.runId,
      teamId: team.teamId,
    });
    await expect(teamPersistence.persistTeamRunSnapshot(crossPlan)).rejects.toMatchObject({
      code: "team-run-conflict",
    });

    const database = new DatabaseSync(resolveCoreDatabasePath(userDataPath));
    expect(
      database.prepare("SELECT revision FROM team_runs WHERE run_id = ?").get(accepted.runId),
    ).toEqual({ revision: 2 });
    expect(
      database
        .prepare("SELECT revision FROM team_run_revisions WHERE run_id = ? ORDER BY revision")
        .all(accepted.runId),
    ).toEqual([{ revision: 1 }, { revision: 2 }]);
    database.close();
    await persistence.close();

    const reopened = openSqliteCorePersistence(userDataPath) as unknown as TeamRunPersistence & {
      close(): Promise<void>;
    };
    const restored = await reopened.getTeamRunSnapshot(accepted.runId);
    expect(restored).toEqual(started);
    expect(Object.isFrozen(restored)).toBe(true);
    expect(restored?.nodes.every(Object.isFrozen)).toBe(true);
    await reopened.close();
  });

  it("persists a requested feedback revision through the canonical Core transition", async () => {
    const userDataPath = createTestDirectory();
    const { plan, team, accepted } = await createTeamRunFixture("feedback-revision");
    const persistence = openSqliteCorePersistence(userDataPath);
    const teamPersistence = persistence as unknown as TeamRunPersistence;
    await persistence.persistAdmittedTeamPlan(plan);
    await teamPersistence.persistTeamDefinition(team);

    let snapshot = accepted;
    await teamPersistence.persistTeamRunSnapshot(snapshot);
    snapshot = transitionTeamRun(snapshot, {
      type: "start-run",
      occurredAt: instant("2026-08-04T01:00:02.000Z"),
    });
    await teamPersistence.persistTeamRunSnapshot(snapshot);
    for (const [capability, occurredAt] of [
      ["general", "2026-08-04T01:00:03.000Z"],
      ["coding", "2026-08-04T01:00:05.000Z"],
    ] as const) {
      const node = snapshot.nodes.find(
        (candidate) => candidate.kind === "worker" && candidate.capability === capability,
      );
      if (node?.kind !== "worker") throw new Error(`Missing ${capability} Worker node`);
      const running = transitionTeamRun(snapshot, {
        type: "start-node",
        nodeId: node.nodeId,
        workerTaskId: taskId(`task-team-feedback-${capability}`),
        occurredAt: instant(occurredAt),
      });
      await teamPersistence.persistTeamRunSnapshot(running);
      const attempt = running.nodes.find(({ nodeId }) => nodeId === node.nodeId)!.attempts.at(-1)!;
      snapshot = transitionTeamRun(running, {
        type: "complete-node",
        nodeId: node.nodeId,
        attemptId: attempt.attemptId,
        artifacts: [
          {
            artifactId: artifactId(`artifact-team-feedback-${capability}`),
            taskId: attempt.workerTaskId,
            kind: node.expectedArtifactKind,
          },
        ],
        summary: `${capability} completed its bounded result.`,
        occurredAt: instant(
          capability === "general" ? "2026-08-04T01:00:04.000Z" : "2026-08-04T01:00:06.000Z",
        ),
      });
      await teamPersistence.persistTeamRunSnapshot(snapshot);
    }

    const feedback = snapshot.nodes.find(({ kind }) => kind === "human-feedback")!;
    const denied = transitionTeamRun(snapshot, {
      type: "resolve-human-feedback",
      nodeId: feedback.nodeId,
      decision: "denied",
      note: "Request one bounded revision.",
      occurredAt: instant("2026-08-04T01:00:07.000Z"),
    });
    await teamPersistence.persistTeamRunSnapshot(denied);
    const revised = transitionTeamRun(denied, {
      type: "request-feedback-revision",
      nodeId: feedback.nodeId,
      reason: "Continue the review after the requested revision.",
      occurredAt: instant("2026-08-04T01:00:08.000Z"),
    });

    await expect(teamPersistence.persistTeamRunSnapshot(revised)).resolves.toEqual({
      status: "stored",
      snapshot: revised,
    });
    await expect(teamPersistence.getTeamRunSnapshot(accepted.runId)).resolves.toEqual(revised);
    await persistence.close();
  });

  it("binds every initial run and later revision to canonical Core authority", async () => {
    const userDataPath = createTestDirectory();
    const fixture = await createTeamRunFixture("authority-binding");
    const substitutedIdentity = await createTeamRunFixture("substituted-identity");
    const persistence = openSqliteCorePersistence(userDataPath);
    const teamPersistence = persistence as unknown as TeamRunPersistence;
    await persistence.persistAdmittedTeamPlan(fixture.plan);
    await teamPersistence.persistTeamDefinition(fixture.team);

    const wrongRunIdentity = normalizeTeamRunSnapshot({
      ...fixture.accepted,
      runId: substitutedIdentity.accepted.runId,
    });
    await expect(teamPersistence.persistTeamRunSnapshot(wrongRunIdentity)).rejects.toMatchObject({
      code: "team-run-conflict",
    });

    const substitutedInitialNode = normalizeTeamRunSnapshot({
      ...fixture.accepted,
      nodes: fixture.accepted.nodes.map((node, index) =>
        index === 0 ? { ...node, title: "Substituted structurally valid node" } : node,
      ),
    });
    await expect(
      teamPersistence.persistTeamRunSnapshot(substitutedInitialNode),
    ).rejects.toMatchObject({ code: "team-run-conflict" });

    await expect(teamPersistence.persistTeamRunSnapshot(fixture.accepted)).resolves.toMatchObject({
      status: "stored",
    });
    const arbitraryRewrite = normalizeTeamRunSnapshot({
      ...fixture.accepted,
      revision: 2,
      status: "running",
      updatedAt: "2026-08-04T01:00:02.000Z",
    });
    await expect(teamPersistence.persistTeamRunSnapshot(arbitraryRewrite)).rejects.toMatchObject({
      code: "team-run-conflict",
    });

    const started = transitionTeamRun(fixture.accepted, {
      type: "start-run",
      occurredAt: instant("2026-08-04T01:00:02.000Z"),
    });
    await expect(teamPersistence.persistTeamRunSnapshot(started)).resolves.toMatchObject({
      status: "stored",
      snapshot: started,
    });
    await persistence.close();
  });

  it("detects digest drift and lists only non-terminal current run heads", async () => {
    const userDataPath = createTestDirectory();
    const recoverable = await createTeamRunFixture("recoverable");
    const terminal = await createTeamRunFixture("terminal");
    const persistence = openSqliteCorePersistence(userDataPath);
    const teamPersistence = persistence as unknown as TeamRunPersistence;
    for (const fixture of [recoverable, terminal]) {
      await persistence.persistAdmittedTeamPlan(fixture.plan);
      await teamPersistence.persistTeamDefinition(fixture.team);
      await teamPersistence.persistTeamRunSnapshot(fixture.accepted);
    }
    const cancelled = transitionTeamRun(terminal.accepted, {
      type: "cancel-run",
      reason: "Cancel the terminal fixture before execution.",
      occurredAt: instant("2026-08-04T01:00:02.000Z"),
    });
    await teamPersistence.persistTeamRunSnapshot(cancelled);

    await expect(teamPersistence.listRecoverableTeamRuns(10)).resolves.toEqual([
      recoverable.accepted,
    ]);
    await persistence.close();

    const database = new DatabaseSync(resolveCoreDatabasePath(userDataPath));
    database
      .prepare(
        `UPDATE team_run_revisions
         SET snapshot_json = json_set(snapshot_json, '$.statusExplanation', 'drifted')
         WHERE run_id = ? AND revision = 1`,
      )
      .run(recoverable.accepted.runId);
    database.close();

    const reopened = openSqliteCorePersistence(userDataPath) as unknown as TeamRunPersistence & {
      close(): Promise<void>;
    };
    await expect(reopened.getTeamRunSnapshot(recoverable.accepted.runId)).rejects.toMatchObject({
      name: "PersistenceError",
      code: "corrupt-database",
    });
    await reopened.close();
  });
});

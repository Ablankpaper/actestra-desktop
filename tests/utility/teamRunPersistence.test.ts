// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  instant,
  normalizeTeamDefinition,
  normalizeTeamRunSnapshot,
  taskId,
  transitionTeamRun,
  type TeamDefinition,
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

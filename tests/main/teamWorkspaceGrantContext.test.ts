import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  instant,
  workspaceGrantId,
  workspaceId,
  type WorkspaceGrant,
} from "../../apps/desktop/src/core";
import { TeamWorkspaceGrantContext } from "../../apps/desktop/src/main/orchestration/teamWorkspaceGrantContext";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("TeamWorkspaceGrantContext", () => {
  it("resolves only the Main-persisted active grant to one canonical private context", async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "actestra-team-workspace-"));
    roots.push(temporaryRoot);
    const workspaceRoot = path.join(temporaryRoot, "workspace");
    await mkdir(workspaceRoot, { mode: 0o700 });
    const stableWorkspaceId = workspaceId(`workspace-team-${"a".repeat(64)}`);
    const grant: WorkspaceGrant = Object.freeze({
      contractVersion: 1,
      grantId: workspaceGrantId(`grant-team-${"b".repeat(64)}`),
      workspaceId: stableWorkspaceId,
      rootPath: workspaceRoot,
      displayName: "Bounded Team Workspace",
      state: "active",
      createdAt: instant("2026-08-06T00:00:00.000Z"),
      updatedAt: instant("2026-08-06T00:00:00.000Z"),
    });
    const persistence = {
      getActiveWorkspaceGrant: vi.fn(async () => grant),
    };

    const context = await new TeamWorkspaceGrantContext({ persistence }).resolve(stableWorkspaceId);

    expect(context).toEqual({
      rootPath: await realpath(workspaceRoot),
      displayName: "Bounded Team Workspace",
    });
    expect(persistence.getActiveWorkspaceGrant).toHaveBeenCalledWith(stableWorkspaceId);
    expect(Object.isFrozen(context)).toBe(true);
  });

  it("fails closed when Core has no matching active grant", async () => {
    const persistence = {
      getActiveWorkspaceGrant: vi.fn(async () => null),
    };
    const context = new TeamWorkspaceGrantContext({ persistence });

    await expect(
      context.resolve(workspaceId(`workspace-team-${"c".repeat(64)}`)),
    ).rejects.toMatchObject({
      name: "TeamWorkspaceGrantContextError",
      code: "grant-unavailable",
    });
  });
});

import {
  assertWorkspaceGrant,
  workspaceId,
  type ActestraPersistencePort,
  type WorkspaceId,
} from "../../core";
import { canonicalizeAionUiGeneralWorkNativeContext } from "../compatibility/aionuiGeneralWorkNativeContext";
import type { TeamWorkspaceContextPort } from "./teamJourneyWorkerRouter";

export type TeamWorkspaceGrantContextErrorCode =
  | "invalid-input"
  | "grant-unavailable"
  | "grant-invalid";

export class TeamWorkspaceGrantContextError extends Error {
  constructor(
    readonly code: TeamWorkspaceGrantContextErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TeamWorkspaceGrantContextError";
  }
}

export interface TeamWorkspaceGrantContextOptions {
  readonly persistence: Pick<ActestraPersistencePort, "getActiveWorkspaceGrant">;
}

export class TeamWorkspaceGrantContext implements TeamWorkspaceContextPort {
  constructor(private readonly options: TeamWorkspaceGrantContextOptions) {}

  async resolve(workspaceIdValue: WorkspaceId) {
    let stableWorkspaceId: WorkspaceId;
    try {
      stableWorkspaceId = workspaceId(workspaceIdValue);
    } catch {
      throw new TeamWorkspaceGrantContextError(
        "invalid-input",
        "Team Workspace identity is invalid",
      );
    }
    const grant = await this.options.persistence.getActiveWorkspaceGrant(stableWorkspaceId);
    if (grant === null) {
      throw new TeamWorkspaceGrantContextError(
        "grant-unavailable",
        "Team Workspace has no active Main-owned grant",
      );
    }
    try {
      assertWorkspaceGrant(grant);
    } catch {
      throw new TeamWorkspaceGrantContextError("grant-invalid", "Team Workspace grant is invalid");
    }
    if (grant.workspaceId !== stableWorkspaceId || grant.state !== "active") {
      throw new TeamWorkspaceGrantContextError(
        "grant-invalid",
        "Team Workspace grant does not match authoritative identity",
      );
    }
    try {
      return await canonicalizeAionUiGeneralWorkNativeContext({
        rootPath: grant.rootPath,
        displayName: grant.displayName,
      });
    } catch {
      throw new TeamWorkspaceGrantContextError(
        "grant-invalid",
        "Team Workspace grant cannot be resolved to a canonical context",
      );
    }
  }
}

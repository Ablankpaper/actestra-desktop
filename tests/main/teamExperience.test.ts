// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as Core from "../../apps/desktop/src/core";
import { createTeamRunFixture } from "../fixtures/teamRun";

const { normalizeTeamDefinition } = Core;

type TeamExperienceBinding = Readonly<{
  contractVersion: 1;
  teamId: string;
  experience: "standard" | "orchestrated";
  boundAt: string;
}>;

function experienceBindingNormalizer(): (value: unknown) => TeamExperienceBinding {
  const candidate = (Core as Record<string, unknown>)["normalizeTeamExperienceBinding"];
  expect(candidate).toBeTypeOf("function");
  return candidate as (value: unknown) => TeamExperienceBinding;
}

describe("Team experience authority", () => {
  it("migrates schema-15 Actestra Team definitions to the orchestrated experience", async () => {
    const { team } = await createTeamRunFixture("experience-migration");
    const legacy = JSON.parse(JSON.stringify(team)) as Record<string, unknown>;
    delete legacy.experience;

    const migrated = normalizeTeamDefinition(legacy);

    expect(migrated.experience).toBe("orchestrated");
    expect(migrated.description).toBeNull();
    expect(Object.keys(migrated)).toContain("experience");
    expect(Object.keys(migrated)).toContain("description");
  });

  it("fails closed when a schema-15 Team definition carries an unknown experience", async () => {
    const { team } = await createTeamRunFixture("experience-unknown");

    expect(() => normalizeTeamDefinition({ ...team, experience: "foreign-provider" })).toThrow(
      /Team definition is invalid/u,
    );
  });

  it("normalizes one immutable Core-owned experience binding for a native Team identity", () => {
    const normalizeTeamExperienceBinding = experienceBindingNormalizer();

    const binding = normalizeTeamExperienceBinding({
      contractVersion: 1,
      teamId: "019fd31e-a4bd-7b41-ba88-2bf6cddae0aa",
      experience: "standard",
      boundAt: "2026-08-06T02:15:00.000Z",
    });

    expect(binding).toEqual({
      contractVersion: 1,
      teamId: "019fd31e-a4bd-7b41-ba88-2bf6cddae0aa",
      experience: "standard",
      boundAt: "2026-08-06T02:15:00.000Z",
    });
    expect(Object.isFrozen(binding)).toBe(true);
  });

  it("rejects inferred, unknown, or renderer-shaped Team experience bindings", () => {
    const normalizeTeamExperienceBinding = experienceBindingNormalizer();
    const valid = {
      contractVersion: 1,
      teamId: "native-team-1",
      experience: "standard",
      boundAt: "2026-08-06T02:15:00.000Z",
    } as const;

    expect(() =>
      normalizeTeamExperienceBinding({ ...valid, experience: "foreign-provider" }),
    ).toThrow(/experience binding is invalid/u);
    expect(() => normalizeTeamExperienceBinding({ ...valid, rendererGuess: true })).toThrow(
      /experience binding is invalid/u,
    );
    expect(() => normalizeTeamExperienceBinding({ ...valid, teamId: " native-team-1" })).toThrow(
      /Team experience identity/u,
    );
  });

  it("keeps provider-active Team list/get routing behind one Main/Core projection", () => {
    const patch = fs.readFileSync(
      path.join(process.cwd(), "downstream/aionui-v2.1.41/patches/0014-actestra-team-work.mjs"),
      "utf8",
    );

    expect(patch).toContain("providerActive ? listActestraTeams");
    expect(patch).toContain("return getActestraTeam(id!)");
    const teamListPatch = patch.match(
      /const teamListPath = "packages\/desktop\/src\/renderer\/pages\/team\/hooks\/useTeamList\.ts";[\s\S]*?const teamListCronCleanupTestPath =/u,
    )?.[0];
    expect(teamListPatch).toBeDefined();
    expect(
      teamListPatch?.match(/const providerActive = isActestraTeamProviderActive\(\);/gu),
    ).toHaveLength(1);
    expect(patch).not.toContain("mergeTeamLists(standardTeams, orchestratedTeams)");
    expect(patch).not.toContain("Promise.all([standardPromise, orchestratedPromise])");
    expect(patch).not.toContain("export function mergeTeamLists");
    expect(patch).not.toContain("getActestraTeamOptional: mocks.getOrchestrated");
    expect(patch).not.toContain("mergeTeamLists: (standard: TTeam[], orchestrated: TTeam[])");
  });

  it("resolves workflow feedback against the approval-blocked node Core actually parks", () => {
    const service = fs.readFileSync(
      path.join(process.cwd(), "apps/desktop/src/main/compatibility/aionuiTeamService.ts"),
      "utf8",
    );
    const resolveFeedback = service.slice(
      service.indexOf("async #resolveFeedback("),
      service.indexOf(
        "const orchestrator = await this.#ensureWorkerRuntime(team);",
        service.indexOf("async #resolveFeedback("),
      ),
    );

    expect(resolveFeedback).toContain('candidate.kind === "human-feedback"');
    expect(resolveFeedback).toContain('candidate.status === "approval-blocked"');
    expect(resolveFeedback).toContain('candidate.blockedReason === "human-feedback"');
    expect(resolveFeedback).toContain("candidate.protectedApproval === null");
    expect(resolveFeedback).toContain("candidate.workflowFeedback === null");
    expect(resolveFeedback).not.toContain('status === "ready"');
  });

  it("offers no protected-Approval action on the workflow-feedback node Core parks", () => {
    const service = fs.readFileSync(
      path.join(process.cwd(), "apps/desktop/src/main/compatibility/aionuiTeamService.ts"),
      "utf8",
    );
    const nodeActions = service.slice(
      service.indexOf("function nodeActions("),
      service.indexOf("function artifactReference("),
    );
    const approvalBlocked = nodeActions.slice(nodeActions.indexOf('case "approval-blocked":'));

    expect(approvalBlocked).toContain('node.blockedReason === "human-feedback"');
    expect(approvalBlocked.indexOf('Object.freeze(["cancel"])')).toBeLessThan(
      approvalBlocked.indexOf('Object.freeze(["approve", "deny", "cancel"])'),
    );
  });

  it("does not advertise active-worker controls for a failed Worker node", () => {
    const service = fs.readFileSync(
      path.join(process.cwd(), "apps/desktop/src/main/compatibility/aionuiTeamService.ts"),
      "utf8",
    );
    const actions = service.slice(
      service.indexOf("function nodeActions("),
      service.indexOf("function artifactReference("),
    );
    const failed = actions.slice(
      actions.indexOf('case "failed":'),
      actions.indexOf('case "pending":', actions.indexOf('case "failed":')),
    );

    expect(failed).toContain('Object.freeze(["retry"])');
    expect(failed).not.toContain('"replace"');
    expect(failed).not.toContain('"handoff"');
  });

  it("does not advertise child cancellation after or before an active Worker attempt", () => {
    const service = fs.readFileSync(
      path.join(process.cwd(), "apps/desktop/src/main/compatibility/aionuiTeamService.ts"),
      "utf8",
    );
    const actions = service.slice(
      service.indexOf("function nodeActions("),
      service.indexOf("function artifactReference("),
    );

    expect(actions).toContain(
      'node.blockedReason === "human-feedback"\n        ? Object.freeze([])',
    );
    expect(actions).toContain(
      'node.kind === "human-feedback" ? Object.freeze(["revise"]) : Object.freeze([])',
    );
    expect(actions).toContain(
      'case "pending":\n    case "ready":\n    case "handoff-required":\n      return Object.freeze([])',
    );
  });

  it("renders the run feedback controls on the blocked reason the feedback node carries", () => {
    const patch = fs.readFileSync(
      path.join(process.cwd(), "downstream/aionui-v2.1.41/patches/0014-actestra-team-work.mjs"),
      "utf8",
    );

    expect(patch).toContain(
      "node.capability === 'feedback' && node.blocked_reason === 'human-feedback'",
    );
    expect(patch).not.toContain("node.capability === 'feedback' && node.state === 'ready'");
  });

  it("routes and explains the revision-requested feedback action through the native client", () => {
    const patch = fs.readFileSync(
      path.join(process.cwd(), "downstream/aionui-v2.1.41/patches/0014-actestra-team-work.mjs"),
      "utf8",
    );

    expect(patch).toContain("| 'revise';");
    expect(patch).toContain(
      "case 'revision-requested': return translate('team.actestra.blocked.revisionRequested');",
    );
    expect(patch).toContain('"revision-requested": "Changes requested"');
    expect(patch).toContain('"revisionRequested": "Changes were requested.');
    expect(patch).toContain('"revise": "Continue review"');
    expect(patch).toContain('"revision-requested": "已要求修改"');
    expect(patch).toContain('"revisionRequested": "已要求修改；');
    expect(patch).toContain('"revise": "继续审阅"');
  });

  it("does not tell a failed Worker user to invoke the unavailable replace route", () => {
    const patch = fs.readFileSync(
      path.join(process.cwd(), "downstream/aionui-v2.1.41/patches/0014-actestra-team-work.mjs"),
      "utf8",
    );

    expect(patch).toContain(
      '"attemptFailed": "The previous attempt failed; retry the Worker to continue."',
    );
    expect(patch).toContain('"attemptFailed": "上一次尝试失败，请重试 Worker 以继续。"');
    expect(patch).not.toContain("retry or replace the Worker");
    expect(patch).not.toContain("请重试或替换 Worker");
  });
});

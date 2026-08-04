// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

interface OverlayPatch {
  readonly path: string;
  readonly classification: readonly string[];
  readonly domains: readonly string[];
}

interface OverlaySourceCopy {
  readonly source: string;
  readonly destination: string;
}

interface DownstreamOverlay {
  readonly phase: string;
  readonly patches: readonly OverlayPatch[];
  readonly sourceCopies: readonly OverlaySourceCopy[];
  readonly expectedChangedFiles: readonly string[];
}

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const overlayPath = path.join(repositoryRoot, "downstream/aionui-v2.1.41/overlay.json");
const patchPath = path.join(
  path.dirname(overlayPath),
  "patches/0013-actestra-goose-native-agent.mjs",
);

describe("P5.3 retained AionUI Goose agent and coding journey", () => {
  it("declares one R1 downstream patch and the Actestra-owned journey source copies", () => {
    const overlay = JSON.parse(fs.readFileSync(overlayPath, "utf8")) as DownstreamOverlay;
    expect(overlay.phase).toBe("P5-preserved-aionui-coding-journey");
    expect(overlay.patches.at(-1)).toEqual(
      expect.objectContaining({
        path: "patches/0013-actestra-goose-native-agent.mjs",
        classification: ["R1"],
        domains: expect.arrayContaining([
          "fixed Goose managed-agent readiness",
          "retained Agent Settings status and probe",
          "retained Agent Repair unavailable state",
          "retained ACP SendBox Goose selector",
          "main-owned coding journey IPC",
          "native ACP message, permission, tool, diff, test, and Artifact projection",
        ]),
      }),
    );

    const copies = new Map(
      overlay.sourceCopies.map((copy) => [copy.source, copy.destination] as const),
    );
    expect(copies.get("apps/desktop/src/compatibility/aionui/codingAgent.ts")).toBe(
      "packages/desktop/src/actestra/compatibility/aionui/codingAgent.ts",
    );
    expect(copies.get("apps/desktop/src/main/compatibility/aionuiCodingAgentService.ts")).toBe(
      "packages/desktop/src/actestra/main/compatibility/aionuiCodingAgentService.ts",
    );
    expect(copies.get("apps/desktop/src/compatibility/aionui/codingJourney.ts")).toBe(
      "packages/desktop/src/actestra/compatibility/aionui/codingJourney.ts",
    );
    expect(copies.get("apps/desktop/src/main/compatibility/aionuiCodingJourneyService.ts")).toBe(
      "packages/desktop/src/actestra/main/compatibility/aionuiCodingJourneyService.ts",
    );
    expect(
      copies.get("apps/desktop/src/main/compatibility/aionuiCodingJourneyBridgeService.ts"),
    ).toBe("packages/desktop/src/actestra/main/compatibility/aionuiCodingJourneyBridgeService.ts");
    for (const destination of [
      "packages/desktop/src/actestra/compatibility/aionui/codingAgent.ts",
      "packages/desktop/src/actestra/compatibility/aionui/codingJourney.ts",
      "packages/desktop/src/actestra/main/compatibility/aionuiCodingAgentService.ts",
      "packages/desktop/src/actestra/main/compatibility/aionuiCodingJourneyService.ts",
      "packages/desktop/src/actestra/main/compatibility/aionuiCodingJourneyBridgeService.ts",
      "packages/desktop/src/common/adapter/actestraCodingAgentClient.ts",
      "packages/desktop/src/common/adapter/actestraCodingJourneyClient.ts",
      "packages/desktop/src/renderer/hooks/chat/actestraCodingJourneyProjection.ts",
      "packages/desktop/src/renderer/hooks/chat/useActestraCodingJourney.ts",
      "packages/desktop/src/renderer/pages/settings/AgentSettings/ActestraCodingAgentRepairPanel.tsx",
      "tests/unit/actestra/codingAgentClient.dom.test.ts",
      "tests/unit/actestra/codingAgentNativeWiring.test.ts",
      "tests/unit/actestra/codingJourneyClient.dom.test.ts",
      "tests/unit/actestra/codingJourneyHook.dom.test.tsx",
      "tests/unit/actestra/codingJourneyNativeWiring.test.ts",
    ]) {
      expect(overlay.expectedChangedFiles).toContain(destination);
    }
  });

  it("keeps runner authority in main while reusing native settings and repair routes", () => {
    expect(fs.existsSync(patchPath)).toBe(true);
    if (!fs.existsSync(patchPath)) return;
    const source = fs.readFileSync(patchPath, "utf8");

    for (const marker of [
      "AionUiCodingAgentService",
      "ACTESTRA_CODING_AGENT_STATUS_CHANNEL",
      "ACTESTRA_CODING_AGENT_PROBE_CHANNEL",
      "contextBridge.exposeInMainWorld('actestraCodingAgent'",
      "mergeActestraCodingAgent",
      "probeActestraCodingAgent",
      "ActestraCodingAgentRepairPanel",
      "agent-row-actestra-goose",
    ]) {
      expect(source).toContain(marker);
    }
    expect(source).not.toContain("ACTESTRA_GOOSE_RUNNER_MANIFEST_SHA256: request");
    expect(source).not.toContain("createCustomAgent({ id: 'actestra-goose'");
  });

  it("keeps five coding intents main-frame-only and projects them through retained ACP surfaces", () => {
    expect(fs.existsSync(patchPath)).toBe(true);
    if (!fs.existsSync(patchPath)) return;
    const source = fs.readFileSync(patchPath, "utf8");

    for (const marker of [
      "AionUiCodingJourneyService",
      "AionUiCodingJourneyBridgeService",
      "ACTESTRA_CODING_JOURNEY_SUBMIT_CHANNEL",
      "ACTESTRA_CODING_JOURNEY_LIST_CHANNEL",
      "ACTESTRA_CODING_JOURNEY_CANCEL_CHANNEL",
      "ACTESTRA_CODING_JOURNEY_APPROVAL_DECISION_CHANNEL",
      "ACTESTRA_CODING_JOURNEY_PUBLISH_DECISION_CHANNEL",
      "contextBridge.exposeInMainWorld('actestraCodingJourney'",
      "actestraCodingJourneySelector",
      "useActestraCodingJourney",
      "projectActestraCodingJourneyMessages",
      "decideActestraCodingJourneyApproval",
      "decideActestraCodingJourneyPublish",
      "data-testid='actestra-coding-agent-selector'",
      "MessageAcpPermission",
      "MessageAcpToolCall",
    ]) {
      expect(source).toContain(marker);
    }
    expect(source).toContain("ownsMainFrame(event, extraArguments)");
    expect(source).toContain("await activeCodingJourney?.close();");
    expect(source).toContain("codingJourneyService = null;");
    expect(source).toContain("Actestra coding journey shutdown failed");
    expect(source).not.toContain("repositoryRoot: request");
    expect(source).not.toContain("modelId: request");
    expect(source).not.toContain("runnerPath: request");
    expect(source).not.toContain("actorId: request");
  });
});

// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type {
  AionUiShadowEvidence,
  AionUiShadowPersistencePort,
} from "../../apps/desktop/src/compatibility/aionui";
import { AionUiShadowProjectionService } from "../../apps/desktop/src/main/compatibility/aionuiShadowProjectionService";

const OBSERVED_AT = Date.parse("2026-07-29T03:00:00.000Z");

function persistence(
  append: AionUiShadowPersistencePort["appendAionUiShadowEvidence"],
): AionUiShadowPersistencePort {
  return {
    appendAionUiShadowEvidence: append,
    listRecentAionUiShadowEvidence: vi.fn(async () => []),
    summarizeAionUiShadowEvidence: vi.fn(async () => ({
      recordCount: 0,
      lastSequence: 0,
    })),
  };
}

describe("AionUi F2 shadow projection service", () => {
  it("returns bounded append evidence without exposing native metadata", async () => {
    let captured: AionUiShadowEvidence | undefined;
    const service = new AionUiShadowProjectionService(
      persistence(async (evidence) => {
        captured = evidence;
        return {
          status: "appended",
          sequence: 7,
        };
      }),
    );

    await expect(
      service.observe({
        contractVersion: 1,
        kind: "workspace",
        nativeId: "conversation-private",
        observedAtMs: OBSERVED_AT,
        conversationId: "conversation-private",
        workspaceKey: "/Users/private/workspace",
        entryCount: 4,
      }),
    ).resolves.toEqual({
      status: "appended",
      evidenceId: expect.stringMatching(/^aionui-shadow-evidence-[a-f0-9]{32}$/u),
      sequence: 7,
    });
    expect(JSON.stringify(captured)).not.toContain("conversation-private");
    expect(JSON.stringify(captured)).not.toContain("/Users/private/workspace");
  });

  it("contains projection and persistence failures without throwing into native UI calls", async () => {
    const unavailable = new AionUiShadowProjectionService(
      persistence(async () => {
        throw new Error("database unavailable");
      }),
    );
    await expect(
      unavailable.observe({
        contractVersion: 1,
        kind: "provider",
        nativeId: "provider-1",
        observedAtMs: OBSERVED_AT,
        providerId: "provider-1",
        available: true,
      }),
    ).resolves.toEqual({
      status: "rejected",
      code: "persistence-unavailable",
    });

    const invalid = new AionUiShadowProjectionService(persistence(vi.fn()));
    await expect(
      invalid.observe({
        contractVersion: 1,
        kind: "provider",
        nativeId: "provider-1",
        observedAtMs: OBSERVED_AT,
        providerId: "provider-1",
        available: true,
        apiKey: "forbidden",
      }),
    ).resolves.toEqual({
      status: "rejected",
      code: "invalid-observation",
    });
  });
});

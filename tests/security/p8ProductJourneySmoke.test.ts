// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  P8_PRODUCT_JOURNEY_IDS,
  assertP8ProductJourneyPrivacy,
  createP8ProductJourneyCoordinator,
  parseP8ProductJourneySmokeEnvironment,
  type P8ProductJourneyRunContext,
} from "../../apps/desktop/src/main/security/p8ProductJourneySmoke";

const root = "/tmp/actestra-p8-smoke";
const completeEnvironment = {
  ACTESTRA_E2E_TEST: "1",
  ACTESTRA_P8_PRODUCT_JOURNEYS_SMOKE: "1",
  ACTESTRA_E2E_ISOLATION_ROOT: root,
  ACTESTRA_USER_DATA_DIR: `${root}/user-data`,
  ACTESTRA_E2E_HOME_DIR: `${root}/home`,
  ACTESTRA_E2E_TEMP_DIR: `${root}/temp`,
  ACTESTRA_P8_PRODUCT_JOURNEYS_WORKSPACE: `${root}/workspace`,
  ACTESTRA_P8_PRODUCT_JOURNEYS_RESULT: `${root}/user-data/p8-product-journeys-result.json`,
  ACTESTRA_P8_PRODUCT_JOURNEYS_TIMEOUT_MS: "30000",
};

function context(overrides: Partial<P8ProductJourneyRunContext> = {}): P8ProductJourneyRunContext {
  return {
    environment: completeEnvironment,
    appIsPackaged: true,
    executeJourney: async (id) => ({ id, status: "verified", residualProcessCount: 0 }),
    cleanup: async () => ({ residualProcessCount: 0 }),
    ...overrides,
  };
}

describe("P8 packaged product-journey coordinator", () => {
  it("is inert unless the complete explicit environment is present", () => {
    expect(parseP8ProductJourneySmokeEnvironment({})).toBeNull();
    expect(parseP8ProductJourneySmokeEnvironment(completeEnvironment)?.resultPath).toBe(
      completeEnvironment.ACTESTRA_P8_PRODUCT_JOURNEYS_RESULT,
    );
    expect(
      parseP8ProductJourneySmokeEnvironment({
        ...completeEnvironment,
        ACTESTRA_P8_PRODUCT_JOURNEYS_RESULT: "/tmp/outside/result.json",
      }),
    ).toBeNull();
  });

  it("runs the fixed nine journeys in order and returns only bounded observations", async () => {
    const seen: string[] = [];
    const result = await createP8ProductJourneyCoordinator(
      context({
        executeJourney: async (id) => {
          seen.push(id);
          return { id, status: "verified", residualProcessCount: 0 };
        },
      }),
    ).run();
    expect(seen).toEqual(P8_PRODUCT_JOURNEY_IDS);
    expect(result).toEqual({
      schemaVersion: 1,
      status: "verified",
      journeys: P8_PRODUCT_JOURNEY_IDS.map((id) => ({
        id,
        status: "verified",
        residualProcessCount: 0,
      })),
    });
    expect(JSON.stringify(result)).not.toMatch(/path|credential|worker|pid|payload/i);
  });

  it("fails closed and never writes a success result when a journey or cleanup fails", async () => {
    const writeResult = vi.fn();
    await expect(
      createP8ProductJourneyCoordinator(
        context({
          writeResult,
          executeJourney: async (id) => {
            if (id === "goose-isolated-patch") throw new Error("journey-failed");
            return { id, status: "verified", residualProcessCount: 0 };
          },
        }),
      ).run(),
    ).rejects.toMatchObject({ code: "journey-failed" });
    expect(writeResult).not.toHaveBeenCalledWith(expect.objectContaining({ status: "verified" }));
  });

  it("rejects privacy leaks in bounded projections", () => {
    expect(() => assertP8ProductJourneyPrivacy({ status: "verified", journeys: [] })).not.toThrow();
    expect(() => assertP8ProductJourneyPrivacy({ privatePath: "/Users/private" })).toThrow(
      "privacy-redaction-failed",
    );
    expect(() => assertP8ProductJourneyPrivacy({ credential: "secret" })).toThrow(
      "privacy-redaction-failed",
    );
  });

  it("aggregates residual processes as a closed cleanup failure", async () => {
    await expect(
      createP8ProductJourneyCoordinator(
        context({ cleanup: async () => ({ residualProcessCount: 1 }) }),
      ).run(),
    ).rejects.toMatchObject({ code: "residual-processes" });
  });
});

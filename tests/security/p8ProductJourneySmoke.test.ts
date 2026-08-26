// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  P8_PRODUCT_JOURNEY_IDS,
  assertP8ProductJourneyPrivacy,
  createP8ProductJourneyCoordinator,
  parseP8ProductJourneySmokeEnvironment,
  writeP8ProductJourneyResult,
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

  it("still runs bounded cleanup after the caller cancels an active journey", async () => {
    const controller = new AbortController();
    const cleanup = vi.fn(async () => ({ residualProcessCount: 0 }));
    const result = createP8ProductJourneyCoordinator(
      context({
        signal: controller.signal,
        cleanup,
        executeJourney: async (_id, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
            queueMicrotask(() => controller.abort(new Error("journey-failed")));
          }),
      }),
    ).run();
    await expect(result).rejects.toMatchObject({ code: "journey-failed" });
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("times out a stalled journey and still completes cleanup", async () => {
    vi.useFakeTimers();
    try {
      const cleanup = vi.fn(async () => ({ residualProcessCount: 0 }));
      const result = createP8ProductJourneyCoordinator(
        context({
          environment: {
            ...completeEnvironment,
            ACTESTRA_P8_PRODUCT_JOURNEYS_TIMEOUT_MS: "1000",
          },
          cleanup,
          executeJourney: async () => new Promise(() => undefined),
        }),
      ).run();
      const rejection = expect(result).rejects.toMatchObject({ code: "journey-timeout" });
      await vi.advanceTimersByTimeAsync(1_000);
      await rejection;
      expect(cleanup).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("writes the exact private newline-terminated result only once", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-p8-result-"));
    const resultPath = path.join(directory, "p8-product-journeys-result.json");
    const result = {
      schemaVersion: 1 as const,
      status: "verified" as const,
      journeys: P8_PRODUCT_JOURNEY_IDS.map((id) => ({
        id,
        status: "verified" as const,
        residualProcessCount: 0 as const,
      })),
    };
    try {
      writeP8ProductJourneyResult(resultPath, result);
      expect(fs.readFileSync(resultPath, "utf8")).toBe(`${JSON.stringify(result)}\n`);
      expect(fs.statSync(resultPath).mode & 0o777).toBe(0o600);
      expect(() => writeP8ProductJourneyResult(resultPath, result)).toThrow("result-write-failed");
      expect(fs.readFileSync(resultPath, "utf8")).toBe(`${JSON.stringify(result)}\n`);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

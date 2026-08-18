import os from "node:os";
import path from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";
import { createGooseRunnerEnvironment } from "../../apps/desktop/src/main/workers/gooseRunnerProcess";

const fixtureTemporaryRoot = process.platform === "win32" ? os.tmpdir() : "/tmp";
const fixtureRoot = path.join(fixtureTemporaryRoot, "actestra-goose-environment-isolation");

/** The exact closed key set Main hands to the Goose runner without a model binding. */
const CLOSED_ENVIRONMENT_KEYS = Object.freeze([
  "GOOSE_PATH_ROOT",
  "GOOSE_TELEMETRY_OFF",
  "GOOSE_DISABLE_KEYRING",
  "GOOSE_DISABLE_SESSION_NAMING",
  "HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "TZ",
  "OTEL_SDK_DISABLED",
  "OTEL_TRACES_EXPORTER",
  "OTEL_METRICS_EXPORTER",
  "OTEL_LOGS_EXPORTER",
  "ACTESTRA_GOOSE_CPU_SECONDS",
  "ACTESTRA_GOOSE_ADDRESS_SPACE_BYTES",
]);

describe("Goose runner environment isolation", () => {
  it("exposes only the closed whitelist that Windows supervisor inheritance depends on", () => {
    const environment = createGooseRunnerEnvironment(fixtureRoot);

    expect(Object.isFrozen(environment)).toBe(true);
    expect(Object.keys(environment)).toEqual([...CLOSED_ENVIRONMENT_KEYS]);
    expect(environment.GOOSE_PATH_ROOT).toBe(fixtureRoot);
    expect(environment.GOOSE_TELEMETRY_OFF).toBe("1");
    expect(environment.GOOSE_DISABLE_KEYRING).toBe("1");
    expect(environment.GOOSE_DISABLE_SESSION_NAMING).toBe("true");
  });

  it("keeps a parent-environment canary out of the supervisor environment", () => {
    const canaryKey = "ACTESTRA_ENVIRONMENT_CANARY";
    const canaryValue = "canary-0123456789abcdef0123456789abcdef";
    const originalCanary = process.env[canaryKey];
    const parentCredentialKeys = [
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
      "AWS_SECRET_ACCESS_KEY",
    ] as const;
    const originalCredentials = parentCredentialKeys.map((key) => [key, process.env[key]] as const);

    try {
      process.env[canaryKey] = canaryValue;
      for (const key of parentCredentialKeys) {
        process.env[key] = `parent-${key.toLowerCase()}-value`;
      }

      const environment = createGooseRunnerEnvironment(fixtureRoot);

      expect(Object.keys(environment)).not.toContain(canaryKey);
      expect(Object.values(environment)).not.toContain(canaryValue);
      for (const key of parentCredentialKeys) {
        expect(Object.keys(environment)).not.toContain(key);
      }
      // No parent variable outside the closed whitelist survives.
      for (const parentKey of Object.keys(process.env)) {
        if (!CLOSED_ENVIRONMENT_KEYS.includes(parentKey)) {
          expect(Object.keys(environment)).not.toContain(parentKey);
        }
      }
    } finally {
      if (originalCanary === undefined) {
        delete process.env[canaryKey];
      } else {
        process.env[canaryKey] = originalCanary;
      }
      for (const [key, value] of originalCredentials) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  it("redirects home and temporary directories into the attempt-private root", () => {
    const environment = createGooseRunnerEnvironment(fixtureRoot);
    const privateTemporary = path.join(fixtureRoot, "tmp");

    expect(environment.HOME).toBe(path.join(fixtureRoot, "home"));
    expect(environment.TMPDIR).toBe(privateTemporary);
    expect(environment.TMP).toBe(privateTemporary);
    expect(environment.TEMP).toBe(privateTemporary);
    for (const key of ["HOME", "TMPDIR", "TMP", "TEMP"] as const) {
      const parentValue = process.env[key];
      if (parentValue !== undefined) {
        expect(environment[key]).not.toBe(parentValue);
      }
    }
  });

  it("adds the model binding keys only when Main supplies an admitted binding", () => {
    const attemptLease = "attempt-lease-0123456789abcdef0123456789";
    const withoutModel = createGooseRunnerEnvironment(fixtureRoot);

    for (const key of ["GOOSE_PROVIDER", "GOOSE_MODEL", "OPENAI_BASE_URL", "OPENAI_API_KEY"]) {
      expect(Object.keys(withoutModel)).not.toContain(key);
    }

    const withModel = createGooseRunnerEnvironment(fixtureRoot, {
      baseUrl: "http://127.0.0.1:41234/v1",
      modelId: "test-model",
      attemptLease,
    });

    expect(withModel.GOOSE_PROVIDER).toBe("openai");
    expect(withModel.GOOSE_MODEL).toBe("test-model");
    expect(withModel.OPENAI_BASE_URL).toBe("http://127.0.0.1:41234/v1");
    expect(withModel.OPENAI_API_KEY).toBe(attemptLease);
    expect(withModel.NO_PROXY).toBe("127.0.0.1,localhost");
  });
});

// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { auditContextFor, policyRevision } from "../../apps/desktop/src/core";
import { createMainPlatformServices } from "../../apps/desktop/src/main/platform/mainPlatformServices";
import { createProtectedOperation } from "../fixtures/privilegedServices";

const testDirectories: string[] = [];

function createTestDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-main-platform-test-"));
  testDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of testDirectories.splice(0)) {
    if (!directory.startsWith(path.join(os.tmpdir(), "actestra-main-platform-test-"))) {
      throw new Error(`Refusing to remove unexpected test directory: ${directory}`);
    }
    fs.rmSync(directory, {
      recursive: true,
      force: true,
    });
  }
});

describe("main-owned platform composition", () => {
  it("registers inert services and returns only a bounded renderer projection", async () => {
    const services = createMainPlatformServices(createTestDirectory());
    await expect(services.snapshot()).resolves.toEqual({
      contractVersion: 1,
      authority: "main-only",
      privilegedServices: "registered-inert",
      policy: "deny-by-default",
      credentials: "opaque-references-only",
      tools: "disabled",
      audit: {
        durability: "sqlite-metadata-only",
        recordCount: 0,
        lastSequence: 0,
      },
      attempts: [],
    });

    await expect(services.policyEngine.evaluate(createProtectedOperation())).resolves.toMatchObject(
      {
        effect: "deny",
        reasonCode: "no-matching-rule",
      },
    );
    await expect(services.toolGateway.invoke(createProtectedOperation())).rejects.toMatchObject({
      code: "manifest-unavailable",
      mayHaveExecuted: false,
    });
    expect(JSON.stringify(await services.snapshot())).not.toMatch(
      /credentialRef|inputRef|database|path/i,
    );
    await services.close();
  });

  it("projects durable audit counts after reopening the main composition", async () => {
    const userDataPath = createTestDirectory();
    const operation = createProtectedOperation();
    const first = createMainPlatformServices(userDataPath);
    await first.auditTrail.append({
      type: "policy.evaluated",
      context: auditContextFor(operation),
      policyRevision: policyRevision("policy-main-deny-by-default-v1"),
      decision: "deny",
      reasonCode: "no-matching-rule",
      matchedRuleIds: [],
    });
    await first.close();

    const reopened = createMainPlatformServices(userDataPath);
    await expect(reopened.snapshot()).resolves.toMatchObject({
      audit: {
        recordCount: 1,
        lastSequence: 1,
      },
    });
    await reopened.close();
    await expect(reopened.close()).resolves.toBeUndefined();
  });
});

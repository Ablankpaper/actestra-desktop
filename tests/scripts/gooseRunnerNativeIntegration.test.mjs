// @vitest-environment node

import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");

function read(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}

describe("P8.2b Linux authenticated Goose integration gate", () => {
  it("registers one bounded Linux-only native integration command", () => {
    const scripts = JSON.parse(read("package.json")).scripts;
    const launcher = path.join(repositoryRoot, "scripts/run-goose-runner-native-integration.mjs");

    expect(scripts["goose:runner:integration:linux"]).toBe(
      "node scripts/run-goose-runner-native-integration.mjs",
    );
    expect(fs.existsSync(launcher)).toBe(true);
  });

  it("collapses an unsupported host to the closed integration failure vocabulary", () => {
    if (process.platform === "linux" && process.arch === "x64") return;
    const result = spawnSync(
      process.execPath,
      [path.join(repositoryRoot, "scripts/run-goose-runner-native-integration.mjs")],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: { PATH: process.env.PATH ?? "" },
      },
    );

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("Goose native integration integration-target-unsupported\n");
  });

  it("keeps the production runtime resolver Darwin-only", () => {
    const target = read("apps/desktop/src/main/workers/gooseRunnerTarget.ts");
    const processSource = read("apps/desktop/src/main/workers/gooseRunnerProcess.ts");

    expect(target).toContain('return target?.platform === "darwin" ? target : undefined');
    expect(processSource).toContain(
      "resolveGooseRunnerRuntimeTarget(process.platform, process.arch)",
    );
    expect(processSource).not.toContain("ACTESTRA_GOOSE_NATIVE_INTEGRATION");
  });

  it("places the runtime-target override only in the opt-in native test", () => {
    const integrationPath = path.join(
      repositoryRoot,
      "tests/main/gooseRunnerLinuxNative.integration.ts",
    );

    expect(fs.existsSync(integrationPath)).toBe(true);
    if (!fs.existsSync(integrationPath)) return;
    const source = fs.readFileSync(integrationPath, "utf8");
    const vitest = read("vitest.config.ts");
    expect(source).toContain('vi.mock("../../apps/desktop/src/main/workers/gooseRunnerTarget"');
    expect(source).toContain("resolveGooseRunnerBuildTarget(platform, architecture)");
    expect(source).toContain("openGooseMcpSessionComposition");
    expect(source).toContain('ACTESTRA_GOOSE_NATIVE_INTEGRATION === "1"');
    expect(source).not.toContain("OPENAI_API_KEY");
    expect(source).not.toContain("ACTESTRA_API_KEY");
    expect(vitest).toContain("nativeLinuxGooseIntegrationFiles");
    expect(vitest).toContain('process.env.ACTESTRA_GOOSE_NATIVE_INTEGRATION === "1"');
    expect(vitest).toContain('"tests/main/gooseRunnerLinuxNative.integration.ts"');
  });

  it("publishes a closed, digest-bound nine-outcome evidence validator", () => {
    const validatorPath = path.join(repositoryRoot, "scripts/gooseNativeIntegrationEvidence.mjs");
    const validatorTestsPath = path.join(
      repositoryRoot,
      "tests/scripts/gooseNativeIntegrationEvidence.test.mjs",
    );
    expect(fs.existsSync(validatorPath)).toBe(true);
    expect(fs.existsSync(validatorTestsPath)).toBe(true);
  });

  it("keeps supervisor-death cleanup caller-owned and checks attempt directories directly", () => {
    const source = read("tests/main/gooseRunnerLinuxNative.integration.ts");

    expect(source).toContain("readonly privateRoot: string;");
    expect(source).toContain("await rm(state.privateRoot, { recursive: true, force: true });");
    expect(source).not.toContain("await readFile(attempts)");
    expect(source).toContain("const entries = await readdir(attempts)");
  });
});

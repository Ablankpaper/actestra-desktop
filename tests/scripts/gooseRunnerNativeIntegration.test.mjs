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

  it("admits only attempt-private Darwin and package-owned Linux runtimes", () => {
    const target = read("apps/desktop/src/main/workers/gooseRunnerTarget.ts");
    const processSource = read("apps/desktop/src/main/workers/gooseRunnerProcess.ts");

    expect(target).toContain(
      'target?.platform === "darwin" || target?.platform === "linux" ? target : undefined',
    );
    expect(target).toContain('if (platform === "darwin") return "attempt-private"');
    expect(target).toContain('if (platform === "linux") return "linux-package"');
    expect(target).not.toContain('if (platform === "win32")');
    expect(processSource).toContain("const platform = dependencies.platform ?? process.platform");
    expect(processSource).toContain(
      "const architecture = dependencies.architecture ?? process.arch",
    );
    expect(processSource).toContain("resolveGooseRunnerRuntimeTarget(platform, architecture)");
    expect(processSource).toContain(
      "resolveGooseRunnerExecutableAuthority(runtimeTarget.platform)",
    );
    expect(processSource).toContain('executableAuthority === "linux-package"');
    expect(processSource).toContain("const linuxInstall = artifact.linuxInstall");
    expect(processSource).not.toContain("ACTESTRA_GOOSE_NATIVE_INTEGRATION");
  });

  it("gives every native composition non-empty production-shaped registries", () => {
    const integration = read("tests/main/gooseRunnerLinuxNative.integration.ts");
    const supervisor = read("tests/fixtures/gooseLinuxNativeSupervisorExit.ts");

    for (const source of [integration, supervisor]) {
      expect(source).not.toContain("commandIds: Object.freeze([])");
      expect(source).not.toContain("testIds: Object.freeze([])");
      expect(source).toContain('Object.freeze(["git.status"])');
      expect(source).toContain('Object.freeze(["git.diff-check"])');
    }
  });

  it("kills the direct Main-style socket owner instead of a nested Vitest wrapper", () => {
    const fixturePath = path.join(
      repositoryRoot,
      "tests/fixtures/gooseLinuxNativeSupervisorExit.ts",
    );
    expect(fs.existsSync(fixturePath)).toBe(true);
    if (!fs.existsSync(fixturePath)) return;

    const integration = read("tests/main/gooseRunnerLinuxNative.integration.ts");
    const supervisor = fs.readFileSync(fixturePath, "utf8");
    expect(integration).toContain('spawn("bun", [supervisorFixture], {');
    expect(integration).not.toContain(
      '["run", "test", "--", "tests/fixtures/gooseLinuxNativeSupervisorExit.test.ts"]',
    );
    expect(supervisor).not.toContain('from "vitest"');
    expect(supervisor).not.toContain("vi.mock");
    expect(supervisor).toContain("await openGooseMcpSessionComposition");
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

  it("reports only a closed stage when the native test fails", () => {
    const launcher = read("scripts/run-goose-runner-native-integration.mjs");
    const integration = read("tests/main/gooseRunnerLinuxNative.integration.ts");

    expect(launcher).toContain("ACTESTRA_GOOSE_NATIVE_INTEGRATION_FAILURE_EVIDENCE_PATH");
    expect(launcher).toContain("classifyGooseNativeIntegrationFailureEvidence");
    expect(launcher).toContain('"--bail=1"');
    for (const code of [
      "integration-handshake-cleanup-failed",
      "integration-handshake-process-exit-failed",
      "integration-handshake-process-signal-failed",
      "integration-handshake-response-failed",
      "integration-handshake-timeout-failed",
      "integration-handshake-transport-failed",
      "integration-handshake-transport-process-failed",
      "integration-handshake-transport-stderr-failed",
      "integration-handshake-transport-stdin-failed",
      "integration-handshake-transport-stdout-failed",
      "integration-runner-acp-failed",
      "integration-runner-panic-failed",
      "integration-runner-relay-failed",
      "integration-runner-runtime-failed",
      "integration-parent-death-supervisor-not-exited-failed",
      "integration-parent-death-capability-owner-mismatch-failed",
      "integration-parent-death-model-owner-mismatch-failed",
      "integration-parent-death-capability-orphan-owner-failed",
      "integration-parent-death-model-orphan-owner-failed",
      "integration-parent-death-capability-owner-unresolved-failed",
      "integration-parent-death-model-owner-unresolved-failed",
      "integration-parent-death-capability-owner-not-listed-failed",
      "integration-parent-death-model-owner-not-listed-failed",
      "integration-parent-death-capability-owner-no-visible-process-failed",
      "integration-parent-death-model-owner-no-visible-process-failed",
      "integration-parent-death-capability-owner-scan-failed",
      "integration-parent-death-model-owner-scan-failed",
      "integration-parent-death-capability-owner-fd-inaccessible-failed",
      "integration-parent-death-model-owner-fd-inaccessible-failed",
      "integration-parent-death-capability-owner-process-race-failed",
      "integration-parent-death-model-owner-process-race-failed",
      "integration-parent-death-runner-not-exited-failed",
      "integration-parent-death-capability-socket-failed",
      "integration-parent-death-model-socket-failed",
      "integration-parent-death-private-root-failed",
    ]) {
      expect(launcher).toContain(`"${code}"`);
    }
    expect(launcher).not.toContain("process.stderr.write(child.stderr");
    expect(launcher).not.toContain("process.stdout.write(child.stdout");
    expect(integration).toContain('markFailureStage("artifact-admission")');
    expect(integration).toContain('markFailureStage("composition-open")');
    expect(integration).toContain("classifyOpeningFailureStage");
    expect(integration).toContain('markFailureStage("prompt")');
    expect(integration).toContain('markFailureStage("cancellation")');
    expect(integration).toContain('markFailureStage("crash")');
    expect(integration).toContain('markFailureStage("restart")');
    expect(integration).toContain('markFailureStage("parent-death")');
    expect(integration).toContain('markFailureStage("parent-death-supervisor-not-exited")');
    expect(integration).toContain('markFailureStage("parent-death-capability-owner-mismatch")');
    expect(integration).toContain('markFailureStage("parent-death-model-owner-mismatch")');
    expect(integration).toContain('markFailureStage("parent-death-capability-orphan-owner")');
    expect(integration).toContain('markFailureStage("parent-death-model-orphan-owner")');
    expect(integration).toContain('markFailureStage("parent-death-capability-owner-not-listed")');
    expect(integration).toContain('markFailureStage("parent-death-model-owner-not-listed")');
    expect(integration).toContain(
      'markFailureStage("parent-death-capability-owner-no-visible-process")',
    );
    expect(integration).toContain(
      'markFailureStage("parent-death-model-owner-no-visible-process")',
    );
    expect(integration).toContain('markFailureStage("parent-death-capability-owner-scan-failed")');
    expect(integration).toContain('markFailureStage("parent-death-model-owner-scan-failed")');
    expect(integration).toContain(
      'markFailureStage("parent-death-capability-owner-fd-inaccessible")',
    );
    expect(integration).toContain('markFailureStage("parent-death-model-owner-fd-inaccessible")');
    expect(integration).toContain('markFailureStage("parent-death-capability-owner-process-race")');
    expect(integration).toContain('markFailureStage("parent-death-model-owner-process-race")');
    expect(integration).toContain("relevantProcessGroups");
    expect(integration).toContain("readLinuxProcessGroupId");
    expect(integration).toContain('markFailureStage("parent-death-runner-not-exited")');
    expect(integration).toContain('markFailureStage("parent-death-capability-socket")');
    expect(integration).toContain('markFailureStage("parent-death-model-socket")');
    expect(integration).toContain('markFailureStage("parent-death-private-root")');
    expect(integration).toContain("readLinuxUnixSocketOwnerProcessIds");
    expect(integration).not.toContain("ownerProcessIds.join");
    expect(integration).not.toContain("JSON.stringify(ownerProcessIds");
    expect(integration).toContain('markFailureStage("cleanup")');
  });

  it("keeps supervisor-death cleanup caller-owned and checks attempt directories directly", () => {
    const source = read("tests/main/gooseRunnerLinuxNative.integration.ts");

    expect(source).toContain("readonly privateRoot: string;");
    expect(source).toContain("await rm(state.privateRoot, { recursive: true, force: true });");
    expect(source).not.toContain("await readFile(attempts)");
    expect(source).toContain("const entries = await readdir(attempts)");
  });
});

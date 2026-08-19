// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");

function read(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}

function readWorkflowJob(workflow, jobId) {
  const start = workflow.indexOf(`\n  ${jobId}:`);
  if (start === -1) return "";
  const end = workflow.slice(start + 1).search(/\n  [A-Za-z0-9_-]+:\n/u);
  return workflow.slice(start, end === -1 ? workflow.length : start + 1 + end);
}

function expectOrderedFragments(contents, fragments) {
  const normalized = contents.replace(/\s+/gu, " ");
  let cursor = -1;
  for (const fragment of fragments) {
    const next = normalized.indexOf(fragment.replace(/\s+/gu, " "), cursor + 1);
    expect(next, `missing or out-of-order CI fragment: ${fragment}`).toBeGreaterThan(cursor);
    cursor = next;
  }
}

describe("P8 native Goose build wiring", () => {
  it("admits the private runtime only for same-repository CI with a read-only deploy key", () => {
    const workflow = read(".github/workflows/ci.yml");
    const sameRepositoryCondition =
      "if: github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository";
    const hostKey =
      "github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl";

    for (const jobId of [
      "goose-runner",
      "goose-runner-windows",
      "goose-runner-linux",
      "goose-containment-windows",
      "goose-containment-linux",
      "macos",
    ]) {
      const job = readWorkflowJob(workflow, jobId);
      expect(job, `missing CI job ${jobId}`).not.toBe("");
      expect(job).toContain(sameRepositoryCondition);
      expect(job).toContain("name: Fetch admitted private Goose runtime source");
      expect(job).toContain(
        "ACTESTRA_GOOSE_RUNTIME_DEPLOY_KEY: ${{ secrets.ACTESTRA_GOOSE_RUNTIME_DEPLOY_KEY }}",
      );
      expect(job).toContain(hostKey);
      expect(job).toContain("trap 'rm -rf -- \"$key_root\"' EXIT");
      expect(job).toContain('mkdir -p "$key_root"');
      expect(job).toContain('if [ "$RUNNER_OS" != "Windows" ]; then');
      expect(job).toContain('chmod 700 "$key_root"');
      expect(job).toContain('chmod 600 "$key_root/id_ed25519"');
      expect(job).toContain("export CARGO_NET_GIT_FETCH_WITH_CLI=true");
      expect(job).toContain('export GIT_SSH_COMMAND="ssh -i $key_root/id_ed25519');
      expect(job).toContain("cargo fetch --manifest-path workers/goose-runner/Cargo.toml --locked");
      expect(job).not.toContain('install -m 700 -d "$key_root"');
      expect(job).not.toContain("$GITHUB_ENV");
      expectOrderedFragments(job, [
        "name: Checkout",
        "name: Install dependencies",
        "name: Fetch admitted private Goose runtime source",
      ]);
      const credentialStart = job.indexOf("name: Fetch admitted private Goose runtime source");
      const credentialEnd = job.indexOf("\n      - name:", credentialStart);
      const credentialWindow = job.slice(credentialStart, credentialEnd);
      expect(credentialWindow.match(/\bcargo\b/gu)).toHaveLength(1);
      expect(credentialWindow).not.toContain("bun run");
      expect(`${job.slice(0, credentialStart)}${job.slice(credentialEnd)}`).not.toContain(
        "ACTESTRA_GOOSE_RUNTIME_DEPLOY_KEY",
      );
      const uploadSteps = job
        .split(/\n\s+- name:/u)
        .filter((step) => step.includes("upload-artifact"))
        .join("\n");
      expect(uploadSteps).not.toContain("ACTESTRA_GOOSE_RUNTIME_DEPLOY_KEY");
      expect(uploadSteps).not.toContain("actestra-goose-runtime-ssh");
    }

    expect(workflow).toContain(
      "# GitHub ED25519 fingerprint: SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU",
    );
  });

  it("registers a build-only emitted-artifact verifier at the production admission boundary", () => {
    const scripts = JSON.parse(read("package.json")).scripts;
    const verifierPath = path.join(repositoryRoot, "scripts/admit-goose-runner-build.ts");

    expect(scripts["goose:runner:admit-build"]).toBe("bun scripts/admit-goose-runner-build.ts");
    expect(fs.existsSync(verifierPath)).toBe(true);
    if (!fs.existsSync(verifierPath)) return;

    const verifier = fs.readFileSync(verifierPath, "utf8");
    expect(verifier).toContain("admitGooseRunnerArtifact");
    expect(verifier).toContain("resolveGooseRunnerBuildTarget");
    expect(verifier).not.toContain("gooseRunnerProcess");
    expect(verifier).not.toContain("openGooseRunnerHandshake");
  });

  it("materializes the shared target boundary as an exact Actestra-owned source copy", () => {
    const overlay = JSON.parse(read("downstream/aionui-v2.1.41/overlay.json"));
    const source = "apps/desktop/src/main/workers/gooseRunnerTarget.ts";
    const destination = "packages/desktop/src/actestra/main/workers/gooseRunnerTarget.ts";
    const checker = read("scripts/check-aionui-downstream.mjs");
    const artifactAdmission = read("apps/desktop/src/main/workers/gooseRunnerArtifact.ts");
    const runtimeProcess = read("apps/desktop/src/main/workers/gooseRunnerProcess.ts");

    expect(overlay.sourceCopies).toContainEqual({ source, destination });
    expect(overlay.expectedChangedFiles).toContain(destination);
    expect(checker).toContain(destination);
    expect(artifactAdmission).toContain('from "./gooseRunnerTarget"');
    expect(runtimeProcess).toContain('from "./gooseRunnerTarget"');
  });

  it("passes only Electron-owned Linux package resources into coding runtime admission", () => {
    const patch = read("downstream/aionui-v2.1.41/patches/0014-actestra-team-work.mjs");
    expect(patch).toContain(
      "linuxPackageResourcesPath: process.platform === 'linux' ? process.resourcesPath : undefined",
    );
    expect(patch).not.toContain("ACTESTRA_GOOSE_LINUX_PACKAGE");
  });

  it("probes Windows and Linux native build admission without claiming runtime support", () => {
    const workflow = read(".github/workflows/ci.yml");
    expect(workflow).toContain("name: Goose runner admission");
    expect(workflow).toContain("name: macOS arm64 foundation");

    for (const [jobId, jobName, runner] of [
      ["goose-runner-windows", "P8.2 Windows x64 Goose build probe", "windows-2025"],
      ["goose-runner-linux", "P8.2 Ubuntu x64 Goose build probe", "ubuntu-24.04"],
    ]) {
      const job = readWorkflowJob(workflow, jobId);
      expect(job, `missing CI job ${jobId}`).not.toBe("");
      expect(job).toContain(`name: ${jobName}`);
      expect(job).toContain(`runs-on: ${runner}`);
      expect(job).toContain(`timeout-minutes: ${jobId === "goose-runner-windows" ? "50" : "35"}`);
      expect(job).toContain("actions/checkout@11d5960a326750d5838078e36cf38b85af677262");
      expect(job).toContain("actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020");
      expect(job).toContain("node-version: 24.13.0");
      expect(job).toContain("oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6");
      expect(job).toContain("bun-version: 1.3.9");
      expect(job).toContain(
        "rustup toolchain install 1.96.1 --profile minimal --component rustfmt",
      );
      const nativeAdmissionTests =
        jobId === "goose-runner-windows"
          ? "bun run test tests/main/gooseRunnerTarget.test.ts tests/main/gooseRunnerArtifact.test.ts tests/main/gooseRunnerLifecycle.test.ts tests/main/gooseRunnerWindowsBridge.test.ts tests/scripts/p8NativeBuildWiring.test.mjs"
          : "bun run test tests/main/gooseRunnerTarget.test.ts tests/main/gooseRunnerArtifact.test.ts tests/main/gooseRunnerLifecycle.test.ts tests/scripts/p8NativeBuildWiring.test.mjs";
      expectOrderedFragments(job, [
        "bun install --frozen-lockfile",
        "bun run goose:runner:format:check",
        "bun run goose:runner:tools",
        "bun run goose:runner:build",
        "git diff --exit-code -- workers/goose-runner/Cargo.lock",
        nativeAdmissionTests,
        "bun run goose:runner:admit-build",
      ]);
      for (const forbidden of [
        "goose:runner:test",
        "upload-artifact",
        "electron-builder",
        "dist:mac",
        "smoke:",
        "codesign",
        "publish",
        "release",
      ]) {
        expect(job, `${jobId} must not claim or run ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("runs the Windows supervisor native tests before admitting the emitted artifact", () => {
    const workflow = read(".github/workflows/ci.yml");
    const job = readWorkflowJob(workflow, "goose-runner-windows");

    expectOrderedFragments(job, [
      "bun run goose:runner:format:check",
      "cargo test --manifest-path workers/goose-runner/Cargo.toml --locked windows_native_tests",
      "bun run goose:runner:build",
      "bun run goose:runner:admit-build",
    ]);
  });

  it("installs the exact Ubuntu package layout with sudo only around setup and teardown", () => {
    const workflow = read(".github/workflows/ci.yml");
    const job = readWorkflowJob(workflow, "goose-containment-linux");
    expectOrderedFragments(job, [
      "Build exact Ubuntu Goose runner artifact",
      "Install temporary Ubuntu Goose package layout",
      "Re-admit installed Ubuntu Goose package",
      "Run authenticated Linux Goose integration",
      "Run exact Ubuntu containment acceptance",
      "Remove temporary Ubuntu Goose package layout",
    ]);
    expect(job).toContain("kernel.apparmor_restrict_unprivileged_userns");
    expect(job).toContain("downstream:aionui:inspect:deb");
    expect(job).toContain("dist:linux");
    expect(job).toContain("dpkg-deb --extract");
    expect(job).toContain("ACTESTRA_GOOSE_LINUX_BOOTSTRAP_OK");
    expect(job).toContain("goose:runner:admit-package:linux");
    expect(job).not.toContain("sysctl -w");
    expect(job).toContain("sudo install");
    expect(job).toContain("id -u");

    const integrationStep = job.slice(
      job.indexOf("- name: Run authenticated Linux Goose integration"),
      job.indexOf("- name: Run exact Ubuntu containment acceptance"),
    );
    const containmentStep = job.slice(
      job.indexOf("- name: Run exact Ubuntu containment acceptance"),
      job.indexOf("- name: Re-admit bound Ubuntu Goose runner artifact"),
    );
    expect(integrationStep).not.toContain("sudo");
    expect(containmentStep).not.toContain("sudo");
  });

  it("normalizes the GitHub Ubuntu opt root only for admission and restores its exact mode", () => {
    const workflow = read(".github/workflows/ci.yml");
    const job = readWorkflowJob(workflow, "goose-containment-linux");
    const installStep = job.slice(
      job.indexOf("- name: Install temporary Ubuntu Goose package layout"),
      job.indexOf("- name: Re-admit installed Ubuntu Goose package"),
    );
    const cleanupStep = job.slice(
      job.indexOf("- name: Remove temporary Ubuntu Goose package layout"),
    );

    expect(installStep).toContain("id: linux-package-install");
    expectOrderedFragments(installStep, [
      'test "$(stat -c \'%u\' /opt)" = "0"',
      "original_opt_mode=\"$(stat -c '%a' /opt)\"",
      'echo "opt_mode=$original_opt_mode" >> "$GITHUB_OUTPUT"',
      "sudo chmod 0755 /opt",
      'test "$(stat -c \'%a:%u\' /opt)" = "755:0"',
      "sudo install -d -o root -g root -m 0755 /opt/Actestra/resources/actestra-goose-runner",
    ]);
    expect(installStep).toContain("755 | 777) ;;");
    expect(cleanupStep).toContain(
      "ACTESTRA_ORIGINAL_OPT_MODE: ${{ steps.linux-package-install.outputs.opt_mode }}",
    );
    expectOrderedFragments(cleanupStep, [
      "sudo rm -rf -- /opt/Actestra",
      "test ! -e /opt/Actestra",
      'sudo chmod "$ACTESTRA_ORIGINAL_OPT_MODE" /opt',
      'exit "$cleanup_status"',
    ]);
    expect(job).not.toContain("chmod -R");
    expect(job).not.toContain("chmod 0777 /opt");
  });
});

// @vitest-environment node

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyPrivateGooseRuntime } from "../../scripts/goosePrivateRuntimeContract.mjs";

const patch = "fixed binary patch";
const contract = Object.freeze({
  goose: Object.freeze({
    repository: "https://github.com/aaif-goose/goose.git",
    version: "1.45.0",
    baseCommit: "1".repeat(40),
    runtimeRepository: "ssh://git@github.com/Ablankpaper/actestra-goose-runtime.git",
    runtimeCommit: "2".repeat(40),
    changedPaths: Object.freeze([
      "crates/goose/src/acp/server.rs",
      "crates/goose/src/acp/server/new_session.rs",
      "crates/goose/src/acp/server_factory.rs",
    ]),
    cargoFeatures: Object.freeze([]),
    patchSetSha256: createHash("sha256").update(patch).digest("hex"),
  }),
});

function metadata(overrides = {}) {
  const packageId = `git+${contract.goose.runtimeRepository}?rev=${contract.goose.runtimeCommit}#goose@${contract.goose.version}`;
  return {
    packages: [
      {
        id: packageId,
        name: "goose",
        version: contract.goose.version,
        source:
          `git+${contract.goose.runtimeRepository}?rev=${contract.goose.runtimeCommit}` +
          `#${contract.goose.runtimeCommit}`,
        manifest_path: "/cargo/git/checkouts/runtime/crates/goose/Cargo.toml",
        ...overrides.package,
      },
    ],
    resolve: {
      nodes: [{ id: packageId, features: [], ...overrides.node }],
    },
  };
}

function gitFixture(overrides = {}) {
  const calls = [];
  const git = async (args, cwd) => {
    calls.push({ args, cwd });
    const operation = args.join(" ");
    if (operation === "rev-parse HEAD") {
      return { code: 0, signal: null, stdout: `${contract.goose.runtimeCommit}\n`, stderr: "" };
    }
    if (operation.startsWith("merge-base --is-ancestor")) {
      return { code: 0, signal: null, stdout: "", stderr: "" };
    }
    if (operation.startsWith("diff --name-only")) {
      return {
        code: 0,
        signal: null,
        stdout: `${contract.goose.changedPaths.join("\n")}\n`,
        stderr: "",
      };
    }
    if (operation.startsWith("diff --binary")) {
      return { code: 0, signal: null, stdout: patch, stderr: "" };
    }
    throw new Error(`unexpected git call: ${operation}`);
  };
  return { calls, git: overrides.git ?? git };
}

describe("private Goose runtime build contract", () => {
  it("accepts the exact source, ancestry, changed paths, patch digest, and empty features", async () => {
    const fixture = gitFixture();

    await expect(
      verifyPrivateGooseRuntime({
        metadata: metadata(),
        sourceContract: contract,
        git: fixture.git,
      }),
    ).resolves.toBeUndefined();
    expect(fixture.calls).toHaveLength(4);
    expect(new Set(fixture.calls.map(({ cwd }) => cwd))).toEqual(
      new Set(["/cargo/git/checkouts/runtime"]),
    );
  });

  it("rejects a different private source or revision", async () => {
    await expect(
      verifyPrivateGooseRuntime({
        metadata: metadata({ package: { source: "git+ssh://git@example.invalid/runtime" } }),
        sourceContract: contract,
        git: gitFixture().git,
      }),
    ).rejects.toThrow("does not resolve the admitted private Goose runtime");
  });

  it("rejects a runtime commit outside the admitted base ancestry", async () => {
    const fixture = gitFixture({
      git: async (args, cwd) =>
        args[0] === "merge-base"
          ? { code: 1, signal: null, stdout: "", stderr: "" }
          : gitFixture().git(args, cwd),
    });
    await expect(
      verifyPrivateGooseRuntime({
        metadata: metadata(),
        sourceContract: contract,
        git: fixture.git,
      }),
    ).rejects.toThrow("does not descend from the admitted upstream base");
  });

  it("rejects a changed-path set outside the source contract", async () => {
    const fallback = gitFixture().git;
    const fixture = gitFixture({
      git: async (args, cwd) =>
        args[0] === "diff" && args[1] === "--name-only"
          ? { code: 0, signal: null, stdout: "crates/goose/src/acp/server.rs\n", stderr: "" }
          : fallback(args, cwd),
    });
    await expect(
      verifyPrivateGooseRuntime({
        metadata: metadata(),
        sourceContract: contract,
        git: fixture.git,
      }),
    ).rejects.toThrow("changed-path set differs");
  });

  it("rejects a patch digest outside the source contract", async () => {
    const fallback = gitFixture().git;
    const fixture = gitFixture({
      git: async (args, cwd) =>
        args[0] === "diff" && args[1] === "--binary"
          ? { code: 0, signal: null, stdout: "different patch", stderr: "" }
          : fallback(args, cwd),
    });
    await expect(
      verifyPrivateGooseRuntime({
        metadata: metadata(),
        sourceContract: contract,
        git: fixture.git,
      }),
    ).rejects.toThrow("patch digest differs");
  });

  it("rejects a resolved Goose feature outside the empty feature set", async () => {
    await expect(
      verifyPrivateGooseRuntime({
        metadata: metadata({ node: { features: ["telemetry"] } }),
        sourceContract: contract,
        git: gitFixture().git,
      }),
    ).rejects.toThrow("features differ");
  });
});

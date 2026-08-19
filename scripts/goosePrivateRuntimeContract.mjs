import { createHash } from "node:crypto";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

function failure(message) {
  throw new Error(message);
}

async function requireGit(git, args, cwd) {
  const result = await git(args, cwd);
  if (result.code !== 0 || result.signal !== null || typeof result.stdout !== "string") {
    failure(`Git source verification failed at ${args[0]}`);
  }
  return result.stdout;
}

export async function verifyPrivateGooseRuntime({ metadata, sourceContract, git }) {
  const gooseContract = sourceContract.goose;
  const goosePackage = metadata.packages.find(
    (packageValue) =>
      packageValue.name === "goose" && packageValue.version === gooseContract.version,
  );
  const expectedSource =
    `git+${gooseContract.runtimeRepository}?rev=${gooseContract.runtimeCommit}` +
    `#${gooseContract.runtimeCommit}`;
  if (
    goosePackage === undefined ||
    goosePackage.source !== expectedSource ||
    typeof goosePackage.manifest_path !== "string"
  ) {
    failure("Cargo metadata does not resolve the admitted private Goose runtime");
  }

  const gooseNode = metadata.resolve?.nodes?.find((node) => node.id === goosePackage.id);
  if (
    gooseNode === undefined ||
    !Array.isArray(gooseNode.features) ||
    !isDeepStrictEqual([...gooseNode.features].sort(), [...gooseContract.cargoFeatures].sort())
  ) {
    failure("Resolved Goose features differ from the admitted source contract");
  }

  const gooseRoot = path.resolve(path.dirname(goosePackage.manifest_path), "../..");
  const resolvedCommit = (await requireGit(git, ["rev-parse", "HEAD"], gooseRoot)).trim();
  if (resolvedCommit !== gooseContract.runtimeCommit) {
    failure("Fetched Goose runtime commit differs from the admitted source contract");
  }

  const ancestry = await git(
    ["merge-base", "--is-ancestor", gooseContract.baseCommit, resolvedCommit],
    gooseRoot,
  );
  if (ancestry.code !== 0 || ancestry.signal !== null) {
    failure("Fetched Goose runtime does not descend from the admitted upstream base");
  }

  const expectedChangedPaths = [...gooseContract.changedPaths].sort();
  const actualChangedPaths = (
    await requireGit(
      git,
      ["diff", "--name-only", gooseContract.baseCommit, resolvedCommit, "--"],
      gooseRoot,
    )
  )
    .split(/\r?\n/u)
    .filter(Boolean)
    .sort();
  if (!isDeepStrictEqual(actualChangedPaths, expectedChangedPaths)) {
    failure("Goose runtime changed-path set differs from the admitted source contract");
  }

  const patch = await requireGit(
    git,
    [
      "diff",
      "--binary",
      "--full-index",
      "--no-ext-diff",
      gooseContract.baseCommit,
      resolvedCommit,
      "--",
      ...expectedChangedPaths,
    ],
    gooseRoot,
  );
  const patchSha256 = createHash("sha256").update(patch).digest("hex");
  if (patchSha256 !== gooseContract.patchSetSha256) {
    failure("Goose runtime patch digest differs from the admitted source contract");
  }
}

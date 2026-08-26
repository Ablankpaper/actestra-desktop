import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { admitGooseRunnerPackage } from "../apps/desktop/src/main/workers/gooseRunnerArtifact";

export type AdmittedAionuiGoosePackage = Readonly<{
  readonly status: "verified";
  readonly targetTriple: string;
  readonly sourceCommit: string;
  readonly runnerManifestSha256: string;
  readonly executableSha256: string;
}>;

/**
 * Re-admit only the runner installed inside one native Electron package.
 * The shared Main-owned package admission validates the exact file set,
 * attestation, source commit, executable/manifest digests, SBOM, audit and
 * runner provenance. This CLI deliberately has no external Artifact fallback.
 */
export async function admitAionuiGoosePackage(
  packageResource: string,
  targetTriple: string,
  options: Readonly<{ readonly expectedSourceCommit?: string; readonly reAdmit?: boolean }> = {},
): Promise<AdmittedAionuiGoosePackage> {
  if (options.reAdmit !== true) {
    throw new Error("Goose package admission requires explicit --re-admit");
  }
  const admitted = await admitGooseRunnerPackage(path.resolve(packageResource), {
    expectedTargetTriple: targetTriple,
    ...(options.expectedSourceCommit === undefined
      ? {}
      : { expectedSourceCommit: options.expectedSourceCommit }),
  });
  return Object.freeze({
    status: "verified",
    targetTriple: admitted.attestation.targetTriple,
    sourceCommit: admitted.sourceCommit,
    runnerManifestSha256: admitted.attestation.runnerManifestSha256,
    executableSha256: admitted.attestation.executableSha256,
  });
}

function argumentValue(argv: readonly string[], name: string): string {
  const index = argv.indexOf(name);
  const value = index === -1 ? undefined : argv[index + 1];
  if (value === undefined || value.length === 0) throw new Error(`${name} requires a value`);
  return value;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const packageResource = argumentValue(argv, "--package-resource");
  const targetTriple = argumentValue(argv, "--target-triple");
  const expectedSourceCommit = process.env.GITHUB_SHA?.trim() || undefined;
  const result = await admitAionuiGoosePackage(packageResource, targetTriple, {
    expectedSourceCommit,
    reAdmit: argv.includes("--re-admit"),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();

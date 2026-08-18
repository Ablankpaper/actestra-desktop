import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";

export const LINUX_INSTALLED_GOOSE_EXECUTABLE_PATH =
  "/opt/Actestra/resources/actestra-goose-runner/actestra-goose-runner";

const LINUX_TARGET_TRIPLE = "x86_64-unknown-linux-gnu";
const MAX_EXECUTABLE_BYTES = 512 * 1024 * 1024;

function fail(code) {
  throw new Error(code);
}

/**
 * Selects the executable used by a containment probe. The manifest and
 * digest remain owned by the build artifact; a packaged Linux acceptance may
 * additionally request the already-admitted fixed install path. Keeping this
 * decision in one helper prevents the binder and the recheck from drifting.
 *
 * The owner override is only for deterministic unit fixtures. Production
 * callers use the defaults (root-owned, non-writable installed executable).
 */
export async function resolveGooseContainmentProbeExecutable({
  targetTriple,
  artifactExecutablePath,
  artifactExecutableSha256,
  artifactExecutableSize,
  requestedExecutablePath,
  expectedLinuxExecutablePath = LINUX_INSTALLED_GOOSE_EXECUTABLE_PATH,
  expectedOwnerUid = 0,
}) {
  if (requestedExecutablePath === undefined) return artifactExecutablePath;
  if (targetTriple !== LINUX_TARGET_TRIPLE) fail("probe-executable-path-invalid");
  if (requestedExecutablePath !== expectedLinuxExecutablePath) {
    fail("probe-executable-path-invalid");
  }
  if (
    typeof artifactExecutableSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(artifactExecutableSha256) ||
    !Number.isSafeInteger(artifactExecutableSize) ||
    artifactExecutableSize < 1 ||
    artifactExecutableSize > MAX_EXECUTABLE_BYTES
  ) {
    fail("probe-executable-metadata-invalid");
  }

  const requestedStat = await lstat(requestedExecutablePath).catch(() => undefined);
  if (requestedStat === undefined || requestedStat.isSymbolicLink() || !requestedStat.isFile()) {
    fail("probe-executable-invalid");
  }
  const canonicalPath = await realpath(requestedExecutablePath).catch(() => undefined);
  if (canonicalPath !== expectedLinuxExecutablePath) {
    fail("probe-executable-path-invalid");
  }
  if (
    requestedStat.uid !== expectedOwnerUid ||
    !Number.isSafeInteger(requestedStat.mode) ||
    (requestedStat.mode & 0o7022) !== 0 ||
    (requestedStat.mode & 0o100) === 0 ||
    requestedStat.size !== artifactExecutableSize
  ) {
    fail("probe-executable-metadata-invalid");
  }
  const actualDigest = createHash("sha256")
    .update(await readFile(requestedExecutablePath))
    .digest("hex");
  if (actualDigest !== artifactExecutableSha256) fail("probe-executable-digest-mismatch");
  return canonicalPath;
}

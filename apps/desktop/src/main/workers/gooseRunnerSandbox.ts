import path from "node:path";

const MACOS_DENIED_HOST_READ_ROOTS = Object.freeze([
  "/Users",
  "/Volumes",
  "/private/tmp",
  "/private/var/folders",
  "/Library",
] as const);

export interface GooseRunnerSandboxLaunch {
  readonly executable: "/usr/bin/sandbox-exec";
  readonly args: readonly string[];
  readonly profile: string;
}

export interface GooseRunnerSandboxOptions {
  readonly executablePath: string;
  readonly privateRoot: string;
  readonly networkPorts: readonly number[];
}

function sandboxLiteral(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function sandboxTraversalPaths(...values: readonly string[]): readonly string[] {
  const traversal = new Set<string>();
  for (const value of values) {
    let current = path.resolve(value);
    while (path.parse(current).root !== current) {
      traversal.add(current);
      current = path.dirname(current);
    }
  }
  return [...traversal];
}

export function createGooseRunnerSandboxLaunch(
  options: GooseRunnerSandboxOptions,
): GooseRunnerSandboxLaunch {
  if (
    process.platform !== "darwin" ||
    !path.isAbsolute(options.executablePath) ||
    path.resolve(options.executablePath) !== options.executablePath ||
    !path.isAbsolute(options.privateRoot) ||
    path.resolve(options.privateRoot) !== options.privateRoot ||
    options.privateRoot === path.parse(options.privateRoot).root ||
    !Array.isArray(options.networkPorts) ||
    options.networkPorts.some((port) => !Number.isSafeInteger(port) || port < 1 || port > 65_535)
  ) {
    throw new Error("Goose runner macOS sandbox options are invalid");
  }
  const traversalPaths = sandboxTraversalPaths(options.privateRoot, options.executablePath);
  const networkPorts = [...new Set(options.networkPorts)];
  const profile = [
    "(version 1)",
    "(allow default)",
    "(deny process-exec)",
    "(deny network*)",
    `(deny file-read* ${MACOS_DENIED_HOST_READ_ROOTS.map(
      (root) => `(subpath "${sandboxLiteral(root)}")`,
    ).join(" ")})`,
    "(deny file-write*)",
    `(allow process-exec (literal "${sandboxLiteral(options.executablePath)}"))`,
    `(allow file-read-metadata ${traversalPaths
      .map((root) => `(literal "${sandboxLiteral(root)}")`)
      .join(" ")})`,
    `(allow file-read* (subpath "${sandboxLiteral(options.privateRoot)}") (literal "${sandboxLiteral(options.executablePath)}"))`,
    `(allow file-write* (subpath "${sandboxLiteral(options.privateRoot)}") (literal "/dev/null"))`,
    ...networkPorts.map(
      (port) => `(allow network-outbound (remote ip "localhost:${String(port)}"))`,
    ),
  ].join("");
  return Object.freeze({
    executable: "/usr/bin/sandbox-exec",
    args: Object.freeze(["-p", profile, options.executablePath]),
    profile,
  });
}

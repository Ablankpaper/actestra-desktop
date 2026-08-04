import { spawn } from "node:child_process";

const [sidecarFixture, mode, pidFile, workingDirectory] = process.argv.slice(2);

if (
  sidecarFixture === undefined ||
  mode === undefined ||
  pidFile === undefined ||
  workingDirectory === undefined
) {
  process.exit(90);
}

const sidecar = spawn(process.execPath, [sidecarFixture, mode, pidFile], {
  cwd: workingDirectory,
  detached: process.platform !== "win32",
  env: {},
  shell: false,
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});

let stdout = Buffer.alloc(0);
sidecar.stdout.on("data", (chunk) => {
  stdout = Buffer.concat([stdout, chunk]);
  if (stdout.includes(0x0a)) process.exit(0);
});
sidecar.once("error", () => process.exit(91));
setTimeout(() => process.exit(92), 2_000).unref();

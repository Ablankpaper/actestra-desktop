import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appBundle = path.resolve(
  process.argv[2] ?? path.join(repositoryRoot, "release", "mac-arm64", "Actestra.app"),
);
const executable = path.join(appBundle, "Contents", "MacOS", "Actestra");
const profileDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-smoke-"));
const timeoutMilliseconds = 20_000;
let output = "";

if (!fs.existsSync(executable)) {
  console.error(`Packaged smoke failed: executable is missing at ${executable}`);
  process.exit(1);
}

const child = spawn(executable, [], {
  env: {
    ...process.env,
    ACTESTRA_USER_DATA_DIR: profileDirectory,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

child.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

function waitForExit() {
  return new Promise((resolve) => {
    child.once("exit", resolve);
  });
}

async function finishWithFailure(message) {
  child.kill("SIGTERM");
  await Promise.race([
    waitForExit(),
    new Promise((resolve) => {
      setTimeout(resolve, 2_000);
    }),
  ]);
  console.error(`Packaged smoke failed: ${message}`);
  console.error(output.trim());
  console.error(`Isolated profile retained for inspection: ${profileDirectory}`);
  process.exit(1);
}

const startedAt = Date.now();
while (
  Date.now() - startedAt < timeoutMilliseconds &&
  (!output.includes("ACTESTRA_READY") ||
    !output.includes("ACTESTRA_WINDOW_READY") ||
    !output.includes("ACTESTRA_RENDERER_READY"))
) {
  if (child.exitCode !== null) {
    await finishWithFailure(`Actestra exited early with code ${child.exitCode}`);
  }
  await new Promise((resolve) => {
    setTimeout(resolve, 100);
  });
}

if (
  !output.includes("ACTESTRA_READY") ||
  !output.includes("ACTESTRA_WINDOW_READY") ||
  !output.includes("ACTESTRA_RENDERER_READY")
) {
  await finishWithFailure("ready markers were not observed before timeout");
}

const profileEntries = fs.readdirSync(profileDirectory);
if (profileEntries.some((entry) => entry.toLowerCase().includes("aionui"))) {
  await finishWithFailure("upstream application data appeared in the isolated profile");
}

let dataLayoutManifest;
try {
  dataLayoutManifest = JSON.parse(
    fs.readFileSync(path.join(profileDirectory, "data-layout.json"), "utf8"),
  );
} catch {
  await finishWithFailure("Actestra data layout manifest is missing or unreadable");
}
if (dataLayoutManifest.product !== "Actestra" || dataLayoutManifest.layoutVersion !== 1) {
  await finishWithFailure("Actestra data layout manifest is missing or invalid");
}

child.kill("SIGTERM");
await Promise.race([
  waitForExit(),
  new Promise((resolve) => {
    setTimeout(resolve, 2_000);
  }),
]);

console.info(
  "Packaged smoke passed: Actestra reached application, window, and renderer ready markers.",
);
console.info(`Isolated profile: ${profileDirectory}`);

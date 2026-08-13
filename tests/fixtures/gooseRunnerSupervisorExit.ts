import { readFile, writeFile } from "node:fs/promises";
import { openGooseRunnerHandshake } from "../../apps/desktop/src/main/workers/gooseRunnerProcess";

const metadataPath = process.argv[2];
const statePath = process.argv[3];
if (metadataPath === undefined || statePath === undefined) {
  process.exit(90);
}

const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as Parameters<
  typeof openGooseRunnerHandshake
>[0];
const opened = await openGooseRunnerHandshake(metadata);
await writeFile(statePath, JSON.stringify({ privateRoot: opened.privateRoot }), "utf8");
process.stdout.write("READY\n");
// Stay alive until the parent test kills this supervisor. This models Main
// disappearing without giving the child a chance to call close().
setInterval(() => {}, 1_000);

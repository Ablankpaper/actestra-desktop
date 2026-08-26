import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { buildP8CleanMachineEvidence } from "./p8-clean-machine-evidence.mjs";

const MAX_INPUT_BYTES = 256 * 1024;

function readJson(filePath) {
  const resolved = path.resolve(filePath);
  const metadata = fs.lstatSync(resolved, { throwIfNoEntry: false });
  if (!metadata?.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_INPUT_BYTES) {
    throw new Error("evidence-file-invalid");
  }
  try {
    return JSON.parse(fs.readFileSync(resolved, "utf8"));
  } catch {
    throw new Error("evidence-file-invalid");
  }
}

function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === "--input") result.input = value;
    else if (argument === "--output") result.output = value;
    else throw new Error("evidence-malformed");
    index += 1;
  }
  if (typeof result.input !== "string" || typeof result.output !== "string") {
    throw new Error("evidence-malformed");
  }
  return result;
}

function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    const evidence = buildP8CleanMachineEvidence(readJson(options.input));
    const output = path.resolve(options.output);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    process.stdout.write(
      `${JSON.stringify({ targetId: evidence.targetId, status: evidence.status })}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `P8.4 clean-machine evidence ${error instanceof Error ? error.message : "evidence-malformed"}\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

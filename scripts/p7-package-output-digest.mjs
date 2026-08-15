import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { computeMaterializedOutputSha256 } from "./p7-packaged-trust.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const materializedRoot =
  process.argv[2] ?? path.join(repositoryRoot, ".actestra", "aionui-v2.1.41");

try {
  console.log(computeMaterializedOutputSha256(materializedRoot));
} catch {
  console.error("P7 package output digest failed: materialized output is unavailable");
  process.exitCode = 1;
}

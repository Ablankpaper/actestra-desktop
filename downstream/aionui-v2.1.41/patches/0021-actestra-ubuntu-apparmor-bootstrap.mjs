import fs from "node:fs";
import path from "node:path";

const outputRoot = path.resolve(process.argv[2] ?? "");
if (path.basename(outputRoot) !== "aionui-v2.1.41") {
  throw new Error(`Expected a materialized aionui-v2.1.41 tree, received ${outputRoot}`);
}

const builderConfig = path.join(outputRoot, "packages/desktop/electron-builder.yml");
let contents = fs.readFileSync(builderConfig, "utf8");

function replaceOnce(before, after) {
  const first = contents.indexOf(before);
  if (first === -1 || contents.indexOf(before, first + before.length) !== -1) {
    throw new Error("Expected exactly one Ubuntu AppArmor builder context");
  }
  contents = contents.slice(0, first) + after + contents.slice(first + before.length);
}

replaceOnce(
  `  - from: resources/hub\n    to: hub\n`,
  `  - from: resources/hub\n    to: hub\n  - from: resources/actestra-goose-runner\n    to: actestra-goose-runner\n  - from: resources/actestra-goose-runner-admission.json\n    to: actestra-goose-runner-admission.json\n`,
);
const linuxAnchor = "linux:\n";
const linuxIndex = contents.indexOf(linuxAnchor);
if (linuxIndex === -1 || contents.indexOf(linuxAnchor, linuxIndex + linuxAnchor.length) !== -1) {
  throw new Error("Expected exactly one Linux builder context");
}
contents =
  contents.slice(0, linuxIndex) +
  `deb:\n  appArmorProfile: resources/actestra-apparmor-profile\n\n` +
  contents.slice(linuxIndex);
fs.writeFileSync(builderConfig, contents, "utf8");

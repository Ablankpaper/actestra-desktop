// @vitest-environment node

import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const inspectorPath = path.join(repositoryRoot, "scripts/inspect-aionui-linux-deb.mjs");
const roots = [];

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "actestra-linux-deb-inspect-"));
  roots.push(root);
  const dataRoot = path.join(root, "data/opt/Actestra/resources");
  const controlRoot = path.join(root, "control");
  const runnerRoot = path.join(dataRoot, "actestra-goose-runner");
  await mkdir(runnerRoot, { recursive: true });
  await mkdir(controlRoot, { recursive: true });
  const files = {
    executable: Buffer.from("runner"),
    manifest: Buffer.from("manifest"),
    sbom: Buffer.from("sbom"),
    audit: Buffer.from("audit"),
    lock: Buffer.from("lock"),
    license: Buffer.from("license"),
    profile: Buffer.from("profile bytes\n"),
  };
  await Promise.all([
    writeFile(path.join(runnerRoot, "actestra-goose-runner"), files.executable),
    writeFile(path.join(runnerRoot, "actestra-goose-runner.manifest.json"), files.manifest),
    writeFile(path.join(runnerRoot, "actestra-goose-runner.cdx.json"), files.sbom),
    writeFile(path.join(runnerRoot, "actestra-goose-runner.audit.json"), files.audit),
    writeFile(path.join(runnerRoot, "Cargo.lock"), files.lock),
    writeFile(path.join(runnerRoot, "GOOSE-APACHE-2.0.txt"), files.license),
    writeFile(path.join(dataRoot, "apparmor-profile"), files.profile),
    writeFile(
      path.join(dataRoot, "actestra-goose-runner-admission.json"),
      JSON.stringify({
        contractVersion: 1,
        targetTriple: "x86_64-unknown-linux-gnu",
        runnerManifestSha256: digest(files.manifest),
        executableSha256: digest(files.executable),
        profileSha256: digest(files.profile),
        profileName: "Actestra-Goose-Runner",
        executablePath: "/opt/Actestra/resources/actestra-goose-runner/actestra-goose-runner",
      }),
    ),
    writeFile(path.join(controlRoot, "postinst"), "load /etc/apparmor.d/Actestra after install\n"),
    writeFile(path.join(controlRoot, "prerm"), "remove /etc/apparmor.d/Actestra before remove\n"),
  ]);
  await chmod(path.join(runnerRoot, "actestra-goose-runner"), 0o755);
  return { root, dataRoot, controlRoot };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Ubuntu DEB Goose package inspector", () => {
  it("is exposed as a bounded package inspection command", async () => {
    const scripts = JSON.parse(
      await (
        await import("node:fs/promises")
      ).readFile(path.join(repositoryRoot, "package.json"), "utf8"),
    );
    expect(scripts.scripts["downstream:aionui:inspect:deb"]).toBe(
      "node scripts/inspect-aionui-linux-deb.mjs",
    );
  });

  it("accepts the exact profile, six-file runner Artifact, record, and maintainer hooks", async () => {
    expect((await import(pathToFileURL(inspectorPath).href)).inspectAionuiLinuxDeb).toBeTypeOf(
      "function",
    );
    const inspector = await import(pathToFileURL(inspectorPath).href);
    const value = await fixture();
    await expect(inspector.inspectAionuiLinuxDeb(value.root)).resolves.toEqual(
      expect.objectContaining({ status: "verified", packageFormat: "deb" }),
    );
  });

  it.each([
    ["missing profile", async (value) => rm(path.join(value.dataRoot, "apparmor-profile"))],
    [
      "missing runner entry",
      async (value) => rm(path.join(value.dataRoot, "actestra-goose-runner/Cargo.lock")),
    ],
    [
      "changed profile bytes",
      async (value) => writeFile(path.join(value.dataRoot, "apparmor-profile"), "changed\n"),
    ],
    [
      "missing profile hook",
      async (value) => writeFile(path.join(value.controlRoot, "postinst"), "true\n"),
    ],
  ])("rejects %s with a closed code", async (_label, mutate) => {
    const inspector = await import(pathToFileURL(inspectorPath).href);
    const value = await fixture();
    await mutate(value);
    await expect(inspector.inspectAionuiLinuxDeb(value.root)).rejects.toMatchObject({
      code: expect.stringMatching(/^deb-/u),
    });
  });
});

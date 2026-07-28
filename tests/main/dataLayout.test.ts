import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CURRENT_DATA_LAYOUT_VERSION,
  DATA_LAYOUT_MANIFEST,
  ensureDataLayout,
} from "../../apps/desktop/src/main/dataLayout";

const testDirectories: string[] = [];

function createTestDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-data-layout-test-"));
  testDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of testDirectories.splice(0)) {
    if (!directory.startsWith(path.join(os.tmpdir(), "actestra-data-layout-test-"))) {
      throw new Error(`Refusing to remove unexpected test directory: ${directory}`);
    }
    fs.rmSync(directory, {
      recursive: true,
      force: true,
    });
  }
});

describe("Actestra data layout", () => {
  it("creates an Actestra-owned version manifest on first launch", () => {
    const directory = createTestDirectory();

    expect(ensureDataLayout(directory)).toBe("created");
    expect(JSON.parse(fs.readFileSync(path.join(directory, DATA_LAYOUT_MANIFEST), "utf8"))).toEqual(
      {
        product: "Actestra",
        layoutVersion: CURRENT_DATA_LAYOUT_VERSION,
      },
    );
  });

  it("reuses the current layout without rewriting its manifest", () => {
    const directory = createTestDirectory();

    ensureDataLayout(directory);
    const manifestPath = path.join(directory, DATA_LAYOUT_MANIFEST);
    const firstModifiedTime = fs.statSync(manifestPath).mtimeMs;

    expect(ensureDataLayout(directory)).toBe("current");
    expect(fs.statSync(manifestPath).mtimeMs).toBe(firstModifiedTime);
  });

  it("fails closed for a future layout version", () => {
    const directory = createTestDirectory();
    fs.writeFileSync(
      path.join(directory, DATA_LAYOUT_MANIFEST),
      JSON.stringify({
        product: "Actestra",
        layoutVersion: CURRENT_DATA_LAYOUT_VERSION + 1,
      }),
    );

    expect(() => ensureDataLayout(directory)).toThrow(/newer than supported/i);
  });

  it("fails closed for a foreign product manifest", () => {
    const directory = createTestDirectory();
    fs.writeFileSync(
      path.join(directory, DATA_LAYOUT_MANIFEST),
      JSON.stringify({
        product: "OtherProduct",
        layoutVersion: CURRENT_DATA_LAYOUT_VERSION,
      }),
    );

    expect(() => ensureDataLayout(directory)).toThrow(/manifest is invalid/i);
  });
});

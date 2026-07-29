// @vitest-environment node

import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  materializeAionUiDownstream,
  resolveContainedPath,
} from "../../scripts/materialize-aionui-downstream.mjs";

describe("AionUi downstream path safety", () => {
  it("rejects absolute and traversing overlay paths", () => {
    const root = path.join(os.tmpdir(), "actestra-path-root");

    expect(() => resolveContainedPath(root, "../escape", "test path")).toThrow(
      /escapes its declared root/u,
    );
    expect(() => resolveContainedPath(root, path.join(root, "absolute"), "test path")).toThrow(
      /relative path/u,
    );
    expect(resolveContainedPath(root, "nested/file.txt", "test path")).toBe(
      path.join(root, "nested", "file.txt"),
    );
  });

  it("refuses to remove a generated tree outside the repository-owned directory", () => {
    const outside = path.join(os.tmpdir(), "aionui-v2.1.41");

    expect(() =>
      materializeAionUiDownstream({
        outputRoot: outside,
      }),
    ).toThrow(/Downstream output/u);
  });
});

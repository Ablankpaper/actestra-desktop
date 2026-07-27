import { describe, expect, it } from "vitest";
import { createWindowOptions } from "../../apps/desktop/src/main/windowOptions";

describe("desktop window boundary", () => {
  it("keeps renderer authority sandboxed", () => {
    const options = createWindowOptions("/tmp/actestra-preload.js");

    expect(options.show).toBe(false);
    expect(options.webPreferences).toMatchObject({
      preload: "/tmp/actestra-preload.js",
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    });
  });
});

import { describe, expect, it } from "vitest";
import { createWindowOptions } from "../../apps/desktop/src/main/windowOptions";

describe("desktop window boundary", () => {
  it("keeps packaged renderer authority sandboxed and closes DevTools", () => {
    const options = createWindowOptions("/tmp/actestra-preload.js", true);

    expect(options.show).toBe(false);
    expect(options.webPreferences).toMatchObject({
      preload: "/tmp/actestra-preload.js",
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: false,
    });
  });

  it("keeps DevTools available for local development", () => {
    const options = createWindowOptions("/tmp/actestra-preload.js", false);

    expect(options.webPreferences?.devTools).toBe(true);
  });
});

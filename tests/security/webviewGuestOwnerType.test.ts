// @vitest-environment node

import type { WebContents } from "electron";
import { describe, expect, it } from "vitest";
import { installWebviewGuestSecurity } from "../../apps/desktop/src/main/security/p7SecuritySmoke";

describe("P7 WebView owner type boundary", () => {
  it("accepts Electron WebContents at the Main registration boundary", () => {
    const owner: Parameters<typeof installWebviewGuestSecurity>[0] = {} as WebContents;
    expect(owner).toBeDefined();
  });
});

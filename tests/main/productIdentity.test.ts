import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  APP_ID,
  isActestraDeepLink,
  PRODUCT_NAME,
  PROTOCOL_SCHEME,
  resolveUserDataPath,
  USER_DATA_DIRECTORY,
} from "../../apps/desktop/src/main/productIdentity";

describe("product identity", () => {
  it("owns stable Actestra identifiers", () => {
    expect(PRODUCT_NAME).toBe("Actestra");
    expect(APP_ID).toBe("com.bignormal.actestra");
    expect(PROTOCOL_SCHEME).toBe("actestra");
    expect(USER_DATA_DIRECTORY).toBe("Actestra");
  });

  it("uses an Actestra-owned default data path", () => {
    expect(resolveUserDataPath("/tmp/application-support")).toBe(
      path.join("/tmp/application-support", "Actestra"),
    );
  });

  it("resolves an explicit test or deployment override", () => {
    expect(resolveUserDataPath("/ignored", "./isolated-profile")).toBe(
      path.resolve("./isolated-profile"),
    );
    expect(resolveUserDataPath("/tmp/application-support", "   ")).toBe(
      path.join("/tmp/application-support", "Actestra"),
    );
  });

  it("accepts only the Actestra deep-link scheme", () => {
    expect(isActestraDeepLink("actestra://task/example")).toBe(true);
    expect(isActestraDeepLink("https://example.com")).toBe(false);
    expect(isActestraDeepLink("aionui://task/example")).toBe(false);
    expect(isActestraDeepLink("not a url")).toBe(false);
  });
});

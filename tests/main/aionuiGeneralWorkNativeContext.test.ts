import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  AionUiGeneralWorkNativeContextResolver,
  type AionUiGeneralWorkNativeConversationReader,
} from "../../apps/desktop/src/main/compatibility/aionuiGeneralWorkNativeContext";

describe("AionUI general-work native context resolver", () => {
  it("extracts only the bounded workspace authority needed by Actestra Core", async () => {
    const reader: AionUiGeneralWorkNativeConversationReader = {
      read: vi.fn(async () => ({
        id: "conversation-native-workspace",
        name: " Native project ",
        extra: {
          workspace: "/private/tmp/native-project",
          backend: "gemini",
        },
        model: {
          id: "must-not-cross-the-boundary",
        },
      })),
    };
    const resolver = new AionUiGeneralWorkNativeContextResolver(reader);

    await expect(resolver.resolve("conversation-native-workspace")).resolves.toEqual({
      rootPath: "/private/tmp/native-project",
      displayName: "Native project",
    });
    expect(reader.read).toHaveBeenCalledExactlyOnceWith("conversation-native-workspace");
  });

  it.each([
    undefined,
    null,
    {},
    { name: "Project", extra: {} },
    { name: "", extra: { workspace: "/private/tmp/project" } },
    { name: "Project", extra: { workspace: "" } },
    { name: "Project", extra: { workspace: " /private/tmp/project" } },
    {
      name: "Project",
      extra: {
        workspace: `/private/tmp/${"x".repeat(8_193)}`,
      },
    },
    {
      id: "conversation-native-workspace",
      name: "Project",
      extra: {
        workspace: path.parse(process.cwd()).root,
      },
    },
  ])("fails closed for an invalid native conversation payload %#", async (payload) => {
    const resolver = new AionUiGeneralWorkNativeContextResolver({
      read: async () => payload,
    });

    await expect(resolver.resolve("conversation-native-workspace")).rejects.toThrow(
      /native conversation context/u,
    );
  });

  it("validates the native conversation identity before transport", async () => {
    const read = vi.fn(async () => ({
      name: "Project",
      extra: { workspace: "/private/tmp/project" },
    }));
    const resolver = new AionUiGeneralWorkNativeContextResolver({ read });

    await expect(resolver.resolve(" conversation-native-workspace")).rejects.toThrow(
      /conversation identity/u,
    );
    expect(read).not.toHaveBeenCalled();
  });
});

import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  AionUiGeneralWorkNativeContextResolver,
  canonicalizeAionUiGeneralWorkNativeContext,
  type AionUiGeneralWorkNativeConversationReader,
} from "../../apps/desktop/src/main/compatibility/aionuiGeneralWorkNativeContext";

describe("AionUI general-work native context resolver", () => {
  it("uses the canonical workspace path and truncates presentation text at 128 UTF-8 bytes", async () => {
    const requestedRoot = path.join(process.cwd(), "workspace-alias");
    const canonicalRoot = path.join(process.cwd(), "workspace-canonical");
    const expectedDisplayName = `${"界".repeat(42)}ab`;
    const resolveRealpath = vi.fn(async () => canonicalRoot);

    const canonical = await canonicalizeAionUiGeneralWorkNativeContext(
      {
        rootPath: requestedRoot,
        displayName: `${expectedDisplayName}界`,
      },
      resolveRealpath,
    );

    expect(resolveRealpath).toHaveBeenCalledExactlyOnceWith(requestedRoot);
    expect(canonical).toEqual({
      rootPath: canonicalRoot,
      displayName: expectedDisplayName,
    });
    expect(new TextEncoder().encode(canonical.displayName).byteLength).toBe(128);
  });

  it("rejects control-bearing trusted presentation text before filesystem resolution", async () => {
    const requestedRoot = path.join(process.cwd(), "workspace-control-name");
    const resolveRealpath = vi.fn(async () => requestedRoot);

    await expect(
      canonicalizeAionUiGeneralWorkNativeContext(
        { rootPath: requestedRoot, displayName: "Trusted\u0000workspace" },
        resolveRealpath,
      ),
    ).rejects.toThrow("AionUI conversation has no bounded workspace name");
    expect(resolveRealpath).not.toHaveBeenCalled();
  });

  it("rejects an invalid path returned by canonical filesystem resolution", async () => {
    const requestedRoot = path.join(process.cwd(), "workspace-invalid-canonical");
    const resolveRealpath = vi.fn(async () => "relative-canonical-workspace");

    await expect(
      canonicalizeAionUiGeneralWorkNativeContext(
        { rootPath: requestedRoot, displayName: "Trusted workspace" },
        resolveRealpath,
      ),
    ).rejects.toThrow("AionUI conversation workspace canonical root is invalid");
    expect(resolveRealpath).toHaveBeenCalledExactlyOnceWith(requestedRoot);
  });

  it.each([
    ".",
    `${process.cwd()}\nprivate-suffix`,
    path.join(path.parse(process.cwd()).root, "x".repeat(8_193)),
  ])(
    "rejects an unsafe trusted workspace root before filesystem resolution %#",
    async (rootPath) => {
      const resolveRealpath = vi.fn(async () => rootPath);
      await expect(
        canonicalizeAionUiGeneralWorkNativeContext(
          { rootPath, displayName: "Trusted workspace" },
          resolveRealpath,
        ),
      ).rejects.toThrow("AionUI conversation has no bounded workspace root");
      expect(resolveRealpath).not.toHaveBeenCalled();
    },
  );

  it("bounds filesystem resolution failure without exposing the absolute path", async () => {
    const rootPath = path.join(process.cwd(), ".actestra-missing-native-context-workspace");
    const resolutionFailure = new Error("Controlled realpath failure");
    const resolveRealpath = vi.fn(async () => {
      throw resolutionFailure;
    });
    let failure: unknown;

    try {
      await canonicalizeAionUiGeneralWorkNativeContext(
        {
          rootPath,
          displayName: "Missing workspace",
        },
        resolveRealpath,
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    if (!(failure instanceof Error)) {
      throw new Error("Expected native context resolution to fail");
    }
    expect(failure.message).toBe("AionUI conversation workspace could not be resolved");
    expect(failure.message).not.toContain(rootPath);
    expect(failure.cause).toBe(resolutionFailure);
    expect(resolveRealpath).toHaveBeenCalledExactlyOnceWith(rootPath);
  });

  it("extracts only the bounded workspace authority needed by Actestra Core", async () => {
    const resolveRealpath = vi.fn(async () => "/private/tmp/native-project-canonical");
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
    const resolver = new AionUiGeneralWorkNativeContextResolver(reader, resolveRealpath);

    await expect(resolver.resolve("conversation-native-workspace")).resolves.toEqual({
      rootPath: "/private/tmp/native-project-canonical",
      displayName: "Native project",
    });
    expect(reader.read).toHaveBeenCalledExactlyOnceWith("conversation-native-workspace");
    expect(resolveRealpath).toHaveBeenCalledExactlyOnceWith("/private/tmp/native-project");
  });

  it("rejects a configured workspace alias that canonicalizes to the filesystem root", async () => {
    const requestedRoot = path.join(path.parse(process.cwd()).root, "workspace-root-alias");
    const resolveRealpath = vi.fn(async () => path.parse(requestedRoot).root);
    const resolver = new AionUiGeneralWorkNativeContextResolver(
      {
        read: vi.fn(async () => ({
          id: "conversation-native-root-alias",
          name: "Root alias",
          extra: { workspace: requestedRoot },
        })),
      },
      resolveRealpath,
    );

    await expect(resolver.resolve("conversation-native-root-alias")).rejects.toThrow(
      "workspace root must not be the filesystem root",
    );
    expect(resolveRealpath).toHaveBeenCalledExactlyOnceWith(requestedRoot);
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

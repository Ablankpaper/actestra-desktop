// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  createAionUiGeneralWorkRegistration,
  createAionUiLocalResearchRegistration,
  createAionUiWritingRegistration,
  createAionUiWorkspaceFileRegistration,
} from "../fixtures/aionuiGeneralWork";

describe("AionUI general-work journey identity", () => {
  it("derives a stable metadata-only conversation hash", async () => {
    const compatibility = (await import("../../apps/desktop/src/compatibility/aionui")) as Record<
      string,
      unknown
    >;

    expect(compatibility.hashAionUiGeneralWorkConversation).toBeTypeOf("function");

    const hash = (
      compatibility.hashAionUiGeneralWorkConversation as (conversationId: string) => string
    )("conversation-native-1");

    expect(hash).toBe("8d67d46a10371f76a7a3cfbf44cfdc87d14c3f8b62328e48ac8e7aca70153961");
    expect(hash).not.toContain("conversation-native-1");
  });
});

describe("AionUI general-work intent", () => {
  it("maps preserved commands to the closed prompt, file, and local-research journeys", async () => {
    const compatibility = (await import("../../apps/desktop/src/compatibility/aionui")) as Record<
      string,
      unknown
    >;

    expect(compatibility.parseAionUiGeneralWorkCommand).toBeTypeOf("function");
    const parseCommand = compatibility.parseAionUiGeneralWorkCommand as (value: string) => unknown;
    expect(parseCommand("/actestra summarize this task")).toEqual({
      prompt: "summarize this task",
      journeyKind: "prompt-artifact",
    });
    expect(parseCommand("/actestra file review the reserved input")).toEqual({
      prompt: "review the reserved input",
      journeyKind: "workspace-file-artifact",
    });
    expect(parseCommand("/actestra file")).toEqual({
      prompt: "",
      journeyKind: "workspace-file-artifact",
    });
    expect(parseCommand("/actestra research compare the approved source notes")).toEqual({
      prompt: "compare the approved source notes",
      journeyKind: "local-research-artifact",
    });
    expect(parseCommand("/actestra research")).toEqual({
      prompt: "",
      journeyKind: "local-research-artifact",
    });
    const writingBrief = [
      "Title: Quarterly launch note",
      "Audience: Product leadership",
      "Purpose: Explain the approved launch sequence.",
      "Point: Start with the verified customer outcome.",
      "Point: Close with the bounded next step.",
    ].join("\n");
    expect(parseCommand(`/actestra write ${writingBrief}`)).toEqual({
      prompt: writingBrief,
      journeyKind: "writing-artifact",
    });
    expect(parseCommand("/actestra write")).toEqual({
      prompt: "",
      journeyKind: "writing-artifact",
    });
    expect(parseCommand("ordinary native AionUI message")).toBeNull();
  });

  it("accepts one bounded typed submission", async () => {
    const compatibility = (await import("../../apps/desktop/src/compatibility/aionui")) as Record<
      string,
      unknown
    >;

    expect(compatibility.assertAionUiGeneralWorkIntent).toBeTypeOf("function");
    expect(() =>
      (compatibility.assertAionUiGeneralWorkIntent as (value: unknown) => void)({
        contractVersion: 1,
        nativeConversationId: "conversation-native-1",
        submissionId: "submission-native-1",
        prompt: "Summarize the approved workspace file.",
      }),
    ).not.toThrow();
    expect(() =>
      (compatibility.assertAionUiGeneralWorkIntent as (value: unknown) => void)({
        contractVersion: 1,
        nativeConversationId: "conversation-native-1",
        submissionId: "submission-native-file-1",
        prompt: "Process the reserved workspace text.",
        journeyKind: "workspace-file-artifact",
      }),
    ).not.toThrow();
    expect(() =>
      (compatibility.assertAionUiGeneralWorkIntent as (value: unknown) => void)({
        contractVersion: 1,
        nativeConversationId: "conversation-native-1",
        submissionId: "submission-native-research-1",
        prompt: "Compare the approved local source notes.",
        journeyKind: "local-research-artifact",
      }),
    ).not.toThrow();
  });

  it("accepts only the exact bounded writing brief contract", async () => {
    const compatibility = (await import("../../apps/desktop/src/compatibility/aionui")) as Record<
      string,
      unknown
    >;
    const assertIntent = compatibility.assertAionUiGeneralWorkIntent as (value: unknown) => void;
    const intent = {
      contractVersion: 1,
      nativeConversationId: "conversation-native-1",
      submissionId: "submission-native-writing-1",
      journeyKind: "writing-artifact",
      prompt: [
        "Title: Quarterly launch note",
        "Audience: Product leadership",
        "Purpose: Explain the approved launch sequence.",
        "Point: Start with the verified customer outcome.",
        "Point: Close with the bounded next step.",
      ].join("\n"),
    };

    expect(() => assertIntent(intent)).not.toThrow();

    for (const prompt of [
      [
        "Title: Quarterly launch note",
        "Audience: Product leadership",
        "Purpose: Explain the approved launch sequence.",
      ].join("\n"),
      [
        "Audience: Product leadership",
        "Title: Quarterly launch note",
        "Purpose: Explain the approved launch sequence.",
        "Point: Start with the verified customer outcome.",
      ].join("\n"),
      [
        "Title: Quarterly launch note",
        "Audience: Product leadership",
        "Purpose: Explain the approved launch sequence.",
        "Source: Unapproved field",
        "Point: Start with the verified customer outcome.",
      ].join("\n"),
      [
        "Title: Quarterly launch note",
        "Audience: Product leadership",
        "Purpose: ",
        "Point: Start with the verified customer outcome.",
      ].join("\n"),
      [
        "Title: Quarterly launch note",
        "Audience: Product leadership",
        "Purpose: Explain the approved launch sequence.",
        ...Array.from({ length: 9 }, (_, index) => `Point: Draft point ${index + 1}.`),
      ].join("\n"),
      [
        `Title: ${"t".repeat(257)}`,
        "Audience: Product leadership",
        "Purpose: Explain the approved launch sequence.",
        "Point: Start with the verified customer outcome.",
      ].join("\n"),
      [
        "Title: Quarterly launch note",
        "Audience: Product leadership",
        "Purpose: Explain the approved launch sequence.",
        `Point: ${"p".repeat(2_049)}`,
      ].join("\n"),
      [
        "Title: Quarterly\u2028launch note",
        "Audience: Product leadership",
        "Purpose: Explain the approved launch sequence.",
        "Point: Start with the verified customer outcome.",
      ].join("\n"),
      [
        "Title: Quarterly launch note",
        "Audience: Product leadership",
        "Purpose: Explain the approved launch sequence.",
        "Point: Start\u2029with the verified customer outcome.",
      ].join("\n"),
    ]) {
      expect(() => assertIntent({ ...intent, prompt })).toThrowError(
        expect.objectContaining({ code: "invalid-intent" }),
      );
    }
  });

  it("preserves a forbidden Unicode separator at the writing-command boundary", async () => {
    const compatibility = (await import("../../apps/desktop/src/compatibility/aionui")) as Record<
      string,
      unknown
    >;
    const parseCommand = compatibility.parseAionUiGeneralWorkCommand as (
      value: string,
    ) => { readonly prompt: string; readonly journeyKind: string } | null;
    const assertIntent = compatibility.assertAionUiGeneralWorkIntent as (value: unknown) => void;
    const brief = [
      "Title: Quarterly launch note",
      "Audience: Product leadership",
      "Purpose: Explain the approved launch sequence.",
      "Point: Start with the verified customer outcome.",
    ].join("\n");
    const parsed = parseCommand(`/actestra write ${brief}\u2028`);

    expect(parsed).toMatchObject({ journeyKind: "writing-artifact" });
    expect(() =>
      assertIntent({
        contractVersion: 1,
        nativeConversationId: "conversation-native-1",
        submissionId: "submission-native-writing-separator",
        ...parsed,
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid-intent" }));
  });

  it("rejects undeclared authority fields and unbounded text", async () => {
    const compatibility = (await import("../../apps/desktop/src/compatibility/aionui")) as Record<
      string,
      unknown
    >;
    const assertIntent = compatibility.assertAionUiGeneralWorkIntent as (value: unknown) => void;
    const valid = {
      contractVersion: 1,
      nativeConversationId: "conversation-native-1",
      submissionId: "submission-native-1",
      prompt: "Summarize the approved workspace file.",
    };

    for (const invalid of [
      { ...valid, workspaceRoot: "/private/workspace" },
      { ...valid, nativeConversationId: "c".repeat(257) },
      { ...valid, submissionId: "s".repeat(129) },
      { ...valid, prompt: "p".repeat(16_385) },
      { ...valid, prompt: "unsafe\u0000prompt" },
      { ...valid, journeyKind: "arbitrary-shell" },
    ]) {
      expect(() => assertIntent(invalid)).toThrowError(
        expect.objectContaining({ code: "invalid-intent" }),
      );
    }
  });
});

describe("AionUI general-work authoritative registration", () => {
  it("accepts one metadata-only link with atomic domain, grant, and input authority", async () => {
    const compatibility = (await import("../../apps/desktop/src/compatibility/aionui")) as Record<
      string,
      unknown
    >;
    const registration = createAionUiGeneralWorkRegistration("contract-1");

    expect(compatibility.assertAionUiGeneralWorkRegistration).toBeTypeOf("function");
    expect(() =>
      (compatibility.assertAionUiGeneralWorkRegistration as (value: unknown) => void)(registration),
    ).not.toThrow();
  });

  it("accepts only the initial input field selected by the journey kind", async () => {
    const compatibility = (await import("../../apps/desktop/src/compatibility/aionui")) as Record<
      string,
      unknown
    >;
    const assertRegistration = compatibility.assertAionUiGeneralWorkRegistration as (
      value: unknown,
    ) => void;
    const prompt = createAionUiGeneralWorkRegistration("prompt-kind");
    const file = createAionUiWorkspaceFileRegistration("file-kind");
    const research = createAionUiLocalResearchRegistration("research-kind");

    expect(() => assertRegistration(prompt)).not.toThrow();
    expect(() => assertRegistration(file)).not.toThrow();
    expect(() => assertRegistration(research)).not.toThrow();
  });

  it("accepts writing registration without placeholder tool authority", async () => {
    const compatibility = (await import("../../apps/desktop/src/compatibility/aionui")) as Record<
      string,
      unknown
    >;
    const assertRegistration = compatibility.assertAionUiGeneralWorkRegistration as (
      value: unknown,
    ) => void;
    const writing = createAionUiWritingRegistration("writing-kind");
    const prompt = createAionUiGeneralWorkRegistration("writing-placeholder");

    expect(() => assertRegistration(writing)).not.toThrow();
    expect(() =>
      assertRegistration({
        ...writing,
        toolInputReference: prompt.toolInputReference,
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid-registration" }));
  });

  it("rejects a writing registration whose persisted prompt is not a writing brief", async () => {
    const compatibility = (await import("../../apps/desktop/src/compatibility/aionui")) as Record<
      string,
      unknown
    >;
    const assertRegistration = compatibility.assertAionUiGeneralWorkRegistration as (
      value: unknown,
    ) => void;
    const writing = createAionUiWritingRegistration("invalid-writing-brief");

    expect(() =>
      assertRegistration({
        ...writing,
        promptReference: {
          ...writing.promptReference,
          content: "Draft an unstructured document.",
        },
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid-registration" }));
  });

  it("rejects mismatched, ambiguous, or missing initial input fields", async () => {
    const compatibility = (await import("../../apps/desktop/src/compatibility/aionui")) as Record<
      string,
      unknown
    >;
    const assertRegistration = compatibility.assertAionUiGeneralWorkRegistration as (
      value: unknown,
    ) => void;
    const prompt = createAionUiGeneralWorkRegistration("invalid-prompt-kind");
    const file = createAionUiWorkspaceFileRegistration("invalid-file-kind");
    const { readInputReference, ...fileWithoutInput } = file;
    const { toolInputReference: _toolInputReference, ...promptWithoutInput } = prompt;

    for (const invalid of [
      {
        ...prompt,
        link: { ...prompt.link, journeyKind: "workspace-file-artifact" },
      },
      {
        ...file,
        link: { ...file.link, journeyKind: "prompt-artifact" },
      },
      {
        ...prompt,
        readInputReference,
      },
      fileWithoutInput,
      promptWithoutInput,
    ]) {
      expect(() => assertRegistration(invalid)).toThrowError(
        expect.objectContaining({ code: "invalid-registration" }),
      );
    }
  });

  it("rejects raw native identity and non-initial domain state", async () => {
    const compatibility = (await import("../../apps/desktop/src/compatibility/aionui")) as Record<
      string,
      unknown
    >;
    const assertRegistration = compatibility.assertAionUiGeneralWorkRegistration as (
      value: unknown,
    ) => void;
    const valid = createAionUiGeneralWorkRegistration("contract-invalid");

    for (const invalid of [
      {
        ...valid,
        link: { ...valid.link, nativeConversationId: "conversation-native-1" },
      },
      {
        ...valid,
        task: { ...valid.task, state: "running" },
        session: { ...valid.session, state: "running" },
        worker: { ...valid.worker, state: "busy" },
      },
    ]) {
      expect(() => assertRegistration(invalid)).toThrowError(
        expect.objectContaining({ code: "invalid-registration" }),
      );
    }
  });
});

describe("AionUI general-work renderer projection", () => {
  it("accepts only bounded task and artifact presentation data", async () => {
    const compatibility = (await import("../../apps/desktop/src/compatibility/aionui")) as Record<
      string,
      unknown
    >;

    expect(compatibility.assertAionUiGeneralWorkProjection).toBeTypeOf("function");
    expect(() =>
      (compatibility.assertAionUiGeneralWorkProjection as (value: unknown) => void)({
        contractVersion: 1,
        taskId: "task-journey-projection-1",
        status: "completed",
        title: "Summarize the approved workspace file.",
        summary: "The deterministic General Worker completed the submitted Actestra task.",
        canCancel: false,
        createdAt: "2026-07-30T06:30:00.000Z",
        updatedAt: "2026-07-30T06:31:00.000Z",
        artifacts: [
          {
            artifactId: "artifact-journey-projection-1",
            kind: "file",
            label: "Workspace summary",
            state: "available",
          },
        ],
      }),
    ).not.toThrow();
  });

  it("rejects authority leakage and misleading lifecycle metadata", async () => {
    const compatibility = (await import("../../apps/desktop/src/compatibility/aionui")) as Record<
      string,
      unknown
    >;
    const assertProjection = compatibility.assertAionUiGeneralWorkProjection as (
      value: unknown,
    ) => void;
    const valid = {
      contractVersion: 1,
      taskId: "task-journey-projection-1",
      status: "completed",
      title: "Summarize the approved workspace file.",
      summary: "The deterministic General Worker completed the submitted Actestra task.",
      canCancel: false,
      createdAt: "2026-07-30T06:30:00.000Z",
      updatedAt: "2026-07-30T06:31:00.000Z",
      artifacts: [
        {
          artifactId: "artifact-journey-projection-1",
          kind: "file",
          label: "Workspace summary",
          state: "available",
        },
      ],
    };

    for (const invalid of [
      { ...valid, workspaceRoot: "/private/approved-workspace" },
      { ...valid, canCancel: true },
      { ...valid, status: "ready", canCancel: true },
      {
        ...valid,
        updatedAt: "2026-07-30T06:29:59.999Z",
      },
      {
        ...valid,
        artifacts: [
          {
            ...valid.artifacts[0],
            artifactId: "a".repeat(129),
          },
        ],
      },
      {
        ...valid,
        artifacts: [
          {
            ...valid.artifacts[0],
            contentRef: "content-ref-private-1",
          },
        ],
      },
    ]) {
      expect(() => assertProjection(invalid)).toThrowError(
        expect.objectContaining({ code: "invalid-projection" }),
      );
    }
  });
});

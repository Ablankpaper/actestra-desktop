// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  GENERAL_DRAFT_MARKDOWN_MAXIMUM_BYTES,
  GENERAL_DRAFT_MISSING_INPUT_MAXIMUM_COUNT,
  GENERAL_DRAFT_REPAIR_ATTEMPT_LIMIT,
  GENERAL_DRAFT_SYSTEM_PROMPT,
  buildGeneralDraftRepairInstruction,
  findGeneralDraftPlaceholder,
  validateGeneralDraft,
} from "../../apps/desktop/src/core";

function rejection(rawOutput: string) {
  const result = validateGeneralDraft(rawOutput);
  if (result.valid) throw new Error(`Expected a rejection, got a valid draft: ${rawOutput}`);
  return result;
}

describe("General draft contract", () => {
  it("admits a completed draft and keeps its markdown", () => {
    const result = validateGeneralDraft(
      JSON.stringify({ status: "completed", markdown: "# Title\n\nReal prose." }),
    );

    expect(result).toMatchObject({
      valid: true,
      draft: { status: "completed", markdown: "# Title\n\nReal prose." },
    });
  });

  it("admits a needs-input reply and normalizes what it asks for", () => {
    const result = validateGeneralDraft(
      JSON.stringify({
        status: "needs-input",
        missing_inputs: ["  README.md line 1  "],
        message: "  Please paste the README text.  ",
      }),
    );

    expect(result).toMatchObject({
      valid: true,
      draft: {
        status: "needs-input",
        missingInputs: ["README.md line 1"],
        message: "Please paste the README text.",
      },
    });
  });

  it("reports general-output-invalid for a reply that is not JSON at all", () => {
    // The pre-contract behaviour: raw Markdown straight to draft.md.
    expect(rejection("# Just Markdown")).toMatchObject({
      errorCode: "general-output-invalid",
      violatedRule: "not-json",
    });
  });

  it("reports general-output-invalid for an unknown status", () => {
    expect(rejection(JSON.stringify({ status: "done", markdown: "x" }))).toMatchObject({
      errorCode: "general-output-invalid",
      violatedRule: "unknown-status",
    });
  });

  it("refuses a needs-input reply that also smuggles a completed draft", () => {
    const result = rejection(
      JSON.stringify({
        status: "needs-input",
        missing_inputs: ["README.md"],
        message: "Need the README.",
        markdown: "# Draft written without the README",
      }),
    );

    expect(result).toMatchObject({
      errorCode: "general-output-invalid",
      violatedRule: "unexpected-key",
    });
    expect(result.message).toContain("markdown");
  });

  it("treats an empty completed draft as noncompliant rather than merely malformed", () => {
    expect(rejection(JSON.stringify({ status: "completed", markdown: "   \n  " }))).toMatchObject({
      errorCode: "general-instruction-noncompliant",
      violatedRule: "empty-markdown",
    });
  });

  it("rejects a completed draft that leaves a placeholder to fill in later", () => {
    for (const markdown of [
      "## Summary\n\n<to be filled>",
      "## Summary\n\n[TODO]",
      "## Summary\n\n{{ section }}",
      "## Summary\n\nName: ____",
      "## Summary\n\nSee XXX for details.",
    ]) {
      expect(rejection(JSON.stringify({ status: "completed", markdown }))).toMatchObject({
        errorCode: "general-instruction-noncompliant",
        violatedRule: "placeholder-in-markdown",
      });
    }
  });

  it("does not condemn prose that merely discusses placeholders", () => {
    // Matching is structural, so a draft *about* TODO lists is still a valid draft.
    const markdown = "# Process\n\nTrack every TODO item in the tracker before release.";

    expect(validateGeneralDraft(JSON.stringify({ status: "completed", markdown }))).toMatchObject({
      valid: true,
    });
    expect(findGeneralDraftPlaceholder(markdown)).toBeNull();
  });

  it("bounds the completed draft size", () => {
    const markdown = "a".repeat(GENERAL_DRAFT_MARKDOWN_MAXIMUM_BYTES + 1);

    expect(rejection(JSON.stringify({ status: "completed", markdown }))).toMatchObject({
      errorCode: "general-output-invalid",
      violatedRule: "markdown-too-large",
    });
  });

  it("requires a needs-input reply to name something and explain itself", () => {
    expect(
      rejection(JSON.stringify({ status: "needs-input", missing_inputs: [], message: "Need it." })),
    ).toMatchObject({ violatedRule: "missing-inputs-not-listed" });

    expect(
      rejection(
        JSON.stringify({
          status: "needs-input",
          missing_inputs: Array.from(
            { length: GENERAL_DRAFT_MISSING_INPUT_MAXIMUM_COUNT + 1 },
            (_, index) => `input-${String(index)}`,
          ),
          message: "Need them.",
        }),
      ),
    ).toMatchObject({ violatedRule: "too-many-missing-inputs" });

    expect(
      rejection(
        JSON.stringify({ status: "needs-input", missing_inputs: ["README.md"], message: "  " }),
      ),
    ).toMatchObject({ violatedRule: "invalid-message" });
  });

  it("keeps the malformed output out of the repair instruction", () => {
    const offending = "# Draft with <to be filled> inside";
    const result = rejection(JSON.stringify({ status: "completed", markdown: offending }));
    const instruction = buildGeneralDraftRepairInstruction(result.violatedRule);

    // Spec C: the retry names the broken rule and never echoes what the model wrote.
    expect(instruction).toContain("placeholder-in-markdown");
    expect(instruction).not.toContain(offending);
    expect(instruction).not.toContain("<to be filled>");
    expect(GENERAL_DRAFT_REPAIR_ATTEMPT_LIMIT).toBe(1);
  });

  it("states both admitted shapes in the system prompt, so the first reply can comply", () => {
    expect(GENERAL_DRAFT_SYSTEM_PROMPT).toContain('"status":"completed"');
    expect(GENERAL_DRAFT_SYSTEM_PROMPT).toContain('"status":"needs-input"');
    expect(GENERAL_DRAFT_SYSTEM_PROMPT).toContain("no file, repository, or network access");
  });
});

import { describe, expect, it } from "vitest";
import {
  GENERAL_OUTPUT_ENVELOPE_MAXIMUM_BYTES,
  GENERAL_OUTPUT_STRUCTURED_DATA_MAXIMUM_PROPERTIES,
  GENERAL_OUTPUT_TEXT_MAXIMUM_BYTES,
  validateGeneralOutputEnvelope,
  type GeneralOutputEnvelope,
} from "../../apps/desktop/src/core/generalOutputEnvelope";
import { GENERAL_V1_CONTRACT_VERSION } from "../../apps/desktop/src/core/generalCapabilityAdmission";

describe("generalOutputEnvelope", () => {
  describe("validateGeneralOutputEnvelope", () => {
    it("accepts valid text output envelope", () => {
      const envelope: GeneralOutputEnvelope = {
        contractVersion: GENERAL_V1_CONTRACT_VERSION,
        capability: "text-generation",
        format: "text",
        content: "This is a valid text response.",
      };
      const result = validateGeneralOutputEnvelope(JSON.stringify(envelope));
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.envelope).toMatchObject({
          contractVersion: 1,
          capability: "text-generation",
          format: "text",
          content: "This is a valid text response.",
        });
      }
    });

    it("accepts valid structured output envelope", () => {
      const envelope: GeneralOutputEnvelope = {
        contractVersion: GENERAL_V1_CONTRACT_VERSION,
        capability: "text-analysis",
        format: "structured",
        content: {
          sentiment: "positive",
          confidence: 0.95,
          keywords: ["valid", "structured", "response"],
        },
      };
      const result = validateGeneralOutputEnvelope(JSON.stringify(envelope));
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.envelope.format).toBe("structured");
        expect(result.envelope.content).toMatchObject({
          sentiment: "positive",
          confidence: 0.95,
        });
      }
    });

    it("accepts envelope with optional metadata", () => {
      const envelope: GeneralOutputEnvelope = {
        contractVersion: GENERAL_V1_CONTRACT_VERSION,
        capability: "text-transformation",
        format: "text",
        content: "Transformed text",
        metadata: {
          model: "claude-opus-5",
          tokensConsumed: 1234,
          completionReason: "end_turn",
        },
      };
      const result = validateGeneralOutputEnvelope(JSON.stringify(envelope));
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.envelope.metadata).toMatchObject({
          model: "claude-opus-5",
          tokensConsumed: 1234,
          completionReason: "end_turn",
        });
      }
    });

    it("accepts envelope with partial metadata", () => {
      const envelope: GeneralOutputEnvelope = {
        contractVersion: GENERAL_V1_CONTRACT_VERSION,
        capability: "text-analysis",
        format: "text",
        content: "Analysis result",
        metadata: {
          model: "claude-sonnet-5",
        },
      };
      const result = validateGeneralOutputEnvelope(JSON.stringify(envelope));
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.envelope.metadata?.model).toBe("claude-sonnet-5");
        expect(result.envelope.metadata?.tokensConsumed).toBeUndefined();
      }
    });

    it("rejects output exceeding maximum size", () => {
      const largeContent = "x".repeat(GENERAL_OUTPUT_ENVELOPE_MAXIMUM_BYTES + 1);
      const envelope = {
        contractVersion: GENERAL_V1_CONTRACT_VERSION,
        capability: "text-generation",
        format: "text",
        content: largeContent,
      };
      const result = validateGeneralOutputEnvelope(JSON.stringify(envelope));
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errorCode).toBe("output-too-large");
        expect(result.repairHint).toContain("Reduce content size");
      }
    });

    it("rejects invalid JSON", () => {
      const result = validateGeneralOutputEnvelope('{"invalid": json}');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errorCode).toBe("invalid-json");
        expect(result.repairHint).toContain("valid JSON");
      }
    });

    it("rejects JSON array instead of object", () => {
      const result = validateGeneralOutputEnvelope('["not", "an", "object"]');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errorCode).toBe("invalid-json");
        expect(result.message).toContain("must be a JSON object");
      }
    });

    it("rejects missing contractVersion field", () => {
      const envelope = {
        capability: "text-generation",
        format: "text",
        content: "Missing contract version",
      };
      const result = validateGeneralOutputEnvelope(JSON.stringify(envelope));
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errorCode).toBe("missing-required-field");
        expect(result.message).toContain("contractVersion");
      }
    });

    it("rejects missing capability field", () => {
      const envelope = {
        contractVersion: GENERAL_V1_CONTRACT_VERSION,
        format: "text",
        content: "Missing capability",
      };
      const result = validateGeneralOutputEnvelope(JSON.stringify(envelope));
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errorCode).toBe("missing-required-field");
        expect(result.message).toContain("capability");
      }
    });

    it("rejects missing format field", () => {
      const envelope = {
        contractVersion: GENERAL_V1_CONTRACT_VERSION,
        capability: "text-generation",
        content: "Missing format",
      };
      const result = validateGeneralOutputEnvelope(JSON.stringify(envelope));
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errorCode).toBe("missing-required-field");
        expect(result.message).toContain("format");
      }
    });

    it("rejects missing content field", () => {
      const envelope = {
        contractVersion: GENERAL_V1_CONTRACT_VERSION,
        capability: "text-generation",
        format: "text",
      };
      const result = validateGeneralOutputEnvelope(JSON.stringify(envelope));
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errorCode).toBe("missing-required-field");
        expect(result.message).toContain("content");
      }
    });

    it("rejects unexpected top-level field", () => {
      const envelope = {
        contractVersion: GENERAL_V1_CONTRACT_VERSION,
        capability: "text-generation",
        format: "text",
        content: "Valid content",
        unexpectedField: "should not be here",
      };
      const result = validateGeneralOutputEnvelope(JSON.stringify(envelope));
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errorCode).toBe("unexpected-field");
        expect(result.message).toContain("unexpectedField");
      }
    });

    it("rejects wrong contract version", () => {
      const envelope = {
        contractVersion: 99,
        capability: "text-generation",
        format: "text",
        content: "Wrong version",
      };
      const result = validateGeneralOutputEnvelope(JSON.stringify(envelope));
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errorCode).toBe("invalid-contract-version");
        expect(result.message).toContain("must be 1");
      }
    });

    it("rejects invalid capability", () => {
      const envelope = {
        contractVersion: GENERAL_V1_CONTRACT_VERSION,
        capability: "workspace-write",
        format: "text",
        content: "Invalid capability",
      };
      const result = validateGeneralOutputEnvelope(JSON.stringify(envelope));
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errorCode).toBe("invalid-capability");
        expect(result.message).toContain("text-analysis, text-generation, text-transformation");
      }
    });

    it("rejects invalid format value", () => {
      const envelope = {
        contractVersion: GENERAL_V1_CONTRACT_VERSION,
        capability: "text-generation",
        format: "binary",
        content: "Invalid format",
      };
      const result = validateGeneralOutputEnvelope(JSON.stringify(envelope));
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errorCode).toBe("invalid-format");
        expect(result.message).toContain('"text" or "structured"');
      }
    });

    it("rejects text format with non-string content", () => {
      const envelope = {
        contractVersion: GENERAL_V1_CONTRACT_VERSION,
        capability: "text-generation",
        format: "text",
        content: { should: "be string" },
      };
      const result = validateGeneralOutputEnvelope(JSON.stringify(envelope));
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errorCode).toBe("content-type-mismatch");
        expect(result.message).toContain("content is not a string");
      }
    });

    it("rejects structured format with non-object content", () => {
      const envelope = {
        contractVersion: GENERAL_V1_CONTRACT_VERSION,
        capability: "text-analysis",
        format: "structured",
        content: "should be object",
      };
      const result = validateGeneralOutputEnvelope(JSON.stringify(envelope));
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errorCode).toBe("content-type-mismatch");
        expect(result.message).toContain("content is not an object");
      }
    });

    it("rejects text content exceeding maximum size", () => {
      const largeText = "x".repeat(GENERAL_OUTPUT_TEXT_MAXIMUM_BYTES + 1);
      const envelope = {
        contractVersion: GENERAL_V1_CONTRACT_VERSION,
        capability: "text-generation",
        format: "text",
        content: largeText,
      };
      const result = validateGeneralOutputEnvelope(JSON.stringify(envelope));
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errorCode).toBe("text-content-too-large");
        expect(result.repairHint).toContain("Reduce text content");
      }
    });

    it("rejects structured content exceeding complexity limit", () => {
      const complexObject: Record<string, unknown> = {};
      for (let i = 0; i < GENERAL_OUTPUT_STRUCTURED_DATA_MAXIMUM_PROPERTIES + 100; i++) {
        complexObject[`key${i}`] = `value${i}`;
      }
      const envelope = {
        contractVersion: GENERAL_V1_CONTRACT_VERSION,
        capability: "text-analysis",
        format: "structured",
        content: complexObject,
      };
      const result = validateGeneralOutputEnvelope(JSON.stringify(envelope));
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errorCode).toBe("structured-content-too-complex");
        expect(result.repairHint).toContain("Simplify structured content");
      }
    });

    it("rejects non-object metadata", () => {
      const envelope = {
        contractVersion: GENERAL_V1_CONTRACT_VERSION,
        capability: "text-generation",
        format: "text",
        content: "Valid content",
        metadata: "should be object",
      };
      const result = validateGeneralOutputEnvelope(JSON.stringify(envelope));
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errorCode).toBe("unexpected-field");
        expect(result.message).toContain("metadata must be an object");
      }
    });

    it("rejects unexpected metadata field", () => {
      const envelope = {
        contractVersion: GENERAL_V1_CONTRACT_VERSION,
        capability: "text-generation",
        format: "text",
        content: "Valid content",
        metadata: {
          model: "claude-opus-5",
          unexpectedMetaField: "invalid",
        },
      };
      const result = validateGeneralOutputEnvelope(JSON.stringify(envelope));
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errorCode).toBe("unexpected-field");
        expect(result.message).toContain("unexpectedMetaField");
      }
    });

    it("rejects non-string metadata.model", () => {
      const envelope = {
        contractVersion: GENERAL_V1_CONTRACT_VERSION,
        capability: "text-generation",
        format: "text",
        content: "Valid content",
        metadata: {
          model: 123,
        },
      };
      const result = validateGeneralOutputEnvelope(JSON.stringify(envelope));
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errorCode).toBe("unexpected-field");
        expect(result.message).toContain("metadata.model must be a string");
      }
    });

    it("rejects non-integer metadata.tokensConsumed", () => {
      const envelope = {
        contractVersion: GENERAL_V1_CONTRACT_VERSION,
        capability: "text-generation",
        format: "text",
        content: "Valid content",
        metadata: {
          tokensConsumed: 123.45,
        },
      };
      const result = validateGeneralOutputEnvelope(JSON.stringify(envelope));
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errorCode).toBe("unexpected-field");
        expect(result.message).toContain("metadata.tokensConsumed must be a non-negative integer");
      }
    });

    it("rejects negative metadata.tokensConsumed", () => {
      const envelope = {
        contractVersion: GENERAL_V1_CONTRACT_VERSION,
        capability: "text-generation",
        format: "text",
        content: "Valid content",
        metadata: {
          tokensConsumed: -100,
        },
      };
      const result = validateGeneralOutputEnvelope(JSON.stringify(envelope));
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errorCode).toBe("unexpected-field");
        expect(result.message).toContain("non-negative integer");
      }
    });

    it("rejects non-string metadata.completionReason", () => {
      const envelope = {
        contractVersion: GENERAL_V1_CONTRACT_VERSION,
        capability: "text-generation",
        format: "text",
        content: "Valid content",
        metadata: {
          completionReason: 123,
        },
      };
      const result = validateGeneralOutputEnvelope(JSON.stringify(envelope));
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errorCode).toBe("unexpected-field");
        expect(result.message).toContain("metadata.completionReason must be a string");
      }
    });
  });
});

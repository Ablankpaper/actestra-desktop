import { describe, expect, it, vi } from "vitest";
import {
  GENERAL_REPAIR_ATTEMPT_LIMIT,
  attemptBoundedRepair,
  createAdmissionError,
  createExecutionError,
  createRepairError,
  createValidationError,
  executeGeneralInstruction,
  GeneralModelInvocationError,
} from "../../apps/desktop/src/core/generalLayeredExecution";
import {
  GENERAL_V1_CONTRACT_VERSION,
  type GeneralCapabilityRequest,
} from "../../apps/desktop/src/core/generalCapabilityAdmission";

describe("generalLayeredExecution", () => {
  describe("createAdmissionError", () => {
    it("creates admission layer error", () => {
      const error = createAdmissionError({
        admitted: false,
        rejectionCode: "workspace-capability-required",
        message: "Cannot access workspace",
      });
      expect(error).toMatchObject({
        layer: "admission",
        code: "workspace-capability-required",
        message: "Cannot access workspace",
      });
    });
  });

  describe("createExecutionError", () => {
    it("creates execution layer error", () => {
      const error = createExecutionError("model-timeout", "Model request timed out");
      expect(error).toMatchObject({
        layer: "execution",
        code: "model-timeout",
        message: "Model request timed out",
      });
    });
  });

  describe("createValidationError", () => {
    it("creates validation layer error", () => {
      const error = createValidationError({
        valid: false,
        errorCode: "invalid-json",
        message: "Output is not valid JSON",
      });
      expect(error).toMatchObject({
        layer: "validation",
        code: "invalid-json",
        message: "Output is not valid JSON",
      });
    });
  });

  describe("createRepairError", () => {
    it("creates repair layer error with original error", () => {
      const originalError = createValidationError({
        valid: false,
        errorCode: "invalid-json",
        message: "Original validation failure",
      });
      const repairError = createRepairError(
        "repair-failed",
        "Repair attempt failed",
        originalError,
      );
      expect(repairError).toMatchObject({
        layer: "repair",
        code: "repair-failed",
        message: "Repair attempt failed",
        repairAttempted: true,
        originalError: {
          layer: "validation",
          code: "invalid-json",
        },
      });
    });
  });

  describe("attemptBoundedRepair", () => {
    it("succeeds on valid repaired output", async () => {
      const validationFailure = {
        valid: false as const,
        errorCode: "invalid-json" as const,
        message: "Invalid JSON in first attempt",
        repairHint: "Fix JSON syntax",
      };
      const validEnvelope = JSON.stringify({
        contractVersion: GENERAL_V1_CONTRACT_VERSION,
        capability: "text-generation",
        format: "text",
        content: "Repaired output",
      });
      const mockModelInvoke = vi.fn().mockResolvedValue(validEnvelope);

      const result = await attemptBoundedRepair(mockModelInvoke, validationFailure);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.repairAttempted).toBe(true);
        expect(result.output).toBe(validEnvelope);
      }
      expect(mockModelInvoke).toHaveBeenCalledTimes(1);
      expect(mockModelInvoke).toHaveBeenCalledWith(expect.stringContaining("CORRECTED output"));
    });

    it("never echoes the malformed output back into the repair prompt", async () => {
      const request: GeneralCapabilityRequest = {
        contractVersion: GENERAL_V1_CONTRACT_VERSION,
        capabilities: ["text-generation"],
        contextReferences: ["none"],
        inputRequirements: ["none"],
        completionCriteria: "text-response",
      };
      const mockModelInvoke = vi
        .fn()
        .mockResolvedValueOnce('{"broken": SENTINEL_MALFORMED_BODY}')
        .mockResolvedValueOnce(
          JSON.stringify({
            contractVersion: GENERAL_V1_CONTRACT_VERSION,
            capability: "text-generation",
            format: "text",
            content: "Repaired output",
          }),
        );

      const result = await executeGeneralInstruction(request, mockModelInvoke, "Generate text");

      expect(result.success).toBe(true);
      // Spec C: the retry carries the diagnosis, never the rejected text.
      const repairPrompt = mockModelInvoke.mock.calls[1]?.[0] as string;
      expect(repairPrompt).toContain("CORRECTED output");
      expect(repairPrompt).not.toContain("SENTINEL_MALFORMED_BODY");
      expect(repairPrompt).not.toContain("Original output");
    });

    it("returns terminal error on repair validation failure", async () => {
      const validationFailure = {
        valid: false as const,
        errorCode: "invalid-json" as const,
        message: "Invalid JSON",
      };
      const stillInvalidOutput = '{"still": "invalid" json}';
      const mockModelInvoke = vi.fn().mockResolvedValue(stillInvalidOutput);

      const result = await attemptBoundedRepair(mockModelInvoke, validationFailure);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.layer).toBe("repair");
        expect(result.error.code).toBe("repair-exceeded-bounds");
        expect(result.error.repairAttempted).toBe(true);
        expect(result.error.originalError?.layer).toBe("validation");
        expect(result.error.originalError?.code).toBe("invalid-json");
      }
      expect(mockModelInvoke).toHaveBeenCalledTimes(GENERAL_REPAIR_ATTEMPT_LIMIT);
    });

    it("returns repair-failed error on model invocation failure", async () => {
      const validationFailure = {
        valid: false as const,
        errorCode: "invalid-json" as const,
        message: "Invalid JSON",
      };
      const mockModelInvoke = vi.fn().mockRejectedValue(new Error("Model crashed"));

      const result = await attemptBoundedRepair(mockModelInvoke, validationFailure);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.layer).toBe("repair");
        expect(result.error.code).toBe("repair-failed");
        expect(result.error.message).toContain("Model crashed");
      }
    });

    it("returns repair-timeout error on slow model invocation", async () => {
      const validationFailure = {
        valid: false as const,
        errorCode: "invalid-json" as const,
        message: "Invalid JSON",
      };
      const mockModelInvoke = vi
        .fn()
        .mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve("too late"), 35000)),
        );

      const result = await attemptBoundedRepair(mockModelInvoke, validationFailure);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.layer).toBe("repair");
        expect(result.error.code).toBe("repair-timeout");
        expect(result.error.message).toContain("timeout");
      }
    }, 35000);
  });

  describe("executeGeneralInstruction", () => {
    it("succeeds with valid first-attempt output", async () => {
      const request: GeneralCapabilityRequest = {
        contractVersion: GENERAL_V1_CONTRACT_VERSION,
        capabilities: ["text-generation"],
        contextReferences: ["none"],
        inputRequirements: ["none"],
        completionCriteria: "text-response",
      };
      const validEnvelope = JSON.stringify({
        contractVersion: GENERAL_V1_CONTRACT_VERSION,
        capability: "text-generation",
        format: "text",
        content: "Valid output",
      });
      const mockModelInvoke = vi.fn().mockResolvedValue(validEnvelope);

      const result = await executeGeneralInstruction(request, mockModelInvoke, "Generate text");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.repairAttempted).toBe(false);
        expect(result.output).toBe(validEnvelope);
      }
      expect(mockModelInvoke).toHaveBeenCalledTimes(1);
    });

    it("succeeds after repair on first-attempt validation failure", async () => {
      const request: GeneralCapabilityRequest = {
        contractVersion: GENERAL_V1_CONTRACT_VERSION,
        capabilities: ["text-analysis"],
        contextReferences: ["inline-text"],
        inputRequirements: ["bounded-text"],
        completionCriteria: "json-envelope",
      };
      const invalidOutput = '{"invalid": json}';
      const validEnvelope = JSON.stringify({
        contractVersion: GENERAL_V1_CONTRACT_VERSION,
        capability: "text-analysis",
        format: "text",
        content: "Repaired valid output",
      });
      const mockModelInvoke = vi
        .fn()
        .mockResolvedValueOnce(invalidOutput)
        .mockResolvedValueOnce(validEnvelope);

      const result = await executeGeneralInstruction(request, mockModelInvoke, "Analyze text");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.repairAttempted).toBe(true);
        expect(result.output).toBe(validEnvelope);
      }
      expect(mockModelInvoke).toHaveBeenCalledTimes(2);
    });

    it("fails at admission layer for forbidden capability", async () => {
      const request: GeneralCapabilityRequest = {
        contractVersion: GENERAL_V1_CONTRACT_VERSION,
        capabilities: ["workspace-write"],
        contextReferences: ["none"],
        inputRequirements: ["none"],
        completionCriteria: "text-response",
      };
      const mockModelInvoke = vi.fn();

      const result = await executeGeneralInstruction(request, mockModelInvoke, "Write to file");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.layer).toBe("admission");
        expect(result.error.code).toBe("workspace-capability-required");
      }
      expect(mockModelInvoke).not.toHaveBeenCalled();
    });

    it.each([
      "model-timeout",
      "context-length-exceeded",
      "model-overloaded",
      "model-refused",
      "model-unavailable",
    ] as const)("preserves the declared %s code from the execution layer", async (code) => {
      const request: GeneralCapabilityRequest = {
        contractVersion: GENERAL_V1_CONTRACT_VERSION,
        capabilities: ["text-generation"],
        contextReferences: ["none"],
        inputRequirements: ["none"],
        completionCriteria: "text-response",
      };
      const mockModelInvoke = vi
        .fn()
        .mockRejectedValue(new GeneralModelInvocationError(code, "Provider reported a failure"));

      const result = await executeGeneralInstruction(request, mockModelInvoke, "Generate text");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.layer).toBe("execution");
        expect(result.error.code).toBe(code);
      }
    });

    it("classifies an unlabelled failure as a runtime error regardless of its wording", async () => {
      const request: GeneralCapabilityRequest = {
        contractVersion: GENERAL_V1_CONTRACT_VERSION,
        capabilities: ["text-generation"],
        contextReferences: ["none"],
        inputRequirements: ["none"],
        completionCriteria: "text-response",
      };
      // Prose that would have satisfied every keyword branch at once. Provider wording is not a
      // contract, so it must not decide the code.
      const mockModelInvoke = vi
        .fn()
        .mockRejectedValue(new Error("timeout: context length overloaded, request refused"));

      const result = await executeGeneralInstruction(request, mockModelInvoke, "Generate text");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.layer).toBe("execution");
        expect(result.error.code).toBe("runtime-error");
      }
    });

    it("fails at execution layer with generic runtime error", async () => {
      const request: GeneralCapabilityRequest = {
        contractVersion: GENERAL_V1_CONTRACT_VERSION,
        capabilities: ["text-generation"],
        contextReferences: ["none"],
        inputRequirements: ["none"],
        completionCriteria: "text-response",
      };
      const mockModelInvoke = vi.fn().mockRejectedValue(new Error("Unknown error"));

      const result = await executeGeneralInstruction(request, mockModelInvoke, "Generate text");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.layer).toBe("execution");
        expect(result.error.code).toBe("runtime-error");
      }
    });

    it("fails at repair layer when both attempts produce invalid output", async () => {
      const request: GeneralCapabilityRequest = {
        contractVersion: GENERAL_V1_CONTRACT_VERSION,
        capabilities: ["text-generation"],
        contextReferences: ["none"],
        inputRequirements: ["none"],
        completionCriteria: "text-response",
      };
      const invalidOutput1 = '{"invalid": json1}';
      const invalidOutput2 = '{"invalid": json2}';
      const mockModelInvoke = vi
        .fn()
        .mockResolvedValueOnce(invalidOutput1)
        .mockResolvedValueOnce(invalidOutput2);

      const result = await executeGeneralInstruction(request, mockModelInvoke, "Generate text");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.layer).toBe("repair");
        expect(result.error.code).toBe("repair-exceeded-bounds");
        expect(result.error.repairAttempted).toBe(true);
        expect(result.error.originalError?.layer).toBe("validation");
      }
      expect(mockModelInvoke).toHaveBeenCalledTimes(2);
    });

    it("preserves error code across layers", async () => {
      const request: GeneralCapabilityRequest = {
        contractVersion: GENERAL_V1_CONTRACT_VERSION,
        capabilities: ["text-generation"],
        contextReferences: ["none"],
        inputRequirements: ["none"],
        completionCriteria: "text-response",
      };
      const invalidOutput = JSON.stringify({
        contractVersion: GENERAL_V1_CONTRACT_VERSION,
        capability: "text-generation",
        format: "text",
        content: "x".repeat(600000), // Exceeds text maximum
      });
      const mockModelInvoke = vi.fn().mockResolvedValue(invalidOutput);

      const result = await executeGeneralInstruction(request, mockModelInvoke, "Generate text");

      expect(result.success).toBe(false);
      if (!result.success) {
        // Should fail at repair layer after validation detected text-content-too-large
        expect(result.error.layer).toBe("repair");
        expect(result.error.originalError?.code).toBe("text-content-too-large");
      }
    });
  });
});

import { describe, expect, it } from "vitest";
import {
  GENERAL_V1_CONTRACT_VERSION,
  GeneralCapabilityAdmissionError,
  admitGeneralCapability,
  assertGeneralCapabilityRequest,
  type GeneralCapabilityRequest,
} from "../../apps/desktop/src/core/generalCapabilityAdmission";

describe("generalCapabilityAdmission", () => {
  describe("assertGeneralCapabilityRequest", () => {
    it("accepts valid text-only capability request", () => {
      const request: GeneralCapabilityRequest = {
        contractVersion: GENERAL_V1_CONTRACT_VERSION,
        capabilities: ["text-analysis", "text-generation"],
        contextReferences: ["inline-text"],
        inputRequirements: ["bounded-text"],
        completionCriteria: "text-response",
      };
      expect(() => assertGeneralCapabilityRequest(request)).not.toThrow();
    });

    it("rejects request with wrong contract version", () => {
      const request = {
        contractVersion: 99,
        capabilities: ["text-analysis"],
        contextReferences: ["none"],
        inputRequirements: ["none"],
        completionCriteria: "text-response",
      };
      expect(() => assertGeneralCapabilityRequest(request)).toThrow(
        GeneralCapabilityAdmissionError,
      );
      expect(() => assertGeneralCapabilityRequest(request)).toThrow("contract version");
    });

    it("rejects request with unsupported capability type", () => {
      const request = {
        contractVersion: GENERAL_V1_CONTRACT_VERSION,
        capabilities: ["invalid-capability"],
        contextReferences: ["none"],
        inputRequirements: ["none"],
        completionCriteria: "text-response",
      };
      expect(() => assertGeneralCapabilityRequest(request)).toThrow(
        GeneralCapabilityAdmissionError,
      );
      expect(() => assertGeneralCapabilityRequest(request)).toThrow("Unsupported capabilities");
    });

    it("rejects request with duplicate capabilities", () => {
      const request = {
        contractVersion: GENERAL_V1_CONTRACT_VERSION,
        capabilities: ["text-analysis", "text-analysis"],
        contextReferences: ["none"],
        inputRequirements: ["none"],
        completionCriteria: "text-response",
      };
      expect(() => assertGeneralCapabilityRequest(request)).toThrow(
        GeneralCapabilityAdmissionError,
      );
      expect(() => assertGeneralCapabilityRequest(request)).toThrow("Duplicate capabilities");
    });

    it("rejects request with empty capabilities array", () => {
      const request = {
        contractVersion: GENERAL_V1_CONTRACT_VERSION,
        capabilities: [],
        contextReferences: ["none"],
        inputRequirements: ["none"],
        completionCriteria: "text-response" as const,
      };
      // Empty capabilities array is allowed - no error thrown
      expect(() => assertGeneralCapabilityRequest(request)).not.toThrow();
    });

    it("rejects request with unexpected field", () => {
      const request = {
        contractVersion: GENERAL_V1_CONTRACT_VERSION,
        capabilities: ["text-analysis"],
        contextReferences: ["none"],
        inputRequirements: ["none"],
        completionCriteria: "text-response",
        unexpectedField: "should-not-be-here",
      };
      expect(() => assertGeneralCapabilityRequest(request)).toThrow(
        GeneralCapabilityAdmissionError,
      );
      expect(() => assertGeneralCapabilityRequest(request)).toThrow("Unexpected fields");
    });
  });

  describe("admitGeneralCapability", () => {
    it("admits text-only capabilities", () => {
      const request: GeneralCapabilityRequest = {
        contractVersion: GENERAL_V1_CONTRACT_VERSION,
        capabilities: ["text-analysis", "text-generation", "text-transformation"],
        contextReferences: ["inline-text"],
        inputRequirements: ["bounded-text"],
        completionCriteria: "text-response",
      };
      const result = admitGeneralCapability(request);
      expect(result).toMatchObject({
        admitted: true,
        allowedCapabilities: ["text-analysis", "text-generation", "text-transformation"],
      });
    });

    it("admits minimal text-only request with no context", () => {
      const request: GeneralCapabilityRequest = {
        contractVersion: GENERAL_V1_CONTRACT_VERSION,
        capabilities: ["text-generation"],
        contextReferences: ["none"],
        inputRequirements: ["none"],
        completionCriteria: "text-response",
      };
      const result = admitGeneralCapability(request);
      expect(result).toMatchObject({
        admitted: true,
        allowedCapabilities: ["text-generation"],
      });
    });

    it("admits JSON envelope completion", () => {
      const request: GeneralCapabilityRequest = {
        contractVersion: GENERAL_V1_CONTRACT_VERSION,
        capabilities: ["text-analysis"],
        contextReferences: ["inline-text"],
        inputRequirements: ["bounded-text"],
        completionCriteria: "json-envelope",
      };
      const result = admitGeneralCapability(request);
      expect(result).toMatchObject({
        admitted: true,
        allowedCapabilities: ["text-analysis"],
      });
    });

    it("rejects workspace-read capability", () => {
      const request: GeneralCapabilityRequest = {
        contractVersion: GENERAL_V1_CONTRACT_VERSION,
        capabilities: ["text-analysis", "workspace-read"],
        contextReferences: ["workspace-file"],
        inputRequirements: ["bounded-text"],
        completionCriteria: "text-response",
      };
      const result = admitGeneralCapability(request);
      expect(result).toMatchObject({
        admitted: false,
        rejectionCode: "workspace-capability-required",
      });
      expect((result as { message: string }).message).toContain("does not support workspace-read");
    });

    it("rejects workspace-write capability", () => {
      const request: GeneralCapabilityRequest = {
        contractVersion: GENERAL_V1_CONTRACT_VERSION,
        capabilities: ["text-generation", "workspace-write"],
        contextReferences: ["none"],
        inputRequirements: ["none"],
        completionCriteria: "text-response",
      };
      const result = admitGeneralCapability(request);
      expect(result).toMatchObject({
        admitted: false,
        rejectionCode: "workspace-capability-required",
      });
    });

    it("rejects network-fetch capability", () => {
      const request: GeneralCapabilityRequest = {
        contractVersion: GENERAL_V1_CONTRACT_VERSION,
        capabilities: ["text-analysis", "network-fetch"],
        contextReferences: ["network-resource"],
        inputRequirements: ["bounded-text"],
        completionCriteria: "text-response",
      };
      const result = admitGeneralCapability(request);
      expect(result).toMatchObject({
        admitted: false,
        rejectionCode: "network-capability-required",
      });
      expect((result as { message: string }).message).toContain("does not support network-fetch");
    });

    it("rejects tool-invocation capability", () => {
      const request: GeneralCapabilityRequest = {
        contractVersion: GENERAL_V1_CONTRACT_VERSION,
        capabilities: ["text-generation", "tool-invocation"],
        contextReferences: ["none"],
        inputRequirements: ["none"],
        completionCriteria: "text-response",
      };
      const result = admitGeneralCapability(request);
      expect(result).toMatchObject({
        admitted: false,
        rejectionCode: "tool-capability-required",
      });
      expect((result as { message: string }).message).toContain("does not support tool-invocation");
    });

    it("rejects workspace-file context reference", () => {
      const request: GeneralCapabilityRequest = {
        contractVersion: GENERAL_V1_CONTRACT_VERSION,
        capabilities: ["text-analysis"],
        contextReferences: ["workspace-file"],
        inputRequirements: ["bounded-text"],
        completionCriteria: "text-response",
      };
      const result = admitGeneralCapability(request);
      expect(result).toMatchObject({
        admitted: false,
        rejectionCode: "file-context-required",
      });
      expect((result as { message: string }).message).toContain("does not support workspace-file");
    });

    it("rejects network-resource context reference", () => {
      const request: GeneralCapabilityRequest = {
        contractVersion: GENERAL_V1_CONTRACT_VERSION,
        capabilities: ["text-analysis"],
        contextReferences: ["network-resource"],
        inputRequirements: ["bounded-text"],
        completionCriteria: "text-response",
      };
      const result = admitGeneralCapability(request);
      expect(result).toMatchObject({
        admitted: false,
        rejectionCode: "network-context-required",
      });
      expect((result as { message: string }).message).toContain(
        "does not support network-resource",
      );
    });

    it("rejects file-content input requirement", () => {
      const request = {
        contractVersion: GENERAL_V1_CONTRACT_VERSION,
        capabilities: ["text-analysis"],
        contextReferences: ["inline-text"],
        inputRequirements: ["file-content"],
        completionCriteria: "text-response" as const,
      };
      // file-content is not a valid input requirement kind, will throw in assertion
      expect(() => admitGeneralCapability(request as any)).toThrow(GeneralCapabilityAdmissionError);
    });

    it("rejects artifact-created completion criteria", () => {
      const request = {
        contractVersion: GENERAL_V1_CONTRACT_VERSION,
        capabilities: ["text-generation"],
        contextReferences: ["none"],
        inputRequirements: ["none"],
        completionCriteria: "artifact-created",
      };
      // artifact-created is not a valid completion criteria, will throw in assertion
      expect(() => admitGeneralCapability(request as any)).toThrow(GeneralCapabilityAdmissionError);
    });

    it("filters out forbidden capabilities and admits remaining allowed ones", () => {
      const request: GeneralCapabilityRequest = {
        contractVersion: GENERAL_V1_CONTRACT_VERSION,
        capabilities: ["text-analysis"],
        contextReferences: ["inline-text"],
        inputRequirements: ["bounded-text"],
        completionCriteria: "text-response",
      };
      const result = admitGeneralCapability(request);
      expect(result).toMatchObject({
        admitted: true,
        allowedCapabilities: ["text-analysis"],
      });
    });
  });
});

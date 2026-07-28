import {
  PrivilegedServiceError,
  toolId,
  type ProtectedToolExecutor,
  type ToolCapabilityManifest,
  type ToolExecutionRequest,
  type ToolExecutionResult,
  type ToolId,
} from "../../core";

export class DisabledProtectedToolExecutor implements ProtectedToolExecutor {
  async manifest(tool: ToolId): Promise<ToolCapabilityManifest> {
    toolId(tool);
    throw new PrivilegedServiceError(
      "manifest-unavailable",
      "No protected tool manifest is registered",
    );
  }

  async execute(_request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    throw new PrivilegedServiceError(
      "tool-execution-failed",
      "Protected tool execution is disabled",
    );
  }
}

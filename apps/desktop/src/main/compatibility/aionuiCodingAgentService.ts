import {
  ACTESTRA_GOOSE_MANAGED_AGENT_ID,
  ACTESTRA_GOOSE_MANAGED_AGENT_NAME,
  ACTESTRA_GOOSE_RUNNER_VERSION,
  AIONUI_CODING_AGENT_CONTRACT_VERSION,
  assertAionUiCodingAgentProjection,
  type AionUiCodingAgentProjection,
  type AionUiCodingAgentUnavailableProjection,
} from "../../compatibility/aionui";
import type { IsolatedCodingMainService } from "../workers/isolatedCodingMainService";
import {
  GooseRunnerArtifactError,
  admitGooseRunnerArtifact,
  type AdmittedGooseRunnerArtifact,
  type AdmitGooseRunnerArtifactOptions,
} from "../workers/gooseRunnerArtifact";

export interface AionUiCodingRunnerAdmission extends AdmitGooseRunnerArtifactOptions {
  readonly directory: string;
}

export interface AionUiCodingAgentServiceOptions {
  readonly getMainService: () => IsolatedCodingMainService | null;
  readonly runnerAdmission?: AionUiCodingRunnerAdmission;
  readonly admittedArtifact?: AdmittedGooseRunnerArtifact;
}

export interface AionUiCodingAgentServiceDependencies {
  readonly admitRunnerArtifact: typeof admitGooseRunnerArtifact;
}

const DEFAULT_DEPENDENCIES: AionUiCodingAgentServiceDependencies = Object.freeze({
  admitRunnerArtifact: admitGooseRunnerArtifact,
});

export type AionUiCodingAgentServiceErrorCode = "not-ready";

export class AionUiCodingAgentServiceError extends Error {
  constructor(
    readonly code: AionUiCodingAgentServiceErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AionUiCodingAgentServiceError";
  }
}

function readyProjection(): AionUiCodingAgentProjection {
  return Object.freeze({
    contractVersion: AIONUI_CODING_AGENT_CONTRACT_VERSION,
    agentId: ACTESTRA_GOOSE_MANAGED_AGENT_ID,
    displayName: ACTESTRA_GOOSE_MANAGED_AGENT_NAME,
    status: "ready",
    runnerVersion: ACTESTRA_GOOSE_RUNNER_VERSION,
  });
}

function unavailableProjection(
  status: AionUiCodingAgentUnavailableProjection["status"],
  reason: AionUiCodingAgentUnavailableProjection["reason"],
): AionUiCodingAgentUnavailableProjection {
  const projection = Object.freeze({
    contractVersion: AIONUI_CODING_AGENT_CONTRACT_VERSION,
    agentId: ACTESTRA_GOOSE_MANAGED_AGENT_ID,
    displayName: ACTESTRA_GOOSE_MANAGED_AGENT_NAME,
    status,
    reason,
  });
  assertAionUiCodingAgentProjection(projection);
  return projection;
}

function artifactFailureProjection(error: unknown): AionUiCodingAgentUnavailableProjection {
  if (error instanceof GooseRunnerArtifactError) {
    if (error.code === "missing-artifact") {
      return unavailableProjection("missing", "runner-missing");
    }
    return unavailableProjection("incompatible", "runner-incompatible");
  }
  return unavailableProjection("incompatible", "runner-admission-failed");
}

export class AionUiCodingAgentService {
  private admittedArtifact: AdmittedGooseRunnerArtifact | undefined;
  private admissionFailure: AionUiCodingAgentUnavailableProjection | undefined;
  private admissionPromise: Promise<AdmittedGooseRunnerArtifact> | undefined;

  constructor(
    private readonly options: AionUiCodingAgentServiceOptions,
    private readonly dependencies: AionUiCodingAgentServiceDependencies = DEFAULT_DEPENDENCIES,
  ) {
    this.admittedArtifact = options.admittedArtifact;
  }

  private mainServiceAvailable(): boolean {
    try {
      return this.options.getMainService() !== null;
    } catch {
      return false;
    }
  }

  private async admit(refresh: boolean): Promise<AdmittedGooseRunnerArtifact> {
    if (refresh) {
      this.admittedArtifact = undefined;
      this.admissionFailure = undefined;
    }
    if (this.admittedArtifact !== undefined) {
      return this.admittedArtifact;
    }
    const admission = this.options.runnerAdmission;
    if (admission === undefined) {
      throw new AionUiCodingAgentServiceError(
        "not-ready",
        "The admitted Goose runner is not configured",
      );
    }
    if (!refresh && this.admissionFailure !== undefined) {
      throw new AionUiCodingAgentServiceError(
        "not-ready",
        "The admitted Goose runner is not ready",
      );
    }
    this.admissionPromise ??= this.dependencies
      .admitRunnerArtifact(admission.directory, {
        trustedManifestSha256: admission.trustedManifestSha256,
        expectedTargetTriple: admission.expectedTargetTriple,
      })
      .then((artifact) => {
        this.admittedArtifact = artifact;
        this.admissionFailure = undefined;
        return artifact;
      })
      .finally(() => {
        this.admissionPromise = undefined;
      });
    return this.admissionPromise;
  }

  private async inspect(refresh: boolean): Promise<AionUiCodingAgentProjection> {
    if (!this.mainServiceAvailable()) {
      this.admittedArtifact = undefined;
      this.admissionFailure = undefined;
      return unavailableProjection("unavailable", "main-unavailable");
    }
    if (!refresh && this.admittedArtifact !== undefined) {
      return readyProjection();
    }
    if (this.options.runnerAdmission === undefined) {
      return unavailableProjection("missing", "runner-not-configured");
    }
    if (!refresh && this.admissionFailure !== undefined) {
      return this.admissionFailure;
    }
    try {
      await this.admit(refresh);
      return readyProjection();
    } catch (error) {
      if (error instanceof AionUiCodingAgentServiceError) {
        return unavailableProjection("missing", "runner-not-configured");
      }
      const projection = artifactFailureProjection(error);
      this.admissionFailure = projection;
      return projection;
    }
  }

  status(): Promise<AionUiCodingAgentProjection> {
    return this.inspect(false);
  }

  probe(): Promise<AionUiCodingAgentProjection> {
    return this.inspect(true);
  }

  async requireAdmittedArtifact(): Promise<AdmittedGooseRunnerArtifact> {
    if (!this.mainServiceAvailable()) {
      throw new AionUiCodingAgentServiceError(
        "not-ready",
        "The Actestra coding runtime is not ready",
      );
    }
    if (this.admittedArtifact !== undefined) {
      return this.admittedArtifact;
    }
    if (this.options.runnerAdmission === undefined) {
      throw new AionUiCodingAgentServiceError(
        "not-ready",
        "The Actestra coding runtime is not ready",
      );
    }
    try {
      return await this.admit(false);
    } catch (error) {
      if (error instanceof AionUiCodingAgentServiceError) {
        throw error;
      }
      throw new AionUiCodingAgentServiceError(
        "not-ready",
        "The admitted Goose runner is not ready",
        { cause: error },
      );
    }
  }
}

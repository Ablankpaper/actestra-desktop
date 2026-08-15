export * from "./agentAdapter";
export * from "./artifactDelivery";
export * from "./artifactPatchAccess";
export * from "./domain";
export * from "./events";
export * from "./generalCapabilityAdmission";
export * from "./generalDraftContract";
// `generalLayeredExecution` and `generalOutputEnvelope` are deliberately absent. They hold an
// unreached second General vocabulary — 27 layered codes and a different envelope shape — that no
// execution path uses. Publishing both through this barrel would let a caller build against codes
// that never appear in a real event, which is the drift the one-code-per-failure contract in
// `generalDraftContract` exists to prevent. Their tests import them by path and still run.
export * from "./generalWorkRecovery";
export * from "./isolatedCodingTools";
export * from "./officeDocumentArtifact";
export * from "./persistence";
export * from "./platform";
export * from "./productPersistence";
export * from "./privilegedServices";
export * from "./scopedNativeTools";
export * from "./teamOrchestration";
export * from "./teamRun";
export * from "./workloadContent";
export * from "./workerResourceBudget";
export * from "./writingArtifact";

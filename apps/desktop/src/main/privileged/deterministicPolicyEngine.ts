import {
  PrivilegedServiceError,
  assertPolicyDecision,
  assertPolicySnapshot,
  assertProtectedOperation,
  compareInstants,
  instant,
  policyDecisionId,
  type PolicyDecision,
  type PolicyDecisionId,
  type PolicyEffect,
  type PolicyEngine,
  type PolicyRule,
  type PolicySnapshot,
  type PrivilegedClock,
  type ProtectedOperation,
} from "../../core";

function immutableRule(rule: PolicyRule): PolicyRule {
  return Object.freeze({
    ...rule,
    actions: Object.freeze([...rule.actions]),
    resourceKinds: Object.freeze([...rule.resourceKinds]),
    ...(rule.toolIds === undefined
      ? {}
      : {
          toolIds: Object.freeze([...rule.toolIds]),
        }),
  });
}

function immutableSnapshot(snapshot: PolicySnapshot): PolicySnapshot {
  return Object.freeze({
    contractVersion: snapshot.contractVersion,
    revision: snapshot.revision,
    rules: Object.freeze(snapshot.rules.map(immutableRule)),
  });
}

function matchesCredentialUse(rule: PolicyRule, operation: ProtectedOperation): boolean {
  const usesCredentials = operation.credentialRefs.length > 0;
  return (
    rule.credentialUse === "any" ||
    (rule.credentialUse === "required" && usesCredentials) ||
    (rule.credentialUse === "none" && !usesCredentials)
  );
}

function matchesRule(rule: PolicyRule, operation: ProtectedOperation): boolean {
  return (
    rule.actions.includes(operation.action) &&
    rule.resourceKinds.includes(operation.resourceKind) &&
    matchesCredentialUse(rule, operation) &&
    (rule.toolIds === undefined || rule.toolIds.includes(operation.toolId))
  );
}

function strongestEffect(rules: readonly PolicyRule[]): PolicyEffect {
  if (rules.some(({ effect }) => effect === "deny")) {
    return "deny";
  }
  if (rules.some(({ effect }) => effect === "require-approval")) {
    return "require-approval";
  }
  return rules.length === 0 ? "deny" : "allow";
}

export class DeterministicPolicyEngine implements PolicyEngine {
  private readonly snapshot: PolicySnapshot;
  private readonly decisionIds = new Set<PolicyDecisionId>();

  constructor(
    snapshot: PolicySnapshot,
    private readonly clock: PrivilegedClock,
    private readonly newDecisionId: () => PolicyDecisionId,
  ) {
    assertPolicySnapshot(snapshot);
    instant(clock.now());
    this.snapshot = immutableSnapshot(snapshot);
  }

  async evaluate(operation: ProtectedOperation): Promise<PolicyDecision> {
    assertProtectedOperation(operation);
    const evaluatedAt = this.clock.now();
    instant(evaluatedAt);

    if (compareInstants(operation.requestedAt, evaluatedAt) > 0) {
      throw new PrivilegedServiceError(
        "invalid-contract",
        "Protected operations cannot be requested in the future",
      );
    }

    const decisionId = this.newDecisionId();
    try {
      policyDecisionId(decisionId);
    } catch {
      throw new PrivilegedServiceError(
        "policy-unavailable",
        "Policy decision identifier source returned an invalid identifier",
      );
    }
    if (this.decisionIds.has(decisionId)) {
      throw new PrivilegedServiceError(
        "policy-unavailable",
        "Policy decision identifier source returned a duplicate identifier",
      );
    }

    const matchingRules = this.snapshot.rules.filter((rule) => matchesRule(rule, operation));
    const effect = strongestEffect(matchingRules);
    const reasonCode =
      matchingRules.length === 0
        ? "no-matching-rule"
        : effect === "deny"
          ? "matching-rule-deny"
          : effect === "require-approval"
            ? "matching-rule-approval"
            : "matching-rule-allow";
    const decision = Object.freeze({
      decisionId,
      policyRevision: this.snapshot.revision,
      requestId: operation.requestId,
      effect,
      reasonCode,
      matchedRuleIds: Object.freeze(matchingRules.map(({ id }) => id)),
      evaluatedAt,
    }) satisfies PolicyDecision;
    assertPolicyDecision(decision);
    this.decisionIds.add(decisionId);
    return decision;
  }
}

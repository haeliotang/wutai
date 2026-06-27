export const TRUST_VERDICT_ARTIFACT_NAME = "trust-verdict.json";

export const DEFAULT_TRUST_POLICY = {
  schemaVersion: 1,
  kind: "wutai.trust_policy",
  policyId: "wutai-default-trust-policy-v0.3",
  sourceLabel: "built-in default",
  requireTrustedProducerForTrusted: true,
  defaultUnsignedAction: "review",
  defaultPolicyWarningAction: "review",
  defaultHighRiskAllowAction: "review",
  defaultMissingRationaleAction: "review",
  rulePolicies: {},
};

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function policyAction(value) {
  return value === "allow" || value === "review" || value === "block"
    ? value
    : undefined;
}

function reviewOrBlock(value, fallback) {
  return value === "block" || value === "review" ? value : fallback;
}

export function normalizeTrustPolicy(raw, sourceLabel = "local trust policy") {
  if (!raw) return DEFAULT_TRUST_POLICY;
  if (!isRecord(raw)) {
    throw new Error("Trust policy must be a JSON object.");
  }
  if (raw.kind && raw.kind !== "wutai.trust_policy") {
    throw new Error(`Unsupported trust policy kind: ${String(raw.kind)}.`);
  }

  const rawRulePolicies = isRecord(raw.rulePolicies) ? raw.rulePolicies : {};
  const rulePolicies = Object.fromEntries(
    Object.entries(rawRulePolicies).map(([ruleId, value]) => {
      if (!isRecord(value)) {
        throw new Error(`Trust policy rule ${ruleId} must be an object.`);
      }
      const action = policyAction(value.action);
      return [
        ruleId,
        {
          ...(action ? { action } : {}),
          ...(typeof value.requireRationale === "boolean"
            ? { requireRationale: value.requireRationale }
            : {}),
          missingRationaleAction: reviewOrBlock(
            value.missingRationaleAction,
            DEFAULT_TRUST_POLICY.defaultMissingRationaleAction,
          ),
          ...(typeof value.requireTrustedProducer === "boolean"
            ? { requireTrustedProducer: value.requireTrustedProducer }
            : {}),
          ...(typeof value.requireReviewer === "boolean"
            ? { requireReviewer: value.requireReviewer }
            : {}),
          ...(typeof value.note === "string" && value.note.trim()
            ? { note: value.note.trim() }
            : {}),
        },
      ];
    }),
  );

  return {
    schemaVersion: 1,
    kind: "wutai.trust_policy",
    policyId:
      typeof raw.policyId === "string" && raw.policyId.trim()
        ? raw.policyId.trim()
        : DEFAULT_TRUST_POLICY.policyId,
    sourceLabel,
    requireTrustedProducerForTrusted:
      typeof raw.requireTrustedProducerForTrusted === "boolean"
        ? raw.requireTrustedProducerForTrusted
        : DEFAULT_TRUST_POLICY.requireTrustedProducerForTrusted,
    defaultUnsignedAction: reviewOrBlock(
      raw.defaultUnsignedAction,
      DEFAULT_TRUST_POLICY.defaultUnsignedAction,
    ),
    defaultPolicyWarningAction: reviewOrBlock(
      raw.defaultPolicyWarningAction,
      DEFAULT_TRUST_POLICY.defaultPolicyWarningAction,
    ),
    defaultHighRiskAllowAction: reviewOrBlock(
      raw.defaultHighRiskAllowAction,
      DEFAULT_TRUST_POLICY.defaultHighRiskAllowAction,
    ),
    defaultMissingRationaleAction: reviewOrBlock(
      raw.defaultMissingRationaleAction,
      DEFAULT_TRUST_POLICY.defaultMissingRationaleAction,
    ),
    rulePolicies,
  };
}

function statusForAction(action) {
  return action === "block" ? "blocked" : "review_required";
}

function addCheck(checks, status, name, message, evidence, ruleId) {
  checks.push({
    name,
    status,
    message,
    ...(evidence ? { evidence } : {}),
    ...(ruleId ? { ruleId } : {}),
  });
}

function ruleRationale(ruleId, policy, policyReview) {
  const matched = policy?.matchedRules?.find((rule) => rule.ruleId === ruleId);
  const explicitOverrideApplies =
    policy?.override?.applied && policy.override.appliedRuleIds?.includes(ruleId);
  return (
    matched?.ruleOverride?.reason ??
    (explicitOverrideApplies ? policy?.override?.reason : undefined) ??
    policyReview?.ruleOverrides?.find((rule) => rule.ruleId === ruleId)?.reason ??
    undefined
  );
}

function matchedRuleIds(policy, policyReview) {
  return [
    ...new Set([
      ...(policy?.matchedRules?.map((rule) => rule.ruleId).filter(Boolean) ?? []),
      ...(policyReview?.ruleOverrides?.map((rule) => rule.ruleId).filter(Boolean) ??
        []),
    ]),
  ];
}

export function buildTrustVerdictArtifact({
  taskId,
  generatedAt,
  manifest,
  policy,
  integrity,
  provenance,
  policyReview,
  trustPolicy = DEFAULT_TRUST_POLICY,
}) {
  const checks = [];

  if (manifest?.kind === "wutai.work_packet_manifest") {
    addCheck(
      checks,
      "passed",
      "manifest_contract",
      "Manifest contract is present.",
      `packetType=${String(manifest.packetType ?? "missing")}`,
    );
  } else {
    addCheck(
      checks,
      "blocked",
      "manifest_contract",
      "Manifest contract is missing or invalid.",
      `kind=${String(manifest?.kind ?? "missing")}`,
    );
  }

  if (integrity?.status === "passed") {
    addCheck(checks, "passed", "artifact_integrity", integrity.summary ?? "Artifact hashes passed.");
  } else if (integrity?.status === "failed") {
    addCheck(
      checks,
      "blocked",
      "artifact_integrity",
      integrity.summary ?? "Artifact integrity failed.",
      `mismatched=${integrity.metrics?.mismatched ?? 0} missing=${integrity.metrics?.missing ?? 0}`,
    );
  } else {
    addCheck(
      checks,
      "review_required",
      "artifact_integrity",
      integrity?.summary ?? "Artifact integrity is incomplete.",
      `unverifiable=${integrity?.metrics?.unverifiable ?? 0}`,
    );
  }

  if (provenance?.status === "passed") {
    addCheck(checks, "passed", "packet_provenance", provenance.summary ?? "Packet provenance passed.");
  } else if (provenance?.status === "failed") {
    addCheck(
      checks,
      "blocked",
      "packet_provenance",
      provenance.summary ?? "Packet provenance failed.",
      `trustPolicy=${String(provenance?.trustPolicy?.status ?? "unknown")}`,
    );
  } else {
    addCheck(
      checks,
      statusForAction(trustPolicy.defaultUnsignedAction),
      "packet_provenance",
      provenance?.summary ?? "Packet provenance requires review.",
      `attestation=${provenance?.attestation?.present ? "present" : "missing"} trusted=${String(provenance?.attestation?.trustedKey ?? false)}`,
    );
  }

  const trustedProducer = provenance?.attestation?.trustedKey === true;
  if (trustPolicy.requireTrustedProducerForTrusted && !trustedProducer) {
    addCheck(
      checks,
      statusForAction(trustPolicy.defaultUnsignedAction),
      "trusted_producer_required",
      "A trusted producer key is required before this packet can be marked trusted.",
      `trustPolicy=${String(provenance?.trustPolicy?.status ?? "unknown")}`,
    );
  } else {
    addCheck(
      checks,
      "passed",
      "trusted_producer_required",
      "Trusted-producer requirement is satisfied for this verdict.",
    );
  }

  if (policyReview?.status === "passed") {
    addCheck(checks, "passed", "policy_override_review", policyReview.summary ?? "Policy override review passed.");
  } else if (policyReview?.status === "failed") {
    addCheck(checks, "blocked", "policy_override_review", policyReview.summary ?? "Policy override review failed.");
  } else {
    addCheck(
      checks,
      statusForAction(trustPolicy.defaultPolicyWarningAction),
      "policy_override_review",
      policyReview?.summary ?? "Policy override review requires review.",
    );
  }

  if (policy?.decision === "deny") {
    addCheck(
      checks,
      "blocked",
      "policy_decision",
      "The packet policy denied execution before the command ran.",
      `decision=${policy.decision}`,
    );
  } else if (
    policy?.decision === "allow_with_override" ||
    policy?.decision === "allow_with_warnings"
  ) {
    addCheck(
      checks,
      "review_required",
      "policy_decision",
      "The packet policy allowed execution with warnings or override.",
      `decision=${policy.decision}`,
    );
  } else if (policy?.decision === "allow") {
    addCheck(
      checks,
      "passed",
      "policy_decision",
      "The packet policy allowed execution with no blocking rule.",
      `decision=${policy.decision}`,
    );
  } else {
    addCheck(checks, "blocked", "policy_decision", "The packet policy decision is missing.");
  }

  const missingRationaleCount =
    (policyReview?.metrics?.missingOverrideReasonCount ?? 0) +
    (policyReview?.metrics?.explicitOverrideWithoutReason ? 1 : 0);
  if (missingRationaleCount > 0) {
    addCheck(
      checks,
      statusForAction(trustPolicy.defaultMissingRationaleAction),
      "override_rationale",
      "One or more policy overrides are missing rationale.",
      `missing=${missingRationaleCount}`,
    );
  } else {
    addCheck(checks, "passed", "override_rationale", "Policy override rationale is present when required.");
  }

  const highRiskAllowCount = policyReview?.metrics?.highRiskAllowCount ?? 0;
  if (highRiskAllowCount > 0) {
    addCheck(
      checks,
      statusForAction(trustPolicy.defaultHighRiskAllowAction),
      "high_risk_allow",
      "High-risk policy outcome allowed execution after override.",
      `highRiskAllowCount=${highRiskAllowCount}`,
    );
  } else {
    addCheck(checks, "passed", "high_risk_allow", "No high-risk allow outcome was recorded.");
  }

  let matchedRulePolicyCount = 0;
  for (const ruleId of matchedRuleIds(policy, policyReview)) {
    const rulePolicy = trustPolicy.rulePolicies[ruleId];
    if (!rulePolicy) continue;

    matchedRulePolicyCount += 1;
    if (rulePolicy.action === "block") {
      addCheck(
        checks,
        "blocked",
        "rule_trust_policy",
        rulePolicy.note ?? `Trust policy blocks matched rule ${ruleId}.`,
        "action=block",
        ruleId,
      );
    } else if (rulePolicy.action === "review") {
      addCheck(
        checks,
        "review_required",
        "rule_trust_policy",
        rulePolicy.note ?? `Trust policy requires review for matched rule ${ruleId}.`,
        "action=review",
        ruleId,
      );
    } else {
      addCheck(
        checks,
        "passed",
        "rule_trust_policy",
        rulePolicy.note ?? `Trust policy allows matched rule ${ruleId}.`,
        `action=${rulePolicy.action ?? "allow"}`,
        ruleId,
      );
    }

    if (rulePolicy.requireRationale && !ruleRationale(ruleId, policy, policyReview)) {
      addCheck(
        checks,
        statusForAction(
          rulePolicy.missingRationaleAction ??
            trustPolicy.defaultMissingRationaleAction,
        ),
        "rule_rationale_required",
        `Trust policy requires rationale for matched rule ${ruleId}.`,
        "rationale=missing",
        ruleId,
      );
    }

    if (rulePolicy.requireTrustedProducer && !trustedProducer) {
      addCheck(
        checks,
        "blocked",
        "rule_trusted_producer_required",
        `Trust policy requires a trusted producer for matched rule ${ruleId}.`,
        `trustedProducer=${String(trustedProducer)}`,
        ruleId,
      );
    }

    if (rulePolicy.requireReviewer) {
      addCheck(
        checks,
        "review_required",
        "rule_reviewer_required",
        `Trust policy requires human reviewer attestation for matched rule ${ruleId}.`,
        "reviewer=not_recorded",
        ruleId,
      );
    }
  }

  const metrics = {
    total: checks.length,
    passed: checks.filter((check) => check.status === "passed").length,
    reviewRequired: checks.filter((check) => check.status === "review_required")
      .length,
    blocked: checks.filter((check) => check.status === "blocked").length,
  };
  const verdict =
    metrics.blocked > 0
      ? "blocked"
      : metrics.reviewRequired > 0
        ? "review_required"
        : "trusted";

  return {
    schemaVersion: 1,
    kind: "wutai.trust_verdict",
    taskId,
    generatedAt,
    verdict,
    summary:
      verdict === "blocked"
        ? `Trust verdict blocked by ${metrics.blocked} gate${metrics.blocked === 1 ? "" : "s"}.`
        : verdict === "review_required"
          ? `Trust verdict requires review for ${metrics.reviewRequired} gate${metrics.reviewRequired === 1 ? "" : "s"}.`
          : "Trust verdict trusted: integrity, provenance, policy review, and trust policy checks passed.",
    policy: {
      policyId: trustPolicy.policyId,
      sourceLabel: trustPolicy.sourceLabel,
      requireTrustedProducerForTrusted:
        trustPolicy.requireTrustedProducerForTrusted,
      matchedRulePolicyCount,
    },
    inputs: {
      manifestKind: manifest?.kind,
      packetType: manifest?.packetType ?? provenance?.manifest?.packetType,
      producerAdapter: manifest?.producer?.adapter ?? provenance?.manifest?.producerAdapter,
      policyDecision: policy?.decision,
      integrityStatus: integrity?.status,
      provenanceStatus: provenance?.status,
      policyReviewStatus: policyReview?.status,
      trustedProducer,
    },
    metrics,
    checks,
    reviewRequired: checks
      .filter((check) => check.status === "review_required")
      .map((check) => check.message),
    blocked: checks
      .filter((check) => check.status === "blocked")
      .map((check) => check.message),
    limitation:
      "This verdict is a local review gate over packet artifacts and local policy. It does not sandbox execution, prove external identity, or guarantee that the recorded command was safe.",
  };
}

#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import process from "node:process";
import { verifyPacketDirectory } from "./wutai_verify_packet.mjs";

const CONSUMER_ATTESTATION_NAME = "consumer-attestation.json";
const CONSUMER_ATTESTATION_CHECK_NAME = "consumer-attestation-check.json";
const REVIEW_SESSION_NAME = "review-session.json";
const VALID_DECISIONS = new Set([
  "ratified",
  "refused",
  "rejected",
  "needs_changes",
  "no_action",
]);
const SCOPE_REASON_SIGNALS = new Set([
  "intent_drift",
  "empty_seat",
  "unevidenced_claims",
  "scope_boundary",
  "trace_incomplete",
  "other",
]);

function usage() {
  return `Usage:
  wutai attest-packet [options] <packet-dir>
  npm run wutai:attest -- [options] <packet-dir>

Options:
  --attestation <path>         Scoped ratification JSON. Default: <packet-dir>/consumer-attestation.json.
  --review-session <path>      Optional v0.8 review-session JSON for attention/causal-credit scoring.
  --disallow-reviewer <id>     Reviewer id that cannot satisfy the gate. Repeatable.
  --trusted-producers <path>   Trusted producer policy JSON for packet verification.
  --trust-policy <path>        Trust verdict policy JSON for packet verification.
  --trust-policy-profile <id>  Trust policy profile for packet verification. Default: personal-default.
  --write-artifacts            Write verifier artifacts and consumer-attestation-check.json into the packet directory.
  --help                       Show this message.

Exit codes:
  0 accepted scoped ratification, 20 not accepted or invalid, 2 usage or packet-read error.`;
}

function parseArgs(argv) {
  const options = {
    attestation: null,
    reviewSession: null,
    disallowedReviewers: [],
    trustedProducers: null,
    trustPolicy: null,
    trustPolicyProfile: null,
    writeArtifacts: false,
    help: false,
    packetDir: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") {
      options.help = true;
    } else if (arg === "--attestation") {
      index += 1;
      if (!argv[index]) throw new Error("--attestation requires a value.");
      options.attestation = argv[index];
    } else if (arg === "--review-session") {
      index += 1;
      if (!argv[index]) throw new Error("--review-session requires a value.");
      options.reviewSession = argv[index];
    } else if (arg === "--disallow-reviewer") {
      index += 1;
      if (!argv[index]) throw new Error("--disallow-reviewer requires a value.");
      options.disallowedReviewers.push(argv[index]);
    } else if (arg === "--trusted-producers") {
      index += 1;
      if (!argv[index]) throw new Error("--trusted-producers requires a value.");
      options.trustedProducers = argv[index];
    } else if (arg === "--trust-policy") {
      index += 1;
      if (!argv[index]) throw new Error("--trust-policy requires a value.");
      options.trustPolicy = argv[index];
    } else if (arg === "--trust-policy-profile") {
      index += 1;
      if (!argv[index]) throw new Error("--trust-policy-profile requires a value.");
      options.trustPolicyProfile = argv[index];
    } else if (arg === "--write-artifacts") {
      options.writeArtifacts = true;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (!options.packetDir) {
      options.packetDir = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  return options;
}

function sha256Hex(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function parseJson(content, name) {
  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`${name} is not valid JSON.`);
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeReviewerId(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function hasText(value) {
  return typeof value === "string" && Boolean(value.trim());
}

function stringList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizedScopeReasons(attestation) {
  return [
    ...stringList(attestation.scopeReasons),
    ...stringList(attestation.refusalReasons),
  ].filter((reason, index, list) => list.indexOf(reason) === index);
}

function normalizedWedgeSignals(attestation) {
  const wedge = isRecord(attestation.wedge) ? attestation.wedge : {};
  return [...stringList(wedge.signals), ...stringList(attestation.wedgeSignals)]
    .map((signal) => signal.toLowerCase())
    .filter((signal) => signal && signal !== "none")
    .filter((signal, index, list) => list.indexOf(signal) === index);
}

function wedgeOutcome(attestation) {
  const wedge = isRecord(attestation.wedge) ? attestation.wedge : {};
  const signals = normalizedWedgeSignals(attestation);
  if (wedge.changedReviewBehavior === true || signals.length > 0) {
    return "wedge_win";
  }
  if (
    wedge.changedReviewBehavior === false ||
    (Array.isArray(wedge.signals) && signals.length === 0) ||
    (Array.isArray(attestation.wedgeSignals) && signals.length === 0)
  ) {
    return "wedge_null";
  }
  return "not_recorded";
}

function normalizeMoatOutcome(value) {
  if (
    value === "scoped_ratified" ||
    value === "refused_with_scope_reason" ||
    value === "theater_signature" ||
    value === "no_action"
  ) {
    return value;
  }
  return null;
}

function moatOutcome(attestation) {
  const decision = typeof attestation.decision === "string" ? attestation.decision : "";
  const scopeReasons = normalizedScopeReasons(attestation);
  const hasScopedBoundary =
    hasText(attestation.declaredScope) && hasText(attestation.excludedScope);
  const hasScopeReason = scopeReasons.some((reason) => SCOPE_REASON_SIGNALS.has(reason));

  if (decision === "ratified") {
    return hasScopedBoundary ? "scoped_ratified" : "theater_signature";
  }
  if (["refused", "rejected", "needs_changes"].includes(decision)) {
    return hasScopeReason && hasText(attestation.statement)
      ? "refused_with_scope_reason"
      : "no_action";
  }
  return "no_action";
}

function moatSignal(outcome) {
  if (outcome === "scoped_ratified" || outcome === "refused_with_scope_reason") {
    return "moat_win";
  }
  if (outcome === "theater_signature") return "anti_signal";
  return "moat_null";
}

function experimentCell(wedge, moat) {
  const signal = moatSignal(moat);
  if (wedge === "not_recorded") {
    if (signal === "anti_signal") return "unclassified_theater";
    return "unclassified";
  }
  const wedgeCell = wedge === "wedge_win" ? "wedge_win" : "wedge_null";
  if (signal === "anti_signal") return `${wedgeCell}_theater`;
  if (signal === "moat_win") return `${wedgeCell}_moat_win`;
  return `${wedgeCell}_moat_null`;
}

function gateDecision(structuralPassed, moat) {
  if (!structuralPassed) return "invalid";
  if (moat === "scoped_ratified") return "accepted";
  if (moat === "refused_with_scope_reason") return "not_accepted";
  return "invalid";
}

function addCheck(checks, status, name, message, evidence = undefined) {
  checks.push({
    name,
    status,
    message,
    ...(evidence ? { evidence } : {}),
  });
}

function addSessionNote(notes, status, name, message, evidence = undefined) {
  notes.push({
    name,
    status,
    message,
    ...(evidence ? { evidence } : {}),
  });
}

function decisionStatus(checks) {
  return checks.some((check) => check.status === "failed") ? "failed" : "passed";
}

function summaryFor({ status, gate, wedge, moat, attention, causalCredit }) {
  if (gate === "accepted") {
    return `Scoped ratification gate passed: ${moat} with ${wedge}; attention=${attention}; causalCredit=${causalCredit}.`;
  }
  if (moat === "refused_with_scope_reason") {
    return `Reviewer refused scoped ratification with a scope/evidence/empty-seat reason. This is a valid MOAT readout, but it is not an acceptance pass. attention=${attention}; causalCredit=${causalCredit}.`;
  }
  if (moat === "theater_signature") {
    return `Reviewer ratified without a declared scope and excluded scope. This is a THEATER anti-signal, not a pass. attention=${attention}; causalCredit=${causalCredit}.`;
  }
  return status === "failed"
    ? `Scoped ratification gate failed before a valid moat readout: ${moat}. attention=${attention}; causalCredit=${causalCredit}.`
    : `Scoped ratification gate produced ${moat} with ${wedge}. attention=${attention}; causalCredit=${causalCredit}.`;
}

function boolOrNull(value) {
  return typeof value === "boolean" ? value : null;
}

function sessionArm(session, name) {
  return isRecord(session?.[name]) ? session[name] : {};
}

function reviewSessionSubjectMatches(session, manifest, manifestSha256) {
  const subject = isRecord(session.subject) ? session.subject : {};
  return (
    subject.manifestSha256 === manifestSha256 &&
    subject.packetId === manifest.packetId &&
    subject.taskId === manifest.taskId &&
    subject.producerAdapter === manifest.producer?.adapter
  );
}

function reviewSessionReviewerMatches(session, reviewerId) {
  const sessionReviewer = isRecord(session.reviewer) ? session.reviewer : {};
  const sessionReviewerId = normalizeReviewerId(sessionReviewer.id);
  return sessionReviewerId && sessionReviewerId === reviewerId;
}

function reviewSessionPathLabel(path) {
  return path ? basename(path) : REVIEW_SESSION_NAME;
}

function evaluateReviewSession({ reviewSession, reviewSessionPath, manifest, manifestSha256, reviewerId, moat }) {
  if (!reviewSession) {
    return {
      status: "not_recorded",
      attentionOutcome: "not_recorded",
      causalCredit: "not_recorded",
      path: null,
      inputs: {},
      contaminationReasons: [],
      noCreditReasons: [],
      notes: [
        {
          name: "review_session",
          status: "not_recorded",
          message: "No review-session JSON was supplied.",
        },
      ],
    };
  }

  const arm0 = sessionArm(reviewSession, "arm0");
  const armA = sessionArm(reviewSession, "armA");
  const armB = sessionArm(reviewSession, "armB");
  const controls = sessionArm(reviewSession, "controls");
  const notes = [];
  const contaminationReasons = [];
  const noCreditReasons = [];
  const wouldLook = boolOrNull(arm0.wouldLook);
  const packetViewed = boolOrNull(armB.packetViewed);
  const diffOnlySawTargetGap = boolOrNull(armA.sawTargetGap);
  const diffOnlyScopedDecision = normalizeMoatOutcome(armA.scopedDecision);
  const negativeControlReportedUseful = boolOrNull(controls.negativeControlReportedUseful);
  const shamFieldAttributed = boolOrNull(controls.shamFieldAttributed);
  const packetOnlyRepeatedDiff = boolOrNull(controls.packetOnlyRepeatedDiff);
  const traceCompleteEnough = boolOrNull(controls.traceCompleteEnough);
  const automaticReproducible = boolOrNull(controls.automaticReproducible);
  const attentionOutcome =
    wouldLook === false && packetViewed === true
      ? "attention_win"
      : wouldLook === null || packetViewed === null
        ? "not_recorded"
        : "attention_null";

  addSessionNote(
    notes,
    reviewSession.kind === "wutai.review_session" ? "passed" : "failed",
    "review_session_kind",
    reviewSession.kind === "wutai.review_session"
      ? "Review session kind matches the v0.8 contract."
      : `Review session kind mismatch: ${String(reviewSession.kind ?? "missing")}.`,
  );
  if (reviewSession.kind !== "wutai.review_session") {
    contaminationReasons.push("review_session_kind_mismatch");
  }

  addSessionNote(
    notes,
    reviewSessionSubjectMatches(reviewSession, manifest, manifestSha256) ? "passed" : "failed",
    "review_session_subject",
    "Review session subject must bind the same packet identity and manifest hash.",
  );
  if (!reviewSessionSubjectMatches(reviewSession, manifest, manifestSha256)) {
    contaminationReasons.push("review_session_subject_mismatch");
  }

  addSessionNote(
    notes,
    reviewSessionReviewerMatches(reviewSession, reviewerId) ? "passed" : "failed",
    "review_session_reviewer",
    "Review session reviewer must match consumer-attestation reviewer.id.",
    reviewerId ? `reviewer=${reviewerId}` : "reviewer=missing",
  );
  if (!reviewSessionReviewerMatches(reviewSession, reviewerId)) {
    contaminationReasons.push("review_session_reviewer_mismatch");
  }

  if (packetViewed !== true) noCreditReasons.push("packet_not_viewed");
  if (diffOnlyScopedDecision === null) {
    noCreditReasons.push("diff_only_scoped_decision_not_recorded");
  }
  if (diffOnlyScopedDecision && diffOnlyScopedDecision === moat) {
    noCreditReasons.push("diff_only_same_scoped_decision");
  }
  if (diffOnlySawTargetGap === true) noCreditReasons.push("diff_only_already_saw_target_gap");
  if (packetOnlyRepeatedDiff === true) noCreditReasons.push("packet_only_repeated_diff");
  if (wouldLook === null) noCreditReasons.push("would_look_baseline_not_recorded");

  if (negativeControlReportedUseful === true) {
    contaminationReasons.push("negative_control_reported_useful");
  }
  if (shamFieldAttributed === true) {
    contaminationReasons.push("sham_field_attributed");
  }
  if (traceCompleteEnough === false) {
    contaminationReasons.push("trace_incomplete_for_scope_or_evidence_claims");
  }
  if (automaticReproducible === false) {
    contaminationReasons.push("packet_fields_not_automatically_reproducible");
  }

  const packetChangedMoat =
    attentionOutcome !== "attention_win" &&
    wouldLook === true &&
    packetViewed === true &&
    moatSignal(moat) === "moat_win" &&
    diffOnlyScopedDecision !== null &&
    diffOnlyScopedDecision !== moat &&
    diffOnlySawTargetGap === false &&
    packetOnlyRepeatedDiff !== true;

  const causalCredit = contaminationReasons.length
    ? "contaminated"
    : attentionOutcome === "attention_win"
      ? "packet_changed_attention"
      : packetChangedMoat
        ? "packet_changed_moat"
        : "no_causal_credit";

  addSessionNote(
    notes,
    attentionOutcome === "not_recorded" ? "not_recorded" : "passed",
    "attention_baseline",
    `Attention outcome: ${attentionOutcome}.`,
    `wouldLook=${String(wouldLook)} packetViewed=${String(packetViewed)}`,
  );
  addSessionNote(
    notes,
    causalCredit === "packet_changed_moat" || causalCredit === "packet_changed_attention"
      ? "passed"
      : causalCredit === "contaminated"
        ? "failed"
        : "not_recorded",
    "causal_credit",
    `Causal credit: ${causalCredit}.`,
    [
      `diffOnlyScopedDecision=${String(diffOnlyScopedDecision ?? "missing")}`,
      `diffOnlySawTargetGap=${String(diffOnlySawTargetGap)}`,
      `contaminationReasons=${contaminationReasons.length ? contaminationReasons.join(",") : "none"}`,
      `noCreditReasons=${noCreditReasons.length ? noCreditReasons.join(",") : "none"}`,
    ].join(" "),
  );

  return {
    status: contaminationReasons.length ? "contaminated" : "usable",
    attentionOutcome,
    causalCredit,
    path: reviewSessionPath ? reviewSessionPathLabel(reviewSessionPath) : null,
    inputs: {
      wouldLook,
      packetViewed,
      diffOnlyScopedDecision,
      diffOnlySawTargetGap,
      negativeControlReportedUseful,
      shamFieldAttributed,
      packetOnlyRepeatedDiff,
      traceCompleteEnough,
      automaticReproducible,
    },
    contaminationReasons,
    noCreditReasons,
    notes,
  };
}

export async function runConsumerAttestationGate(packetDir, options = {}) {
  const resolvedPacketDir = resolve(packetDir);
  const generatedAt = new Date().toISOString();
  const manifestPath = join(resolvedPacketDir, "manifest.json");
  const manifestContent = await readFile(manifestPath, "utf8");
  const manifest = parseJson(manifestContent, "manifest.json");
  const manifestSha256 = sha256Hex(manifestContent);
  const attestationPath = resolve(
    options.attestation ?? join(resolvedPacketDir, CONSUMER_ATTESTATION_NAME),
  );
  const attestationContent = await readFile(attestationPath, "utf8");
  const attestation = parseJson(attestationContent, basename(attestationPath));
  const reviewSessionPath = options.reviewSession
    ? resolve(options.reviewSession)
    : null;
  const reviewSession = reviewSessionPath
    ? parseJson(
        await readFile(reviewSessionPath, "utf8"),
        basename(reviewSessionPath),
      )
    : null;
  const { trustVerdict } = await verifyPacketDirectory(resolvedPacketDir, {
    trustedProducers: options.trustedProducers,
    trustPolicy: options.trustPolicy,
    trustPolicyProfile: options.trustPolicyProfile,
    writeArtifacts: options.writeArtifacts,
  });

  const checks = [];
  const subject = isRecord(attestation.subject) ? attestation.subject : {};
  const reviewer = isRecord(attestation.reviewer) ? attestation.reviewer : {};
  const reviewerId = normalizeReviewerId(reviewer.id);
  const scopeReasons = normalizedScopeReasons(attestation);
  const wedge = wedgeOutcome(attestation);
  const moat = moatOutcome(attestation);
  const reviewSessionResult = evaluateReviewSession({
    reviewSession,
    reviewSessionPath,
    manifest,
    manifestSha256,
    reviewerId,
    moat,
  });
  const disallowedReviewers = (options.disallowedReviewers ?? [])
    .flatMap((item) => String(item).split(","))
    .map(normalizeReviewerId)
    .filter(Boolean);

  addCheck(
    checks,
    trustVerdict.verdict === "blocked" ? "failed" : "passed",
    "packet_trust_verdict",
    trustVerdict.verdict === "blocked"
      ? "Consumer attestation cannot pass a packet that Wutai blocked."
      : "Packet trust verdict is not blocked.",
    `verdict=${trustVerdict.verdict}`,
  );

  addCheck(
    checks,
    attestation.kind === "wutai.consumer_attestation" ? "passed" : "failed",
    "attestation_kind",
    attestation.kind === "wutai.consumer_attestation"
      ? "Consumer attestation kind matches the v0.7 contract."
      : `Consumer attestation kind mismatch: ${String(attestation.kind ?? "missing")}.`,
  );
  addCheck(
    checks,
    VALID_DECISIONS.has(attestation.decision) ? "passed" : "failed",
    "consumer_decision_recorded",
    VALID_DECISIONS.has(attestation.decision)
      ? `Consumer reviewer recorded decision: ${attestation.decision}.`
      : `Consumer reviewer decision is missing or unsupported: ${String(attestation.decision ?? "missing")}.`,
  );
  addCheck(
    checks,
    reviewerId ? "passed" : "failed",
    "reviewer_identity",
    reviewerId
      ? "Consumer reviewer id is present."
      : "Consumer attestation must include reviewer.id.",
    reviewerId ? `reviewer=${reviewerId}` : undefined,
  );
  addCheck(
    checks,
    reviewerId && !disallowedReviewers.includes(reviewerId) ? "passed" : "failed",
    "reviewer_not_self",
    reviewerId && !disallowedReviewers.includes(reviewerId)
      ? "Consumer reviewer is not in the disallowed self/author list."
      : "Consumer reviewer is missing or matches a disallowed self/author id.",
    disallowedReviewers.length
      ? `disallowed=${disallowedReviewers.join(",")}`
      : "disallowed=none",
  );
  addCheck(
    checks,
    subject.manifestSha256 === manifestSha256 ? "passed" : "failed",
    "subject_manifest_hash",
    subject.manifestSha256 === manifestSha256
      ? "Consumer attestation subject matches the selected manifest hash."
      : "Consumer attestation subject manifest hash does not match the selected packet.",
    `expected=${manifestSha256} actual=${String(subject.manifestSha256 ?? "missing")}`,
  );
  addCheck(
    checks,
    subject.packetId === manifest.packetId &&
      subject.taskId === manifest.taskId &&
      subject.producerAdapter === manifest.producer?.adapter
      ? "passed"
      : "failed",
    "subject_packet_identity",
    "Consumer attestation subject must bind packetId, taskId, and producerAdapter.",
    `packetId=${String(subject.packetId ?? "missing")} taskId=${String(subject.taskId ?? "missing")} producer=${String(subject.producerAdapter ?? "missing")}`,
  );
  addCheck(
    checks,
    hasText(attestation.statement) ? "passed" : "failed",
    "review_statement",
    "Consumer attestation must include a non-empty human review statement.",
  );
  addCheck(
    checks,
    hasText(attestation.reviewedAt) ? "passed" : "failed",
    "review_timestamp",
    "Consumer attestation must record reviewedAt.",
  );
  addCheck(
    checks,
    moat === "theater_signature" ? "failed" : "passed",
    "declared_scope",
    moat === "theater_signature"
      ? "A ratified decision without declaredScope and excludedScope is a theater signature."
      : "Ratification outcome is not an unscoped theater signature.",
    `declaredScope=${hasText(attestation.declaredScope) ? "present" : "missing"} excludedScope=${hasText(attestation.excludedScope) ? "present" : "missing"}`,
  );
  addCheck(
    checks,
    moat === "no_action" ? "failed" : "passed",
    "moat_outcome",
    moat === "no_action"
      ? "No scoped ratification or scoped refusal was observed."
      : `Moat outcome recorded: ${moat}.`,
    `scopeReasons=${scopeReasons.length ? scopeReasons.join(",") : "none"}`,
  );

  const structuralStatus = decisionStatus(checks);
  const decision = gateDecision(structuralStatus === "passed", moat);
  const status = decision === "accepted" ? "passed" : "failed";
  const cell = experimentCell(wedge, moat);
  const artifact = {
    schemaVersion: 3,
    kind: "wutai.consumer_attestation_check",
    taskId: manifest.taskId,
    generatedAt,
    status,
    gateDecision: decision,
    attentionOutcome: reviewSessionResult.attentionOutcome,
    causalCredit: reviewSessionResult.causalCredit,
    wedgeOutcome: wedge,
    moatOutcome: moat,
    moatSignal: moatSignal(moat),
    experimentCell: cell,
    summary: summaryFor({
      status,
      gate: decision,
      wedge,
      moat,
      attention: reviewSessionResult.attentionOutcome,
      causalCredit: reviewSessionResult.causalCredit,
    }),
    packet: {
      packetId: manifest.packetId,
      packetType: manifest.packetType,
      producerAdapter: manifest.producer?.adapter,
      manifestSha256,
      trustVerdict: trustVerdict.verdict,
    },
    reviewer: {
      id: reviewer.id,
      name: reviewer.name,
      role: reviewer.role,
      source: reviewer.source,
    },
    ratification: {
      decision: attestation.decision,
      declaredScope: attestation.declaredScope ?? null,
      excludedScope: attestation.excludedScope ?? null,
      scopeReasons,
      wedgeSignals: normalizedWedgeSignals(attestation),
    },
    reviewSession: reviewSessionResult,
    policy: {
      requiredDecision: "scoped_ratified",
      disallowedReviewers,
      blockedPacketAction: "fail",
      refusalAction: "fail_acceptance_but_record_moat_win",
      theaterAction: "fail",
    },
    antiSignals:
      moat === "theater_signature"
        ? [
            "ratified_without_declared_scope",
            "ratified_without_excluded_scope",
          ]
        : [],
    checks,
    limitation:
      "This harness records scoped ratification over a declared packet trace. Review-session scoring can separate attention, wedge, and moat signals, but it does not prove reviewer identity, trace completeness, sandbox execution, or make the packet safe.",
  };

  if (options.writeArtifacts) {
    await writeFile(
      join(resolvedPacketDir, CONSUMER_ATTESTATION_CHECK_NAME),
      JSON.stringify(artifact, null, 2),
      "utf8",
    );
  }

  return {
    packetDir: resolvedPacketDir,
    attestationPath,
    artifact,
    trustVerdict,
  };
}

export async function runConsumerAttestationGateCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return 0;
  }
  if (!options.packetDir) {
    console.error(usage());
    return 2;
  }

  const { artifact } = await runConsumerAttestationGate(options.packetDir, options);
  console.log(JSON.stringify(artifact, null, 2));
  return artifact.status === "passed" ? 0 : 20;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runConsumerAttestationGateCli()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 2;
    });
}

#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as signData,
} from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const MAX_CAPTURE_CHARS = 16_000;
const MAX_SUMMARY_CHARS = 2_000;
const POLICY_DENIED_EXIT_CODE = 3;
const POLICY_VERSION = "wutai-cli-policy-v0.2";
const DEFAULT_POLICY_PROFILE = "standard";
const ATTESTATION_ARTIFACT_NAME = "attestation.json";
const DEFAULT_POLICY_CONFIG_URL = new URL(
  "../config/wutai-cli-policy-profiles.json",
  import.meta.url,
);

const FALLBACK_POLICY_PROFILE_CONFIG = {
  schemaVersion: 1,
  kind: "wutai.cli_policy_profile_config",
  defaultProfile: DEFAULT_POLICY_PROFILE,
  profiles: {
    standard: {
      profileId: "standard",
      name: "Standard",
      description: "Deny high-risk rules and record medium-risk rules as warnings.",
      warningAction: "warn",
    },
    strict: {
      profileId: "strict",
      name: "Strict",
      description: "Deny high-risk rules and escalate medium-risk warning rules to deny.",
      warningAction: "deny",
    },
  },
};

function usage() {
  return `Usage:
  npm run wutai:run -- [options] -- <command> [args...]

Options:
  --output-dir <path>   Directory for generated work packets. Default: artifacts/cli
  --cwd <path>          Working directory for the wrapped command. Default: current directory
  --title <text>        Packet title
  --policy-config <path>
                       JSON profile config. Default: config/wutai-cli-policy-profiles.json
  --policy-profile <id>
                       Policy profile id from the config. Default: config default
  --dry-run            Generate a review packet without executing the command
  --allow-high-risk     Execute even when policy preflight matches high-risk rules
  --override-reason <text>
                       Optional reason recorded when --allow-high-risk is used
  --signing-key <path>
                       Optional EC P-256 private key PEM used to sign manifest.json
  --quiet               Do not mirror child stdout/stderr while running
  --help                Show this message

Boundary:
  This developer wrapper executes the requested command and records a work
  packet. It does not sandbox the process, mediate credentials, or enforce a
  full permission broker. Policy preflight is structured and incomplete.`;
}

function parseArgs(argv) {
  const separatorIndex = argv.indexOf("--");
  const optionArgs = separatorIndex === -1 ? argv : argv.slice(0, separatorIndex);
  const command = separatorIndex === -1 ? [] : argv.slice(separatorIndex + 1);
  const options = {
    outputDir: "artifacts/cli",
    cwd: process.cwd(),
    title: null,
    policyConfig: null,
    policyProfile: null,
    dryRun: false,
    allowHighRisk: false,
    overrideReason: null,
    signingKey: null,
    quiet: false,
    help: false,
  };

  for (let index = 0; index < optionArgs.length; index += 1) {
    const arg = optionArgs[index];
    if (arg === "--help") {
      options.help = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--allow-high-risk") {
      options.allowHighRisk = true;
    } else if (arg === "--policy-profile") {
      index += 1;
      if (!optionArgs[index]) throw new Error("--policy-profile requires a value.");
      options.policyProfile = optionArgs[index];
    } else if (arg === "--policy-config") {
      index += 1;
      if (!optionArgs[index]) throw new Error("--policy-config requires a value.");
      options.policyConfig = optionArgs[index];
    } else if (arg === "--override-reason") {
      index += 1;
      if (!optionArgs[index]) throw new Error("--override-reason requires a value.");
      options.overrideReason = optionArgs[index];
    } else if (arg === "--signing-key") {
      index += 1;
      if (!optionArgs[index]) throw new Error("--signing-key requires a value.");
      options.signingKey = optionArgs[index];
    } else if (arg === "--quiet") {
      options.quiet = true;
    } else if (arg === "--output-dir") {
      index += 1;
      if (!optionArgs[index]) throw new Error("--output-dir requires a value.");
      options.outputDir = optionArgs[index];
    } else if (arg === "--cwd") {
      index += 1;
      if (!optionArgs[index]) throw new Error("--cwd requires a value.");
      options.cwd = optionArgs[index];
    } else if (arg === "--title") {
      index += 1;
      if (!optionArgs[index]) throw new Error("--title requires a value.");
      options.title = optionArgs[index];
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return { options, command };
}

function normalizePolicyConfig(raw, sourcePath) {
  if (!raw || typeof raw !== "object") {
    throw new Error(`Policy config ${sourcePath} must be a JSON object.`);
  }
  if (raw.kind && raw.kind !== "wutai.cli_policy_profile_config") {
    throw new Error(
      `Policy config ${sourcePath} has unsupported kind: ${raw.kind}.`,
    );
  }
  if (!raw.profiles || typeof raw.profiles !== "object" || Array.isArray(raw.profiles)) {
    throw new Error(`Policy config ${sourcePath} must define a profiles object.`);
  }

  const profiles = {};
  for (const [profileId, profile] of Object.entries(raw.profiles)) {
    if (!profile || typeof profile !== "object") {
      throw new Error(`Policy profile ${profileId} in ${sourcePath} must be an object.`);
    }
    if (!["warn", "deny"].includes(profile.warningAction)) {
      throw new Error(
        `Policy profile ${profileId} in ${sourcePath} must set warningAction to warn or deny.`,
      );
    }
    profiles[profileId] = {
      profileId: profile.profileId ?? profileId,
      name: profile.name ?? profileId,
      description: profile.description ?? "No profile description provided.",
      warningAction: profile.warningAction,
    };
  }

  const defaultProfile = raw.defaultProfile ?? DEFAULT_POLICY_PROFILE;
  if (!profiles[defaultProfile]) {
    throw new Error(
      `Policy config ${sourcePath} defaultProfile ${defaultProfile} is not defined.`,
    );
  }

  return {
    schemaVersion: raw.schemaVersion ?? 1,
    kind: "wutai.cli_policy_profile_config",
    sourcePath,
    defaultProfile,
    profiles,
  };
}

async function loadPolicyConfig(configPath) {
  const sourcePath = configPath
    ? resolve(configPath)
    : fileURLToPath(DEFAULT_POLICY_CONFIG_URL);

  let content;
  try {
    content = await readFile(sourcePath, "utf8");
  } catch (error) {
    const missingDefault =
      !configPath &&
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT";
    if (missingDefault) {
      return normalizePolicyConfig(FALLBACK_POLICY_PROFILE_CONFIG, "built-in fallback");
    }
    throw new Error(
      `Could not load policy config ${sourcePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  try {
    return normalizePolicyConfig(JSON.parse(content), sourcePath);
  } catch (error) {
    throw new Error(
      `Could not parse policy config ${sourcePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function appendBounded(current, chunk) {
  const next = current + chunk;
  if (next.length <= MAX_CAPTURE_CHARS) return next;
  return next.slice(next.length - MAX_CAPTURE_CHARS);
}

function summarize(output) {
  const compact = output.trim();
  if (!compact) return "No output captured.";
  if (compact.length <= MAX_SUMMARY_CHARS) return compact;
  return `${compact.slice(0, MAX_SUMMARY_CHARS)}\n[truncated]`;
}

function quoteArg(arg) {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(arg)) return arg;
  return JSON.stringify(arg);
}

function commandLine(command) {
  return command.map(quoteArg).join(" ");
}

function commandName(command) {
  return (command[0]?.split(/[\\/]/).pop() ?? "").toLowerCase();
}

function hasRecursiveFlag(args) {
  return args.some(
    (arg) =>
      arg === "--recursive" ||
      arg === "-r" ||
      arg === "-R" ||
      /^-[A-Za-z]*[rR][A-Za-z]*$/.test(arg),
  );
}

function hasForceFlag(args) {
  return args.some(
    (arg) =>
      arg === "--force" ||
      arg === "-f" ||
      /^-[A-Za-z]*f[A-Za-z]*$/.test(arg),
  );
}

function hasAnyArg(args, candidates) {
  return args.some((arg) => candidates.includes(arg));
}

function hasInspectFlag(args) {
  return args.some((arg) => arg === "--inspect" || arg.startsWith("--inspect="));
}

const POLICY_RULES = [
  {
    ruleId: "shell_interpreter_command_string",
    category: "shell_boundary",
    severity: "high",
    defaultAction: "deny",
    overrideable: true,
    message:
      "Shell interpreter with -c can reintroduce shell expansion outside Wutai's argv boundary.",
    reviewScope: [
      "shell expansion",
      "argument boundary",
      "filesystem and environment access inherited from the shell",
    ],
    matches: ({ name, args }) =>
      ["sh", "bash", "zsh", "fish", "dash"].includes(name) && args.includes("-c"),
  },
  {
    ruleId: "privilege_escalation",
    category: "privilege_boundary",
    severity: "high",
    defaultAction: "deny",
    overrideable: true,
    message: "Privilege escalation commands are high risk for a local wrapper.",
    reviewScope: ["administrator privileges", "system configuration"],
    matches: ({ name }) => ["sudo", "su", "doas"].includes(name),
  },
  {
    ruleId: "destructive_remove",
    category: "filesystem_write",
    severity: "high",
    defaultAction: "deny",
    overrideable: true,
    message: "Recursive or forced remove commands can destroy local data.",
    reviewScope: ["recursive filesystem deletion", "workspace data loss"],
    matches: ({ name, args }) =>
      name === "rm" && (hasRecursiveFlag(args) || hasForceFlag(args)),
  },
  {
    ruleId: "destructive_git_operation",
    category: "source_control",
    severity: "high",
    defaultAction: "deny",
    overrideable: true,
    message: "This git command can discard local work or delete refs.",
    reviewScope: ["uncommitted work", "git refs", "repository history"],
    matches: ({ name, args }) =>
      name === "git" &&
      ((args[0] === "reset" && args.includes("--hard")) ||
        (args[0] === "clean" && hasForceFlag(args)) ||
        (args[0] === "branch" && args.includes("-D"))),
  },
  {
    ruleId: "recursive_permission_change",
    category: "filesystem_permissions",
    severity: "high",
    defaultAction: "deny",
    overrideable: true,
    message: "Recursive ownership or permission changes can damage a workspace.",
    reviewScope: ["file ownership", "file permissions", "recursive workspace writes"],
    matches: ({ name, args }) =>
      ["chmod", "chown", "chgrp"].includes(name) &&
      (hasRecursiveFlag(args) || hasAnyArg(args, ["-R"])),
  },
  {
    ruleId: "environment_dump",
    category: "credential_exposure",
    severity: "high",
    defaultAction: "deny",
    overrideable: true,
    message: "Environment dump commands can expose provider keys or local secrets.",
    reviewScope: ["environment variables", "credential exposure", "stdout artifact capture"],
    matches: ({ name }) => ["env", "printenv"].includes(name),
  },
  {
    ruleId: "network_listener",
    category: "network_boundary",
    severity: "medium",
    defaultAction: "warn",
    overrideable: false,
    message: "Starting a local network listener requires review.",
    reviewScope: ["local network listener", "port exposure"],
    matches: ({ name, args }) =>
      ((name === "python" || name === "python3") &&
        args[0] === "-m" &&
        args[1] === "http.server") ||
      (["node", "nodejs"].includes(name) && hasInspectFlag(args)),
  },
  {
    ruleId: "dependency_install_or_update",
    category: "dependency_mutation",
    severity: "medium",
    defaultAction: "warn",
    overrideable: false,
    message: "Dependency installation or update can modify local code or tools.",
    reviewScope: ["dependency tree", "lockfiles", "local toolchain"],
    matches: ({ name, args }) =>
      ["npm", "pnpm", "yarn", "pip", "pip3", "brew", "cargo"].includes(name) &&
      hasAnyArg(args, ["install", "add", "update", "upgrade"]),
  },
];

function severityRank(severity) {
  if (severity === "high") return 3;
  if (severity === "medium") return 2;
  if (severity === "low") return 1;
  return 0;
}

function highestSeverity(matchedRules) {
  return matchedRules.reduce(
    (highest, rule) =>
      severityRank(rule.severity) > severityRank(highest) ? rule.severity : highest,
    "low",
  );
}

function countBy(items, key) {
  return items.reduce((counts, item) => {
    const value = item[key] ?? "unknown";
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function unique(items) {
  return [...new Set(items)];
}

function policyProfile(profileId, policyConfig) {
  const profile = policyConfig.profiles[profileId];
  if (!profile) {
    throw new Error(
      `Unknown policy profile: ${profileId}. Expected one of ${Object.keys(policyConfig.profiles).join(", ")}.`,
    );
  }
  return profile;
}

function profileRule(rule, profile) {
  const effectiveAction =
    rule.defaultAction === "warn" && profile.warningAction === "deny"
      ? "deny"
      : rule.defaultAction;

  return {
    ...rule,
    effectiveAction,
    profileEscalated: effectiveAction !== rule.defaultAction,
  };
}

function assessPolicy(command, { allowHighRisk, overrideReason, profileId, policyConfig }) {
  const name = commandName(command);
  const args = command.slice(1);
  const context = { command, name, args };
  const profile = policyProfile(profileId, policyConfig);
  const matchedRules = POLICY_RULES.filter((rule) => rule.matches(context)).map(
    ({ matches, ...rule }) => profileRule(rule, profile),
  );
  const denyRules = matchedRules.filter((rule) => rule.effectiveAction === "deny");
  const warningRules = matchedRules.filter((rule) => rule.effectiveAction === "warn");
  const overrideableDenyRules = denyRules.filter((rule) => rule.overrideable);
  const blockingDenyRules = denyRules.filter(
    (rule) => !allowHighRisk || !rule.overrideable,
  );
  const decision =
    blockingDenyRules.length > 0
      ? "deny"
      : allowHighRisk && overrideableDenyRules.length > 0
        ? "allow_with_override"
        : warningRules.length > 0
          ? "allow_with_warnings"
          : "allow";
  const reviewScope = unique(matchedRules.flatMap((rule) => rule.reviewScope));
  const riskProfile = {
    matchedRuleCount: matchedRules.length,
    severityCounts: countBy(matchedRules, "severity"),
    defaultActionCounts: countBy(matchedRules, "defaultAction"),
    actionCounts: countBy(matchedRules, "effectiveAction"),
    highestSeverity: highestSeverity(matchedRules),
  };
  const decisionRationale =
    decision === "deny"
      ? [
          `Denied because ${blockingDenyRules.length} matched rule requires pre-execution review.`,
          "Use --allow-high-risk only when the caller intentionally accepts the recorded boundary.",
        ]
      : decision === "allow_with_override"
        ? [
            `Allowed because --allow-high-risk overrode ${overrideableDenyRules.length} high-risk rule.`,
            "The override is recorded in policy.json and audit.json.",
          ]
        : warningRules.length > 0
          ? [
              `Allowed with warnings because ${warningRules.length} review rule matched.`,
              "The command still runs with the invoking shell's ambient permissions.",
            ]
          : ["Allowed because no policy rules matched this invocation."];

  return {
    schemaVersion: 2,
    kind: "wutai.cli_policy_preflight",
    policyVersion: POLICY_VERSION,
    profile: {
      profileId: profile.profileId,
      name: profile.name,
      description: profile.description,
    },
    policyConfig: {
      schemaVersion: policyConfig.schemaVersion,
      sourcePath: policyConfig.sourcePath,
      defaultProfile: policyConfig.defaultProfile,
      profileCount: Object.keys(policyConfig.profiles).length,
    },
    engine: {
      name: "wutai_cli_policy",
      version: "0.2",
      ruleCount: POLICY_RULES.length,
    },
    decision,
    highestSeverity: riskProfile.highestSeverity,
    allowHighRisk,
    override: {
      requested: allowHighRisk,
      applied: decision === "allow_with_override",
      reason: overrideReason ?? null,
      appliedRuleIds:
        decision === "allow_with_override"
          ? overrideableDenyRules.map((rule) => rule.ruleId)
          : [],
    },
    matchedRules,
    riskProfile,
    decisionRationale,
    reviewScope,
    summary:
      decision === "deny"
        ? "Policy preflight denied execution before the command ran."
        : matchedRules.length
          ? "Policy preflight allowed execution with warnings."
          : "Policy preflight allowed execution with no matched risk rules.",
    limitation:
      "This structured rule set is intentionally incomplete and is not a sandbox, credential broker, filesystem policy, or complete shell safety policy.",
  };
}

function sha256Hex(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

async function buildPacketAttestation({
  taskId,
  generatedAt,
  manifest,
  manifestContent,
  signingKeyPath,
}) {
  const resolvedKeyPath = resolve(signingKeyPath);
  const privateKey = createPrivateKey(await readFile(resolvedKeyPath, "utf8"));
  const namedCurve = privateKey.asymmetricKeyDetails?.namedCurve;
  if (
    privateKey.asymmetricKeyType !== "ec" ||
    !["prime256v1", "P-256"].includes(namedCurve)
  ) {
    throw new Error(
      "--signing-key must point to an EC P-256 private key PEM.",
    );
  }

  const publicKey = createPublicKey(privateKey);
  const publicKeyPem = String(
    publicKey.export({ type: "spki", format: "pem" }),
  );
  const signature = signData("sha256", Buffer.from(manifestContent, "utf8"), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  });

  return {
    schemaVersion: 1,
    kind: "wutai.packet_attestation",
    taskId,
    generatedAt,
    subject: {
      manifestSha256: sha256Hex(manifestContent),
      manifestBytes: Buffer.byteLength(manifestContent, "utf8"),
      packetId: manifest.packetId,
      packetType: manifest.packetType,
      producerAdapter: manifest.producer?.adapter,
    },
    signature: {
      algorithm: "ECDSA_P256_SHA256",
      publicKeyPem,
      publicKeySha256: sha256Hex(publicKeyPem),
      signatureBase64: signature.toString("base64"),
    },
    trust: {
      trustedKey: false,
      note:
        "Signature validates the manifest against the included public key only; Wutai has no trusted key registry yet.",
    },
    limitation:
      "This attestation detects manifest changes after signing. It does not prove the private key owner is trusted, protect the signing key, or sandbox the command.",
  };
}

function gitStatus(cwd) {
  const result = spawnSync("git", ["status", "--porcelain"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0) return [];
  return result.stdout
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);
}

function statusPath(line) {
  const pathPart = line.slice(3);
  const renameParts = pathPart.split(" -> ");
  return renameParts[renameParts.length - 1] ?? pathPart;
}

function statusDelta(before, after) {
  const beforeSet = new Set(before);
  return after
    .filter((line) => !beforeSet.has(line))
    .map(statusPath)
    .sort();
}

function event(taskId, index, timestamp, type, summary, details, visibility) {
  return {
    eventId: `${taskId}_event_${index}`,
    taskId,
    timestamp,
    type,
    summary,
    ...(details ? { details } : {}),
    visibility,
  };
}

function artifact(taskId, name, type, content, createdAt) {
  return {
    artifactId: `${taskId}_artifact_${name.replace(/[^a-z0-9]+/gi, "_")}`,
    taskId,
    type,
    name,
    virtualPath: `artifacts/${taskId}/${name}`,
    content,
    createdAt,
  };
}

function artifactRole(name) {
  if (name === "report.md") return "primary_artifact";
  if (name === "policy.json") return "policy_preflight";
  if (name === "trace.json") return "runtime_trace";
  if (name === "ledger.json") return "session_ledger";
  if (name === "audit.json") return "audit_trail";
  return "supporting_artifact";
}

function buildManifest({
  task,
  artifacts,
  createdAt,
  policy,
  command,
  commandCwd,
  startedAt,
  completedAt,
  exitCode,
  executionMode,
}) {
  const producer = {
    name: "wutai",
    adapter: "wutaiRunCli",
    runtime: "node child_process spawn",
  };
  const eventTypeCounts = task.events.reduce((counts, item) => {
    counts[item.type] = (counts[item.type] ?? 0) + 1;
    return counts;
  }, {});

  return {
    schemaVersion: 2,
    kind: "wutai.work_packet_manifest",
    packetId: `${task.taskId}_work_packet`,
    packetType: "local_script",
    taskId: task.taskId,
    sessionId: task.taskId,
    session: {
      sessionId: task.taskId,
      subject: task.title,
      command,
      workingDirectory: commandCwd,
      startedAt,
      completedAt,
      exitCode,
      importedTrace: false,
      executionMode,
      dryRun: executionMode === "dry_run",
    },
    title: task.title,
    status: task.status,
    userRequest: task.userRequest,
    generatedAt: createdAt,
    producer,
    permissions: task.permissions.map((permission) => ({
      requestId: permission.requestId,
      status: permission.status,
      types: permission.types,
      scope: permission.scope,
      createdAt: permission.createdAt,
      resolvedAt: permission.resolvedAt,
    })),
    audit: {
      eventCount: task.events.length,
      eventTypeCounts,
      permissionDecisionCount: task.permissions.filter(
        (permission) => permission.status !== "pending",
      ).length,
      toolCallCount: eventTypeCounts.ToolCallCaptured ?? 0,
      runtimeEventCount: eventTypeCounts.RuntimeEventCaptured ?? 0,
      credentialPurposes: [],
      auditArtifacts: ["policy.json", "ledger.json", "audit.json"],
      policyDecision: policy.decision,
      policyProfile: policy.profile.profileId,
      executionMode,
    },
    artifacts: artifacts.map((item) => ({
      artifactId: item.artifactId,
      name: item.name,
      role: artifactRole(item.name),
      type: item.type,
      virtualPath: item.virtualPath,
      createdAt: item.createdAt,
      producer,
      bytes: Buffer.byteLength(item.content, "utf8"),
      sha256: sha256Hex(item.content),
    })),
    evidence: {
      status: "not_available",
      readyForTrust: false,
      summary: "No Evidence Gate verification was run for this local-script packet.",
      claimsArtifact: null,
      sourcesArtifact: null,
      unsupportedItems: [
        "The wrapper records process metadata and bounded output; it does not prove the command was safe.",
        "Policy preflight uses a structured but incomplete rule catalog; it is not a complete shell safety policy.",
      ],
      blindSpots: [
        "No process sandbox, filesystem policy, network policy, or credential mediation is active.",
      ],
    },
    coverage: {
      captured: [
        "command_invocation",
        "working_directory",
        "exit_code",
        "bounded_stdout",
        "bounded_stderr",
        "git_status_delta",
        "policy_preflight",
        "permission_record",
        "session_ledger",
        "audit_trail",
        "artifact_hashes",
        ...(executionMode === "dry_run" ? ["dry_run_review"] : []),
      ],
      blindSpots: [
        "The child process runs with the ambient permissions of the invoking shell.",
        "Filesystem changes are approximated from git status before and after command execution.",
        "Commands can read environment variables available to the invoking process.",
        "Stdout and stderr are bounded summaries, not guaranteed complete logs.",
      ],
      enforcement: [
        "The wrapper avoids shell expansion by spawning argv directly.",
        "Structured policy preflight denies matched high-risk commands unless --allow-high-risk is supplied.",
        "Dry-run mode generates a review packet without executing the command.",
        "The explicit CLI invocation and policy decision are recorded as the approval boundary.",
        "No sandbox, credential broker, or complete destructive-command policy is implemented.",
      ],
    },
    humanReview: {
      attestation: "not_recorded",
      note: "Wutai prepared the review surface; no named human attestation is recorded in this packet.",
    },
  };
}

function buildReport({
  task,
  policy,
  command,
  commandCwd,
  startedAt,
  completedAt,
  exitCode,
  stdoutSummary,
  stderrSummary,
  touchedFiles,
  executionMode,
}) {
  return `# Wutai CLI Run Packet

## Command

\`${command}\`

## Policy Preflight

- Decision: ${policy.decision}
- Policy profile: ${policy.profile.profileId}
- Execution mode: ${executionMode}
- Highest severity: ${policy.highestSeverity}
- Matched rules: ${policy.matchedRules.length ? policy.matchedRules.map((rule) => rule.ruleId).join(", ") : "none"}
- Review scope: ${policy.reviewScope.length ? policy.reviewScope.join(", ") : "none"}
- Rationale: ${policy.decisionRationale.join(" ")}

## Result

- Working directory: \`${commandCwd}\`
- Exit code: ${exitCode ?? "not executed"}
- Started: ${startedAt}
- Completed: ${completedAt}

## Captured Output

- stdout summary: ${stdoutSummary}
- stderr summary: ${stderrSummary}
- changed files from git status delta: ${touchedFiles.length ? touchedFiles.join(", ") : "none detected"}

## Boundary

This packet was created by the Wutai development CLI wrapper. The wrapper ran
or denied the requested argv, or generated a dry-run review, according to a
structured but incomplete policy preflight. It did not sandbox the process,
mediate credentials, block filesystem or network access, or enforce a complete
destructive-command policy.

## Task

${task.userRequest}
`;
}

async function runChild(command, cwd, quiet) {
  const startedAt = new Date().toISOString();
  let stdout = "";
  let stderr = "";

  const child = spawn(command[0], command.slice(1), {
    cwd,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    stdout = appendBounded(stdout, text);
    if (!quiet) process.stdout.write(text);
  });
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    stderr = appendBounded(stderr, text);
    if (!quiet) process.stderr.write(text);
  });

  const exitCode = await new Promise((resolveExit) => {
    child.on("error", (error) => {
      stderr = appendBounded(stderr, `${error.message}\n`);
      resolveExit(127);
    });
    child.on("close", (code, signal) => {
      if (signal) {
        stderr = appendBounded(stderr, `Process terminated by signal ${signal}.\n`);
      }
      resolveExit(code ?? 1);
    });
  });
  const completedAt = new Date().toISOString();

  return { startedAt, completedAt, exitCode, stdout, stderr };
}

async function main() {
  const { options, command } = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return 0;
  }
  if (command.length === 0) {
    console.error(usage());
    return 2;
  }

  const commandCwd = resolve(options.cwd);
  const outputRoot = resolve(options.outputDir);
  const commandText = commandLine(command);
  const policyConfig = await loadPolicyConfig(options.policyConfig);
  const profileId = options.policyProfile ?? policyConfig.defaultProfile;
  const policy = assessPolicy(command, {
    allowHighRisk: options.allowHighRisk,
    overrideReason: options.overrideReason,
    profileId,
    policyConfig,
  });
  const deniedByPolicy = policy.decision === "deny";
  const executionMode = options.dryRun ? "dry_run" : "execute";
  let touchedFiles = [];
  let run;
  if (options.dryRun) {
    const reviewedAt = new Date().toISOString();
    run = {
      startedAt: reviewedAt,
      completedAt: reviewedAt,
      exitCode: null,
      stdout: "",
      stderr: "Dry-run review completed. Command was not executed.",
    };
    if (!options.quiet) {
      console.error("Dry-run review completed. Command was not executed.");
      console.error(policy.summary);
    }
  } else if (deniedByPolicy) {
    const deniedAt = new Date().toISOString();
    run = {
      startedAt: deniedAt,
      completedAt: deniedAt,
      exitCode: POLICY_DENIED_EXIT_CODE,
      stdout: "",
      stderr: policy.summary,
    };
    if (!options.quiet) {
      console.error(policy.summary);
      for (const rule of policy.matchedRules) {
        console.error(
          `- ${rule.ruleId} [${rule.severity}/${rule.defaultAction}]: ${rule.message}`,
        );
      }
      console.error("Re-run with --allow-high-risk to override this preflight.");
    }
  } else {
    const beforeStatus = gitStatus(commandCwd);
    run = await runChild(command, commandCwd, options.quiet);
    const afterStatus = gitStatus(commandCwd);
    touchedFiles = statusDelta(beforeStatus, afterStatus);
  }
  const generatedAt = new Date().toISOString();
  const taskId = `cli_${Date.now().toString(36)}`;
  const policyRecord = {
    ...policy,
    taskId,
    generatedAt,
    command: commandText,
    argv: command,
    workingDirectory: commandCwd,
    executionMode,
    dryRun: options.dryRun,
  };
  const status = options.dryRun
    ? "completed_with_warnings"
    : deniedByPolicy
    ? "cancelled"
    : run.exitCode === 0
      ? "completed"
      : "failed";
  const permission = {
    requestId: `${taskId}_permission_local_script_execution`,
    taskId,
    status: options.dryRun ? "pending" : deniedByPolicy ? "denied" : "approved",
    types: ["local_script_execution"],
    scope: [
      options.dryRun
        ? "Review the requested argv through the Wutai developer CLI wrapper without execution"
        : "Run the requested argv through the Wutai developer CLI wrapper",
      "Apply structured policy preflight before execution",
      `Policy profile: ${policy.profile.profileId}`,
      "Capture bounded stdout and stderr summaries",
      "No shell expansion",
      "No sandboxing",
      "No credential mediation",
    ],
    createdAt: run.startedAt,
    ...(options.dryRun ? {} : { resolvedAt: run.startedAt }),
  };
  const artifactPermission = {
    requestId: `${taskId}_permission_artifact_write`,
    taskId,
    status: "approved",
    types: ["artifact_write"],
    scope: [
      "Write a new local work packet",
      "Write policy, trace, ledger, audit, report, manifest, and optional attestation artifacts",
      "Do not modify existing work packets",
    ],
    createdAt: run.startedAt,
    resolvedAt: run.startedAt,
  };
  const stdoutSummary = summarize(run.stdout);
  const stderrSummary = summarize(run.stderr);
  const events = [
    event(taskId, 1, run.startedAt, "TaskStarted", "Started Wutai CLI wrapper session.", null, "user"),
    event(taskId, 2, run.startedAt, "PermissionRequested", "Declared local-script execution and policy boundary.", permission.scope.join("; "), "user"),
  ];
  if (options.dryRun) {
    events.push(
      event(
        taskId,
        3,
        run.startedAt,
        "HumanConfirmationNeeded",
        "Dry-run policy review completed; execution is still pending.",
        policyRecord.summary,
        "user",
      ),
    );
  } else {
    events.push(
      event(
        taskId,
        3,
        run.startedAt,
        "PermissionResolved",
        deniedByPolicy
          ? "Policy preflight denied this invocation before execution."
          : "Policy preflight allowed this invocation.",
        policyRecord.summary,
        "user",
      ),
    );
  }
  if (!deniedByPolicy && !options.dryRun) {
    events.push(
      event(taskId, 4, run.startedAt, "ToolCallCaptured", `Started command: ${commandText}`, `Working directory: ${commandCwd}`, "expert"),
      event(taskId, 5, run.completedAt, "RuntimeEventCaptured", `Command exited with code ${run.exitCode}.`, stdoutSummary, "user"),
    );
  }
  events.push(
    event(
      taskId,
      events.length + 1,
      generatedAt,
      "ArtifactCreated",
      options.signingKey
        ? "Saved manifest, report, policy, trace, ledger, audit, and attestation artifacts."
        : "Saved manifest, report, policy, trace, ledger, and audit artifacts.",
      null,
      "user",
    ),
    event(
      taskId,
      events.length + 2,
      generatedAt,
      options.dryRun || (!deniedByPolicy && run.exitCode === 0)
        ? "TaskCompleted"
        : "TaskFailed",
      options.dryRun
        ? "Wutai CLI wrapper dry-run review completed."
        : deniedByPolicy
        ? "Wutai CLI wrapper session blocked by policy preflight."
        : run.exitCode === 0
          ? "Wutai CLI wrapper session completed."
          : "Wutai CLI wrapper session failed.",
      deniedByPolicy ? policyRecord.summary : stderrSummary,
      "user",
    ),
  );
  const task = {
    taskId,
    title:
      options.title ??
      `${options.dryRun ? "CLI dry-run review" : "CLI run"}: ${commandText}`,
    userRequest: options.dryRun
      ? `Review local command without execution: ${commandText}`
      : `Run and record local command: ${commandText}`,
    status,
    plan: [
      "Run policy preflight for the explicit CLI invocation.",
      options.dryRun
        ? "Generate a dry-run review packet without spawning the command."
        : "Run the command with argv-based process spawning if policy allows it.",
      options.dryRun
        ? "Record policy profile, decision, review scope, and pending execution boundary."
        : "Capture bounded stdout, stderr, exit code, and git status delta.",
      options.signingKey
        ? "Save manifest, report, policy, trace, ledger, audit, and attestation artifacts."
        : "Save manifest, report, policy, trace, ledger, and audit artifacts.",
    ],
    createdAt: run.startedAt,
    updatedAt: generatedAt,
    events,
    permissions: [permission, artifactPermission],
    sources: [],
    artifacts: [],
  };

  const trace = {
    schemaVersion: 1,
    kind: "wutai.local_script_trace",
    taskId,
    generatedAt,
    captureMode: "cli_wrapper",
    command: commandText,
    argv: command,
    workingDirectory: commandCwd,
    dryRun: options.dryRun,
    executed: !deniedByPolicy && !options.dryRun,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    exitCode: run.exitCode,
    stdoutSummary,
    stderrSummary,
    touchedFiles,
    producedArtifacts: [],
  };
  const ledger = {
    schemaVersion: 1,
    kind: "wutai.session_ledger",
    task,
    generatedAt,
  };
  const audit = {
    schemaVersion: 1,
    kind: "wutai.session_audit",
    taskId,
    generatedAt,
    permissions: [permission, artifactPermission],
    policy: policyRecord,
    events,
    executionMode,
    toolCalls: deniedByPolicy || options.dryRun
      ? []
      : [
          {
            toolCallId: `${taskId}_tool_1`,
            kind: "local_command",
            command: commandText,
            argv: command,
            workingDirectory: commandCwd,
            startedAt: run.startedAt,
            completedAt: run.completedAt,
            exitCode: run.exitCode,
            captureMode: "cli_wrapper",
          },
        ],
    runtimeEvents: deniedByPolicy || options.dryRun
      ? []
      : [
          {
            runtimeEventId: `${taskId}_runtime_1`,
            type: "process_exit",
            timestamp: run.completedAt,
            exitCode: run.exitCode,
            stdoutSummary,
            stderrSummary,
          },
        ],
    credentialGrants: [],
  };
  const artifacts = [
    artifact(taskId, "report.md", "markdown", buildReport({
      task,
      policy: policyRecord,
      command: commandText,
      commandCwd,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      exitCode: run.exitCode,
      stdoutSummary,
      stderrSummary,
      touchedFiles,
      executionMode,
    }), generatedAt),
    artifact(taskId, "policy.json", "json", JSON.stringify(policyRecord, null, 2), generatedAt),
    artifact(taskId, "trace.json", "json", JSON.stringify(trace, null, 2), generatedAt),
    artifact(taskId, "ledger.json", "json", JSON.stringify(ledger, null, 2), generatedAt),
    artifact(taskId, "audit.json", "json", JSON.stringify(audit, null, 2), generatedAt),
  ];
  const manifest = buildManifest({
    task,
    artifacts,
    createdAt: generatedAt,
    policy: policyRecord,
    command: commandText,
    commandCwd,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    exitCode: run.exitCode,
    executionMode,
  });
  const manifestArtifact = artifact(
    taskId,
    "manifest.json",
    "json",
    JSON.stringify(manifest, null, 2),
    generatedAt,
  );
  const attestationArtifact = options.signingKey
    ? artifact(
        taskId,
        ATTESTATION_ARTIFACT_NAME,
        "json",
        JSON.stringify(
          await buildPacketAttestation({
            taskId,
            generatedAt,
            manifest,
            manifestContent: manifestArtifact.content,
            signingKeyPath: options.signingKey,
          }),
          null,
          2,
        ),
        generatedAt,
      )
    : null;
  const packetDir = join(outputRoot, taskId);
  await mkdir(packetDir, { recursive: true });
  for (const item of [
    ...artifacts,
    manifestArtifact,
    ...(attestationArtifact ? [attestationArtifact] : []),
  ]) {
    await writeFile(join(packetDir, item.name), item.content, "utf8");
  }

  if (!options.quiet) {
    console.error(`\nWutai work packet: ${packetDir}`);
    console.error(`Manifest: ${join(packetDir, "manifest.json")}`);
    if (attestationArtifact) {
      console.error(`Attestation: ${join(packetDir, ATTESTATION_ARTIFACT_NAME)}`);
    }
  }

  return options.dryRun ? 0 : run.exitCode;
}

main()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });

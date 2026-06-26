#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import process from "node:process";

const MAX_CAPTURE_CHARS = 16_000;
const MAX_SUMMARY_CHARS = 2_000;

function usage() {
  return `Usage:
  npm run wutai:run -- [options] -- <command> [args...]

Options:
  --output-dir <path>   Directory for generated work packets. Default: artifacts/cli
  --cwd <path>          Working directory for the wrapped command. Default: current directory
  --title <text>        Packet title
  --quiet               Do not mirror child stdout/stderr while running
  --help                Show this message

Boundary:
  This developer wrapper executes the requested command and records a work
  packet. It does not sandbox the process, mediate credentials, or enforce a
  full permission broker.`;
}

function parseArgs(argv) {
  const separatorIndex = argv.indexOf("--");
  const optionArgs = separatorIndex === -1 ? argv : argv.slice(0, separatorIndex);
  const command = separatorIndex === -1 ? [] : argv.slice(separatorIndex + 1);
  const options = {
    outputDir: "artifacts/cli",
    cwd: process.cwd(),
    title: null,
    quiet: false,
    help: false,
  };

  for (let index = 0; index < optionArgs.length; index += 1) {
    const arg = optionArgs[index];
    if (arg === "--help") {
      options.help = true;
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

function sha256Hex(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
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
  if (name === "trace.json") return "runtime_trace";
  if (name === "ledger.json") return "session_ledger";
  if (name === "audit.json") return "audit_trail";
  return "supporting_artifact";
}

function buildManifest({
  task,
  artifacts,
  createdAt,
  command,
  commandCwd,
  startedAt,
  completedAt,
  exitCode,
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
      permissionDecisionCount: 1,
      toolCallCount: 1,
      runtimeEventCount: 1,
      credentialPurposes: [],
      auditArtifacts: ["ledger.json", "audit.json"],
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
        "permission_record",
        "session_ledger",
        "audit_trail",
        "artifact_hashes",
      ],
      blindSpots: [
        "The child process runs with the ambient permissions of the invoking shell.",
        "Filesystem changes are approximated from git status before and after command execution.",
        "Commands can read environment variables available to the invoking process.",
        "Stdout and stderr are bounded summaries, not guaranteed complete logs.",
      ],
      enforcement: [
        "The wrapper avoids shell expansion by spawning argv directly.",
        "The explicit CLI invocation is recorded as the approval boundary.",
        "No policy engine, sandbox, credential broker, or destructive-command blocker is implemented.",
      ],
    },
    humanReview: {
      attestation: "not_recorded",
      note: "Wutai prepared the review surface; no named human attestation is recorded in this packet.",
    },
  };
}

function buildReport({ task, command, commandCwd, startedAt, completedAt, exitCode, stdoutSummary, stderrSummary, touchedFiles }) {
  return `# Wutai CLI Run Packet

## Command

\`${command}\`

## Result

- Working directory: \`${commandCwd}\`
- Exit code: ${exitCode}
- Started: ${startedAt}
- Completed: ${completedAt}

## Captured Output

- stdout summary: ${stdoutSummary}
- stderr summary: ${stderrSummary}
- changed files from git status delta: ${touchedFiles.length ? touchedFiles.join(", ") : "none detected"}

## Boundary

This packet was created by the Wutai development CLI wrapper. The wrapper ran
the requested argv directly and recorded the session. It did not sandbox the
process, mediate credentials, block filesystem or network access, or enforce a
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
  const beforeStatus = gitStatus(commandCwd);
  const run = await runChild(command, commandCwd, options.quiet);
  const afterStatus = gitStatus(commandCwd);
  const touchedFiles = statusDelta(beforeStatus, afterStatus);
  const generatedAt = new Date().toISOString();
  const taskId = `cli_${Date.now().toString(36)}`;
  const status = run.exitCode === 0 ? "completed" : "failed";
  const permission = {
    requestId: `${taskId}_permission_local_script_execution`,
    taskId,
    status: "approved",
    types: ["local_script_execution", "artifact_write"],
    scope: [
      "Run the requested argv through the Wutai developer CLI wrapper",
      "Capture bounded stdout and stderr summaries",
      "Write a new local work packet",
      "No shell expansion",
      "No sandboxing",
      "No credential mediation",
    ],
    createdAt: run.startedAt,
    resolvedAt: run.startedAt,
  };
  const stdoutSummary = summarize(run.stdout);
  const stderrSummary = summarize(run.stderr);
  const events = [
    event(taskId, 1, run.startedAt, "TaskStarted", "Started Wutai CLI wrapper session.", null, "user"),
    event(taskId, 2, run.startedAt, "PermissionRequested", "Declared local-script execution boundary.", permission.scope.join("; "), "user"),
    event(taskId, 3, run.startedAt, "PermissionResolved", "Local-script execution boundary recorded for this invocation.", null, "user"),
    event(taskId, 4, run.startedAt, "ToolCallCaptured", `Started command: ${commandText}`, `Working directory: ${commandCwd}`, "expert"),
    event(taskId, 5, run.completedAt, "RuntimeEventCaptured", `Command exited with code ${run.exitCode}.`, stdoutSummary, "user"),
    event(taskId, 6, generatedAt, "ArtifactCreated", "Saved manifest, report, trace, ledger, and audit artifacts.", null, "user"),
    event(taskId, 7, generatedAt, run.exitCode === 0 ? "TaskCompleted" : "TaskFailed", run.exitCode === 0 ? "Wutai CLI wrapper session completed." : "Wutai CLI wrapper session failed.", stderrSummary, "user"),
  ];
  const task = {
    taskId,
    title: options.title ?? `CLI run: ${commandText}`,
    userRequest: `Run and record local command: ${commandText}`,
    status,
    plan: [
      "Record the explicit CLI invocation boundary.",
      "Run the command with argv-based process spawning.",
      "Capture bounded stdout, stderr, exit code, and git status delta.",
      "Save manifest, report, trace, ledger, and audit artifacts.",
    ],
    createdAt: run.startedAt,
    updatedAt: generatedAt,
    events,
    permissions: [permission],
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
    permissions: [permission],
    events,
    toolCalls: [
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
    runtimeEvents: [
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
      command: commandText,
      commandCwd,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      exitCode: run.exitCode,
      stdoutSummary,
      stderrSummary,
      touchedFiles,
    }), generatedAt),
    artifact(taskId, "trace.json", "json", JSON.stringify(trace, null, 2), generatedAt),
    artifact(taskId, "ledger.json", "json", JSON.stringify(ledger, null, 2), generatedAt),
    artifact(taskId, "audit.json", "json", JSON.stringify(audit, null, 2), generatedAt),
  ];
  const manifest = buildManifest({
    task,
    artifacts,
    createdAt: generatedAt,
    command: commandText,
    commandCwd,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    exitCode: run.exitCode,
  });
  const manifestArtifact = artifact(
    taskId,
    "manifest.json",
    "json",
    JSON.stringify(manifest, null, 2),
    generatedAt,
  );
  const packetDir = join(outputRoot, taskId);
  await mkdir(packetDir, { recursive: true });
  for (const item of [...artifacts, manifestArtifact]) {
    await writeFile(join(packetDir, item.name), item.content, "utf8");
  }

  if (!options.quiet) {
    console.error(`\nWutai work packet: ${packetDir}`);
    console.error(`Manifest: ${join(packetDir, "manifest.json")}`);
  }

  return run.exitCode;
}

main()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });

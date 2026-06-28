#!/usr/bin/env node
import { spawn } from "node:child_process";
import process from "node:process";
import {
  createPacket,
  verifyPacket,
  writePacket,
} from "../sdk/node/index.mjs";

const MAX_CAPTURE_BYTES = 16_384;

function usage() {
  return `Usage:
  node examples/external-agent-wrapper.mjs [options] -- <command> [args...]

Options:
  --output-dir <path>          Packet output root. Default: artifacts/external-agent
  --packet-dir <path>          Exact packet directory to write.
  --trusted-producers <path>   Trusted producer policy JSON for verification.
  --trust-policy <path>        Trust verdict policy JSON for verification.
  --trust-policy-profile <id>  Trust policy profile for verification.
  --signing-key <pem>          EC P-256 private key used to sign manifest.json.
  --write-derived-artifacts    Write integrity/provenance/policy-review/trust-verdict artifacts.
  --quiet                      Do not stream child stdout/stderr while capturing.
  --help                       Show this message.

Exit codes:
  0 trusted, 10 review_required, 20 blocked, 2 usage or wrapper error.`;
}

function parseArgs(argv) {
  const options = {
    outputDir: "artifacts/external-agent",
    packetDir: null,
    trustedProducers: null,
    trustPolicy: null,
    trustPolicyProfile: null,
    signingKeyPath: null,
    writeArtifacts: false,
    quiet: false,
    help: false,
    command: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      options.command = argv.slice(index + 1);
      return options;
    }
    if (arg === "--help") {
      options.help = true;
    } else if (arg === "--quiet") {
      options.quiet = true;
    } else if (arg === "--write-derived-artifacts") {
      options.writeArtifacts = true;
    } else if (arg === "--output-dir") {
      index += 1;
      if (!argv[index]) throw new Error("--output-dir requires a value.");
      options.outputDir = argv[index];
    } else if (arg === "--packet-dir") {
      index += 1;
      if (!argv[index]) throw new Error("--packet-dir requires a value.");
      options.packetDir = argv[index];
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
    } else if (arg === "--signing-key") {
      index += 1;
      if (!argv[index]) throw new Error("--signing-key requires a value.");
      options.signingKeyPath = argv[index];
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function appendBounded(current, chunk) {
  if (current.length >= MAX_CAPTURE_BYTES) return current;
  const text = chunk.toString("utf8");
  const available = MAX_CAPTURE_BYTES - Buffer.byteLength(current, "utf8");
  if (Buffer.byteLength(text, "utf8") <= available) return current + text;
  return current + Buffer.from(text, "utf8").subarray(0, available).toString("utf8");
}

function summarizeOutput(text) {
  const normalized = text.trim();
  if (!normalized) return "No output captured.";
  const suffix =
    Buffer.byteLength(text, "utf8") >= MAX_CAPTURE_BYTES
      ? "\n[truncated by external-agent-wrapper]"
      : "";
  return `${normalized}${suffix}`;
}

function runExternalCommand(argv, { quiet }) {
  return new Promise((resolve) => {
    const startedAt = new Date().toISOString();
    const child = spawn(argv[0], argv.slice(1), {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout = appendBounded(stdout, chunk);
      if (!quiet) process.stdout.write(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = appendBounded(stderr, chunk);
      if (!quiet) process.stderr.write(chunk);
    });
    child.on("error", (error) => {
      stderr = appendBounded(stderr, Buffer.from(error.message));
      resolve({
        startedAt,
        completedAt: new Date().toISOString(),
        exitCode: 127,
        stdoutSummary: summarizeOutput(stdout),
        stderrSummary: summarizeOutput(stderr),
      });
    });
    child.on("close", (code) => {
      resolve({
        startedAt,
        completedAt: new Date().toISOString(),
        exitCode: code ?? 1,
        stdoutSummary: summarizeOutput(stdout),
        stderrSummary: summarizeOutput(stderr),
      });
    });
  });
}

function exitCodeForVerdict(verdict) {
  if (verdict === "trusted") return 0;
  if (verdict === "review_required") return 10;
  return 20;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return 0;
  }
  if (!options.command.length) {
    console.error(usage());
    return 2;
  }

  const run = await runExternalCommand(options.command, {
    quiet: options.quiet,
  });
  const packet = createPacket({
    argv: options.command,
    title: `External agent run: ${options.command[0]}`,
    userRequest:
      "Record work from an external agent adapter through the Wutai v0.4 integration contract.",
    workingDirectory: process.cwd(),
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    exitCode: run.exitCode,
    stdoutSummary: run.stdoutSummary,
    stderrSummary: run.stderrSummary,
    producer: {
      name: "wutai external-agent-wrapper example",
      adapter: "wutaiExternalAgentExample",
      runtime: "node",
    },
  });
  const written = await writePacket(packet, {
    outputDir: options.outputDir,
    packetDir: options.packetDir,
    signingKeyPath: options.signingKeyPath,
  });
  const { trustVerdict } = await verifyPacket(written.packetDir, {
    trustedProducers: options.trustedProducers,
    trustPolicy: options.trustPolicy,
    trustPolicyProfile: options.trustPolicyProfile,
    writeArtifacts: options.writeArtifacts,
  });

  console.log(
    JSON.stringify(
      {
        kind: "wutai.external_agent_wrapper_result",
        packetDir: written.packetDir,
        files: written.files,
        verdict: trustVerdict.verdict,
        trustVerdict,
      },
      null,
      2,
    ),
  );
  return exitCodeForVerdict(trustVerdict.verdict);
}

main()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });

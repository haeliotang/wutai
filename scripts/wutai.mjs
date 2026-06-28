#!/usr/bin/env node
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { runConsumerAttestationGateCli } from "./wutai_attestation_gate.mjs";
import { runVerifyPacketCli } from "./wutai_verify_packet.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));

function usage() {
  return `Usage:
  wutai verify-packet [options] <packet-dir>
  wutai attest-packet [options] <packet-dir>
  wutai run [options] -- <command> [args...]

Use "wutai verify-packet --help", "wutai attest-packet --help", or "wutai run --help" for command-specific options.`;
}

function runNodeScript(scriptName, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(scriptDir, scriptName), ...args], {
      stdio: "inherit",
    });
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(2));
  });
}

async function main(argv = process.argv.slice(2)) {
  const [command, ...args] = argv;
  if (!command || command === "--help" || command === "help") {
    console.log(usage());
    return 0;
  }
  if (command === "verify-packet") {
    return runVerifyPacketCli(args);
  }
  if (command === "attest-packet") {
    return runConsumerAttestationGateCli(args);
  }
  if (command === "run") {
    return runNodeScript("wutai_run.mjs", args);
  }

  console.error(`Unknown wutai command: ${command}`);
  console.error(usage());
  return 2;
}

main()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });

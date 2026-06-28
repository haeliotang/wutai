export type AdapterIntegrationStatus =
  | "native"
  | "proof_harness"
  | "external_contract"
  | "planned";

export interface AgentAdapterDefinition {
  adapterId: string;
  label: string;
  category:
    | "wutai"
    | "coding_agent"
    | "ci"
    | "script_runner"
    | "mcp"
    | "file_ingestion";
  integrationStatus: AdapterIntegrationStatus;
  packetTypes: string[];
  supportsSigning: boolean;
  proofCommand?: string;
  boundary: string;
}

export const AGENT_ADAPTER_REGISTRY: AgentAdapterDefinition[] = [
  {
    adapterId: "wutaiRunCli",
    label: "Wutai CLI Wrapper",
    category: "wutai",
    integrationStatus: "native",
    packetTypes: ["local_script"],
    supportsSigning: true,
    proofCommand: "npm run wutai:run",
    boundary:
      "Wutai runs the explicit command through the development wrapper, records policy preflight, and writes a local-script packet. It is not a full sandbox.",
  },
  {
    adapterId: "wutaiExternalAgentExample",
    label: "External Agent Wrapper Example",
    category: "script_runner",
    integrationStatus: "proof_harness",
    packetTypes: ["local_script"],
    supportsSigning: true,
    proofCommand: "npm run example:external-agent",
    boundary:
      "Example wrapper runs an explicit external command, writes a packet through the SDK, and verifies it. Wutai does not control the child runtime boundary.",
  },
  {
    adapterId: "codexCli",
    label: "Codex CLI",
    category: "coding_agent",
    integrationStatus: "proof_harness",
    packetTypes: ["local_script"],
    supportsSigning: true,
    proofCommand: "node examples/adapter-proof-runner.mjs --adapter codexCli -- <codex command>",
    boundary:
      "Proof harness can wrap a Codex command and produce a Wutai packet. This is packet-level review, not live Codex supervision.",
  },
  {
    adapterId: "claudeCode",
    label: "Claude Code",
    category: "coding_agent",
    integrationStatus: "proof_harness",
    packetTypes: ["local_script"],
    supportsSigning: true,
    proofCommand: "node examples/adapter-proof-runner.mjs --adapter claudeCode -- <claude command>",
    boundary:
      "Proof harness can wrap a Claude Code command and produce a Wutai packet. Wutai verifies the packet artifacts after the command runs.",
  },
  {
    adapterId: "githubActions",
    label: "GitHub Actions",
    category: "ci",
    integrationStatus: "proof_harness",
    packetTypes: ["local_script"],
    supportsSigning: false,
    proofCommand: ".github/workflows/wutai-verify-packet.example.yml",
    boundary:
      "CI can produce or verify packets as an external producer. Wutai treats CI output as reviewable packet evidence, not as local runtime control.",
  },
  {
    adapterId: "localScriptTraceImporter",
    label: "Local Script Trace Importer",
    category: "script_runner",
    integrationStatus: "native",
    packetTypes: ["local_script"],
    supportsSigning: false,
    boundary:
      "Imports declared local-script traces after execution. Wutai does not execute, sandbox, or independently discover touched files in this path.",
  },
  {
    adapterId: "codingAgentTraceImporter",
    label: "Coding Agent Trace Importer",
    category: "coding_agent",
    integrationStatus: "native",
    packetTypes: ["coding_agent"],
    supportsSigning: false,
    boundary:
      "Imports declared coding-agent traces after execution. Wutai does not approve tool calls or supervise the original agent session.",
  },
  {
    adapterId: "mcpToolCallTraceImporter",
    label: "MCP Tool-Call Trace Importer",
    category: "mcp",
    integrationStatus: "native",
    packetTypes: ["mcp_tool_call"],
    supportsSigning: false,
    boundary:
      "Imports declared MCP tool-call traces. Wutai does not proxy the live MCP session or mediate credentials in this path.",
  },
  {
    adapterId: "localFileIngestion",
    label: "Local File Ingestion",
    category: "file_ingestion",
    integrationStatus: "native",
    packetTypes: ["local_file"],
    supportsSigning: false,
    boundary:
      "Records user-selected file metadata, hashes, and bounded previews. Wutai does not crawl directories or watch later changes.",
  },
  {
    adapterId: "mockResearchAdapter",
    label: "Mock Research Adapter",
    category: "wutai",
    integrationStatus: "native",
    packetTypes: ["research"],
    supportsSigning: false,
    boundary:
      "Deterministic local research fixture for development and tests.",
  },
];

export function adapterDefinitionById(adapterId?: string | null) {
  if (!adapterId) return null;
  return (
    AGENT_ADAPTER_REGISTRY.find((adapter) => adapter.adapterId === adapterId) ??
    null
  );
}

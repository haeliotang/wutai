import { useEffect, useMemo, useRef, useState } from "react";
import { createArtifactWriter, type ArtifactWriter } from "./artifacts/artifactWriter";
import {
  evidenceStatusLabel,
  parseEvidenceVerification,
} from "./domain/evidence";
import { appendEvent, createTask, type WutaiTask } from "./domain/task";
import { createResearchAdapter } from "./runtime/createResearchAdapter";
import {
  activateResearchProviderProfile,
  clearResearchProviderSetup,
  deleteResearchProviderProfile,
  getResearchProviderSetup,
  saveResearchProviderSetup,
  type EmbeddingProvider,
  type ModelProvider,
  type ResearchProviderProfile,
  type ResearchProviderSetup,
  type SearchProvider,
} from "./runtime/researchProviderSetup";
import type { ResearchAdapter, ResearchPreflight } from "./runtime/researchAdapter";
import {
  importCodingAgentTrace,
  parseCodingAgentTrace,
} from "./runtime/codingAgentTraceImporter";
import {
  buildLocalFileHashCheck,
  importLocalFiles,
  readLocalFileIngestionFiles,
  type LocalFileHashCheckArtifact,
  type LocalFileIngestionFile,
} from "./runtime/localFileIngestion";
import { importCliPacketFiles } from "./runtime/cliPacketImporter";
import { importLocalScriptTrace } from "./runtime/localScriptTraceImporter";
import {
  importMcpToolCallTrace,
  parseMcpToolCallTrace,
} from "./runtime/mcpToolCallRecorder";
import {
  EMPTY_TRUSTED_PRODUCER_POLICY,
  enrollTrustedProducerKey,
  parseTrustedProducerPolicy,
  updateTrustedProducerKeyStatus,
  type TrustedProducerPolicy,
} from "./runtime/trustedProducerPolicy";
import { createTaskStore } from "./storage/createTaskStore";
import type { TaskStore } from "./storage/taskStore";

const CORE_SCENARIO =
  "Research agent work governance tools and produce a short market comparison report.";
const TRUSTED_PRODUCER_POLICY_STORAGE_KEY = "wutai.v0.trustedProducerPolicy";

interface CliPolicyArtifact {
  decision?: string;
  highestSeverity?: string;
  profile?: { profileId?: string; name?: string };
  executionMode?: "execute" | "dry_run";
  dryRun?: boolean;
  override?: {
    requested?: boolean;
    applied?: boolean;
    reason?: string | null;
    appliedRuleIds?: string[];
  };
  matchedRules?: Array<{
    ruleId?: string;
    category?: string;
    severity?: string;
    defaultAction?: string;
    effectiveAction?: string;
    profileEscalated?: boolean;
    message?: string;
    reviewScope?: string[];
    ruleOverride?: {
      applied?: boolean;
      baseEffectiveAction?: string;
      effectiveAction?: string;
      reason?: string | null;
    };
  }>;
  summary?: string;
  reviewScope?: string[];
  decisionRationale?: string[];
}

interface CliTraceArtifact {
  command?: string;
  workingDirectory?: string;
  exitCode?: number | null;
  dryRun?: boolean;
  executed?: boolean;
  stdoutSummary?: string;
  stderrSummary?: string;
}

interface WorkPacketManifestArtifact {
  packetType?: string;
  producer?: { adapter?: string };
  audit?: {
    policyDecision?: string;
    policyProfile?: string;
    executionMode?: string;
    toolCallCount?: number;
    runtimeEventCount?: number;
  };
  session?: {
    command?: string | null;
    dryRun?: boolean;
    executionMode?: string;
    exitCode?: number | null;
  };
}

interface CliIntegrityArtifact {
  status?: "passed" | "failed" | "incomplete";
  summary?: string;
  importMode?: "directory" | "files";
  metrics?: {
    total?: number;
    passed?: number;
    mismatched?: number;
    missing?: number;
    unverifiable?: number;
  };
  checks?: Array<{
    name?: string;
    role?: string;
    expectedSha256?: string;
    actualSha256?: string;
    expectedBytes?: number;
    actualBytes?: number;
    status?: "passed" | "mismatch" | "missing" | "unverifiable";
    message?: string;
  }>;
  limitation?: string;
}

interface CliProvenanceArtifact {
  status?: "passed" | "warning" | "failed";
  summary?: string;
  manifest?: {
    sha256?: string;
    bytes?: number;
    packetId?: string;
    packetType?: string;
    producerAdapter?: string;
    producerRuntime?: string;
  };
  attestation?: {
    present?: boolean;
    verified?: boolean;
    trustedKey?: boolean;
    algorithm?: string;
    publicKeySha256?: string;
  };
  trustPolicy?: {
    provided?: boolean;
    policyId?: string;
    sourceLabel?: string;
    keyCount?: number;
    status?: string;
    matchedKeyId?: string;
    matchedLabel?: string;
    message?: string;
  };
  metrics?: {
    total?: number;
    passed?: number;
    warnings?: number;
    failed?: number;
  };
  checks?: Array<{
    name?: string;
    status?: "passed" | "warning" | "failed";
    message?: string;
    evidence?: string;
  }>;
  limitation?: string;
}

interface CliPolicyReviewArtifact {
  status?: "passed" | "warning" | "failed";
  summary?: string;
  policy?: {
    decision?: string;
    highestSeverity?: string;
    profileId?: string;
    profileName?: string;
    matchedRuleCount?: number;
  };
  explicitOverride?: {
    requested?: boolean;
    applied?: boolean;
    reason?: string;
    appliedRuleIds?: string[];
  };
  ruleOverrides?: Array<{
    ruleId?: string;
    category?: string;
    severity?: string;
    defaultAction?: string;
    effectiveAction?: string;
    profileEscalated?: boolean;
    source?: string;
    reason?: string;
    message?: string;
    reviewScope?: string[];
  }>;
  metrics?: {
    matchedRuleCount?: number;
    ruleOverrideCount?: number;
    missingOverrideReasonCount?: number;
    explicitOverrideWithoutReason?: boolean;
    highRiskAllowCount?: number;
    warnings?: number;
    failed?: number;
  };
  checks?: Array<{
    name?: string;
    status?: "passed" | "warning" | "failed";
    message?: string;
    evidence?: string;
  }>;
  limitation?: string;
}

interface CliTrustVerdictArtifact {
  verdict?: "trusted" | "review_required" | "blocked";
  summary?: string;
  policy?: {
    policyId?: string;
    sourceLabel?: string;
    matchedRulePolicyCount?: number;
  };
  inputs?: {
    packetType?: string;
    producerAdapter?: string;
    policyDecision?: string;
    integrityStatus?: string;
    provenanceStatus?: string;
    policyReviewStatus?: string;
    trustedProducer?: boolean;
  };
  metrics?: {
    total?: number;
    passed?: number;
    reviewRequired?: number;
    blocked?: number;
  };
  checks?: Array<{
    name?: string;
    status?: "passed" | "review_required" | "blocked";
    message?: string;
    evidence?: string;
    ruleId?: string;
  }>;
  reviewRequired?: string[];
  blocked?: string[];
  limitation?: string;
}

interface CliAuditArtifact {
  permissions?: Array<Record<string, unknown>>;
  events?: Array<Record<string, unknown>>;
  toolCalls?: Array<Record<string, unknown>>;
  runtimeEvents?: Array<Record<string, unknown>>;
  credentialGrants?: Array<Record<string, unknown>>;
}

type AuditFilter =
  | "all"
  | "events"
  | "toolCalls"
  | "runtimeEvents"
  | "credentialGrants";

interface AuditRecordGroup {
  id: Exclude<AuditFilter, "all">;
  title: string;
  records?: Array<Record<string, unknown>>;
  fields: Array<{ key: string; label: string }>;
}

const AUDIT_FILTERS: Array<{ id: AuditFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "events", label: "Events" },
  { id: "toolCalls", label: "Tool Calls" },
  { id: "runtimeEvents", label: "Runtime Events" },
  { id: "credentialGrants", label: "Credential Grants" },
];

interface CliReviewArtifact {
  schemaVersion?: number;
  kind?: string;
  taskId?: string;
  generatedAt?: string;
  decision?: "approved" | "denied";
  command?: string | null;
  policyProfile?: string | null;
  executionMode?: string | null;
  note?: string;
  limitation?: string;
}

interface LocalFileIngestionArtifact {
  schemaVersion?: number;
  kind?: "wutai.local_file_ingestion";
  taskId?: string;
  generatedAt?: string;
  files?: LocalFileIngestionFile[];
  limitation?: string;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function formatTaskStatus(status: WutaiTask["status"]) {
  if (status === "completed_with_warnings") return "needs review";
  return status.replaceAll("_", " ");
}

function downloadArtifact(name: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function parseJsonArtifact<T>(content: string): T | null {
  try {
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

function shortHash(value?: string) {
  if (!value) return "n/a";
  if (value.length <= 18) return value;
  return `${value.slice(0, 10)}...${value.slice(-6)}`;
}

function policyReviewSourceLabel(value?: string) {
  if (value === "explicit_rule_override") return "explicit override";
  if (value === "policy_profile") return "policy profile";
  if (value === "effective_action_change") return "action change";
  return "change";
}

function trustVerdictLabel(value?: string) {
  if (value === "review_required") return "review required";
  return value ?? "unknown";
}

function formatAuditValue(value: unknown) {
  if (value === null || value === undefined) return "n/a";
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(", ") || "n/a";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

interface AuditRecordListProps {
  title: string;
  records?: Array<Record<string, unknown>>;
  fields: Array<{ key: string; label: string }>;
}

function auditRecordGroups(audit: CliAuditArtifact | null): AuditRecordGroup[] {
  if (!audit) return [];

  return [
    {
      id: "events",
      title: "Events",
      records: audit.events,
      fields: [
        { key: "timestamp", label: "Time" },
        { key: "type", label: "Type" },
        { key: "visibility", label: "Visibility" },
        { key: "details", label: "Details" },
      ],
    },
    {
      id: "toolCalls",
      title: "Tool Calls",
      records: audit.toolCalls,
      fields: [
        { key: "kind", label: "Kind" },
        { key: "command", label: "Command" },
        { key: "workingDirectory", label: "Working directory" },
        { key: "exitCode", label: "Exit" },
      ],
    },
    {
      id: "runtimeEvents",
      title: "Runtime Events",
      records: audit.runtimeEvents,
      fields: [
        { key: "timestamp", label: "Time" },
        { key: "type", label: "Type" },
        { key: "exitCode", label: "Exit" },
        { key: "stdoutSummary", label: "Stdout" },
        { key: "stderrSummary", label: "Stderr" },
      ],
    },
    {
      id: "credentialGrants",
      title: "Credential Grants",
      records: audit.credentialGrants,
      fields: [
        { key: "purpose", label: "Purpose" },
        { key: "provider", label: "Provider" },
        { key: "scope", label: "Scope" },
        { key: "timestamp", label: "Time" },
      ],
    },
  ];
}

function auditRecordCount(groups: AuditRecordGroup[]) {
  return groups.reduce((count, group) => count + (group.records?.length ?? 0), 0);
}

function AuditRecordList({ title, records, fields }: AuditRecordListProps) {
  const items = records ?? [];

  return (
    <details className="audit-detail-group" open={items.length > 0}>
      <summary>
        <span>{title}</span>
        <strong>{items.length}</strong>
      </summary>
      {items.length ? (
        <div className="audit-record-list">
          {items.map((item, index) => (
            <div className="audit-record" key={`${title}_${index}`}>
              <strong>
                {formatAuditValue(
                  item.summary ?? item.command ?? item.type ?? item.kind ?? `Record ${index + 1}`,
                )}
              </strong>
              <dl>
                {fields.map(({ key, label }) => (
                  <div key={key}>
                    <dt>{label}</dt>
                    <dd>{formatAuditValue(item[key])}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">None recorded.</p>
      )}
    </details>
  );
}

function newProviderProfile(): ResearchProviderProfile {
  return {
    profileId: `profile-${Date.now()}`,
    name: "New profile",
    modelProvider: "deepseek",
    model: "deepseek-v4-flash",
    modelBaseUrl: null,
    searchProvider: "tavily",
    embeddingProvider: "ollama",
    embeddingModel: "nomic-embed-text",
    embeddingBaseUrl: "http://127.0.0.1:11434",
  };
}

export default function App() {
  const [tasks, setTasks] = useState<WutaiTask[]>([]);
  const [activeTask, setActiveTask] = useState<WutaiTask | null>(null);
  const [request, setRequest] = useState(CORE_SCENARIO);
  const [error, setError] = useState<string | null>(null);
  const [taskStore, setTaskStore] = useState<TaskStore | null>(null);
  const [artifactWriter, setArtifactWriter] = useState<ArtifactWriter | null>(null);
  const [researchAdapter, setResearchAdapter] = useState<ResearchAdapter | null>(null);
  const [researchPreflight, setResearchPreflight] =
    useState<ResearchPreflight | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [providerSetup, setProviderSetup] =
    useState<ResearchProviderSetup | null>(null);
  const [providerProfile, setProviderProfile] =
    useState<ResearchProviderProfile | null>(null);
  const [modelAccessKey, setModelAccessKey] = useState("");
  const [webSearchKey, setWebSearchKey] = useState("");
  const [embeddingAccessKey, setEmbeddingAccessKey] = useState("");
  const [providerSetupMessage, setProviderSetupMessage] = useState<string | null>(
    null,
  );
  const [providerSetupSaving, setProviderSetupSaving] = useState(false);
  const [trustedProducerPolicy, setTrustedProducerPolicy] =
    useState<TrustedProducerPolicy>(EMPTY_TRUSTED_PRODUCER_POLICY);
  const [trustedProducerPolicyMessage, setTrustedProducerPolicyMessage] =
    useState<string | null>(null);
  const [auditFilter, setAuditFilter] = useState<AuditFilter>("all");
  const abortRef = useRef<AbortController | null>(null);
  const cliPacketInputRef = useRef<HTMLInputElement | null>(null);
  const cliPacketDirectoryInputRef = useRef<HTMLInputElement | null>(null);
  const codingAgentTraceInputRef = useRef<HTMLInputElement | null>(null);
  const mcpToolCallTraceInputRef = useRef<HTMLInputElement | null>(null);
  const localFileIngestionInputRef = useRef<HTMLInputElement | null>(null);
  const localFileRecheckInputRef = useRef<HTMLInputElement | null>(null);
  const trustedProducerPolicyInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      const store = await createTaskStore();
      const writer = createArtifactWriter();
      const adapter = createResearchAdapter();
      const items = await store.list();
      const preflight = await runPreflight(adapter);
      const setup =
        adapter.backendName === "GPT Researcher sidecar"
          ? await getResearchProviderSetup()
          : null;
      if (!active) return;
      setTaskStore(store);
      setArtifactWriter(writer);
      setResearchAdapter(adapter);
      setResearchPreflight(preflight);
      setProviderSetup(setup);
      setProviderProfile(setup?.activeProfile ?? null);
      setTasks(items);
      setActiveTask(items[0] ?? null);
    }

    bootstrap().catch((error) => {
      console.error(error);
      setError("Wutai failed to initialize local storage.");
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const input = cliPacketDirectoryInputRef.current;
    if (!input) return;

    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");
  }, []);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(
        TRUSTED_PRODUCER_POLICY_STORAGE_KEY,
      );
      if (!saved) return;
      const policy = parseTrustedProducerPolicy(saved, "localStorage");
      setTrustedProducerPolicy(policy);
      setTrustedProducerPolicyMessage(
        `Trusted producer policy loaded: ${policy.keys.length} key${policy.keys.length === 1 ? "" : "s"}.`,
      );
    } catch (error) {
      setTrustedProducerPolicy(EMPTY_TRUSTED_PRODUCER_POLICY);
      setTrustedProducerPolicyMessage(
        error instanceof Error
          ? error.message
          : "Wutai could not load the trusted producer policy.",
      );
    }
  }, []);

  useEffect(() => {
    setAuditFilter("all");
  }, [activeTask?.taskId]);

  async function runPreflight(adapter: ResearchAdapter): Promise<ResearchPreflight> {
    try {
      return await adapter.preflight();
    } catch (error) {
      return {
        ready: false,
        summary: "Wutai could not check the research setup.",
        checks: [
          {
            key: "preflight",
            label: "Research setup",
            status: "fail",
            message: "The setup check did not finish.",
            detail: error instanceof Error ? error.message : String(error),
          },
        ],
        fixes: ["Restart Wutai and run the setup check again."],
      };
    }
  }

  async function refreshResearchSetup() {
    if (!researchAdapter) return;

    setPreflightLoading(true);
    setResearchPreflight(await runPreflight(researchAdapter));
    setPreflightLoading(false);
  }

  function applyProviderSetup(setup: ResearchProviderSetup) {
    setProviderSetup(setup);
    setProviderProfile({ ...setup.activeProfile });
    setModelAccessKey("");
    setWebSearchKey("");
    setEmbeddingAccessKey("");
  }

  async function saveProviderSetup() {
    if (!researchAdapter || !providerProfile) return;

    setProviderSetupSaving(true);
    setProviderSetupMessage(null);
    try {
      const setup = await saveResearchProviderSetup({
        profile: providerProfile,
        modelApiKey: modelAccessKey.trim() || null,
        searchApiKey: webSearchKey.trim() || null,
        embeddingApiKey: embeddingAccessKey.trim() || null,
      });
      applyProviderSetup(setup);
      setProviderSetupMessage("Provider Profile saved. Secrets stay in the system keychain.");
      setResearchPreflight(await runPreflight(researchAdapter));
    } catch (error) {
      setProviderSetupMessage(
        error instanceof Error
          ? error.message
          : "Wutai could not save research access.",
      );
    } finally {
      setProviderSetupSaving(false);
    }
  }

  async function clearProviderSetup() {
    if (!researchAdapter) return;

    setProviderSetupSaving(true);
    setProviderSetupMessage(null);
    try {
      const setup = await clearResearchProviderSetup();
      applyProviderSetup(setup);
      setProviderSetupMessage("Secrets for this Provider Profile were removed.");
      setResearchPreflight(await runPreflight(researchAdapter));
    } catch (error) {
      setProviderSetupMessage(
        error instanceof Error
          ? error.message
          : "Wutai could not clear research access.",
      );
    } finally {
      setProviderSetupSaving(false);
    }
  }

  async function selectProviderProfile(profileId: string) {
    if (!researchAdapter) return;
    setProviderSetupSaving(true);
    setProviderSetupMessage(null);
    try {
      const setup = await activateResearchProviderProfile(profileId);
      applyProviderSetup(setup);
      setResearchPreflight(await runPreflight(researchAdapter));
    } catch (error) {
      setProviderSetupMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setProviderSetupSaving(false);
    }
  }

  async function deleteProviderProfile() {
    if (!researchAdapter || !providerProfile) return;
    setProviderSetupSaving(true);
    setProviderSetupMessage(null);
    try {
      const setup = await deleteResearchProviderProfile(providerProfile.profileId);
      applyProviderSetup(setup);
      setProviderSetupMessage("Provider Profile deleted.");
      setResearchPreflight(await runPreflight(researchAdapter));
    } catch (error) {
      setProviderSetupMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setProviderSetupSaving(false);
    }
  }

  function changeModelProvider(modelProvider: ModelProvider) {
    if (!providerProfile) return;
    const defaults: Record<ModelProvider, Pick<ResearchProviderProfile, "model" | "modelBaseUrl">> = {
      deepseek: { model: "deepseek-v4-flash", modelBaseUrl: null },
      openai: { model: "gpt-4o-mini", modelBaseUrl: null },
      "openai-compatible": {
        model: "compatible-model",
        modelBaseUrl: "https://api.example.com/v1",
      },
      ollama: { model: "qwen3:8b", modelBaseUrl: "http://127.0.0.1:11434" },
    };
    const next = { ...providerProfile, modelProvider, ...defaults[modelProvider] };
    if (modelProvider === "ollama" && next.embeddingProvider === "ollama") {
      next.embeddingBaseUrl = next.modelBaseUrl;
    }
    if (
      next.embeddingProvider === "openai" &&
      (modelProvider === "openai" || modelProvider === "openai-compatible")
    ) {
      next.embeddingBaseUrl = next.modelBaseUrl;
    }
    setProviderProfile(next);
  }

  function changeEmbeddingProvider(embeddingProvider: EmbeddingProvider) {
    if (!providerProfile) return;
    setProviderProfile({
      ...providerProfile,
      embeddingProvider,
      embeddingModel:
        embeddingProvider === "ollama"
          ? "nomic-embed-text"
          : "text-embedding-3-small",
      embeddingBaseUrl:
        embeddingProvider === "ollama"
          ? providerProfile.modelProvider === "ollama"
            ? providerProfile.modelBaseUrl
            : "http://127.0.0.1:11434"
          : providerProfile.modelProvider === "openai-compatible"
            ? providerProfile.modelBaseUrl
            : null,
    });
  }

  const pendingPermission = activeTask?.permissions.find(
    (permission) =>
      permission.status === "pending" &&
      permission.types.some((type) =>
        ["public_web_search", "public_webpage_read"].includes(type),
      ),
  );

  const reportArtifact = useMemo(
    () =>
      activeTask?.artifacts.find((artifact) => artifact.name === "report.md") ??
      null,
    [activeTask],
  );

  const claimsArtifact = useMemo(
    () =>
      activeTask?.artifacts.find((item) => item.name === "claims.json") ?? null,
    [activeTask],
  );

  const manifestArtifact = useMemo(
    () =>
      activeTask?.artifacts.find((item) => item.name === "manifest.json") ??
      null,
    [activeTask],
  );

  const policyArtifact = useMemo(
    () => activeTask?.artifacts.find((item) => item.name === "policy.json") ?? null,
    [activeTask],
  );

  const traceArtifact = useMemo(
    () => activeTask?.artifacts.find((item) => item.name === "trace.json") ?? null,
    [activeTask],
  );

  const ledgerArtifact = useMemo(
    () => activeTask?.artifacts.find((item) => item.name === "ledger.json") ?? null,
    [activeTask],
  );

  const auditArtifact = useMemo(
    () => activeTask?.artifacts.find((item) => item.name === "audit.json") ?? null,
    [activeTask],
  );

  const integrityArtifact = useMemo(
    () =>
      activeTask?.artifacts.find((item) => item.name === "integrity.json") ??
      null,
    [activeTask],
  );

  const provenanceArtifact = useMemo(
    () =>
      activeTask?.artifacts.find((item) => item.name === "provenance.json") ??
      null,
    [activeTask],
  );

  const policyReviewArtifact = useMemo(
    () =>
      activeTask?.artifacts.find((item) => item.name === "policy-review.json") ??
      null,
    [activeTask],
  );

  const trustVerdictArtifact = useMemo(
    () =>
      activeTask?.artifacts.find((item) => item.name === "trust-verdict.json") ??
      null,
    [activeTask],
  );

  const reviewArtifact = useMemo(
    () =>
      activeTask?.artifacts.find((item) => item.name === "review.json") ??
      null,
    [activeTask],
  );

  const filesArtifact = useMemo(
    () => activeTask?.artifacts.find((item) => item.name === "files.json") ?? null,
    [activeTask],
  );

  const fileCheckArtifact = useMemo(
    () =>
      activeTask?.artifacts.find((item) => item.name === "file-check.json") ??
      null,
    [activeTask],
  );

  const verificationArtifact = useMemo(
    () =>
      activeTask?.artifacts.find((item) => item.name === "verification.json") ??
      null,
    [activeTask],
  );

  const evidenceVerification = useMemo(() => {
    const artifact = verificationArtifact;
    return artifact ? parseEvidenceVerification(artifact.content) : null;
  }, [verificationArtifact]);

  const cliPacketReview = useMemo(() => {
    if (!manifestArtifact || !policyArtifact || !traceArtifact) return null;

    const manifest = parseJsonArtifact<WorkPacketManifestArtifact>(
      manifestArtifact.content,
    );
    if (
      manifest?.packetType !== "local_script" ||
      manifest.producer?.adapter !== "wutaiRunCli"
    ) {
      return null;
    }

    return {
      manifest,
      policy: parseJsonArtifact<CliPolicyArtifact>(policyArtifact.content),
      trace: parseJsonArtifact<CliTraceArtifact>(traceArtifact.content),
      audit: auditArtifact
        ? parseJsonArtifact<CliAuditArtifact>(auditArtifact.content)
        : null,
      integrity: integrityArtifact
        ? parseJsonArtifact<CliIntegrityArtifact>(integrityArtifact.content)
        : null,
      provenance: provenanceArtifact
        ? parseJsonArtifact<CliProvenanceArtifact>(provenanceArtifact.content)
        : null,
      policyReview: policyReviewArtifact
        ? parseJsonArtifact<CliPolicyReviewArtifact>(policyReviewArtifact.content)
        : null,
      trustVerdict: trustVerdictArtifact
        ? parseJsonArtifact<CliTrustVerdictArtifact>(trustVerdictArtifact.content)
        : null,
      review: reviewArtifact
        ? parseJsonArtifact<CliReviewArtifact>(reviewArtifact.content)
        : null,
    };
  }, [
    auditArtifact,
    integrityArtifact,
    manifestArtifact,
    policyArtifact,
    policyReviewArtifact,
    provenanceArtifact,
    reviewArtifact,
    traceArtifact,
    trustVerdictArtifact,
  ]);

  const localFileReview = useMemo(() => {
    if (!manifestArtifact || !filesArtifact) return null;

    const manifest = parseJsonArtifact<WorkPacketManifestArtifact>(
      manifestArtifact.content,
    );
    if (
      manifest?.packetType !== "local_file" ||
      manifest.producer?.adapter !== "localFileIngestion"
    ) {
      return null;
    }

    return {
      manifest,
      files: parseJsonArtifact<LocalFileIngestionArtifact>(filesArtifact.content),
      check: fileCheckArtifact
        ? parseJsonArtifact<LocalFileHashCheckArtifact>(fileCheckArtifact.content)
        : null,
    };
  }, [fileCheckArtifact, filesArtifact, manifestArtifact]);

  const cliDryRunReview = useMemo(() => {
    if (!activeTask || !cliPacketReview) return null;

    const dryRun =
      cliPacketReview.policy?.dryRun === true ||
      cliPacketReview.policy?.executionMode === "dry_run" ||
      cliPacketReview.trace?.dryRun === true ||
      cliPacketReview.manifest.session?.dryRun === true ||
      cliPacketReview.manifest.session?.executionMode === "dry_run" ||
      cliPacketReview.manifest.audit?.executionMode === "dry_run";
    if (!dryRun) return null;

    const pendingExecutionPermission = activeTask.permissions.find(
      (permission) =>
        permission.types.includes("local_script_execution") &&
        permission.status === "pending",
    );

    return {
      pendingExecutionPermission,
      review: cliPacketReview.review,
    };
  }, [activeTask, cliPacketReview]);

  const canEnrollTrustedProducerKey = useMemo(() => {
    const provenance = cliPacketReview?.provenance;
    if (!provenance) return false;
    return Boolean(
      provenance.attestation?.present &&
        provenance.attestation.verified &&
        !provenance.attestation.trustedKey &&
        provenance.attestation.publicKeySha256 &&
        provenance.trustPolicy?.status !== "revoked",
    );
  }, [cliPacketReview]);

  const cliAuditGroups = useMemo(
    () => auditRecordGroups(cliPacketReview?.audit ?? null),
    [cliPacketReview],
  );
  const visibleCliAuditGroups = useMemo(
    () =>
      auditFilter === "all"
        ? cliAuditGroups
        : cliAuditGroups.filter((group) => group.id === auditFilter),
    [auditFilter, cliAuditGroups],
  );
  const cliAuditTotalCount = useMemo(
    () => auditRecordCount(cliAuditGroups),
    [cliAuditGroups],
  );
  const cliAuditVisibleCount = useMemo(
    () => auditRecordCount(visibleCliAuditGroups),
    [visibleCliAuditGroups],
  );
  const trustPolicyKeyCounts = useMemo(
    () => ({
      active: trustedProducerPolicy.keys.filter((key) => key.status === "active")
        .length,
      revoked: trustedProducerPolicy.keys.filter((key) => key.status === "revoked")
        .length,
    }),
    [trustedProducerPolicy],
  );

  async function persist(task: WutaiTask) {
    if (!taskStore) return;

    await taskStore.save(task);
    const nextTasks = await taskStore.list();
    setTasks(nextTasks);
    setActiveTask(task);
  }

  async function startTask() {
    if (!taskStore || !artifactWriter || !researchAdapter) {
      setError("Wutai is still initializing local storage.");
      return;
    }

    if (!researchPreflight || preflightLoading) {
      setError("Wutai is still checking the research setup.");
      return;
    }

    if (!researchPreflight.ready) {
      setError(researchPreflight.summary);
      return;
    }

    if (!request.trim()) {
      setError("Enter a task before starting.");
      return;
    }

    setError(null);
    const task = createTask(request.trim());
    await persist(task);
  }

  async function importLocalScriptTraceTask() {
    if (!taskStore || !artifactWriter) {
      setError("Wutai is still initializing local storage.");
      return;
    }

    setError(null);
    const task = await importLocalScriptTrace(artifactWriter);
    await persist(task);
  }

  async function importCodingAgentTraceTask(files: FileList | null) {
    const file = files?.[0];
    if (!taskStore || !artifactWriter || !file) return;

    setError(null);
    try {
      const trace = parseCodingAgentTrace(await file.text());
      const task = await importCodingAgentTrace(artifactWriter, trace);
      await persist(task);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Wutai could not import the coding-agent trace.",
      );
    } finally {
      if (codingAgentTraceInputRef.current) {
        codingAgentTraceInputRef.current.value = "";
      }
    }
  }

  async function importMcpToolCallTraceTask(files: FileList | null) {
    const file = files?.[0];
    if (!taskStore || !artifactWriter || !file) return;

    setError(null);
    try {
      const trace = parseMcpToolCallTrace(await file.text());
      const task = await importMcpToolCallTrace(artifactWriter, trace);
      await persist(task);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Wutai could not import the MCP tool-call trace.",
      );
    } finally {
      if (mcpToolCallTraceInputRef.current) {
        mcpToolCallTraceInputRef.current.value = "";
      }
    }
  }

  async function importLocalFileIngestionTask(files: FileList | null) {
    if (!taskStore || !artifactWriter || !files || files.length === 0) return;

    setError(null);
    try {
      const selectedFiles = await readLocalFileIngestionFiles(files);
      const task = await importLocalFiles(artifactWriter, selectedFiles);
      await persist(task);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Wutai could not ingest the selected local files.",
      );
    } finally {
      if (localFileIngestionInputRef.current) {
        localFileIngestionInputRef.current.value = "";
      }
    }
  }

  function saveTrustedProducerPolicyState(
    policy: TrustedProducerPolicy,
    message: string,
  ) {
    if (
      policy.keys.length === 0 &&
      policy.policyId === EMPTY_TRUSTED_PRODUCER_POLICY.policyId
    ) {
      window.localStorage.removeItem(TRUSTED_PRODUCER_POLICY_STORAGE_KEY);
    } else {
      window.localStorage.setItem(
        TRUSTED_PRODUCER_POLICY_STORAGE_KEY,
        JSON.stringify(policy, null, 2),
      );
    }
    setTrustedProducerPolicy(policy);
    setTrustedProducerPolicyMessage(message);
    setError(null);
  }

  async function refreshActiveCliPacketWithPolicy(policy: TrustedProducerPolicy) {
    if (!activeTask || !taskStore || !cliPacketReview) return;

    const packetFiles = cliPacketArtifactsForReimport(activeTask);
    const task = await importCliPacketFiles(packetFiles, policy);
    await persist(task);
  }

  async function applyTrustedProducerPolicy(
    policy: TrustedProducerPolicy,
    message: string,
    options: { refreshActivePacket?: boolean } = {},
  ) {
    saveTrustedProducerPolicyState(policy, message);
    if (options.refreshActivePacket ?? true) {
      await refreshActiveCliPacketWithPolicy(policy);
    }
  }

  async function recheckLocalFileHashes(files: FileList | null) {
    if (
      !activeTask ||
      !taskStore ||
      !localFileReview?.files?.files ||
      !files ||
      files.length === 0
    ) {
      return;
    }

    setError(null);
    try {
      const now = new Date().toISOString();
      const selectedFiles = await readLocalFileIngestionFiles(files);
      const check = buildLocalFileHashCheck(
        activeTask.taskId,
        localFileReview.files.files,
        selectedFiles,
        now,
      );
      const checkRecord: WutaiTask["artifacts"][number] = {
        artifactId: `${activeTask.taskId}_artifact_file_check_json`,
        taskId: activeTask.taskId,
        type: "json",
        name: "file-check.json",
        virtualPath: `imported/${activeTask.taskId}/file-check.json`,
        content: JSON.stringify(check, null, 2),
        createdAt: now,
      };
      const withoutPriorCheck = activeTask.artifacts.filter(
        (artifact) => artifact.name !== "file-check.json",
      );
      let nextTask: WutaiTask = {
        ...activeTask,
        status: check.status === "passed" ? "completed" : "completed_with_warnings",
        updatedAt: now,
        artifacts: [...withoutPriorCheck, checkRecord],
      };
      nextTask = appendEvent(nextTask, {
        type: "RuntimeEventCaptured",
        summary: `Local file hash re-check ${check.status}.`,
        details: check.summary,
        visibility: "user",
      });
      nextTask = appendEvent(nextTask, {
        type: "ArtifactCreated",
        summary: "Saved local file hash re-check artifact.",
        details: "file-check.json records hash comparisons for selected files only.",
        visibility: "user",
      });
      await persist(nextTask);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Wutai could not re-check the selected local files.",
      );
    } finally {
      if (localFileRecheckInputRef.current) {
        localFileRecheckInputRef.current.value = "";
      }
    }
  }

  async function loadTrustedProducerPolicy(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;

    try {
      const policy = parseTrustedProducerPolicy(await file.text(), file.name);
      await applyTrustedProducerPolicy(
        policy,
        `Trusted producer policy loaded: ${policy.keys.length} key${policy.keys.length === 1 ? "" : "s"}.`,
      );
    } catch (error) {
      setTrustedProducerPolicyMessage(
        error instanceof Error
          ? error.message
          : "Wutai could not load the trusted producer policy.",
      );
    } finally {
      if (trustedProducerPolicyInputRef.current) {
        trustedProducerPolicyInputRef.current.value = "";
      }
    }
  }

  async function clearTrustedProducerPolicy() {
    await applyTrustedProducerPolicy(
      EMPTY_TRUSTED_PRODUCER_POLICY,
      "Trusted producer policy cleared.",
    );
  }

  async function importCliPacketFromFiles(files: FileList | null) {
    if (!taskStore || !files || files.length === 0) return;

    setError(null);
    try {
      const task = await importCliPacketFiles(
        Array.from(files),
        trustedProducerPolicy,
      );
      await persist(task);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Wutai could not import the CLI packet.",
      );
    } finally {
      if (cliPacketInputRef.current) {
        cliPacketInputRef.current.value = "";
      }
    }
  }

  function cliPacketArtifactsForReimport(task: WutaiTask) {
    const names = new Set([
      "manifest.json",
      "report.md",
      "policy.json",
      "trace.json",
      "ledger.json",
      "audit.json",
      "attestation.json",
    ]);
    return task.artifacts
      .filter((artifact) => names.has(artifact.name))
      .map((artifact) => ({
        name: artifact.name,
        text: async () => artifact.content,
      }));
  }

  async function enrollCurrentPacketProducerKey() {
    if (!activeTask || !taskStore || !cliPacketReview?.provenance) return;

    const provenance = cliPacketReview.provenance;
    const publicKeySha256 = provenance.attestation?.publicKeySha256;
    const producerAdapter =
      provenance.manifest?.producerAdapter ??
      cliPacketReview.manifest.producer?.adapter;
    const packetType =
      provenance.manifest?.packetType ?? cliPacketReview.manifest.packetType;
    if (
      !provenance.attestation?.verified ||
      provenance.attestation.trustedKey ||
      !publicKeySha256 ||
      !producerAdapter ||
      !packetType ||
      provenance.trustPolicy?.status === "revoked"
    ) {
      setError("This packet does not have an enrollable verified producer key.");
      return;
    }

    setError(null);
    try {
      const nextPolicy = enrollTrustedProducerKey(trustedProducerPolicy, {
        publicKeySha256,
        producerAdapter,
        packetType,
        label: `${producerAdapter} ${shortHash(publicKeySha256)}`,
        note:
          "Locally enrolled from a verified packet attestation in Wutai desktop. This does not prove external identity.",
      });
      await applyTrustedProducerPolicy(
        nextPolicy,
        `Trusted producer key enrolled: ${producerAdapter} ${shortHash(publicKeySha256)}.`,
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Wutai could not enroll the trusted producer key.",
      );
    }
  }

  async function updateTrustedProducerKey(
    keyId: string,
    status: "active" | "revoked",
  ) {
    try {
      const nextPolicy = updateTrustedProducerKeyStatus(
        trustedProducerPolicy,
        keyId,
        status,
      );
      const action = status === "revoked" ? "revoked" : "reactivated";
      await applyTrustedProducerPolicy(
        nextPolicy,
        `Trusted producer key ${action}: ${keyId}.`,
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Wutai could not update the trusted producer key.",
      );
    }
  }

  function exportTrustedProducerPolicy() {
    if (trustedProducerPolicy.keys.length === 0) {
      setTrustedProducerPolicyMessage("No trusted producer policy to export.");
      return;
    }

    downloadArtifact(
      "wutai-trusted-producers.json",
      JSON.stringify(trustedProducerPolicy, null, 2),
    );
  }

  async function recordDryRunReview(decision: "approved" | "denied") {
    if (!activeTask || !taskStore || !cliPacketReview || !cliDryRunReview) return;

    const pendingPermission = cliDryRunReview.pendingExecutionPermission;
    if (!pendingPermission) {
      setError("This dry-run packet no longer has a pending execution permission.");
      return;
    }

    const now = new Date().toISOString();
    const command =
      cliPacketReview.trace?.command ??
      cliPacketReview.manifest.session?.command ??
      null;
    const review: CliReviewArtifact = {
      schemaVersion: 1,
      kind: "wutai.dry_run_review",
      taskId: activeTask.taskId,
      generatedAt: now,
      decision,
      command,
      policyProfile:
        cliPacketReview.policy?.profile?.profileId ??
        cliPacketReview.manifest.audit?.policyProfile ??
        null,
      executionMode:
        cliPacketReview.policy?.executionMode ??
        cliPacketReview.manifest.audit?.executionMode ??
        cliPacketReview.manifest.session?.executionMode ??
        "dry_run",
      note:
        decision === "approved"
          ? "Human reviewer approved the dry-run packet. Wutai desktop did not execute the command."
          : "Human reviewer denied the dry-run packet. Wutai desktop did not execute the command.",
      limitation:
        "This is a local review record only. It does not execute, sandbox, or supervise the command.",
    };
    const reviewRecord: WutaiTask["artifacts"][number] = {
      artifactId: `${activeTask.taskId}_artifact_review_json`,
      taskId: activeTask.taskId,
      type: "json",
      name: "review.json",
      virtualPath: `imported/${activeTask.taskId}/review.json`,
      content: JSON.stringify(review, null, 2),
      createdAt: now,
    };
    const withoutPriorReview = activeTask.artifacts.filter(
      (artifact) => artifact.name !== "review.json",
    );
    let nextTask: WutaiTask = {
      ...activeTask,
      status: decision === "denied" ? "cancelled" : "completed_with_warnings",
      updatedAt: now,
      permissions: activeTask.permissions.map((permission) =>
        permission.requestId === pendingPermission.requestId
          ? { ...permission, status: decision, resolvedAt: now }
          : permission,
      ),
      artifacts: [...withoutPriorReview, reviewRecord],
    };

    nextTask = appendEvent(nextTask, {
      type: "PermissionResolved",
      summary:
        decision === "approved"
          ? "Dry-run execution review approved; Wutai desktop did not execute the command."
          : "Dry-run execution review denied; Wutai desktop did not execute the command.",
      details: `Review artifact: review.json. Command: ${command ?? "unavailable"}.`,
      visibility: "user",
    });
    nextTask = appendEvent(nextTask, {
      type: "ArtifactCreated",
      summary: "Saved dry-run review artifact.",
      details: "review.json records the local review decision only.",
      visibility: "user",
    });

    setError(null);
    await persist(nextTask);
  }

  async function resolvePermission(status: "approved" | "denied") {
    if (!activeTask || !pendingPermission) return;

    const now = new Date().toISOString();
    let nextTask: WutaiTask = {
      ...activeTask,
      status: status === "approved" ? "running" : "cancelled",
      updatedAt: now,
      permissions: activeTask.permissions.map((permission) =>
        permission.requestId === pendingPermission.requestId
          ? { ...permission, status, resolvedAt: now }
          : permission,
      ),
    };

    nextTask = appendEvent(nextTask, {
      type: "PermissionResolved",
      summary:
        status === "approved"
          ? "Public web-research permission approved for this task."
          : "Public web-research permission denied. Task was not executed.",
      visibility: "user",
    });

    await persist(nextTask);

    if (status === "approved") {
      if (!artifactWriter || !researchAdapter) return;

      const controller = new AbortController();
      abortRef.current = controller;
      let latestTask = nextTask;
      try {
        await researchAdapter.run(
          nextTask,
          controller.signal,
          async (task) => {
            latestTask = task;
            await persist(task);
          },
          artifactWriter,
        );
      } catch (error) {
        const wasAbort = error instanceof DOMException && error.name === "AbortError";
        const failedTask = appendEvent(
          {
            ...latestTask,
            status: wasAbort ? "cancelled" : "failed",
            updatedAt: new Date().toISOString(),
          },
          {
            type: "TaskFailed",
            summary:
              wasAbort
                ? "Task stopped by user."
                : `${researchAdapter.backendName} failed before completion.`,
            details: error instanceof Error ? error.message : String(error),
            visibility: "user",
          },
        );
        await persist(failedTask);
      } finally {
        abortRef.current = null;
      }
    }
  }

  async function stopTask() {
    abortRef.current?.abort();
  }

  async function clearHistory() {
    if (!taskStore) return;

    await taskStore.clear();
    setTasks([]);
    setActiveTask(null);
  }

  const shouldShowResearchSetup =
    researchPreflight !== null && researchPreflight.checks.length > 0;
  const modelNeedsKey = providerProfile?.modelProvider !== "ollama";
  const searchNeedsKey = providerProfile?.searchProvider === "tavily";
  const embeddingNeedsSeparateKey =
    providerProfile?.embeddingProvider === "openai" &&
    providerProfile.modelProvider !== "openai" &&
    providerProfile.modelProvider !== "openai-compatible";
  const editingStoredProfile = Boolean(
    providerProfile &&
      providerSetup?.profiles.profiles.some(
        (profile) => profile.profileId === providerProfile.profileId,
      ),
  );
  const modelKeyIsConfigured = Boolean(
    editingStoredProfile &&
      providerSetup?.modelKeyConfigured &&
      providerProfile?.modelProvider === providerSetup.activeProfile.modelProvider,
  );
  const searchKeyIsConfigured = Boolean(
    editingStoredProfile &&
      providerSetup?.searchKeyConfigured &&
      providerProfile?.searchProvider === providerSetup.activeProfile.searchProvider,
  );
  const embeddingKeyIsConfigured = Boolean(
    editingStoredProfile &&
      providerSetup?.embeddingKeyConfigured &&
      providerProfile?.embeddingProvider ===
        providerSetup.activeProfile.embeddingProvider &&
      providerProfile?.modelProvider === providerSetup.activeProfile.modelProvider,
  );

  return (
    <main className="app-shell">
      <section className="hero-console">
        <div className="system-line">WUTAI / OBSERVE MODE</div>
        <h1>Local trust layer for agentic work</h1>
        <p>
          v0.2 foundation. Supervised research sessions, local-script trace
          import, external trace review, local file ingestion, CLI packet
          review, task-scoped permission, Evidence Gate checks, and local work
          packets.
        </p>
        <p className="runtime-line">
          Storage: {taskStore?.backendName ?? "initializing"} / Artifacts:{" "}
          {artifactWriter?.backendName ?? "initializing"} / Adapter:{" "}
          {researchAdapter?.backendName ?? "initializing"}
        </p>
      </section>

      <section className="workspace">
        <aside className="history-panel" aria-label="Task history">
          <div className="panel-header">
            <span>Task history</span>
            <button type="button" onClick={clearHistory} disabled={!tasks.length}>
              Clear
            </button>
          </div>
          <div className="task-list">
            {tasks.length === 0 ? (
              <p className="muted">No tasks yet.</p>
            ) : (
              tasks.map((task) => (
                <button
                  key={task.taskId}
                  type="button"
                  className={
                    activeTask?.taskId === task.taskId
                      ? "task-row task-row-active"
                      : "task-row"
                  }
                  onClick={() => setActiveTask(task)}
                >
                  <span>{task.title}</span>
                  <small>{formatTaskStatus(task.status)}</small>
                </button>
              ))
            )}
          </div>
        </aside>

        <section className="task-console" aria-label="Task console">
          <div className="prompt-line">
            <span>&gt;</span>
            <textarea
              value={request}
              onChange={(event) => setRequest(event.target.value)}
              rows={3}
              aria-label="Task request"
            />
          </div>
          <div className="action-bar">
            <button type="button" className="primary-action" onClick={startTask}>
              Create plan
            </button>
            <button
              type="button"
              onClick={() => setRequest(CORE_SCENARIO)}
              aria-label="Restore core scenario"
            >
              Core scenario
            </button>
            <button type="button" onClick={importLocalScriptTraceTask}>
              Import local script trace
            </button>
            <button
              type="button"
              onClick={() => codingAgentTraceInputRef.current?.click()}
            >
              Import coding agent trace
            </button>
            <button
              type="button"
              onClick={() => mcpToolCallTraceInputRef.current?.click()}
            >
              Import MCP tool-call trace
            </button>
            <button
              type="button"
              onClick={() => localFileIngestionInputRef.current?.click()}
            >
              Ingest local files
            </button>
            <button
              type="button"
              onClick={() => cliPacketInputRef.current?.click()}
            >
              Import CLI packet files
            </button>
            <button
              type="button"
              onClick={() => cliPacketDirectoryInputRef.current?.click()}
            >
              Import CLI packet directory
            </button>
            <button
              type="button"
              onClick={() => trustedProducerPolicyInputRef.current?.click()}
            >
              Load trust policy
            </button>
            <button
              type="button"
              onClick={exportTrustedProducerPolicy}
              disabled={trustedProducerPolicy.keys.length === 0}
            >
              Export trust policy
            </button>
            <button
              type="button"
              onClick={() => void clearTrustedProducerPolicy()}
              disabled={trustedProducerPolicy.keys.length === 0}
            >
              Clear trust policy
            </button>
            <button
              type="button"
              onClick={stopTask}
              disabled={activeTask?.status !== "running"}
            >
              Stop
            </button>
            <input
              ref={cliPacketInputRef}
              type="file"
              className="file-input-hidden"
              aria-label="CLI packet files"
              accept=".json,.md"
              multiple
              onChange={(event) => void importCliPacketFromFiles(event.target.files)}
            />
            <input
              ref={codingAgentTraceInputRef}
              type="file"
              className="file-input-hidden"
              aria-label="Coding agent trace"
              accept=".json"
              onChange={(event) => void importCodingAgentTraceTask(event.target.files)}
            />
            <input
              ref={mcpToolCallTraceInputRef}
              type="file"
              className="file-input-hidden"
              aria-label="MCP tool-call trace"
              accept=".json"
              onChange={(event) => void importMcpToolCallTraceTask(event.target.files)}
            />
            <input
              ref={localFileIngestionInputRef}
              type="file"
              className="file-input-hidden"
              aria-label="Local files"
              multiple
              onChange={(event) =>
                void importLocalFileIngestionTask(event.target.files)
              }
            />
            <input
              ref={localFileRecheckInputRef}
              type="file"
              className="file-input-hidden"
              aria-label="Local files re-check"
              multiple
              onChange={(event) => void recheckLocalFileHashes(event.target.files)}
            />
            <input
              ref={cliPacketDirectoryInputRef}
              type="file"
              className="file-input-hidden"
              aria-label="CLI packet directory"
              multiple
              onChange={(event) => void importCliPacketFromFiles(event.target.files)}
            />
            <input
              ref={trustedProducerPolicyInputRef}
              type="file"
              className="file-input-hidden"
              aria-label="Trusted producer policy"
              accept=".json"
              onChange={(event) => void loadTrustedProducerPolicy(event.target.files)}
            />
          </div>
          <div className="trust-policy-status" aria-label="Trust policy status">
            <span>
              Trust policy:{" "}
              <strong>
                {trustedProducerPolicy.keys.length
                  ? trustedProducerPolicy.policyId
                  : "none"}
              </strong>
            </span>
            <span>
              {trustPolicyKeyCounts.active} active / {trustPolicyKeyCounts.revoked} revoked
            </span>
            {trustedProducerPolicyMessage && (
              <span>{trustedProducerPolicyMessage}</span>
            )}
          </div>
          {trustedProducerPolicy.keys.length > 0 && (
            <section className="trust-registry" aria-label="Trusted producer keys">
              <div className="panel-header">
                <h2>Trusted Producer Keys</h2>
                <strong>{trustedProducerPolicy.sourceLabel}</strong>
              </div>
              <div className="trust-key-list">
                {trustedProducerPolicy.keys.map((key) => (
                  <div className="trust-key-row" key={key.keyId}>
                    <span
                      className={`trust-key-status trust-key-${key.status}`}
                    >
                      {key.status}
                    </span>
                    <div>
                      <strong>{key.label}</strong>
                      <code>{shortHash(key.publicKeySha256)}</code>
                      <p>
                        {key.producerAdapter ?? "any adapter"} /{" "}
                        {key.allowedPacketTypes?.join(", ") ?? "any packet type"}
                      </p>
                      {key.note && <p className="muted">{key.note}</p>}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        void updateTrustedProducerKey(
                          key.keyId,
                          key.status === "revoked" ? "active" : "revoked",
                        )
                      }
                    >
                      {key.status === "revoked" ? "Reactivate" : "Revoke"}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
          {error && <p className="error-text">{error}</p>}

          {shouldShowResearchSetup && (
            <section
              className={
                researchPreflight.ready
                  ? "research-setup research-setup-ready"
                  : "research-setup research-setup-blocked"
              }
              aria-label="Research setup"
            >
              <div className="panel-header">
                <h2>Research setup</h2>
                <button
                  type="button"
                  onClick={refreshResearchSetup}
                  disabled={preflightLoading}
                >
                  {preflightLoading ? "Checking" : "Recheck"}
                </button>
              </div>
              <p>{researchPreflight.summary}</p>
              <div className="preflight-checks">
                {researchPreflight.checks.map((check) => (
                  <div className="preflight-row" key={check.key}>
                    <span className={`preflight-status preflight-${check.status}`}>
                      {check.status}
                    </span>
                    <div>
                      <strong>{check.label}</strong>
                      <span>{check.message}</span>
                    </div>
                  </div>
                ))}
              </div>
              {researchPreflight.fixes.length > 0 && (
                <ul className="preflight-fixes">
                  {researchPreflight.fixes.map((fix) => (
                    <li key={fix}>{fix}</li>
                  ))}
                </ul>
              )}
              {providerProfile && providerSetup && (
                <div className="provider-setup-form" aria-label="Provider Profiles">
                  <div className="profile-toolbar">
                    <label>
                      <span>Provider Profile</span>
                      <select
                        value={
                          providerSetup.profiles.profiles.some(
                            (profile) => profile.profileId === providerProfile.profileId,
                          )
                            ? providerProfile.profileId
                            : "new"
                        }
                        onChange={(event) => {
                          if (event.target.value !== "new") {
                            void selectProviderProfile(event.target.value);
                          }
                        }}
                        disabled={providerSetupSaving}
                      >
                        {providerSetup.profiles.profiles.map((profile) => (
                          <option key={profile.profileId} value={profile.profileId}>
                            {profile.name}
                          </option>
                        ))}
                        {!providerSetup.profiles.profiles.some(
                          (profile) => profile.profileId === providerProfile.profileId,
                        ) && <option value="new">New profile</option>}
                      </select>
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setProviderProfile(newProviderProfile());
                        setProviderSetupMessage(null);
                      }}
                      disabled={providerSetupSaving}
                    >
                      New
                    </button>
                    <button
                      type="button"
                      onClick={deleteProviderProfile}
                      disabled={
                        providerSetupSaving ||
                        !providerSetup.profiles.profiles.some(
                          (profile) => profile.profileId === providerProfile.profileId,
                        )
                      }
                    >
                      Delete
                    </button>
                  </div>

                  <label>
                    <span>Profile name</span>
                    <input
                      value={providerProfile.name}
                      onChange={(event) =>
                        setProviderProfile({
                          ...providerProfile,
                          name: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Model service</span>
                    <select
                      value={providerProfile.modelProvider}
                      onChange={(event) =>
                        changeModelProvider(event.target.value as ModelProvider)
                      }
                    >
                      <option value="deepseek">DeepSeek</option>
                      <option value="openai">OpenAI</option>
                      <option value="openai-compatible">OpenAI-compatible</option>
                      <option value="ollama">Ollama (local)</option>
                    </select>
                  </label>
                  <label>
                    <span>Model</span>
                    <input
                      value={providerProfile.model}
                      onChange={(event) =>
                        setProviderProfile({
                          ...providerProfile,
                          model: event.target.value,
                        })
                      }
                    />
                  </label>
                  {modelNeedsKey && (
                    <label>
                      <span>Model access key</span>
                      <input
                        type="password"
                        value={modelAccessKey}
                        onChange={(event) => setModelAccessKey(event.target.value)}
                        autoComplete="off"
                        placeholder={
                          modelKeyIsConfigured
                            ? "Saved - enter to replace"
                            : "Paste key"
                        }
                      />
                    </label>
                  )}
                  <label>
                    <span>Web search</span>
                    <select
                      value={providerProfile.searchProvider}
                      onChange={(event) =>
                        setProviderProfile({
                          ...providerProfile,
                          searchProvider: event.target.value as SearchProvider,
                        })
                      }
                    >
                      <option value="tavily">Tavily</option>
                      <option value="duckduckgo">DuckDuckGo (no key)</option>
                    </select>
                  </label>
                  {searchNeedsKey && (
                    <label>
                      <span>Web search key</span>
                      <input
                        type="password"
                        value={webSearchKey}
                        onChange={(event) => setWebSearchKey(event.target.value)}
                        autoComplete="off"
                        placeholder={
                          searchKeyIsConfigured
                            ? "Saved - enter to replace"
                            : "Paste key"
                        }
                      />
                    </label>
                  )}

                  <details className="provider-advanced">
                    <summary>Advanced</summary>
                    <div className="provider-advanced-grid">
                      {(providerProfile.modelProvider === "openai-compatible" ||
                        providerProfile.modelProvider === "ollama") && (
                        <label>
                          <span>Model base URL</span>
                          <input
                            value={providerProfile.modelBaseUrl ?? ""}
                            onChange={(event) => {
                              const modelBaseUrl = event.target.value || null;
                              setProviderProfile({
                                ...providerProfile,
                                modelBaseUrl,
                                embeddingBaseUrl:
                                  (providerProfile.modelProvider === "ollama" &&
                                    providerProfile.embeddingProvider === "ollama") ||
                                  (providerProfile.modelProvider === "openai-compatible" &&
                                    providerProfile.embeddingProvider === "openai")
                                    ? modelBaseUrl
                                    : providerProfile.embeddingBaseUrl,
                              });
                            }}
                          />
                        </label>
                      )}
                      <label>
                        <span>Document memory</span>
                        <select
                          value={providerProfile.embeddingProvider}
                          onChange={(event) =>
                            changeEmbeddingProvider(
                              event.target.value as EmbeddingProvider,
                            )
                          }
                        >
                          <option value="ollama">Ollama (local)</option>
                          <option value="openai">OpenAI-compatible</option>
                        </select>
                      </label>
                      <label>
                        <span>Embedding model</span>
                        <input
                          value={providerProfile.embeddingModel}
                          onChange={(event) =>
                            setProviderProfile({
                              ...providerProfile,
                              embeddingModel: event.target.value,
                            })
                          }
                        />
                      </label>
                      {!(
                        (providerProfile.modelProvider === "ollama" &&
                          providerProfile.embeddingProvider === "ollama") ||
                        (providerProfile.modelProvider === "openai-compatible" &&
                          providerProfile.embeddingProvider === "openai")
                      ) && (
                        <label>
                          <span>Embedding base URL</span>
                          <input
                            value={providerProfile.embeddingBaseUrl ?? ""}
                            onChange={(event) =>
                              setProviderProfile({
                                ...providerProfile,
                                embeddingBaseUrl: event.target.value || null,
                              })
                            }
                            placeholder={
                              providerProfile.embeddingProvider === "ollama"
                                ? "http://127.0.0.1:11434"
                                : "Optional"
                            }
                          />
                        </label>
                      )}
                      {embeddingNeedsSeparateKey && (
                        <label>
                          <span>Embedding access key</span>
                          <input
                            type="password"
                            value={embeddingAccessKey}
                            onChange={(event) =>
                              setEmbeddingAccessKey(event.target.value)
                            }
                            autoComplete="off"
                            placeholder={
                              embeddingKeyIsConfigured
                                ? "Saved - enter to replace"
                                : "Paste key"
                            }
                          />
                        </label>
                      )}
                    </div>
                  </details>

                  <div className="provider-setup-actions">
                    <button
                      type="button"
                      className="primary-action"
                      onClick={saveProviderSetup}
                      disabled={
                        providerSetupSaving ||
                        !providerProfile.name.trim() ||
                        !providerProfile.model.trim() ||
                        !providerProfile.embeddingModel.trim()
                      }
                    >
                      {providerSetupSaving ? "Saving" : "Save profile"}
                    </button>
                    <button
                      type="button"
                      onClick={clearProviderSetup}
                      disabled={providerSetupSaving || !editingStoredProfile}
                    >
                      Clear profile secrets
                    </button>
                  </div>
                  {providerSetupMessage && (
                    <p className="provider-setup-message">{providerSetupMessage}</p>
                  )}
                </div>
              )}
            </section>
          )}

          {activeTask ? (
            <div className="task-detail">
              <div className="status-grid">
                <div>
                  <span>Status</span>
                  <strong>{formatTaskStatus(activeTask.status)}</strong>
                </div>
                <div>
                  <span>Sources</span>
                  <strong>{activeTask.sources.length}</strong>
                </div>
                <div>
                  <span>Artifacts</span>
                  <strong>{activeTask.artifacts.length}</strong>
                </div>
              </div>

              <section className="plan-section">
                <h2>Plan</h2>
                <ol>
                  {activeTask.plan.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ol>
              </section>

              {pendingPermission && (
                <section className="permission-box">
                  <div>
                    <h2>Permission required</h2>
                    <p>
                      Wutai wants task-scoped public web research permission.
                      It will not access login pages, submit forms, modify
                      existing files, or control the desktop.
                    </p>
                    <ul>
                      {pendingPermission.scope.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="permission-actions">
                    <button
                      type="button"
                      className="primary-action"
                      onClick={() => resolvePermission("approved")}
                    >
                      Allow for this task
                    </button>
                    <button
                      type="button"
                      onClick={() => resolvePermission("denied")}
                    >
                      Deny
                    </button>
                  </div>
                </section>
              )}

              <section className="timeline-section">
                <h2>Timeline</h2>
                <div className="timeline">
                  {activeTask.events
                    .filter((event) => event.visibility === "user")
                    .map((event) => (
                      <div className="timeline-row" key={event.eventId}>
                        <time>{formatTime(event.timestamp)}</time>
                        <span>{event.summary}</span>
                      </div>
                    ))}
                </div>
              </section>

              {evidenceVerification && (
                <section
                  className={`evidence-section evidence-${evidenceVerification.status}`}
                  aria-label="Evidence Gate"
                >
                  <div className="panel-header">
                    <h2>Evidence Gate</h2>
                    <strong>
                      {evidenceStatusLabel(evidenceVerification.status)}
                    </strong>
                  </div>
                  <p>{evidenceVerification.summary}</p>
                  <div className="evidence-metrics">
                    <span>
                      Claims <strong>{evidenceVerification.metrics.claimCount}</strong>
                    </span>
                    <span>
                      Citation coverage{" "}
                      <strong>
                        {Math.round(
                          evidenceVerification.metrics.citationCoverage * 100,
                        )}
                        %
                      </strong>
                    </span>
                    <span>
                      Primary sources{" "}
                      <strong>
                        {evidenceVerification.metrics.primarySourceCount}
                      </strong>
                    </span>
                    <span>
                      Review items{" "}
                      <strong>
                        {evidenceVerification.metrics.highRiskGapCount +
                          evidenceVerification.metrics.conflictCount}
                      </strong>
                    </span>
                  </div>
                  <div className="evidence-checks">
                    {evidenceVerification.checks.map((check) => (
                      <div key={check.key}>
                        <span className={`preflight-status preflight-${check.status}`}>
                          {check.status}
                        </span>
                        <p>{check.message}</p>
                      </div>
                    ))}
                  </div>
                  <div className="evidence-actions">
                    {claimsArtifact && (
                      <button
                        type="button"
                        onClick={() =>
                          downloadArtifact(claimsArtifact.name, claimsArtifact.content)
                        }
                      >
                        Download claims
                      </button>
                    )}
                    {verificationArtifact && (
                      <button
                        type="button"
                        onClick={() =>
                          downloadArtifact(
                            verificationArtifact.name,
                            verificationArtifact.content,
                          )
                        }
                      >
                        Download verification
                      </button>
                    )}
                    {manifestArtifact && (
                      <button
                        type="button"
                        onClick={() =>
                          downloadArtifact(
                            manifestArtifact.name,
                            manifestArtifact.content,
                          )
                        }
                      >
                        Download manifest
                      </button>
                    )}
                  </div>
                </section>
              )}

              {cliPacketReview && (
                <section className="cli-review-section" aria-label="CLI Packet Review">
                  <div className="panel-header">
                    <h2>CLI Packet Review</h2>
                    <strong>{cliPacketReview.policy?.decision ?? "unknown"}</strong>
                  </div>
                  <div className="cli-review-grid">
                    <div>
                      <span>Policy</span>
                      <strong>{cliPacketReview.policy?.highestSeverity ?? "unknown"}</strong>
                    </div>
                    <div>
                      <span>Exit</span>
                      <strong>
                        {cliPacketReview.trace?.exitCode ??
                          cliPacketReview.manifest.session?.exitCode ??
                          "n/a"}
                      </strong>
                    </div>
                    <div>
                      <span>Tool calls</span>
                      <strong>{cliPacketReview.manifest.audit?.toolCallCount ?? 0}</strong>
                    </div>
                    <div>
                      <span>Runtime events</span>
                      <strong>
                        {cliPacketReview.manifest.audit?.runtimeEventCount ?? 0}
                      </strong>
                    </div>
                  </div>
                  <p>
                    {cliPacketReview.trace?.command ??
                      cliPacketReview.manifest.session?.command ??
                      "Command unavailable"}
                  </p>
                  {cliPacketReview.trustVerdict && (
                    <div
                      className={`trust-verdict-panel trust-verdict-${cliPacketReview.trustVerdict.verdict ?? "review_required"}`}
                    >
                      <div className="panel-header">
                        <h3>Trust Verdict</h3>
                        <strong>
                          {trustVerdictLabel(cliPacketReview.trustVerdict.verdict)}
                        </strong>
                      </div>
                      <p>
                        {cliPacketReview.trustVerdict.summary ??
                          "Trust verdict unavailable."}
                      </p>
                      <div className="trust-verdict-metrics">
                        <span>
                          Blocked{" "}
                          <strong>
                            {cliPacketReview.trustVerdict.metrics?.blocked ?? 0}
                          </strong>
                        </span>
                        <span>
                          Review{" "}
                          <strong>
                            {cliPacketReview.trustVerdict.metrics?.reviewRequired ??
                              0}
                          </strong>
                        </span>
                        <span>
                          Passed{" "}
                          <strong>
                            {cliPacketReview.trustVerdict.metrics?.passed ?? 0}
                          </strong>
                        </span>
                        <span>
                          Producer{" "}
                          <strong>
                            {cliPacketReview.trustVerdict.inputs?.trustedProducer
                              ? "trusted"
                              : "not trusted"}
                          </strong>
                        </span>
                      </div>
                      <div className="trust-check-list">
                        {cliPacketReview.trustVerdict.checks?.map((check, index) => (
                          <div key={`${check.name ?? "trust_check"}_${index}`}>
                            <span
                              className={`trust-verdict-status trust-verdict-check-${check.status ?? "review_required"}`}
                            >
                              {trustVerdictLabel(check.status)}
                            </span>
                            <div>
                              <strong>{check.name ?? "trust check"}</strong>
                              <p>{check.message ?? "No trust verdict detail recorded."}</p>
                              {check.ruleId && <small>Rule: {check.ruleId}</small>}
                              {check.evidence && <code>{check.evidence}</code>}
                            </div>
                          </div>
                        ))}
                      </div>
                      {cliPacketReview.trustVerdict.limitation && (
                        <p className="muted">
                          {cliPacketReview.trustVerdict.limitation}
                        </p>
                      )}
                    </div>
                  )}
                  {cliDryRunReview && (
                    <div className="dry-run-review-panel" aria-label="Dry-run Review">
                      <div className="panel-header">
                        <h3>Dry-run Review</h3>
                        <strong>
                          {cliDryRunReview.review?.decision ??
                            (cliDryRunReview.pendingExecutionPermission
                              ? "pending"
                              : "resolved")}
                        </strong>
                      </div>
                      <div className="dry-run-review-grid">
                        <span>
                          Profile{" "}
                          <strong>
                            {cliPacketReview.policy?.profile?.profileId ??
                              cliPacketReview.manifest.audit?.policyProfile ??
                              "unknown"}
                          </strong>
                        </span>
                        <span>
                          Execution{" "}
                          <strong>
                            {cliPacketReview.policy?.executionMode ??
                              cliPacketReview.manifest.audit?.executionMode ??
                              cliPacketReview.manifest.session?.executionMode ??
                              "dry_run"}
                          </strong>
                        </span>
                        <span>
                          Command ran{" "}
                          <strong>{cliPacketReview.trace?.executed ? "yes" : "no"}</strong>
                        </span>
                      </div>
                      {cliDryRunReview.review ? (
                        <p>
                          {cliDryRunReview.review.note ??
                            "Dry-run review decision recorded."}
                        </p>
                      ) : (
                        <p>
                          Execution is still pending. Recording a decision here
                          updates local review history only; Wutai desktop does
                          not execute this command.
                        </p>
                      )}
                      {cliDryRunReview.pendingExecutionPermission &&
                        !cliDryRunReview.review && (
                          <div className="dry-run-review-actions">
                            <button
                              type="button"
                              onClick={() => void recordDryRunReview("approved")}
                            >
                              Record approve
                            </button>
                            <button
                              type="button"
                              onClick={() => void recordDryRunReview("denied")}
                            >
                              Record deny
                            </button>
                          </div>
                        )}
                    </div>
                  )}
                  {cliPacketReview.policy?.matchedRules?.length ? (
                    <div className="cli-rule-list">
                      {cliPacketReview.policy.matchedRules.map((rule, index) => (
                        <div key={`${rule.ruleId ?? "rule"}_${index}`}>
                          <span className="preflight-status preflight-warning">
                            {rule.ruleId ?? "rule"}
                          </span>
                          <div>
                            <p>{rule.message ?? "Matched policy rule."}</p>
                            <code>
                              {rule.defaultAction ??
                                rule.ruleOverride?.baseEffectiveAction ??
                                "n/a"}{" "}
                              -&gt;{" "}
                              {rule.effectiveAction ??
                                rule.ruleOverride?.effectiveAction ??
                                "n/a"}
                            </code>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">No policy rules matched this packet.</p>
                  )}

                  {cliPacketReview.policyReview && (
                    <div
                      className={`policy-review-panel policy-review-${cliPacketReview.policyReview.status ?? "warning"}`}
                    >
                      <div className="panel-header">
                        <h3>Policy Override Review</h3>
                        <strong>{cliPacketReview.policyReview.status ?? "warning"}</strong>
                      </div>
                      <p>
                        {cliPacketReview.policyReview.summary ??
                          "Policy override review unavailable."}
                      </p>
                      <div className="policy-review-metrics">
                        <span>
                          Matched{" "}
                          <strong>
                            {cliPacketReview.policyReview.metrics?.matchedRuleCount ??
                              cliPacketReview.policyReview.policy?.matchedRuleCount ??
                              0}
                          </strong>
                        </span>
                        <span>
                          Changes{" "}
                          <strong>
                            {cliPacketReview.policyReview.metrics?.ruleOverrideCount ??
                              0}
                          </strong>
                        </span>
                        <span>
                          Missing reason{" "}
                          <strong>
                            {cliPacketReview.policyReview.metrics
                              ?.missingOverrideReasonCount ?? 0}
                          </strong>
                        </span>
                        <span>
                          High-risk allow{" "}
                          <strong>
                            {cliPacketReview.policyReview.metrics?.highRiskAllowCount ??
                              0}
                          </strong>
                        </span>
                      </div>
                      {cliPacketReview.policyReview.ruleOverrides?.length ? (
                        <div className="policy-override-list">
                          {cliPacketReview.policyReview.ruleOverrides.map(
                            (rule, index) => (
                              <div key={`${rule.ruleId ?? "override"}_${index}`}>
                                <span
                                  className={`policy-review-status policy-review-check-${
                                    rule.severity === "high" &&
                                    rule.effectiveAction === "allow"
                                      ? "warning"
                                      : "passed"
                                  }`}
                                >
                                  {policyReviewSourceLabel(rule.source)}
                                </span>
                                <div>
                                  <strong>{rule.ruleId ?? "policy rule"}</strong>
                                  <code>
                                    {rule.defaultAction ?? "n/a"} -&gt;{" "}
                                    {rule.effectiveAction ?? "n/a"}
                                  </code>
                                  <p>
                                    {rule.reason ??
                                      "Rule override is missing rationale."}
                                  </p>
                                  {rule.message && <p>{rule.message}</p>}
                                  {rule.reviewScope?.length ? (
                                    <small>{rule.reviewScope.join(", ")}</small>
                                  ) : null}
                                </div>
                              </div>
                            ),
                          )}
                        </div>
                      ) : (
                        <p className="muted">
                          No rule-level overrides or effective action changes were
                          recorded.
                        </p>
                      )}
                      <div className="policy-check-list">
                        {cliPacketReview.policyReview.checks?.map((check, index) => (
                          <div key={`${check.name ?? "policy_check"}_${index}`}>
                            <span
                              className={`policy-review-status policy-review-check-${check.status ?? "warning"}`}
                            >
                              {check.status ?? "warning"}
                            </span>
                            <div>
                              <strong>{check.name ?? "policy check"}</strong>
                              <p>{check.message ?? "No policy review detail recorded."}</p>
                              {check.evidence && <code>{check.evidence}</code>}
                            </div>
                          </div>
                        ))}
                      </div>
                      {cliPacketReview.policyReview.limitation && (
                        <p className="muted">
                          {cliPacketReview.policyReview.limitation}
                        </p>
                      )}
                    </div>
                  )}

                  {cliPacketReview.integrity && (
                    <div
                      className={`integrity-panel integrity-${cliPacketReview.integrity.status ?? "incomplete"}`}
                    >
                      <div className="panel-header">
                        <h3>Manifest Integrity</h3>
                        <strong>{cliPacketReview.integrity.status ?? "incomplete"}</strong>
                      </div>
                      <p>{cliPacketReview.integrity.summary ?? "Integrity check unavailable."}</p>
                      <div className="integrity-metrics">
                        <span>
                          Passed{" "}
                          <strong>{cliPacketReview.integrity.metrics?.passed ?? 0}</strong>
                        </span>
                        <span>
                          Mismatch{" "}
                          <strong>
                            {cliPacketReview.integrity.metrics?.mismatched ?? 0}
                          </strong>
                        </span>
                        <span>
                          Missing{" "}
                          <strong>{cliPacketReview.integrity.metrics?.missing ?? 0}</strong>
                        </span>
                        <span>
                          Unverified{" "}
                          <strong>
                            {cliPacketReview.integrity.metrics?.unverifiable ?? 0}
                          </strong>
                        </span>
                      </div>
                      <div className="integrity-check-list">
                        {cliPacketReview.integrity.checks?.map((check, index) => (
                          <div key={`${check.name ?? "artifact"}_${index}`}>
                            <span
                              className={`integrity-status integrity-check-${check.status ?? "unverifiable"}`}
                            >
                              {check.status ?? "unverifiable"}
                            </span>
                            <div>
                              <strong>{check.name ?? "unknown artifact"}</strong>
                              <p>{check.message ?? "No check detail recorded."}</p>
                              <code>
                                expected {shortHash(check.expectedSha256)} / actual{" "}
                                {shortHash(check.actualSha256)}
                              </code>
                            </div>
                          </div>
                        ))}
                      </div>
                      {cliPacketReview.integrity.limitation && (
                        <p className="muted">{cliPacketReview.integrity.limitation}</p>
                      )}
                    </div>
                  )}

                  {cliPacketReview.provenance && (
                    <div
                      className={`provenance-panel provenance-${cliPacketReview.provenance.status ?? "warning"}`}
                    >
                      <div className="panel-header">
                        <h3>Packet Provenance</h3>
                        <div className="panel-actions">
                          {canEnrollTrustedProducerKey && (
                            <button
                              type="button"
                              onClick={enrollCurrentPacketProducerKey}
                            >
                              Trust this producer key
                            </button>
                          )}
                          <strong>
                            {cliPacketReview.provenance.status ?? "warning"}
                          </strong>
                        </div>
                      </div>
                      <p>
                        {cliPacketReview.provenance.summary ??
                          "Packet provenance check unavailable."}
                      </p>
                      <div className="provenance-metrics">
                        <span>
                          Manifest{" "}
                          <strong>
                            {shortHash(cliPacketReview.provenance.manifest?.sha256)}
                          </strong>
                        </span>
                        <span>
                          Producer{" "}
                          <strong>
                            {cliPacketReview.provenance.manifest?.producerAdapter ??
                              "unknown"}
                          </strong>
                        </span>
                        <span>
                          Attestation{" "}
                          <strong>
                            {cliPacketReview.provenance.attestation?.verified
                              ? "verified"
                              : cliPacketReview.provenance.attestation?.present
                                ? "failed"
                                : "missing"}
                          </strong>
                        </span>
                        <span>
                          Trust Key{" "}
                          <strong>
                            {cliPacketReview.provenance.attestation?.trustedKey
                              ? (cliPacketReview.provenance.trustPolicy?.matchedLabel ??
                                "trusted")
                              : (cliPacketReview.provenance.trustPolicy?.status ??
                                "untrusted")}
                          </strong>
                        </span>
                        <span>
                          Warnings{" "}
                          <strong>
                            {cliPacketReview.provenance.metrics?.warnings ?? 0}
                          </strong>
                        </span>
                        <span>
                          Failed{" "}
                          <strong>{cliPacketReview.provenance.metrics?.failed ?? 0}</strong>
                        </span>
                      </div>
                      <div className="provenance-check-list">
                        {cliPacketReview.provenance.checks?.map((check, index) => (
                          <div key={`${check.name ?? "check"}_${index}`}>
                            <span
                              className={`provenance-status provenance-check-${check.status ?? "warning"}`}
                            >
                              {check.status ?? "warning"}
                            </span>
                            <div>
                              <strong>{check.name ?? "unknown check"}</strong>
                              <p>{check.message ?? "No provenance detail recorded."}</p>
                              {check.evidence && <code>{check.evidence}</code>}
                            </div>
                          </div>
                        ))}
                      </div>
                      {cliPacketReview.provenance.limitation && (
                        <p className="muted">{cliPacketReview.provenance.limitation}</p>
                      )}
                    </div>
                  )}

                  {cliPacketReview.audit && (
                    <div className="audit-detail-panel">
                      <div className="panel-header">
                        <h3>Audit Details</h3>
                        <strong>{auditArtifact?.name ?? "audit.json"}</strong>
                      </div>
                      <div className="audit-filter-bar" aria-label="Audit filter">
                        {AUDIT_FILTERS.map((filter) => (
                          <button
                            key={filter.id}
                            type="button"
                            aria-pressed={auditFilter === filter.id}
                            onClick={() => setAuditFilter(filter.id)}
                          >
                            {filter.label}
                          </button>
                        ))}
                      </div>
                      <p className="audit-filter-summary">
                        Showing {cliAuditVisibleCount} of {cliAuditTotalCount} audit
                        records.
                      </p>
                      {visibleCliAuditGroups.map((group) => (
                        <AuditRecordList
                          key={group.id}
                          title={group.title}
                          records={group.records}
                          fields={group.fields}
                        />
                      ))}
                    </div>
                  )}

                  <div className="evidence-actions">
                    {[
                      policyArtifact,
                      traceArtifact,
                      ledgerArtifact,
                      auditArtifact,
                      integrityArtifact,
                      provenanceArtifact,
                      policyReviewArtifact,
                      trustVerdictArtifact,
                      reviewArtifact,
                    ]
                      .filter(Boolean)
                      .map((artifact) => (
                        <button
                          key={artifact!.artifactId}
                          type="button"
                          onClick={() =>
                            downloadArtifact(artifact!.name, artifact!.content)
                          }
                        >
                          Download {artifact!.name}
                        </button>
                      ))}
                  </div>
                </section>
              )}

              {localFileReview && (
                <section className="artifact-section">
                  <div className="panel-header">
                    <h2>Local File Hash Review</h2>
                    <div className="panel-actions">
                      <button
                        type="button"
                        onClick={() => localFileRecheckInputRef.current?.click()}
                      >
                        Re-check local file hashes
                      </button>
                      {filesArtifact && (
                        <button
                          type="button"
                          onClick={() =>
                            downloadArtifact(filesArtifact.name, filesArtifact.content)
                          }
                        >
                          Download files.json
                        </button>
                      )}
                      {fileCheckArtifact && (
                        <button
                          type="button"
                          onClick={() =>
                            downloadArtifact(
                              fileCheckArtifact.name,
                              fileCheckArtifact.content,
                            )
                          }
                        >
                          Download file-check.json
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="integrity-metrics">
                    <span>
                      Files{" "}
                      <strong>{localFileReview.files?.files?.length ?? 0}</strong>
                    </span>
                    <span>
                      Last Check{" "}
                      <strong>{localFileReview.check?.status ?? "not run"}</strong>
                    </span>
                    <span>
                      Summary{" "}
                      <strong>{localFileReview.check?.summary ?? "n/a"}</strong>
                    </span>
                  </div>
                  {localFileReview.check ? (
                    <div className="integrity-check-list">
                      {localFileReview.check.checks.map((check, index) => (
                        <div key={`${check.path}_${index}`}>
                          <span
                            className={`integrity-status integrity-check-${
                              check.status === "passed" ? "passed" : "mismatch"
                            }`}
                          >
                            {check.status}
                          </span>
                          <div>
                            <strong>{check.path}</strong>
                            <p>{check.message}</p>
                            <code>
                              expected {shortHash(check.expectedSha256)} / actual{" "}
                              {shortHash(check.actualSha256)}
                            </code>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">
                      No hash re-check has been recorded for this file packet.
                    </p>
                  )}
                  {localFileReview.files?.limitation && (
                    <p className="muted">{localFileReview.files.limitation}</p>
                  )}
                </section>
              )}

              {reportArtifact && (
                <section className="artifact-section">
                  <div className="panel-header">
                    <h2>Artifact preview</h2>
                    <div className="panel-actions">
                      {manifestArtifact && !evidenceVerification && (
                        <button
                          type="button"
                          onClick={() =>
                            downloadArtifact(
                              manifestArtifact.name,
                              manifestArtifact.content,
                            )
                          }
                        >
                          Download manifest
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          downloadArtifact(reportArtifact.name, reportArtifact.content)
                        }
                      >
                        Download report.md
                      </button>
                    </div>
                  </div>
                  <pre>{reportArtifact.content}</pre>
                </section>
              )}
            </div>
          ) : (
            <div className="empty-state">
              <h2>Ready</h2>
              <p>
                Create the core research task, import a local script trace, or
                review a CLI packet directory.
              </p>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

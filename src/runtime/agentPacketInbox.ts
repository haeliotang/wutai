import type { ArtifactRecord, TaskStatus, WutaiTask } from "../domain/task";
import type { AgentAdapterDefinition } from "./adapterRegistry";

export type AgentPacketVerdict = "trusted" | "review_required" | "blocked";
export type AgentPacketRetentionDecision = "retained" | "rejected";

export interface AgentPacketInboxItem {
  taskId: string;
  title: string;
  taskStatus: TaskStatus;
  updatedAt: string;
  packetId: string;
  packetType: string;
  producerAdapter: string;
  producerLabel: string;
  producerRuntime?: string;
  adapterStatus: AgentAdapterDefinition["integrationStatus"] | "unknown";
  command?: string;
  exitCode?: number | null;
  artifactCount: number;
  verdict: AgentPacketVerdict | "no_verdict";
  verdictSummary?: string;
  integrityStatus?: string;
  provenanceStatus?: string;
  policyDecision?: string;
  policyProfile?: string;
  trustedProducer?: boolean;
  attestationState: "trusted" | "verified" | "failed" | "missing";
  blockedGateCount: number;
  reviewGateCount: number;
  retentionDecision?: AgentPacketRetentionDecision;
  retentionGeneratedAt?: string;
  searchText: string;
}

export interface AgentPacketInboxFilters {
  query?: string;
  producer?: string;
  verdict?: AgentPacketInboxItem["verdict"] | "all";
  retention?: AgentPacketRetentionDecision | "all" | "undecided";
}

interface ManifestLike {
  kind?: string;
  packetId?: string;
  packetType?: string;
  taskId?: string;
  title?: string;
  status?: string;
  producer?: {
    adapter?: string;
    name?: string;
    runtime?: string;
  };
  session?: {
    command?: string | null;
    exitCode?: number | null;
  };
  audit?: {
    policyDecision?: string;
    policyProfile?: string;
  };
  artifacts?: unknown[];
}

interface TrustVerdictLike {
  kind?: string;
  verdict?: AgentPacketVerdict;
  summary?: string;
  inputs?: {
    integrityStatus?: string;
    provenanceStatus?: string;
    policyDecision?: string;
    trustedProducer?: boolean;
  };
  metrics?: {
    blocked?: number;
    reviewRequired?: number;
  };
}

interface ProvenanceLike {
  kind?: string;
  status?: string;
  attestation?: {
    present?: boolean;
    verified?: boolean;
    trustedKey?: boolean;
  };
}

interface PolicyLike {
  kind?: string;
  decision?: string;
  profile?: {
    profileId?: string;
  };
}

interface RetentionLike {
  kind?: string;
  decision?: AgentPacketRetentionDecision;
  generatedAt?: string;
}

function parseJson<T>(artifact?: ArtifactRecord | null): T | null {
  if (!artifact) return null;
  try {
    return JSON.parse(artifact.content) as T;
  } catch {
    return null;
  }
}

function artifactByName(task: WutaiTask, name: string) {
  return task.artifacts.find((artifact) => artifact.name === name) ?? null;
}

function adapterById(
  registry: AgentAdapterDefinition[],
  adapterId: string,
): AgentAdapterDefinition | null {
  return registry.find((adapter) => adapter.adapterId === adapterId) ?? null;
}

function attestationState(provenance: ProvenanceLike | null) {
  const attestation = provenance?.attestation;
  if (attestation?.trustedKey) return "trusted";
  if (attestation?.verified) return "verified";
  if (attestation?.present) return "failed";
  return "missing";
}

export function buildAgentPacketInbox(
  tasks: WutaiTask[],
  registry: AgentAdapterDefinition[],
): AgentPacketInboxItem[] {
  return tasks
    .map((task): AgentPacketInboxItem | null => {
      const manifest = parseJson<ManifestLike>(artifactByName(task, "manifest.json"));
      if (manifest?.kind !== "wutai.work_packet_manifest") return null;

      const producerAdapter = manifest.producer?.adapter ?? "unknown";
      const adapter = adapterById(registry, producerAdapter);
      const trustVerdict = parseJson<TrustVerdictLike>(
        artifactByName(task, "trust-verdict.json"),
      );
      const provenance = parseJson<ProvenanceLike>(
        artifactByName(task, "provenance.json"),
      );
      const policy = parseJson<PolicyLike>(artifactByName(task, "policy.json"));
      const retention = parseJson<RetentionLike>(
        artifactByName(task, "retention.json"),
      );
      const command = manifest.session?.command ?? undefined;
      const verdict =
        trustVerdict?.kind === "wutai.trust_verdict" && trustVerdict.verdict
          ? trustVerdict.verdict
          : "no_verdict";
      const policyDecision =
        trustVerdict?.inputs?.policyDecision ??
        policy?.decision ??
        manifest.audit?.policyDecision;
      const policyProfile = policy?.profile?.profileId ?? manifest.audit?.policyProfile;
      const packetType = manifest.packetType ?? "unknown";
      const packetId = manifest.packetId ?? `${task.taskId}_work_packet`;
      const producerLabel =
        adapter?.label ?? manifest.producer?.name ?? producerAdapter;
      const searchText = [
        task.title,
        task.userRequest,
        packetId,
        packetType,
        producerAdapter,
        producerLabel,
        command,
        verdict,
        policyDecision,
        policyProfile,
        retention?.decision,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return {
        taskId: task.taskId,
        title: manifest.title ?? task.title,
        taskStatus: task.status,
        updatedAt: task.updatedAt,
        packetId,
        packetType,
        producerAdapter,
        producerLabel,
        producerRuntime: manifest.producer?.runtime,
        adapterStatus: adapter?.integrationStatus ?? "unknown",
        command,
        exitCode: manifest.session?.exitCode,
        artifactCount: manifest.artifacts?.length ?? task.artifacts.length,
        verdict,
        verdictSummary: trustVerdict?.summary,
        integrityStatus: trustVerdict?.inputs?.integrityStatus,
        provenanceStatus:
          trustVerdict?.inputs?.provenanceStatus ?? provenance?.status,
        policyDecision,
        policyProfile,
        trustedProducer: trustVerdict?.inputs?.trustedProducer,
        attestationState: attestationState(provenance),
        blockedGateCount: trustVerdict?.metrics?.blocked ?? 0,
        reviewGateCount: trustVerdict?.metrics?.reviewRequired ?? 0,
        retentionDecision:
          retention?.kind === "wutai.packet_retention_decision"
            ? retention.decision
            : undefined,
        retentionGeneratedAt:
          retention?.kind === "wutai.packet_retention_decision"
            ? retention.generatedAt
            : undefined,
        searchText,
      };
    })
    .filter((item): item is AgentPacketInboxItem => Boolean(item))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function filterAgentPacketInbox(
  items: AgentPacketInboxItem[],
  filters: AgentPacketInboxFilters,
) {
  const query = filters.query?.trim().toLowerCase() ?? "";
  return items.filter((item) => {
    if (query && !item.searchText.includes(query)) return false;
    if (filters.producer && filters.producer !== "all") {
      if (item.producerAdapter !== filters.producer) return false;
    }
    if (filters.verdict && filters.verdict !== "all") {
      if (item.verdict !== filters.verdict) return false;
    }
    if (filters.retention && filters.retention !== "all") {
      if (filters.retention === "undecided") {
        if (item.retentionDecision) return false;
      } else if (item.retentionDecision !== filters.retention) {
        return false;
      }
    }
    return true;
  });
}

export function summarizeAgentPacketInbox(items: AgentPacketInboxItem[]) {
  const producers = new Set(items.map((item) => item.producerAdapter));
  return {
    total: items.length,
    producers: producers.size,
    trusted: items.filter((item) => item.verdict === "trusted").length,
    reviewRequired: items.filter((item) => item.verdict === "review_required")
      .length,
    blocked: items.filter((item) => item.verdict === "blocked").length,
    noVerdict: items.filter((item) => item.verdict === "no_verdict").length,
    retained: items.filter((item) => item.retentionDecision === "retained").length,
    rejected: items.filter((item) => item.retentionDecision === "rejected").length,
  };
}

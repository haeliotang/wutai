import type { EvidenceVerification } from "./evidence";
import type {
  ArtifactRecord,
  PermissionRequest,
  TaskEvent,
  WutaiTask,
} from "./task";

export type WorkPacketType =
  | "research"
  | "coding_agent"
  | "browser_task"
  | "local_script";

export interface WorkPacketProducer {
  name: "wutai";
  adapter: string;
  runtime: string;
}

export interface WorkPacketSession {
  sessionId: string;
  subject: string;
  command?: string;
  workingDirectory?: string;
  startedAt?: string;
  completedAt?: string;
  exitCode?: number | null;
  importedTrace?: boolean;
}

export interface WorkPacketCoverage {
  captured: string[];
  blindSpots: string[];
  enforcement: string[];
}

export interface WorkPacketEvidenceSurface {
  claimsArtifact?: string;
  sourcesArtifact?: string;
  unsupportedItems?: string[];
  blindSpots?: string[];
}

export interface WorkPacketAuditSurface {
  credentialPurposes?: string[];
  toolCallCount?: number;
  runtimeEventCount?: number;
  auditArtifacts?: string[];
}

export interface WorkPacketManifestInput {
  task: WutaiTask;
  artifacts: ArtifactRecord[];
  createdAt: string;
  packetType: WorkPacketType;
  producer: WorkPacketProducer;
  session?: Partial<WorkPacketSession>;
  audit?: WorkPacketAuditSurface;
  evidenceVerification?: EvidenceVerification;
  evidenceSurface?: WorkPacketEvidenceSurface;
  coverage?: Partial<WorkPacketCoverage>;
}

const DEFAULT_RESEARCH_COVERAGE: WorkPacketCoverage = {
  captured: [
    "task_request",
    "task_plan",
    "permission_decisions",
    "user_visible_events",
    "artifacts",
    "sources",
    "claims",
    "evidence_verification",
  ],
  blindSpots: [
    "v0.2 manifest is generated from Wutai-captured events only.",
    "External agent activity outside the active adapter boundary is not captured.",
    "Evidence Gate checks extracted claims; it does not verify every statement.",
  ],
  enforcement: [
    "v0.1 enforces task-scoped public web-research permission for this workflow.",
    "General external-agent permission enforcement is not implemented yet.",
  ],
};

const DEFAULT_LOCAL_SCRIPT_COVERAGE: WorkPacketCoverage = {
  captured: [
    "task_request",
    "task_plan",
    "permission_decisions",
    "user_visible_events",
    "imported_command_trace",
    "runtime_events",
    "artifacts",
    "audit_trail",
  ],
  blindSpots: [
    "v0.2 local-script support imports a declared trace; Wutai does not execute or sandbox the command.",
    "Files touched outside the imported trace are not independently discovered.",
    "No stdout, stderr, or filesystem content is captured unless the trace declares it.",
  ],
  enforcement: [
    "Trace import records the boundary after execution; it does not enforce shell permissions.",
    "Runtime-enforced CLI policy supervision is not implemented in this trace-import path.",
  ],
};

const DEFAULT_FUTURE_SESSION_COVERAGE: WorkPacketCoverage = {
  captured: [
    "task_request",
    "task_plan",
    "permission_decisions",
    "user_visible_events",
    "artifacts",
    "audit_trail",
  ],
  blindSpots: [
    "This packet type is schema-ready, but no runtime adapter is implemented for it yet.",
    "External activity outside Wutai-captured events is not captured.",
  ],
  enforcement: [
    "Permission semantics can be recorded, but runtime enforcement depends on a future adapter.",
  ],
};

function defaultCoverage(packetType: WorkPacketType): WorkPacketCoverage {
  if (packetType === "research") return DEFAULT_RESEARCH_COVERAGE;
  if (packetType === "local_script") return DEFAULT_LOCAL_SCRIPT_COVERAGE;
  return DEFAULT_FUTURE_SESSION_COVERAGE;
}

function mergeCoverage(
  packetType: WorkPacketType,
  coverage?: Partial<WorkPacketCoverage>,
): WorkPacketCoverage {
  const defaults = defaultCoverage(packetType);
  return {
    captured: coverage?.captured ?? defaults.captured,
    blindSpots: coverage?.blindSpots ?? defaults.blindSpots,
    enforcement: coverage?.enforcement ?? defaults.enforcement,
  };
}

function artifactRole(name: string) {
  if (name === "report.md") return "primary_artifact";
  if (name === "sources.json") return "source_ledger";
  if (name === "claims.json") return "claim_ledger";
  if (name === "verification.json") return "evidence_verification";
  if (name === "policy.json") return "policy_preflight";
  if (name === "trace.json") return "runtime_trace";
  if (name === "ledger.json") return "session_ledger";
  if (name === "audit.json") return "audit_trail";
  return "supporting_artifact";
}

async function sha256Hex(content: string) {
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function permissionSummary(permission: PermissionRequest) {
  return {
    requestId: permission.requestId,
    status: permission.status,
    types: permission.types,
    scope: permission.scope,
    createdAt: permission.createdAt,
    resolvedAt: permission.resolvedAt ?? null,
  };
}

function countEventsByType(events: TaskEvent[]) {
  return events.reduce<Record<string, number>>((counts, event) => {
    counts[event.type] = (counts[event.type] ?? 0) + 1;
    return counts;
  }, {});
}

export async function buildWorkPacketManifest({
  task,
  artifacts,
  createdAt,
  packetType,
  producer,
  session,
  audit,
  evidenceVerification,
  evidenceSurface,
  coverage,
}: WorkPacketManifestInput) {
  const artifactsForManifest = artifacts.filter(
    (artifact) => artifact.name !== "manifest.json",
  );
  const inventory = await Promise.all(
    artifactsForManifest.map(async (artifact) => ({
      artifactId: artifact.artifactId,
      name: artifact.name,
      role: artifactRole(artifact.name),
      type: artifact.type,
      virtualPath: artifact.virtualPath,
      createdAt: artifact.createdAt,
      producer,
      bytes: new TextEncoder().encode(artifact.content).byteLength,
      sha256: await sha256Hex(artifact.content),
    })),
  );

  const eventTypeCounts = countEventsByType(task.events);
  const auditArtifacts = audit?.auditArtifacts ?? ["audit.json"].filter((name) =>
    artifactsForManifest.some((artifact) => artifact.name === name),
  );
  const claimsArtifact =
    evidenceSurface?.claimsArtifact ??
    artifactsForManifest.find((artifact) => artifact.name === "claims.json")?.name;
  const sourcesArtifact =
    evidenceSurface?.sourcesArtifact ??
    artifactsForManifest.find((artifact) => artifact.name === "sources.json")?.name;
  const sessionId = session?.sessionId ?? task.taskId;

  return {
    schemaVersion: 2,
    kind: "wutai.work_packet_manifest",
    packetId: `${task.taskId}_work_packet`,
    packetType,
    taskId: task.taskId,
    sessionId,
    session: {
      sessionId,
      subject: session?.subject ?? task.title,
      command: session?.command ?? null,
      workingDirectory: session?.workingDirectory ?? null,
      startedAt: session?.startedAt ?? task.createdAt,
      completedAt: session?.completedAt ?? createdAt,
      exitCode: session?.exitCode ?? null,
      importedTrace: session?.importedTrace ?? false,
    },
    title: task.title,
    status: task.status,
    userRequest: task.userRequest,
    generatedAt: createdAt,
    producer,
    permissions: task.permissions.map(permissionSummary),
    audit: {
      eventCount: task.events.length,
      eventTypeCounts,
      permissionDecisionCount: task.permissions.filter(
        (permission) => permission.status !== "pending",
      ).length,
      toolCallCount:
        audit?.toolCallCount ?? (eventTypeCounts.ToolCallCaptured ?? 0),
      runtimeEventCount:
        audit?.runtimeEventCount ?? (eventTypeCounts.RuntimeEventCaptured ?? 0),
      credentialPurposes: audit?.credentialPurposes ?? [],
      auditArtifacts,
    },
    artifacts: inventory,
    evidence: evidenceVerification
      ? {
          status: evidenceVerification.status,
          readyForTrust: evidenceVerification.readyForTrust,
          summary: evidenceVerification.summary,
          metrics: evidenceVerification.metrics,
          claimsArtifact: claimsArtifact ?? null,
          sourcesArtifact: sourcesArtifact ?? null,
          verificationArtifact: "verification.json",
          unsupportedItems: evidenceSurface?.unsupportedItems ?? [],
          blindSpots: evidenceSurface?.blindSpots ?? [],
        }
      : {
          status: "not_available",
          readyForTrust: false,
          summary: "No evidence verification was captured for this work packet.",
          claimsArtifact: claimsArtifact ?? null,
          sourcesArtifact: sourcesArtifact ?? null,
          unsupportedItems: evidenceSurface?.unsupportedItems ?? [],
          blindSpots: evidenceSurface?.blindSpots ?? [],
        },
    coverage: mergeCoverage(packetType, coverage),
    humanReview: {
      attestation: "not_recorded",
      note: "Wutai prepared the review surface; no named human attestation is recorded in this packet.",
    },
  };
}

export async function appendWorkPacketManifest(
  input: WorkPacketManifestInput,
): Promise<ArtifactRecord[]> {
  const artifacts = input.artifacts.filter(
    (artifact) => artifact.name !== "manifest.json",
  );
  const manifest = await buildWorkPacketManifest({ ...input, artifacts });
  return [
    ...artifacts,
    {
      artifactId: `${input.task.taskId}_artifact_manifest`,
      taskId: input.task.taskId,
      type: "json",
      name: "manifest.json",
      virtualPath: `artifacts/${input.task.taskId}/manifest.json`,
      content: JSON.stringify(manifest, null, 2),
      createdAt: input.createdAt,
    },
  ];
}

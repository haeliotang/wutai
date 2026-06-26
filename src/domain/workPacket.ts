import type { EvidenceVerification } from "./evidence";
import type { ArtifactRecord, PermissionRequest, WutaiTask } from "./task";

export type WorkPacketType = "research";

export interface WorkPacketProducer {
  name: "wutai";
  adapter: string;
  runtime: string;
}

export interface WorkPacketCoverage {
  captured: string[];
  blindSpots: string[];
  enforcement: string[];
}

export interface WorkPacketManifestInput {
  task: WutaiTask;
  artifacts: ArtifactRecord[];
  createdAt: string;
  packetType: WorkPacketType;
  producer: WorkPacketProducer;
  evidenceVerification?: EvidenceVerification;
  coverage?: Partial<WorkPacketCoverage>;
}

const DEFAULT_COVERAGE: WorkPacketCoverage = {
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

function mergeCoverage(coverage?: Partial<WorkPacketCoverage>): WorkPacketCoverage {
  return {
    captured: coverage?.captured ?? DEFAULT_COVERAGE.captured,
    blindSpots: coverage?.blindSpots ?? DEFAULT_COVERAGE.blindSpots,
    enforcement: coverage?.enforcement ?? DEFAULT_COVERAGE.enforcement,
  };
}

function artifactRole(name: string) {
  if (name === "report.md") return "primary_artifact";
  if (name === "sources.json") return "source_ledger";
  if (name === "claims.json") return "claim_ledger";
  if (name === "verification.json") return "evidence_verification";
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

export async function buildWorkPacketManifest({
  task,
  artifacts,
  createdAt,
  packetType,
  producer,
  evidenceVerification,
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
      bytes: new TextEncoder().encode(artifact.content).byteLength,
      sha256: await sha256Hex(artifact.content),
    })),
  );

  return {
    schemaVersion: 2,
    kind: "wutai.work_packet_manifest",
    packetId: `${task.taskId}_work_packet`,
    packetType,
    taskId: task.taskId,
    sessionId: task.taskId,
    title: task.title,
    status: task.status,
    userRequest: task.userRequest,
    generatedAt: createdAt,
    producer,
    permissions: task.permissions.map(permissionSummary),
    artifacts: inventory,
    evidence: evidenceVerification
      ? {
          status: evidenceVerification.status,
          readyForTrust: evidenceVerification.readyForTrust,
          summary: evidenceVerification.summary,
          metrics: evidenceVerification.metrics,
          claimsArtifact: "claims.json",
          verificationArtifact: "verification.json",
        }
      : {
          status: "not_available",
          readyForTrust: false,
          summary: "No evidence verification was captured for this work packet.",
        },
    coverage: mergeCoverage(coverage),
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

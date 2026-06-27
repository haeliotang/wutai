import type {
  ArtifactRecord,
  PermissionRequest,
  TaskEvent,
  TaskStatus,
  WutaiTask,
} from "../domain/task";

type CliPacketFile = Pick<File, "name" | "text"> & {
  webkitRelativePath?: string;
};

const INTEGRITY_ARTIFACT_NAME = "integrity.json";
const PROVENANCE_ARTIFACT_NAME = "provenance.json";
const INTERNAL_IMPORT_ARTIFACT_NAMES = new Set([
  INTEGRITY_ARTIFACT_NAME,
  PROVENANCE_ARTIFACT_NAME,
]);
const REQUIRED_CLI_PACKET_ARTIFACTS = [
  "report.md",
  "policy.json",
  "trace.json",
  "ledger.json",
  "audit.json",
];

interface ManifestArtifact {
  name: string;
  role?: string;
  type?: "markdown" | "json";
  virtualPath?: string;
  createdAt?: string;
  bytes?: number;
  sha256?: string;
}

interface WorkPacketManifest {
  schemaVersion?: number;
  kind?: string;
  packetId?: string;
  packetType?: string;
  taskId?: string;
  sessionId?: string;
  title?: string;
  status?: string;
  userRequest?: string;
  generatedAt?: string;
  producer?: {
    name?: string;
    adapter?: string;
    runtime?: string;
  };
  permissions?: PermissionRequest[];
  artifacts?: ManifestArtifact[];
  session?: {
    command?: string | null;
    exitCode?: number | null;
    startedAt?: string;
    completedAt?: string;
  };
}

interface LedgerArtifact {
  task?: Partial<WutaiTask>;
}

interface IntegrityCheck {
  name: string;
  role?: string;
  expectedSha256?: string;
  actualSha256?: string;
  expectedBytes?: number;
  actualBytes?: number;
  status: "passed" | "mismatch" | "missing" | "unverifiable";
  message: string;
}

interface PacketIntegrityArtifact {
  schemaVersion: 1;
  kind: "wutai.packet_integrity_check";
  taskId: string;
  generatedAt: string;
  importMode: "directory" | "files";
  status: "passed" | "failed" | "incomplete";
  summary: string;
  metrics: {
    total: number;
    passed: number;
    mismatched: number;
    missing: number;
    unverifiable: number;
  };
  checks: IntegrityCheck[];
  limitation: string;
}

interface ProvenanceCheck {
  name: string;
  status: "passed" | "warning" | "failed";
  message: string;
  evidence?: string;
}

interface PacketProvenanceArtifact {
  schemaVersion: 1;
  kind: "wutai.packet_provenance_check";
  taskId: string;
  generatedAt: string;
  importMode: "directory" | "files";
  status: "passed" | "warning" | "failed";
  summary: string;
  manifest: {
    sha256: string;
    bytes: number;
    kind?: string;
    schemaVersion?: number;
    packetId?: string;
    packetType?: string;
    taskId?: string;
    sessionId?: string;
    generatedAt?: string;
    producerName?: string;
    producerAdapter?: string;
    producerRuntime?: string;
  };
  metrics: {
    total: number;
    passed: number;
    warnings: number;
    failed: number;
  };
  checks: ProvenanceCheck[];
  limitation: string;
}

function parseJson<T>(content: string, name: string): T {
  try {
    return JSON.parse(content) as T;
  } catch {
    throw new Error(`${name} is not valid JSON.`);
  }
}

function validStatus(status: unknown): TaskStatus {
  const allowed: TaskStatus[] = [
    "draft",
    "waiting_for_permission",
    "running",
    "completed",
    "completed_with_warnings",
    "failed",
    "cancelled",
  ];
  return allowed.includes(status as TaskStatus) ? (status as TaskStatus) : "completed";
}

function artifactType(name: string): ArtifactRecord["type"] {
  return name.endsWith(".md") ? "markdown" : "json";
}

async function sha256Hex(content: string) {
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function byteLength(content: string) {
  return new TextEncoder().encode(content).byteLength;
}

function safeJson(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function buildIntegrityArtifact(
  taskId: string,
  generatedAt: string,
  manifest: WorkPacketManifest,
  contentByName: Map<string, string>,
  importMode: "directory" | "files",
): Promise<PacketIntegrityArtifact> {
  const manifestArtifacts = manifest.artifacts ?? [];
  const checks: IntegrityCheck[] = [];

  for (const manifestArtifact of manifestArtifacts) {
    const content = contentByName.get(manifestArtifact.name);
    if (!content) {
      checks.push({
        name: manifestArtifact.name,
        role: manifestArtifact.role,
        expectedSha256: manifestArtifact.sha256,
        expectedBytes: manifestArtifact.bytes,
        status: "missing",
        message: "Manifest lists this artifact, but it was not selected for import.",
      });
      continue;
    }

    if (!manifestArtifact.sha256) {
      checks.push({
        name: manifestArtifact.name,
        role: manifestArtifact.role,
        actualSha256: await sha256Hex(content),
        expectedBytes: manifestArtifact.bytes,
        actualBytes: byteLength(content),
        status: "unverifiable",
        message: "Manifest does not provide a SHA-256 hash for this artifact.",
      });
      continue;
    }

    const actualSha256 = await sha256Hex(content);
    const actualBytes = byteLength(content);
    const matches = actualSha256 === manifestArtifact.sha256;
    checks.push({
      name: manifestArtifact.name,
      role: manifestArtifact.role,
      expectedSha256: manifestArtifact.sha256,
      actualSha256,
      expectedBytes: manifestArtifact.bytes,
      actualBytes,
      status: matches ? "passed" : "mismatch",
      message: matches
        ? "Selected artifact matches the manifest SHA-256."
        : "Selected artifact does not match the manifest SHA-256.",
    });
  }

  const metrics = {
    total: checks.length,
    passed: checks.filter((check) => check.status === "passed").length,
    mismatched: checks.filter((check) => check.status === "mismatch").length,
    missing: checks.filter((check) => check.status === "missing").length,
    unverifiable: checks.filter((check) => check.status === "unverifiable").length,
  };
  const status =
    metrics.mismatched > 0 || metrics.missing > 0
      ? "failed"
      : metrics.unverifiable > 0 || metrics.total === 0
        ? "incomplete"
        : "passed";

  return {
    schemaVersion: 1,
    kind: "wutai.packet_integrity_check",
    taskId,
    generatedAt,
    importMode,
    status,
    summary:
      status === "passed"
        ? `Verified ${metrics.passed} artifact hashes from the manifest.`
        : status === "failed"
          ? `Manifest hash check found ${metrics.mismatched} mismatch and ${metrics.missing} missing artifact.`
          : "Manifest hash check could not verify every artifact.",
    metrics,
    checks,
    limitation:
      "This verifies selected artifact bytes against manifest hashes. It does not prove the manifest itself was signed or produced by a trusted runtime.",
  };
}

async function buildProvenanceArtifact(
  taskId: string,
  generatedAt: string,
  manifest: WorkPacketManifest,
  manifestContent: string,
  contentByName: Map<string, string>,
  importMode: "directory" | "files",
): Promise<PacketProvenanceArtifact> {
  const checks: ProvenanceCheck[] = [
    {
      name: "manifest.json",
      status: "passed",
      message: "Selected manifest parsed as a Wutai CLI wrapper packet.",
      evidence: `kind=${manifest.kind ?? "unknown"} packetType=${manifest.packetType ?? "unknown"} producer=${manifest.producer?.adapter ?? "unknown"}`,
    },
    {
      name: "manifest_sha256",
      status: "passed",
      message: "Recorded the selected manifest byte hash for local provenance.",
      evidence: await sha256Hex(manifestContent),
    },
  ];

  const missingRequired = REQUIRED_CLI_PACKET_ARTIFACTS.filter(
    (name) => !contentByName.has(name),
  );
  checks.push({
    name: "required_artifacts",
    status: missingRequired.length ? "failed" : "passed",
    message: missingRequired.length
      ? `Missing required CLI packet artifacts: ${missingRequired.join(", ")}.`
      : "All required CLI packet artifacts were selected.",
  });

  const manifestArtifactNames = new Set(
    manifest.artifacts?.map((artifact) => artifact.name) ?? [],
  );
  const missingFromManifest = REQUIRED_CLI_PACKET_ARTIFACTS.filter(
    (name) => !manifestArtifactNames.has(name),
  );
  checks.push({
    name: "manifest_inventory",
    status: missingFromManifest.length ? "warning" : "passed",
    message: missingFromManifest.length
      ? `Manifest artifact inventory omits: ${missingFromManifest.join(", ")}.`
      : "Manifest artifact inventory includes the required CLI packet artifacts.",
    evidence: `${manifestArtifactNames.size} manifest artifact entries`,
  });

  const expectedKinds: Array<[string, string]> = [
    ["policy.json", "wutai.cli_policy_preflight"],
    ["trace.json", "wutai.local_script_trace"],
    ["ledger.json", "wutai.session_ledger"],
    ["audit.json", "wutai.session_audit"],
  ];
  for (const [name, expectedKind] of expectedKinds) {
    const content = contentByName.get(name);
    if (!content) {
      checks.push({
        name,
        status: "failed",
        message: `${name} was not selected, so its schema kind could not be checked.`,
      });
      continue;
    }
    const parsed = safeJson(content);
    const actualKind = parsed?.kind;
    const artifactTaskId =
      name === "ledger.json"
        ? (parsed?.task as { taskId?: unknown } | undefined)?.taskId
        : parsed?.taskId;
    checks.push({
      name,
      status:
        actualKind === expectedKind && (!artifactTaskId || artifactTaskId === taskId)
          ? "passed"
          : "failed",
      message:
        actualKind === expectedKind
          ? "Artifact schema kind matches the expected Wutai CLI packet contract."
          : `Artifact schema kind mismatch: expected ${expectedKind}, got ${String(actualKind ?? "missing")}.`,
      evidence: `kind=${String(actualKind ?? "missing")} taskId=${String(artifactTaskId ?? "missing")}`,
    });
  }

  const signed =
    "signature" in manifest ||
    "signatures" in manifest ||
    "attestation" in manifest ||
    "attestations" in manifest;
  checks.push({
    name: "trusted_signature",
    status: signed ? "passed" : "warning",
    message: signed
      ? "Manifest contains a signature or attestation field."
      : "No manifest signature or trusted producer attestation was selected.",
  });

  const metrics = {
    total: checks.length,
    passed: checks.filter((check) => check.status === "passed").length,
    warnings: checks.filter((check) => check.status === "warning").length,
    failed: checks.filter((check) => check.status === "failed").length,
  };
  const status =
    metrics.failed > 0 ? "failed" : metrics.warnings > 0 ? "warning" : "passed";

  return {
    schemaVersion: 1,
    kind: "wutai.packet_provenance_check",
    taskId,
    generatedAt,
    importMode,
    status,
    summary:
      status === "failed"
        ? `Packet provenance check found ${metrics.failed} failed check and ${metrics.warnings} warning.`
        : status === "warning"
          ? `Packet provenance recorded with ${metrics.warnings} warning; the packet is not signed or trusted.`
          : "Packet provenance checks passed for the selected CLI wrapper packet.",
    manifest: {
      sha256: await sha256Hex(manifestContent),
      bytes: byteLength(manifestContent),
      kind: manifest.kind,
      schemaVersion: manifest.schemaVersion,
      packetId: manifest.packetId,
      packetType: manifest.packetType,
      taskId: manifest.taskId,
      sessionId: manifest.sessionId,
      generatedAt: manifest.generatedAt,
      producerName: manifest.producer?.name,
      producerAdapter: manifest.producer?.adapter,
      producerRuntime: manifest.producer?.runtime,
    },
    metrics,
    checks,
    limitation:
      "This records selected packet provenance and schema consistency. It does not prove the manifest was signed, produced by a trusted runtime, or unmodified before selection.",
  };
}

function event(
  taskId: string,
  index: number,
  timestamp: string,
  summary: string,
  details?: string,
): TaskEvent {
  return {
    eventId: `${taskId}_import_event_${index}`,
    taskId,
    timestamp,
    type: index === 1 ? "TaskStarted" : "ArtifactCreated",
    summary,
    details,
    visibility: "user",
  };
}

export async function importCliPacketFiles(files: CliPacketFile[]): Promise<WutaiTask> {
  const duplicateNames = files
    .map((file) => file.name)
    .filter((name, index, names) => names.indexOf(name) !== index);
  if (duplicateNames.length > 0) {
    throw new Error(
      `Selected packet contains duplicate file names: ${[...new Set(duplicateNames)].join(", ")}.`,
    );
  }

  const fileContents = await Promise.all(
    files.map(async (file) => [file.name, await file.text()] as const),
  );
  const contentByName = new Map(fileContents);
  const manifestContent = contentByName.get("manifest.json");

  if (!manifestContent) {
    throw new Error("Select manifest.json from a Wutai CLI packet.");
  }

  const manifest = parseJson<WorkPacketManifest>(
    manifestContent,
    "manifest.json",
  );
  if (
    manifest.kind !== "wutai.work_packet_manifest" ||
    manifest.packetType !== "local_script" ||
    manifest.producer?.adapter !== "wutaiRunCli"
  ) {
    throw new Error("This is not a Wutai CLI wrapper packet manifest.");
  }

  const taskId = manifest.taskId || `cli_import_${Date.now().toString(36)}`;
  const generatedAt = manifest.generatedAt || new Date().toISOString();
  const importMode = files.some((file) => file.webkitRelativePath)
    ? "directory"
    : "files";
  const ledgerContent = contentByName.get("ledger.json");
  const ledger = ledgerContent
    ? parseJson<LedgerArtifact>(ledgerContent, "ledger.json")
    : null;
  const ledgerTask = ledger?.task;
  const integrity = await buildIntegrityArtifact(
    taskId,
    new Date().toISOString(),
    manifest,
    contentByName,
    importMode,
  );
  const provenance = await buildProvenanceArtifact(
    taskId,
    new Date().toISOString(),
    manifest,
    manifestContent,
    contentByName,
    importMode,
  );
  const orderedNames = [
    ...(manifest.artifacts?.map((artifact) => artifact.name) ?? []),
    "manifest.json",
  ];
  const sortedNames = [
    ...new Set([
      ...orderedNames,
      ...Array.from(contentByName.keys()).sort((a, b) => a.localeCompare(b)),
    ]),
  ].filter((name) => contentByName.has(name) && !INTERNAL_IMPORT_ARTIFACT_NAMES.has(name));
  const manifestArtifactsByName = new Map(
    manifest.artifacts?.map((artifact) => [artifact.name, artifact]) ?? [],
  );
  const importedArtifacts: ArtifactRecord[] = sortedNames.map((name) => {
    const manifestArtifact = manifestArtifactsByName.get(name);
    return {
      artifactId: `${taskId}_artifact_${name.replace(/[^a-z0-9]+/gi, "_")}`,
      taskId,
      type: manifestArtifact?.type ?? artifactType(name),
      name,
      virtualPath:
        manifestArtifact?.virtualPath ?? `imported/${taskId}/${name}`,
      content: contentByName.get(name) ?? "",
      createdAt: manifestArtifact?.createdAt ?? generatedAt,
    };
  });
  const integrityArtifact: ArtifactRecord = {
    artifactId: `${taskId}_artifact_integrity_json`,
    taskId,
    type: "json",
    name: INTEGRITY_ARTIFACT_NAME,
    virtualPath: `imported/${taskId}/${INTEGRITY_ARTIFACT_NAME}`,
    content: JSON.stringify(integrity, null, 2),
    createdAt: integrity.generatedAt,
  };
  const artifacts = [...importedArtifacts, integrityArtifact];
  const provenanceArtifact: ArtifactRecord = {
    artifactId: `${taskId}_artifact_provenance_json`,
    taskId,
    type: "json",
    name: PROVENANCE_ARTIFACT_NAME,
    virtualPath: `imported/${taskId}/${PROVENANCE_ARTIFACT_NAME}`,
    content: JSON.stringify(provenance, null, 2),
    createdAt: provenance.generatedAt,
  };
  const allArtifacts = [...artifacts, provenanceArtifact];
  const importedEvent = event(
    taskId,
    1,
    generatedAt,
    "Imported Wutai CLI packet.",
    "Review-only import. Wutai did not execute this command from the desktop UI.",
  );
  const artifactEvent = event(
    taskId,
    2,
    generatedAt,
    `Imported ${importedArtifacts.length} CLI packet artifacts and checked manifest hashes and provenance.`,
    `${integrity.summary} ${provenance.summary}`,
  );

  return {
    taskId,
    title: manifest.title || ledgerTask?.title || "Imported Wutai CLI packet",
    userRequest:
      manifest.userRequest ||
      ledgerTask?.userRequest ||
      `Review imported CLI packet: ${manifest.session?.command ?? taskId}`,
    status: validStatus(manifest.status ?? ledgerTask?.status),
    plan:
      ledgerTask?.plan?.length
        ? ledgerTask.plan
        : [
            "Import the CLI wrapper work packet.",
            "Check selected artifacts against manifest hashes and packet provenance.",
            "Review policy, trace, ledger, audit, manifest, and integrity artifacts.",
            "Keep this as a review-only desktop record.",
          ],
    createdAt: manifest.session?.startedAt || ledgerTask?.createdAt || generatedAt,
    updatedAt: manifest.session?.completedAt || ledgerTask?.updatedAt || generatedAt,
    events:
      ledgerTask?.events?.length
        ? [...ledgerTask.events, importedEvent, artifactEvent]
        : [importedEvent, artifactEvent],
    permissions: manifest.permissions ?? ledgerTask?.permissions ?? [],
    sources: [],
    artifacts: allArtifacts,
  };
}

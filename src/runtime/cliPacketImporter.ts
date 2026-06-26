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
  kind?: string;
  packetType?: string;
  taskId?: string;
  title?: string;
  status?: string;
  userRequest?: string;
  generatedAt?: string;
  producer?: {
    adapter?: string;
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
  const orderedNames = [
    ...(manifest.artifacts?.map((artifact) => artifact.name) ?? []),
    "manifest.json",
  ];
  const sortedNames = [
    ...new Set([
      ...orderedNames,
      ...Array.from(contentByName.keys()).sort((a, b) => a.localeCompare(b)),
    ]),
  ].filter((name) => contentByName.has(name) && name !== INTEGRITY_ARTIFACT_NAME);
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
    `Imported ${importedArtifacts.length} CLI packet artifacts and checked manifest hashes.`,
    integrity.summary,
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
            "Check selected artifacts against manifest hashes.",
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
    artifacts,
  };
}

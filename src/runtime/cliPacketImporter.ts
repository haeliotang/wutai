import type {
  ArtifactRecord,
  PermissionRequest,
  TaskEvent,
  TaskStatus,
  WutaiTask,
} from "../domain/task";

type CliPacketFile = Pick<File, "name" | "text">;

interface ManifestArtifact {
  name: string;
  type?: "markdown" | "json";
  virtualPath?: string;
  createdAt?: string;
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
  const ledgerContent = contentByName.get("ledger.json");
  const ledger = ledgerContent
    ? parseJson<LedgerArtifact>(ledgerContent, "ledger.json")
    : null;
  const ledgerTask = ledger?.task;
  const orderedNames = [
    ...(manifest.artifacts?.map((artifact) => artifact.name) ?? []),
    "manifest.json",
  ];
  const sortedNames = [
    ...new Set([
      ...orderedNames,
      ...Array.from(contentByName.keys()).sort((a, b) => a.localeCompare(b)),
    ]),
  ].filter((name) => contentByName.has(name));
  const manifestArtifactsByName = new Map(
    manifest.artifacts?.map((artifact) => [artifact.name, artifact]) ?? [],
  );
  const artifacts: ArtifactRecord[] = sortedNames.map((name) => {
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
    `Imported ${artifacts.length} CLI packet artifacts.`,
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
            "Review policy, trace, ledger, audit, and manifest artifacts.",
            "Keep this as a review-only desktop record.",
          ],
    createdAt: manifest.session?.startedAt || ledgerTask?.createdAt || generatedAt,
    updatedAt: manifest.session?.completedAt || ledgerTask?.updatedAt || generatedAt,
    events:
      ledgerTask?.events?.length
        ? [...ledgerTask.events, importedEvent]
        : [importedEvent, artifactEvent],
    permissions: manifest.permissions ?? ledgerTask?.permissions ?? [],
    sources: [],
    artifacts,
  };
}

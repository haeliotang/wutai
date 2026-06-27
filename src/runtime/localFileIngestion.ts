import type { ArtifactWriter } from "../artifacts/artifactWriter";
import {
  type ArtifactRecord,
  type PermissionRequest,
  type TaskEvent,
  type WutaiTask,
} from "../domain/task";
import { appendWorkPacketManifest } from "../domain/workPacket";

const MAX_FILES = 12;
const MAX_FILE_BYTES = 1024 * 1024;
const PREVIEW_BYTE_LIMIT = 64 * 1024;
const PREVIEW_CHAR_LIMIT = 1_200;

export interface LocalFileIngestionFile {
  name: string;
  relativePath?: string;
  mimeType: string;
  size: number;
  lastModified?: number;
  sha256: string;
  previewText?: string;
  previewTruncated: boolean;
  contentClass: "empty" | "text" | "binary_or_large";
}

export interface LocalFileHashCheck {
  path: string;
  expectedSha256?: string;
  actualSha256?: string;
  expectedBytes?: number;
  actualBytes?: number;
  status: "passed" | "mismatch" | "missing" | "unexpected";
  message: string;
}

export interface LocalFileHashCheckArtifact {
  schemaVersion: 1;
  kind: "wutai.local_file_hash_check";
  taskId: string;
  generatedAt: string;
  status: "passed" | "failed" | "incomplete";
  summary: string;
  expectedFileCount: number;
  selectedFileCount: number;
  checks: LocalFileHashCheck[];
  limitation: string;
}

async function sha256Hex(buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function classifyContent(
  bytes: Uint8Array,
  size: number,
): LocalFileIngestionFile["contentClass"] {
  if (size === 0) return "empty";
  if (size > PREVIEW_BYTE_LIMIT) return "binary_or_large";
  if (bytes.some((byte) => byte === 0)) return "binary_or_large";
  return "text";
}

function boundedPreview(bytes: Uint8Array, size: number) {
  const contentClass = classifyContent(bytes, size);
  if (contentClass !== "text") {
    return {
      previewText: undefined,
      previewTruncated: contentClass === "binary_or_large",
      contentClass,
    };
  }

  if (size > PREVIEW_BYTE_LIMIT) {
    return {
      previewText: undefined,
      previewTruncated: true,
      contentClass,
    };
  }

  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const withoutNulls = decoded.replaceAll("\u0000", "");
  return {
    previewText: withoutNulls.slice(0, PREVIEW_CHAR_LIMIT),
    previewTruncated: withoutNulls.length > PREVIEW_CHAR_LIMIT,
    contentClass,
  };
}

export async function readLocalFileIngestionFiles(files: FileList | File[]) {
  const selected = Array.from(files);
  if (selected.length === 0) {
    throw new Error("Select at least one local file to ingest.");
  }
  if (selected.length > MAX_FILES) {
    throw new Error(`Local file ingestion accepts up to ${MAX_FILES} files at a time.`);
  }

  return Promise.all(
    selected.map(async (file): Promise<LocalFileIngestionFile> => {
      if (file.size > MAX_FILE_BYTES) {
        throw new Error(
          `Local file ingestion accepts files up to ${MAX_FILE_BYTES} bytes: ${file.name}.`,
        );
      }
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const preview = boundedPreview(bytes, file.size);
      return {
        name: file.name,
        relativePath: file.webkitRelativePath || undefined,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        lastModified: file.lastModified || undefined,
        sha256: await sha256Hex(buffer),
        previewText: preview.previewText,
        previewTruncated: preview.previewTruncated,
        contentClass: preview.contentClass,
      };
    }),
  );
}

function fileIdentity(file: Pick<LocalFileIngestionFile, "name" | "relativePath">) {
  return file.relativePath || file.name;
}

export function buildLocalFileHashCheck(
  taskId: string,
  expectedFiles: LocalFileIngestionFile[],
  selectedFiles: LocalFileIngestionFile[],
  generatedAt = new Date().toISOString(),
): LocalFileHashCheckArtifact {
  const selectedByPath = new Map(
    selectedFiles.map((file) => [fileIdentity(file), file]),
  );
  const expectedByPath = new Map(
    expectedFiles.map((file) => [fileIdentity(file), file]),
  );

  const checks: LocalFileHashCheck[] = expectedFiles.map((expected) => {
    const path = fileIdentity(expected);
    const selected = selectedByPath.get(path);
    if (!selected) {
      return {
        path,
        expectedSha256: expected.sha256,
        expectedBytes: expected.size,
        status: "missing",
        message: "Expected file was not selected for re-check.",
      };
    }
    if (selected.sha256 !== expected.sha256 || selected.size !== expected.size) {
      return {
        path,
        expectedSha256: expected.sha256,
        actualSha256: selected.sha256,
        expectedBytes: expected.size,
        actualBytes: selected.size,
        status: "mismatch",
        message: "Selected file no longer matches the recorded hash or byte size.",
      };
    }
    return {
      path,
      expectedSha256: expected.sha256,
      actualSha256: selected.sha256,
      expectedBytes: expected.size,
      actualBytes: selected.size,
      status: "passed",
      message: "Selected file matches the recorded hash and byte size.",
    };
  });

  selectedFiles.forEach((selected) => {
    const path = fileIdentity(selected);
    if (expectedByPath.has(path)) return;
    checks.push({
      path,
      actualSha256: selected.sha256,
      actualBytes: selected.size,
      status: "unexpected",
      message: "Selected file was not part of the original ingestion packet.",
    });
  });

  const failed = checks.filter((check) =>
    ["mismatch", "unexpected"].includes(check.status),
  ).length;
  const missing = checks.filter((check) => check.status === "missing").length;
  const passed = checks.filter((check) => check.status === "passed").length;
  const status = failed > 0 ? "failed" : missing > 0 ? "incomplete" : "passed";

  return {
    schemaVersion: 1,
    kind: "wutai.local_file_hash_check",
    taskId,
    generatedAt,
    status,
    summary: `${passed} passed, ${failed} failed, ${missing} missing.`,
    expectedFileCount: expectedFiles.length,
    selectedFileCount: selectedFiles.length,
    checks,
    limitation:
      "This check compares user-selected files against the packet hashes. Wutai does not read files that were not selected for this re-check.",
  };
}

function buildEvent(
  taskId: string,
  index: number,
  timestamp: string,
  event: Omit<TaskEvent, "eventId" | "taskId" | "timestamp">,
): TaskEvent {
  return {
    ...event,
    eventId: `${taskId}_event_${index}`,
    taskId,
    timestamp,
  };
}

function fileDisplayName(file: LocalFileIngestionFile) {
  return file.relativePath || file.name;
}

function buildReport(task: WutaiTask, files: LocalFileIngestionFile[]) {
  const inventory = files
    .map(
      (file) =>
        `- ${fileDisplayName(file)} (${file.size} bytes, sha256 ${file.sha256.slice(0, 16)}...)`,
    )
    .join("\n");
  const previews = files
    .filter((file) => file.previewText)
    .map(
      (file) => `### ${fileDisplayName(file)}

\`\`\`text
${file.previewText}
\`\`\`
`,
    )
    .join("\n");

  return `# Local File Ingestion

## Selected Files

${inventory}

## Bounded Previews

${previews || "No text previews were retained for the selected files."}

## Boundary

Wutai read only the files explicitly selected by the user. This packet stores
metadata, SHA-256 hashes, and bounded text previews. It does not retain full file
contents, crawl directories, watch future changes, or grant file access to any
downstream agent.

## Task

${task.userRequest}
`;
}

export async function importLocalFiles(
  artifactWriter: ArtifactWriter,
  files: LocalFileIngestionFile[],
) {
  if (files.length === 0) {
    throw new Error("Select at least one local file to ingest.");
  }

  const now = new Date().toISOString();
  const taskId = `local_file_${Date.now().toString(36)}`;
  const permission: PermissionRequest = {
    requestId: `${taskId}_permission_file_ingestion`,
    taskId,
    status: "approved",
    types: ["local_file_ingestion", "local_file_read", "artifact_write"],
    scope: [
      "Read only user-selected local files",
      "Record file metadata and SHA-256 hashes",
      "Store bounded text previews only",
      "Write new work-packet artifacts",
      "No directory crawling or filesystem watching",
      "No credential access",
    ],
    createdAt: now,
    resolvedAt: now,
  };
  const events: TaskEvent[] = [
    buildEvent(taskId, 1, now, {
      type: "TaskStarted",
      summary: "Prepared local file ingestion.",
      details:
        "This flow reads only user-selected files and stores bounded packet evidence.",
      visibility: "user",
    }),
    buildEvent(taskId, 2, now, {
      type: "PermissionRequested",
      summary: "Declared local file-ingestion permission boundary.",
      details: permission.scope.join("; "),
      visibility: "user",
    }),
    buildEvent(taskId, 3, now, {
      type: "PermissionResolved",
      summary: "Local file-ingestion permission recorded for this session.",
      visibility: "user",
    }),
    ...files.slice(0, 5).map((file, index) =>
      buildEvent(taskId, index + 4, now, {
        type: "SourceCaptured",
        summary: `Captured selected file: ${fileDisplayName(file)}`,
        details: `bytes=${file.size}; sha256=${file.sha256}`,
        visibility: "expert",
      }),
    ),
    buildEvent(taskId, 4 + Math.min(files.length, 5), now, {
      type: "RuntimeEventCaptured",
      summary: `Captured ${files.length} user-selected local file${files.length === 1 ? "" : "s"}.`,
      details: "Stored metadata, SHA-256 hashes, and bounded text previews.",
      visibility: "user",
    }),
    buildEvent(taskId, 5 + Math.min(files.length, 5), now, {
      type: "ArtifactCreated",
      summary: "Saved manifest, report, files, and audit artifacts.",
      visibility: "user",
    }),
    buildEvent(taskId, 6 + Math.min(files.length, 5), now, {
      type: "TaskCompleted",
      summary: "Local files imported.",
      visibility: "user",
    }),
  ];
  const task: WutaiTask = {
    taskId,
    title: `Imported ${files.length} local file${files.length === 1 ? "" : "s"}`,
    userRequest:
      "Ingest user-selected local files into a Wutai work packet for bounded review.",
    status: "completed",
    plan: [
      "Declare the local file-ingestion boundary.",
      "Capture metadata, SHA-256 hashes, and bounded previews for selected files.",
      "Record file reads in the local audit trail.",
      "Save manifest, report, files, and audit artifacts.",
    ],
    createdAt: now,
    updatedAt: now,
    events,
    permissions: [permission],
    sources: [],
    artifacts: [],
  };

  const filesArtifact = {
    schemaVersion: 1,
    kind: "wutai.local_file_ingestion",
    taskId,
    generatedAt: now,
    captureMode: "user_selected_files",
    limits: {
      maxFiles: MAX_FILES,
      maxFileBytes: MAX_FILE_BYTES,
      previewByteLimit: PREVIEW_BYTE_LIMIT,
      previewCharLimit: PREVIEW_CHAR_LIMIT,
      fullContentRetained: false,
    },
    files,
    limitation:
      "This packet records metadata, hashes, and bounded previews only. Full file contents are not retained.",
  };
  const auditArtifact = {
    schemaVersion: 1,
    kind: "wutai.session_audit",
    taskId,
    generatedAt: now,
    permissions: [permission],
    events,
    toolCalls: [],
    runtimeEvents: [
      {
        runtimeEventId: `${taskId}_runtime_1`,
        type: "local_files_ingested",
        timestamp: now,
        fileCount: files.length,
        totalBytes: files.reduce((sum, file) => sum + file.size, 0),
      },
    ],
    credentialGrants: [],
    fileReads: files.map((file, index) => ({
      fileReadId: `${taskId}_file_${index + 1}`,
      path: fileDisplayName(file),
      bytes: file.size,
      mimeType: file.mimeType,
      sha256: file.sha256,
      previewTruncated: file.previewTruncated,
      readMode: "user_selected_file_input",
      contentRetention: "metadata_hash_and_bounded_preview_only",
    })),
  };
  const baseArtifacts: ArtifactRecord[] = [
    {
      artifactId: `${taskId}_artifact_report`,
      taskId,
      type: "markdown",
      name: "report.md",
      virtualPath: `artifacts/${taskId}/report.md`,
      content: buildReport(task, files),
      createdAt: now,
    },
    {
      artifactId: `${taskId}_artifact_files`,
      taskId,
      type: "json",
      name: "files.json",
      virtualPath: `artifacts/${taskId}/files.json`,
      content: JSON.stringify(filesArtifact, null, 2),
      createdAt: now,
    },
    {
      artifactId: `${taskId}_artifact_audit`,
      taskId,
      type: "json",
      name: "audit.json",
      virtualPath: `artifacts/${taskId}/audit.json`,
      content: JSON.stringify(auditArtifact, null, 2),
      createdAt: now,
    },
  ];

  const taskWithArtifacts: WutaiTask = {
    ...task,
    artifacts: await appendWorkPacketManifest({
      task: { ...task, artifacts: baseArtifacts },
      artifacts: baseArtifacts,
      createdAt: now,
      packetType: "local_file",
      producer: {
        name: "wutai",
        adapter: "localFileIngestion",
        runtime: "browser file input",
      },
      session: {
        sessionId: taskId,
        subject: "User-selected local file ingestion",
        startedAt: now,
        completedAt: now,
        exitCode: null,
        importedTrace: false,
      },
      audit: {
        toolCallCount: 0,
        runtimeEventCount: 1,
        credentialPurposes: [],
        auditArtifacts: ["audit.json"],
      },
      evidenceSurface: {
        unsupportedItems: [
          "Full file contents are not retained in the packet.",
          "Wutai does not monitor selected files after ingestion.",
        ],
        blindSpots: [
          "Later file edits cannot be detected unless the user imports the file again.",
        ],
      },
    }),
  };

  return artifactWriter.write(taskWithArtifacts);
}

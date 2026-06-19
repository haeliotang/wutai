import { invoke } from "@tauri-apps/api/core";
import type { ArtifactRecord, WutaiTask } from "../domain/task";

export interface ArtifactWriter {
  readonly backendName: string;
  write(task: WutaiTask): Promise<WutaiTask>;
}

interface WrittenArtifact {
  name: string;
  path: string;
}

function isTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

const browserArtifactWriter: ArtifactWriter = {
  backendName: "in-memory artifact preview",

  async write(task) {
    return task;
  },
};

const tauriArtifactWriter: ArtifactWriter = {
  backendName: "Tauri app-data files",

  async write(task) {
    if (task.artifacts.length === 0) return task;

    const written = await invoke<WrittenArtifact[]>("write_task_artifacts", {
      taskId: task.taskId,
      artifacts: task.artifacts.map((artifact) => ({
        name: artifact.name,
        content: artifact.content,
      })),
    });

    const pathsByName = new Map(written.map((artifact) => [artifact.name, artifact.path]));

    return {
      ...task,
      artifacts: task.artifacts.map((artifact): ArtifactRecord => {
        const writtenPath = pathsByName.get(artifact.name);
        return writtenPath ? { ...artifact, virtualPath: writtenPath } : artifact;
      }),
    };
  },
};

export function createArtifactWriter(): ArtifactWriter {
  return isTauriRuntime() ? tauriArtifactWriter : browserArtifactWriter;
}

import type { ArtifactWriter } from "../artifacts/artifactWriter";
import type { WutaiTask } from "../domain/task";

export type TaskUpdateHandler = (task: WutaiTask) => void | Promise<void>;

export interface ResearchAdapter {
  readonly backendName: string;
  run(
    initialTask: WutaiTask,
    signal: AbortSignal,
    onUpdate: TaskUpdateHandler,
    artifactWriter: ArtifactWriter,
  ): Promise<WutaiTask>;
}

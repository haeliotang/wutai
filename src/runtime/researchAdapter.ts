import type { ArtifactWriter } from "../artifacts/artifactWriter";
import type { WutaiTask } from "../domain/task";

export type TaskUpdateHandler = (task: WutaiTask) => void | Promise<void>;

export type ResearchPreflightStatus = "pass" | "fail" | "warning";

export interface ResearchPreflightCheck {
  key: string;
  label: string;
  status: ResearchPreflightStatus;
  message: string;
  detail?: string;
}

export interface ResearchPreflight {
  ready: boolean;
  summary: string;
  checks: ResearchPreflightCheck[];
  fixes: string[];
  pythonPath?: string;
  scriptPath?: string;
  packageVersion?: string;
}

export interface ResearchAdapter {
  readonly backendName: string;
  preflight(): Promise<ResearchPreflight>;
  run(
    initialTask: WutaiTask,
    signal: AbortSignal,
    onUpdate: TaskUpdateHandler,
    artifactWriter: ArtifactWriter,
  ): Promise<WutaiTask>;
}

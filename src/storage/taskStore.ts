import type { WutaiTask } from "../domain/task";

export interface TaskStore {
  list(): Promise<WutaiTask[]>;
  save(task: WutaiTask): Promise<void>;
  clear(): Promise<void>;
}

const STORAGE_KEY = "wutai.v0.tasks";

function readTasks(): WutaiTask[] {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];

  try {
    return JSON.parse(raw) as WutaiTask[];
  } catch {
    return [];
  }
}

function writeTasks(tasks: WutaiTask[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

export const localTaskStore: TaskStore = {
  async list() {
    return readTasks().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  async save(task) {
    const tasks = readTasks();
    const next = [task, ...tasks.filter((item) => item.taskId !== task.taskId)];
    writeTasks(next);
  },

  async clear() {
    window.localStorage.removeItem(STORAGE_KEY);
  },
};

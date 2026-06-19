import { createSqliteTaskStore } from "./sqliteTaskStore";
import { localTaskStore, type TaskStore } from "./taskStore";

function isTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

export async function createTaskStore(): Promise<TaskStore> {
  if (!isTauriRuntime()) return localTaskStore;

  try {
    return await createSqliteTaskStore();
  } catch (error) {
    console.warn("Falling back to localStorage task store.", error);
    return localTaskStore;
  }
}

import Database from "@tauri-apps/plugin-sql";
import type { WutaiTask } from "../domain/task";
import type { TaskStore } from "./taskStore";

interface TaskRow {
  task_id: string;
  updated_at: string;
  payload: string;
}

const DB_URL = "sqlite:wutai.db";

export async function createSqliteTaskStore(): Promise<TaskStore> {
  const db = await Database.load(DB_URL);

  return {
    backendName: "SQLite",

    async list() {
      const rows = await db.select<TaskRow[]>(
        "SELECT task_id, updated_at, payload FROM tasks ORDER BY updated_at DESC",
      );

      return rows.map((row) => JSON.parse(row.payload) as WutaiTask);
    },

    async save(task) {
      await db.execute(
        `INSERT INTO tasks (task_id, updated_at, payload)
         VALUES ($1, $2, $3)
         ON CONFLICT(task_id) DO UPDATE SET
           updated_at = excluded.updated_at,
           payload = excluded.payload`,
        [task.taskId, task.updatedAt, JSON.stringify(task)],
      );
    },

    async clear() {
      await db.execute("DELETE FROM tasks");
    },
  };
}

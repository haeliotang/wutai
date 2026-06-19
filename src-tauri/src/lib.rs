use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};
use tauri_plugin_sql::{Migration, MigrationKind};

#[derive(Debug, Deserialize)]
struct ArtifactPayload {
    name: String,
    content: String,
}

#[derive(Debug, Serialize)]
struct WrittenArtifact {
    name: String,
    path: String,
}

fn sanitize_path_segment(value: &str) -> String {
    let sanitized: String = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric()
                || character == '-'
                || character == '_'
                || character == '.'
            {
                character
            } else {
                '_'
            }
        })
        .collect();

    if sanitized.is_empty() {
        "artifact".to_string()
    } else {
        sanitized
    }
}

fn artifact_dir(app: &AppHandle, task_id: &str) -> Result<PathBuf, String> {
    let base_dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    Ok(base_dir
        .join("artifacts")
        .join(sanitize_path_segment(task_id)))
}

#[tauri::command]
fn write_task_artifacts(
    app: AppHandle,
    task_id: String,
    artifacts: Vec<ArtifactPayload>,
) -> Result<Vec<WrittenArtifact>, String> {
    let output_dir = artifact_dir(&app, &task_id)?;
    fs::create_dir_all(&output_dir).map_err(|error| error.to_string())?;

    artifacts
        .into_iter()
        .map(|artifact| {
            let original_name = artifact.name;
            let file_name = sanitize_path_segment(&original_name);
            let path = output_dir.join(file_name);
            fs::write(&path, artifact.content).map_err(|error| error.to_string())?;
            Ok(WrittenArtifact {
                name: original_name,
                path: path.to_string_lossy().to_string(),
            })
        })
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![Migration {
        version: 1,
        description: "create_initial_task_tables",
        sql: "CREATE TABLE IF NOT EXISTS tasks (
            task_id TEXT PRIMARY KEY NOT NULL,
            updated_at TEXT NOT NULL,
            payload TEXT NOT NULL
        );",
        kind: MigrationKind::Up,
    }];

    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:wutai.db", migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![write_task_artifacts])
        .run(tauri::generate_context!())
        .expect("error while running Wutai");
}

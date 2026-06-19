use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, process::Command};
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GptResearcherRunInput {
    task_id: String,
    query: String,
    report_type: String,
    tone: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct GptResearcherSource {
    title: String,
    url: String,
    note: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct GptResearcherRunOutput {
    report: String,
    sources: Vec<GptResearcherSource>,
    audit: serde_json::Value,
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

fn gpt_researcher_adapter_script() -> Result<PathBuf, String> {
    if let Ok(script_path) = std::env::var("WUTAI_GPT_RESEARCHER_ADAPTER_SCRIPT") {
        return Ok(PathBuf::from(script_path));
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let candidates = [
        manifest_dir.join("../scripts/gpt_researcher_adapter.py"),
        std::env::current_dir()
            .map_err(|error| error.to_string())?
            .join("scripts/gpt_researcher_adapter.py"),
        std::env::current_dir()
            .map_err(|error| error.to_string())?
            .join("../scripts/gpt_researcher_adapter.py"),
    ];

    candidates
        .into_iter()
        .find(|path| path.exists())
        .ok_or_else(|| {
            "Unable to find scripts/gpt_researcher_adapter.py. Set WUTAI_GPT_RESEARCHER_ADAPTER_SCRIPT to an absolute path.".to_string()
        })
}

fn gpt_researcher_python_candidates() -> Vec<String> {
    if let Ok(python_path) = std::env::var("WUTAI_GPT_RESEARCHER_PYTHON") {
        return vec![python_path];
    }

    vec!["python3".to_string(), "python".to_string()]
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

#[tauri::command]
fn run_gpt_researcher(input: GptResearcherRunInput) -> Result<GptResearcherRunOutput, String> {
    let script_path = gpt_researcher_adapter_script()?;
    let mut errors = Vec::new();

    for python_path in gpt_researcher_python_candidates() {
        let output = Command::new(&python_path)
            .arg(&script_path)
            .arg("--query")
            .arg(&input.query)
            .arg("--report-type")
            .arg(&input.report_type)
            .arg("--tone")
            .arg(&input.tone)
            .arg("--task-id")
            .arg(&input.task_id)
            .output();

        match output {
            Ok(output) if output.status.success() => {
                return serde_json::from_slice(&output.stdout).map_err(|error| {
                    format!("GPT Researcher adapter returned invalid JSON: {error}")
                });
            }
            Ok(output) => {
                let mut message = String::from_utf8_lossy(&output.stderr).trim().to_string();
                if message.is_empty() {
                    message = format!(
                        "GPT Researcher adapter exited with status {}",
                        output.status
                    );
                }
                errors.push(format!("{python_path}: {message}"));
            }
            Err(error) => {
                errors.push(format!("{python_path}: {error}"));
            }
        }
    }

    Err(errors.join("\n"))
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
        .invoke_handler(tauri::generate_handler![
            write_task_artifacts,
            run_gpt_researcher
        ])
        .run(tauri::generate_context!())
        .expect("error while running Wutai");
}

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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ResearchPreflightCheck {
    key: String,
    label: String,
    status: String,
    message: String,
    detail: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ResearchPreflight {
    ready: bool,
    summary: String,
    checks: Vec<ResearchPreflightCheck>,
    fixes: Vec<String>,
    python_path: Option<String>,
    script_path: Option<String>,
    package_version: Option<String>,
}

fn preflight_check(
    key: &str,
    label: &str,
    status: &str,
    message: &str,
    detail: Option<String>,
) -> ResearchPreflightCheck {
    ResearchPreflightCheck {
        key: key.to_string(),
        label: label.to_string(),
        status: status.to_string(),
        message: message.to_string(),
        detail,
    }
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

fn command_text_output(command: &mut Command) -> Result<String, String> {
    let output = command.output().map_err(|error| error.to_string())?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            Err(format!("Command exited with status {}", output.status))
        } else {
            Err(stderr)
        }
    }
}

fn find_working_python() -> Result<(String, String), Vec<String>> {
    let mut errors = Vec::new();

    for python_path in gpt_researcher_python_candidates() {
        let output = command_text_output(Command::new(&python_path).arg("-c").arg(
            "import sys; print(f'{sys.executable}|{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')",
        ));

        match output {
            Ok(output) => return Ok((python_path, output)),
            Err(error) => errors.push(format!("{python_path}: {error}")),
        }
    }

    Err(errors)
}

fn python_package_version(python_path: &str, package_name: &str) -> Result<String, String> {
    command_text_output(Command::new(python_path).arg("-c").arg(format!(
        "from importlib import metadata; print(metadata.version('{package_name}'))"
    )))
}

fn artifact_dir(app: &AppHandle, task_id: &str) -> Result<PathBuf, String> {
    let base_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
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
fn check_gpt_researcher() -> ResearchPreflight {
    let mut checks = Vec::new();
    let mut fixes = Vec::new();
    let mut python_path = None;
    let mut package_version = None;

    let script_path = match gpt_researcher_adapter_script() {
        Ok(path) => {
            checks.push(preflight_check(
                "sidecar_script",
                "Research adapter",
                "pass",
                "Wutai found the local research adapter.",
                Some(path.to_string_lossy().to_string()),
            ));
            Some(path.to_string_lossy().to_string())
        }
        Err(error) => {
            checks.push(preflight_check(
                "sidecar_script",
                "Research adapter",
                "fail",
                "Wutai cannot find its local research adapter.",
                Some(error),
            ));
            fixes.push(
                "Keep scripts/gpt_researcher_adapter.py in the project, or set WUTAI_GPT_RESEARCHER_ADAPTER_SCRIPT to its path.".to_string(),
            );
            None
        }
    };

    match find_working_python() {
        Ok((candidate, version_output)) => {
            let mut parts = version_output.splitn(2, '|');
            let executable = parts.next().unwrap_or(candidate.as_str()).to_string();
            let version = parts.next().unwrap_or("unknown").to_string();
            checks.push(preflight_check(
                "python",
                "Python",
                "pass",
                &format!("Wutai can launch Python {version}."),
                Some(executable),
            ));
            python_path = Some(candidate);
        }
        Err(errors) => {
            checks.push(preflight_check(
                "python",
                "Python",
                "fail",
                "Wutai cannot launch Python for the research adapter.",
                Some(errors.join("\n")),
            ));
            fixes.push(
                "Install Python 3.11 or 3.12, then set WUTAI_GPT_RESEARCHER_PYTHON to that Python path.".to_string(),
            );
        }
    }

    if let Some(ref candidate) = python_path {
        match python_package_version(candidate, "gpt-researcher") {
            Ok(version) => {
                checks.push(preflight_check(
                    "gpt_researcher_package",
                    "GPT Researcher",
                    "pass",
                    &format!("GPT Researcher {version} is installed."),
                    None,
                ));
                package_version = Some(version);
            }
            Err(error) => {
                checks.push(preflight_check(
                    "gpt_researcher_package",
                    "GPT Researcher",
                    "fail",
                    "The GPT Researcher package is not installed for this Python.",
                    Some(error),
                ));
                fixes.push(
                    "Create a virtual environment and run: python -m pip install -r requirements-gpt-researcher.txt".to_string(),
                );
            }
        }
    }

    let openai_key_present = std::env::var("OPENAI_API_KEY")
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);
    checks.push(preflight_check(
        "openai_api_key",
        "Model access",
        if openai_key_present { "pass" } else { "fail" },
        if openai_key_present {
            "Model access is configured."
        } else {
            "Model access is not configured."
        },
        None,
    ));
    if !openai_key_present {
        fixes.push(
            "Set OPENAI_API_KEY before starting Wutai with the GPT Researcher adapter.".to_string(),
        );
    }

    let tavily_key_present = std::env::var("TAVILY_API_KEY")
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);
    checks.push(preflight_check(
        "tavily_api_key",
        "Web search",
        if tavily_key_present { "pass" } else { "fail" },
        if tavily_key_present {
            "Web search is configured."
        } else {
            "Web search is not configured."
        },
        None,
    ));
    if !tavily_key_present {
        fixes.push(
            "Set TAVILY_API_KEY before starting Wutai with the GPT Researcher adapter.".to_string(),
        );
    }

    let ready = checks.iter().all(|check| check.status != "fail");
    ResearchPreflight {
        ready,
        summary: if ready {
            "GPT Researcher is ready for real web research.".to_string()
        } else {
            "GPT Researcher needs setup before Wutai can run real web research.".to_string()
        },
        checks,
        fixes,
        python_path,
        script_path,
        package_version,
    }
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
            check_gpt_researcher,
            write_task_artifacts,
            run_gpt_researcher
        ])
        .run(tauri::generate_context!())
        .expect("error while running Wutai");
}

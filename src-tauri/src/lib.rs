use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{BufRead, BufReader, Read},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};
use tauri::{ipc::Channel, AppHandle, Manager, State};
use tauri_plugin_sql::{Migration, MigrationKind};

const KEYRING_SERVICE: &str = "com.haeliotang.wutai.research";
const OPENAI_KEY_ACCOUNT: &str = "openai_api_key";
const TAVILY_KEY_ACCOUNT: &str = "tavily_api_key";

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
    #[serde(default)]
    logs: Vec<String>,
    #[serde(default)]
    progress: Vec<GptResearcherProgressEvent>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct GptResearcherProgressEvent {
    kind: String,
    phase: Option<String>,
    message: String,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResearchProviderSetupInput {
    openai_api_key: Option<String>,
    tavily_api_key: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ResearchProviderSetup {
    openai_key_configured: bool,
    tavily_key_configured: bool,
    secret_store: String,
}

#[derive(Default)]
struct SidecarRegistry {
    processes: Mutex<HashMap<String, Arc<Mutex<Child>>>>,
    cancelled: Mutex<HashSet<String>>,
}

trait ProviderSecretStore: Send + Sync {
    fn read(&self, account: &str) -> Result<Option<String>, String>;
    fn save(&self, account: &str, value: Option<&str>) -> Result<(), String>;
    fn clear(&self, account: &str) -> Result<(), String>;
}

struct SystemKeyringStore;

struct ResearchProviderState {
    store: Arc<dyn ProviderSecretStore>,
    environment_keys: HashMap<String, String>,
}

impl ResearchProviderState {
    fn new(store: Arc<dyn ProviderSecretStore>, environment_keys: HashMap<String, String>) -> Self {
        Self {
            store,
            environment_keys,
        }
    }

    fn configured_key(&self, account: &str, env_name: &str) -> Result<Option<String>, String> {
        configured_key_from_sources(
            self.store.read(account),
            self.environment_keys.get(env_name).cloned(),
        )
    }

    fn key_configuration_source(
        &self,
        account: &str,
        env_name: &str,
    ) -> Result<Option<&'static str>, String> {
        key_configuration_source_from_sources(
            self.store.read(account),
            self.environment_keys.get(env_name).cloned(),
        )
    }
}

impl Default for ResearchProviderState {
    fn default() -> Self {
        let environment_keys = ["OPENAI_API_KEY", "TAVILY_API_KEY"]
            .into_iter()
            .filter_map(|name| {
                normalize_secret(std::env::var(name).ok()).map(|value| (name.to_string(), value))
            })
            .collect();
        Self::new(Arc::new(SystemKeyringStore), environment_keys)
    }
}

impl ProviderSecretStore for SystemKeyringStore {
    fn read(&self, account: &str) -> Result<Option<String>, String> {
        match provider_key_entry(account)?.get_password() {
            Ok(value) => Ok(normalize_secret(Some(value))),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(error.to_string()),
        }
    }

    fn save(&self, account: &str, value: Option<&str>) -> Result<(), String> {
        if let Some(value) = normalize_secret(value.map(str::to_string)) {
            provider_key_entry(account)?
                .set_password(&value)
                .map_err(|error| error.to_string())?;
        }

        Ok(())
    }

    fn clear(&self, account: &str) -> Result<(), String> {
        match provider_key_entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    }
}

impl SidecarRegistry {
    fn contains(&self, task_id: &str) -> Result<bool, String> {
        Ok(self
            .processes
            .lock()
            .map_err(|error| error.to_string())?
            .contains_key(task_id))
    }

    fn register(&self, task_id: &str, child: Arc<Mutex<Child>>) -> Result<(), String> {
        let mut processes = self.processes.lock().map_err(|error| error.to_string())?;
        if processes.contains_key(task_id) {
            return Err("A GPT Researcher sidecar is already running for this task.".to_string());
        }
        processes.insert(task_id.to_string(), child);
        Ok(())
    }

    fn remove(&self, task_id: &str) -> Result<Option<Arc<Mutex<Child>>>, String> {
        Ok(self
            .processes
            .lock()
            .map_err(|error| error.to_string())?
            .remove(task_id))
    }

    fn mark_cancelled(&self, task_id: &str) -> Result<(), String> {
        self.cancelled
            .lock()
            .map_err(|error| error.to_string())?
            .insert(task_id.to_string());
        Ok(())
    }

    fn take_cancelled(&self, task_id: &str) -> Result<bool, String> {
        Ok(self
            .cancelled
            .lock()
            .map_err(|error| error.to_string())?
            .remove(task_id))
    }

    fn cancel(&self, task_id: &str) -> Result<bool, String> {
        self.mark_cancelled(task_id)?;
        let child = self
            .processes
            .lock()
            .map_err(|error| error.to_string())?
            .get(task_id)
            .cloned();

        let Some(child) = child else {
            return Ok(false);
        };
        let mut child = child.lock().map_err(|error| error.to_string())?;
        if child
            .try_wait()
            .map_err(|error| error.to_string())?
            .is_some()
        {
            return Ok(false);
        }

        child.kill().map_err(|error| error.to_string())?;
        Ok(true)
    }
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

fn provider_key_entry(account: &str) -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, account).map_err(|error| error.to_string())
}

fn normalize_secret(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn configured_key_from_sources(
    stored_key: Result<Option<String>, String>,
    environment_key: Option<String>,
) -> Result<Option<String>, String> {
    let environment_key = normalize_secret(environment_key);
    match stored_key.map(normalize_secret) {
        Ok(Some(value)) => return Ok(Some(value)),
        Ok(None) => {}
        Err(error) => {
            if let Some(value) = environment_key {
                return Ok(Some(value));
            }
            return Err(error);
        }
    }

    Ok(environment_key)
}

fn key_configuration_source_from_sources(
    stored_key: Result<Option<String>, String>,
    environment_key: Option<String>,
) -> Result<Option<&'static str>, String> {
    let environment_key = normalize_secret(environment_key);
    match stored_key.map(normalize_secret) {
        Ok(Some(_)) => return Ok(Some("Wutai setup")),
        Ok(None) => {}
        Err(error) => {
            if environment_key.is_some() {
                return Ok(Some("environment"));
            }
            return Err(error);
        }
    }

    if environment_key.is_some() {
        return Ok(Some("environment"));
    }

    Ok(None)
}

fn provider_setup_state(provider: &ResearchProviderState) -> Result<ResearchProviderSetup, String> {
    Ok(ResearchProviderSetup {
        openai_key_configured: provider
            .configured_key(OPENAI_KEY_ACCOUNT, "OPENAI_API_KEY")?
            .is_some(),
        tavily_key_configured: provider
            .configured_key(TAVILY_KEY_ACCOUNT, "TAVILY_API_KEY")?
            .is_some(),
        secret_store: "system keychain".to_string(),
    })
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

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let current_dir = std::env::current_dir().ok();
    let mut roots = vec![manifest_dir.join("..")];
    if let Some(current_dir) = current_dir {
        roots.push(current_dir.clone());
        if let Some(parent) = current_dir.parent() {
            roots.push(parent.to_path_buf());
        }
    }

    let mut candidates = Vec::new();
    let mut seen = HashSet::new();
    for root in roots {
        for relative_path in [".venv/bin/python", ".venv/Scripts/python.exe"] {
            let path = root.join(relative_path);
            if path.exists() {
                let candidate = path.to_string_lossy().to_string();
                if seen.insert(candidate.clone()) {
                    candidates.push(candidate);
                }
            }
        }
    }

    for candidate in [
        "python3.13",
        "python3.12",
        "python3.11",
        "python3",
        "python",
    ] {
        if seen.insert(candidate.to_string()) {
            candidates.push(candidate.to_string());
        }
    }
    candidates
}

fn supported_python_version(version_output: &str) -> bool {
    let version = version_output
        .split_once('|')
        .map(|(_, version)| version)
        .unwrap_or(version_output);
    let mut parts = version.split('.');
    let major = parts.next().and_then(|value| value.parse::<u32>().ok());
    let minor = parts.next().and_then(|value| value.parse::<u32>().ok());
    matches!((major, minor), (Some(3), Some(11..=13)))
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
            Ok(output) if supported_python_version(&output) => return Ok((python_path, output)),
            Ok(output) => {
                let version = output
                    .split_once('|')
                    .map(|(_, version)| version)
                    .unwrap_or("unknown");
                errors.push(format!(
                    "{python_path}: Python {version} is unsupported; use Python 3.11 through 3.13."
                ));
            }
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

fn read_pipe_to_string<R>(mut pipe: R) -> thread::JoinHandle<Result<String, String>>
where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        let mut output = String::new();
        pipe.read_to_string(&mut output)
            .map_err(|error| error.to_string())?;
        Ok(output)
    })
}

fn read_stderr_with_progress<R>(
    pipe: R,
    progress: Channel<GptResearcherProgressEvent>,
    sensitive_values: Vec<String>,
) -> thread::JoinHandle<Result<String, String>>
where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        let mut output = String::new();
        for line in BufReader::new(pipe).lines() {
            let line = line.map_err(|error| error.to_string())?;
            let line = redact_sensitive_values(&line, &sensitive_values);
            output.push_str(&line);
            output.push('\n');
            if let Some(event) = sidecar_progress_event(&line) {
                let _ = progress.send(event);
            }
        }
        Ok(output)
    })
}

fn redact_sensitive_values(line: &str, sensitive_values: &[String]) -> String {
    sensitive_values
        .iter()
        .filter(|value| !value.is_empty())
        .fold(line.to_string(), |redacted, value| {
            redacted.replace(value, "[REDACTED]")
        })
}

fn wait_for_child(child: &Arc<Mutex<Child>>) -> Result<std::process::ExitStatus, String> {
    loop {
        {
            let mut child = child.lock().map_err(|error| error.to_string())?;
            if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
                return Ok(status);
            }
        }

        thread::sleep(Duration::from_millis(100));
    }
}

fn collect_reader_output(
    handle: thread::JoinHandle<Result<String, String>>,
) -> Result<String, String> {
    handle
        .join()
        .map_err(|_| "Unable to join sidecar output reader.".to_string())?
}

const SIDECAR_PROGRESS_PREFIX: &str = "WUTAI_PROGRESS ";

fn sidecar_phase_event(line: &str) -> Option<GptResearcherProgressEvent> {
    let payload = line.trim().strip_prefix(SIDECAR_PROGRESS_PREFIX)?;
    let value: serde_json::Value = serde_json::from_str(payload).ok()?;
    let phase = value.get("phase")?.as_str()?.trim();
    let message = value.get("message")?.as_str()?.trim();
    if phase.is_empty() || message.is_empty() {
        return None;
    }

    Some(GptResearcherProgressEvent {
        kind: "phase".to_string(),
        phase: Some(phase.to_string()),
        message: message.to_string(),
    })
}

fn sidecar_log_event(line: &str) -> Option<GptResearcherProgressEvent> {
    let line = line.trim();
    if line.is_empty() || sidecar_phase_event(line).is_some() {
        return None;
    }

    let mut characters = line.chars();
    let truncated: String = characters.by_ref().take(497).collect();
    let message = if characters.next().is_some() {
        format!("{truncated}...")
    } else {
        line.to_string()
    };
    Some(GptResearcherProgressEvent {
        kind: "log".to_string(),
        phase: None,
        message,
    })
}

fn sidecar_progress_event(line: &str) -> Option<GptResearcherProgressEvent> {
    sidecar_phase_event(line).or_else(|| sidecar_log_event(line))
}

fn sidecar_phase_events(stderr: &str) -> Vec<GptResearcherProgressEvent> {
    stderr.lines().filter_map(sidecar_phase_event).collect()
}

fn sidecar_log_lines(stderr: &str) -> Vec<String> {
    stderr
        .lines()
        .filter_map(sidecar_log_event)
        .map(|event| event.message)
        .collect()
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
fn get_research_provider_setup(
    provider: State<'_, ResearchProviderState>,
) -> Result<ResearchProviderSetup, String> {
    provider_setup_state(provider.inner())
}

#[tauri::command]
fn save_research_provider_setup(
    provider: State<'_, ResearchProviderState>,
    input: ResearchProviderSetupInput,
) -> Result<ResearchProviderSetup, String> {
    provider
        .store
        .save(OPENAI_KEY_ACCOUNT, input.openai_api_key.as_deref())?;
    provider
        .store
        .save(TAVILY_KEY_ACCOUNT, input.tavily_api_key.as_deref())?;
    provider_setup_state(provider.inner())
}

#[tauri::command]
fn clear_research_provider_setup(
    provider: State<'_, ResearchProviderState>,
) -> Result<ResearchProviderSetup, String> {
    provider.store.clear(OPENAI_KEY_ACCOUNT)?;
    provider.store.clear(TAVILY_KEY_ACCOUNT)?;
    provider_setup_state(provider.inner())
}

#[tauri::command]
fn check_gpt_researcher(provider: State<'_, ResearchProviderState>) -> ResearchPreflight {
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
                "Install Python 3.13 and create the project .venv, or set WUTAI_GPT_RESEARCHER_PYTHON to a Python 3.11 through 3.13 interpreter.".to_string(),
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

    match provider.key_configuration_source(OPENAI_KEY_ACCOUNT, "OPENAI_API_KEY") {
        Ok(Some(source)) => checks.push(preflight_check(
            "openai_api_key",
            "Model access",
            "pass",
            "Model access is configured.",
            Some(format!("Configured through {source}.")),
        )),
        Ok(None) => {
            checks.push(preflight_check(
                "openai_api_key",
                "Model access",
                "fail",
                "Model access is not configured.",
                None,
            ));
            fixes.push("Paste a model access key in Research setup and save it.".to_string());
        }
        Err(error) => {
            checks.push(preflight_check(
                "openai_api_key",
                "Model access",
                "fail",
                "Wutai could not check model access.",
                Some(error),
            ));
            fixes.push("Try saving the model access key again in Research setup.".to_string());
        }
    }

    match provider.key_configuration_source(TAVILY_KEY_ACCOUNT, "TAVILY_API_KEY") {
        Ok(Some(source)) => checks.push(preflight_check(
            "tavily_api_key",
            "Web search",
            "pass",
            "Web search is configured.",
            Some(format!("Configured through {source}.")),
        )),
        Ok(None) => {
            checks.push(preflight_check(
                "tavily_api_key",
                "Web search",
                "fail",
                "Web search is not configured.",
                None,
            ));
            fixes.push("Paste a web search key in Research setup and save it.".to_string());
        }
        Err(error) => {
            checks.push(preflight_check(
                "tavily_api_key",
                "Web search",
                "fail",
                "Wutai could not check web search access.",
                Some(error),
            ));
            fixes.push("Try saving the web search key again in Research setup.".to_string());
        }
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
fn cancel_gpt_researcher(
    state: State<'_, SidecarRegistry>,
    task_id: String,
) -> Result<bool, String> {
    state.cancel(&task_id)
}

#[tauri::command]
fn run_gpt_researcher(
    state: State<'_, SidecarRegistry>,
    provider: State<'_, ResearchProviderState>,
    progress: Channel<GptResearcherProgressEvent>,
    input: GptResearcherRunInput,
) -> Result<GptResearcherRunOutput, String> {
    let script_path = gpt_researcher_adapter_script()?;
    let mut errors = Vec::new();
    let openai_key = provider.configured_key(OPENAI_KEY_ACCOUNT, "OPENAI_API_KEY")?;
    let tavily_key = provider.configured_key(TAVILY_KEY_ACCOUNT, "TAVILY_API_KEY")?;
    let sensitive_values = [openai_key.as_ref(), tavily_key.as_ref()]
        .into_iter()
        .flatten()
        .cloned()
        .collect::<Vec<_>>();
    if state.contains(&input.task_id)? {
        return Err("A GPT Researcher sidecar is already running for this task.".to_string());
    }

    for python_path in gpt_researcher_python_candidates() {
        if state.take_cancelled(&input.task_id)? {
            return Err("GPT Researcher task was cancelled.".to_string());
        }

        let mut command = Command::new(&python_path);
        command
            .arg(&script_path)
            .arg("--query")
            .arg(&input.query)
            .arg("--report-type")
            .arg(&input.report_type)
            .arg("--tone")
            .arg(&input.tone)
            .arg("--task-id")
            .arg(&input.task_id)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if let Some(ref key) = openai_key {
            command.env("OPENAI_API_KEY", key);
        }
        if let Some(ref key) = tavily_key {
            command.env("TAVILY_API_KEY", key);
        }

        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                errors.push(format!("Unable to launch {python_path}: {error}"));
                continue;
            }
        };

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Unable to capture GPT Researcher stdout.".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Unable to capture GPT Researcher stderr.".to_string())?;
        let stdout_reader = read_pipe_to_string(stdout);
        let stderr_reader =
            read_stderr_with_progress(stderr, progress.clone(), sensitive_values.clone());
        let child = Arc::new(Mutex::new(child));

        if let Err(error) = state.register(&input.task_id, child.clone()) {
            let _ = child.lock().map_err(|error| error.to_string())?.kill();
            return Err(error);
        }

        let status = wait_for_child(&child);

        state.remove(&input.task_id)?;
        let was_cancelled = state.take_cancelled(&input.task_id)?;

        let stdout = collect_reader_output(stdout_reader)?;
        let stderr = collect_reader_output(stderr_reader)?;

        if was_cancelled {
            return Err("GPT Researcher task was cancelled.".to_string());
        }

        let status = status?;
        if status.success() {
            let mut output: GptResearcherRunOutput =
                serde_json::from_str(&stdout).map_err(|error| {
                    format!("GPT Researcher adapter returned invalid JSON: {error}")
                })?;
            output.logs = sidecar_log_lines(&stderr);
            output.progress = sidecar_phase_events(&stderr);
            return Ok(output);
        }

        let mut message = sidecar_log_lines(&stderr).join("\n");
        if message.is_empty() {
            message = format!("GPT Researcher adapter exited with status {status}");
        }
        errors.push(format!("{python_path}: {message}"));
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
        .manage(SidecarRegistry::default())
        .manage(ResearchProviderState::default())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:wutai.db", migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            cancel_gpt_researcher,
            check_gpt_researcher,
            clear_research_provider_setup,
            get_research_provider_setup,
            save_research_provider_setup,
            write_task_artifacts,
            run_gpt_researcher
        ])
        .run(tauri::generate_context!())
        .expect("error while running Wutai");
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::Cursor;
    use tauri::{
        ipc::{CallbackFn, InvokeBody},
        test::{
            get_ipc_response, mock_builder, mock_context, noop_assets, MockRuntime, INVOKE_KEY,
        },
        webview::InvokeRequest,
        App, WebviewWindow, WebviewWindowBuilder,
    };

    #[derive(Default)]
    struct MemorySecretStore {
        values: Mutex<HashMap<String, String>>,
    }

    impl ProviderSecretStore for MemorySecretStore {
        fn read(&self, account: &str) -> Result<Option<String>, String> {
            Ok(self
                .values
                .lock()
                .map_err(|error| error.to_string())?
                .get(account)
                .cloned())
        }

        fn save(&self, account: &str, value: Option<&str>) -> Result<(), String> {
            if let Some(value) = normalize_secret(value.map(str::to_string)) {
                self.values
                    .lock()
                    .map_err(|error| error.to_string())?
                    .insert(account.to_string(), value);
            }
            Ok(())
        }

        fn clear(&self, account: &str) -> Result<(), String> {
            self.values
                .lock()
                .map_err(|error| error.to_string())?
                .remove(account);
            Ok(())
        }
    }

    fn ipc_test_app(
        provider: ResearchProviderState,
        registry: SidecarRegistry,
    ) -> App<MockRuntime> {
        mock_builder()
            .manage(provider)
            .manage(registry)
            .invoke_handler(tauri::generate_handler![
                cancel_gpt_researcher,
                check_gpt_researcher,
                clear_research_provider_setup,
                get_research_provider_setup,
                save_research_provider_setup
            ])
            .build(mock_context(noop_assets()))
            .unwrap()
    }

    fn ipc_webview(app: &App<MockRuntime>) -> WebviewWindow<MockRuntime> {
        WebviewWindowBuilder::new(app, "main", Default::default())
            .build()
            .unwrap()
    }

    fn invoke_json(
        webview: &WebviewWindow<MockRuntime>,
        command: &str,
        body: serde_json::Value,
    ) -> Result<serde_json::Value, serde_json::Value> {
        let url = if cfg!(any(windows, target_os = "android")) {
            "http://tauri.localhost"
        } else {
            "tauri://localhost"
        };
        get_ipc_response(
            webview,
            InvokeRequest {
                cmd: command.to_string(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: url.parse().unwrap(),
                body: InvokeBody::Json(body),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.to_string(),
            },
        )
        .map(|response| response.deserialize::<serde_json::Value>().unwrap())
    }

    #[test]
    fn secret_store_round_trip_does_not_use_the_system_keychain() {
        let store = MemorySecretStore::default();

        store
            .save(OPENAI_KEY_ACCOUNT, Some("  stored-secret  "))
            .unwrap();
        assert_eq!(
            store.read(OPENAI_KEY_ACCOUNT).unwrap().as_deref(),
            Some("stored-secret")
        );

        store.save(OPENAI_KEY_ACCOUNT, Some("   ")).unwrap();
        assert_eq!(
            store.read(OPENAI_KEY_ACCOUNT).unwrap().as_deref(),
            Some("stored-secret")
        );

        store.clear(OPENAI_KEY_ACCOUNT).unwrap();
        assert_eq!(store.read(OPENAI_KEY_ACCOUNT).unwrap(), None);
    }

    #[test]
    fn stored_secret_takes_precedence_over_environment_fallback() {
        let configured = configured_key_from_sources(
            Ok(Some("stored-secret".to_string())),
            Some("environment-secret".to_string()),
        )
        .unwrap();
        let source = key_configuration_source_from_sources(
            Ok(Some("stored-secret".to_string())),
            Some("environment-secret".to_string()),
        )
        .unwrap();

        assert_eq!(configured.as_deref(), Some("stored-secret"));
        assert_eq!(source, Some("Wutai setup"));
    }

    #[test]
    fn environment_secret_is_used_when_storage_is_empty_or_unavailable() {
        for stored_key in [Ok(None), Err("keychain unavailable".to_string())] {
            assert_eq!(
                configured_key_from_sources(stored_key, Some("  environment-secret  ".to_string()))
                    .unwrap()
                    .as_deref(),
                Some("environment-secret")
            );
        }

        assert_eq!(
            key_configuration_source_from_sources(
                Err("keychain unavailable".to_string()),
                Some("environment-secret".to_string())
            )
            .unwrap(),
            Some("environment")
        );
    }

    #[test]
    fn storage_error_is_reported_when_no_environment_fallback_exists() {
        assert_eq!(
            configured_key_from_sources(Err("keychain unavailable".to_string()), None).unwrap_err(),
            "keychain unavailable"
        );
        assert_eq!(
            key_configuration_source_from_sources(
                Err("keychain unavailable".to_string()),
                Some("   ".to_string())
            )
            .unwrap_err(),
            "keychain unavailable"
        );
    }

    #[test]
    fn python_support_range_is_limited_to_3_11_through_3_13() {
        for version in ["3.11.9", "3.12.12", "3.13.14"] {
            assert!(supported_python_version(version));
            assert!(supported_python_version(&format!(
                "/path/to/python|{version}"
            )));
        }
        for version in ["3.10.18", "3.14.0", "4.0.0", "unknown"] {
            assert!(!supported_python_version(version));
        }
    }

    #[test]
    #[ignore = "requires the optional GPT Researcher Python environment"]
    fn installed_gpt_researcher_sidecar_smoke() {
        let (python_path, version_output) = find_working_python().unwrap_or_else(|errors| {
            panic!("No supported sidecar Python found:\n{}", errors.join("\n"))
        });
        assert!(supported_python_version(&version_output));
        assert_eq!(
            python_package_version(&python_path, "gpt-researcher").unwrap(),
            "0.15.1"
        );
        let imported = command_text_output(
            Command::new(&python_path)
                .arg("-c")
                .arg("from gpt_researcher import GPTResearcher; print(GPTResearcher.__name__)"),
        )
        .unwrap();
        assert_eq!(imported, "GPTResearcher");
    }

    #[test]
    fn stderr_reader_streams_phases_and_logs_while_preserving_audit_lines() {
        let received = Arc::new(Mutex::new(Vec::new()));
        let received_for_channel = received.clone();
        let channel = Channel::new(move |body| {
            let event = body.deserialize::<GptResearcherProgressEvent>().unwrap();
            received_for_channel.lock().unwrap().push(event);
            Ok(())
        });
        let stderr = concat!(
            "WUTAI_PROGRESS {\"phase\":\"researching\",\"message\":\"Reading sources.\"}\n",
            "first runtime log\n",
            "WUTAI_PROGRESS malformed\n",
            "credential=secret-token\n"
        );

        let captured = read_stderr_with_progress(
            Cursor::new(stderr.as_bytes().to_vec()),
            channel,
            vec!["secret-token".to_string()],
        )
        .join()
        .unwrap()
        .unwrap();
        assert!(!captured.contains("secret-token"));
        assert!(captured.contains("credential=[REDACTED]"));
        assert_eq!(
            received.lock().unwrap().as_slice(),
            [
                GptResearcherProgressEvent {
                    kind: "phase".to_string(),
                    phase: Some("researching".to_string()),
                    message: "Reading sources.".to_string(),
                },
                GptResearcherProgressEvent {
                    kind: "log".to_string(),
                    phase: None,
                    message: "first runtime log".to_string(),
                },
                GptResearcherProgressEvent {
                    kind: "log".to_string(),
                    phase: None,
                    message: "WUTAI_PROGRESS malformed".to_string(),
                },
                GptResearcherProgressEvent {
                    kind: "log".to_string(),
                    phase: None,
                    message: "credential=[REDACTED]".to_string(),
                },
            ]
        );
        assert_eq!(sidecar_phase_events(&captured).len(), 1);
        assert_eq!(
            sidecar_log_lines(&captured),
            [
                "first runtime log",
                "WUTAI_PROGRESS malformed",
                "credential=[REDACTED]"
            ]
        );
    }

    #[test]
    fn provider_setup_and_preflight_commands_work_through_tauri_ipc() {
        let store = Arc::new(MemorySecretStore::default());
        let provider = ResearchProviderState::new(store.clone(), HashMap::new());
        let app = ipc_test_app(provider, SidecarRegistry::default());
        let webview = ipc_webview(&app);

        let saved = invoke_json(
            &webview,
            "save_research_provider_setup",
            json!({
                "input": {
                    "openaiApiKey": "model-secret",
                    "tavilyApiKey": "search-secret"
                }
            }),
        )
        .unwrap();
        assert_eq!(saved["openaiKeyConfigured"], true);
        assert_eq!(saved["tavilyKeyConfigured"], true);
        assert_eq!(
            store.read(OPENAI_KEY_ACCOUNT).unwrap().as_deref(),
            Some("model-secret")
        );

        let preflight = invoke_json(&webview, "check_gpt_researcher", json!({})).unwrap();
        let checks = preflight["checks"].as_array().unwrap();
        for key in ["openai_api_key", "tavily_api_key"] {
            let check = checks.iter().find(|check| check["key"] == key).unwrap();
            assert_eq!(check["status"], "pass");
            assert_eq!(check["detail"], "Configured through Wutai setup.");
        }

        let cleared = invoke_json(&webview, "clear_research_provider_setup", json!({})).unwrap();
        assert_eq!(cleared["openaiKeyConfigured"], false);
        assert_eq!(cleared["tavilyKeyConfigured"], false);
        assert_eq!(store.read(OPENAI_KEY_ACCOUNT).unwrap(), None);
        assert_eq!(store.read(TAVILY_KEY_ACCOUNT).unwrap(), None);
    }

    #[cfg(unix)]
    #[test]
    fn cancellation_command_kills_a_registered_process_through_tauri_ipc() {
        let child = Arc::new(Mutex::new(
            Command::new("sh")
                .arg("-c")
                .arg("sleep 30")
                .spawn()
                .unwrap(),
        ));
        let registry = SidecarRegistry::default();
        registry
            .register("ipc-running-task", child.clone())
            .unwrap();
        let provider =
            ResearchProviderState::new(Arc::new(MemorySecretStore::default()), HashMap::new());
        let app = ipc_test_app(provider, registry);
        let webview = ipc_webview(&app);

        let cancelled = invoke_json(
            &webview,
            "cancel_gpt_researcher",
            json!({ "taskId": "ipc-running-task" }),
        )
        .unwrap();
        assert_eq!(cancelled, true);
        child.lock().unwrap().wait().unwrap();

        let registry = app.state::<SidecarRegistry>();
        registry.remove("ipc-running-task").unwrap();
        assert!(registry.take_cancelled("ipc-running-task").unwrap());
    }

    #[test]
    fn cancelling_an_unregistered_task_is_remembered() {
        let registry = SidecarRegistry::default();

        assert!(!registry.cancel("task-before-spawn").unwrap());
        assert!(registry.take_cancelled("task-before-spawn").unwrap());
        assert!(!registry.take_cancelled("task-before-spawn").unwrap());
    }

    #[cfg(unix)]
    #[test]
    fn cancelling_a_registered_process_kills_and_cleans_it_up() {
        let registry = SidecarRegistry::default();
        let child = Arc::new(Mutex::new(
            Command::new("sh")
                .arg("-c")
                .arg("sleep 30")
                .spawn()
                .unwrap(),
        ));

        registry.register("running-task", child.clone()).unwrap();
        assert!(registry.contains("running-task").unwrap());
        assert!(registry.register("running-task", child.clone()).is_err());
        assert!(registry.cancel("running-task").unwrap());
        child.lock().unwrap().wait().unwrap();

        registry.remove("running-task").unwrap();
        assert!(!registry.contains("running-task").unwrap());
        assert!(registry.take_cancelled("running-task").unwrap());
    }
}

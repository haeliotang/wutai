use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{BufRead, BufReader, Read},
    net::{TcpStream, ToSocketAddrs},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};
use tauri::{ipc::Channel, AppHandle, Manager, State};
use tauri_plugin_sql::{Migration, MigrationKind};

const KEYRING_SERVICE: &str = "com.haeliotang.wutai.research";
const PROFILE_CONFIG_FILE: &str = "research-provider-profiles.json";

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

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct ResearchProviderProfile {
    profile_id: String,
    name: String,
    model_provider: String,
    model: String,
    model_base_url: Option<String>,
    search_provider: String,
    embedding_provider: String,
    embedding_model: String,
    embedding_base_url: Option<String>,
}

impl Default for ResearchProviderProfile {
    fn default() -> Self {
        Self {
            profile_id: "deepseek-local".to_string(),
            name: "DeepSeek + local memory".to_string(),
            model_provider: "deepseek".to_string(),
            model: "deepseek-v4-flash".to_string(),
            model_base_url: None,
            search_provider: "tavily".to_string(),
            embedding_provider: "ollama".to_string(),
            embedding_model: "nomic-embed-text".to_string(),
            embedding_base_url: Some("http://127.0.0.1:11434".to_string()),
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct ResearchProviderProfiles {
    active_profile_id: String,
    profiles: Vec<ResearchProviderProfile>,
}

impl Default for ResearchProviderProfiles {
    fn default() -> Self {
        let profile = ResearchProviderProfile::default();
        Self {
            active_profile_id: profile.profile_id.clone(),
            profiles: vec![profile],
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResearchProviderSetupInput {
    profile: ResearchProviderProfile,
    model_api_key: Option<String>,
    search_api_key: Option<String>,
    embedding_api_key: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ResearchProviderSetup {
    profiles: ResearchProviderProfiles,
    active_profile: ResearchProviderProfile,
    model_key_configured: bool,
    search_key_configured: bool,
    embedding_key_configured: bool,
    secret_store: String,
}

#[derive(Debug)]
struct RuntimeProviderConfig {
    environment: HashMap<String, String>,
    sensitive_values: Vec<String>,
    profile: ResearchProviderProfile,
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
    profiles: Mutex<ResearchProviderProfiles>,
    profile_path: Mutex<Option<PathBuf>>,
}

impl ResearchProviderState {
    fn new(store: Arc<dyn ProviderSecretStore>, environment_keys: HashMap<String, String>) -> Self {
        Self {
            store,
            environment_keys,
            profiles: Mutex::new(ResearchProviderProfiles::default()),
            profile_path: Mutex::new(None),
        }
    }

    fn initialize_profiles(&self, path: PathBuf) -> Result<(), String> {
        let profiles = if path.exists() {
            let content = fs::read_to_string(&path).map_err(|error| error.to_string())?;
            serde_json::from_str(&content).map_err(|error| error.to_string())?
        } else {
            ResearchProviderProfiles::default()
        };
        validate_profiles(&profiles)?;
        *self.profiles.lock().map_err(|error| error.to_string())? = profiles;
        *self
            .profile_path
            .lock()
            .map_err(|error| error.to_string())? = Some(path);
        Ok(())
    }

    fn profiles(&self) -> Result<ResearchProviderProfiles, String> {
        Ok(self
            .profiles
            .lock()
            .map_err(|error| error.to_string())?
            .clone())
    }

    fn save_profiles(&self, profiles: ResearchProviderProfiles) -> Result<(), String> {
        validate_profiles(&profiles)?;
        if let Some(path) = self
            .profile_path
            .lock()
            .map_err(|error| error.to_string())?
            .clone()
        {
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            let content =
                serde_json::to_string_pretty(&profiles).map_err(|error| error.to_string())?;
            let temporary_path = path.with_extension("json.tmp");
            fs::write(&temporary_path, content).map_err(|error| error.to_string())?;
            fs::rename(&temporary_path, &path).map_err(|error| error.to_string())?;
        }
        *self.profiles.lock().map_err(|error| error.to_string())? = profiles;
        Ok(())
    }

    fn active_profile(&self) -> Result<ResearchProviderProfile, String> {
        let profiles = self.profiles()?;
        profiles
            .profiles
            .into_iter()
            .find(|profile| profile.profile_id == profiles.active_profile_id)
            .ok_or_else(|| "The active research provider profile does not exist.".to_string())
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
        let environment_keys = ["DEEPSEEK_API_KEY", "OPENAI_API_KEY", "TAVILY_API_KEY"]
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

fn provider_secret_account(profile_id: &str, purpose: &str) -> String {
    format!("profile:{}:{purpose}", sanitize_path_segment(profile_id))
}

fn required_text(value: &str, label: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        Err(format!("{label} cannot be empty."))
    } else {
        Ok(())
    }
}

fn validate_base_url(value: &Option<String>, label: &str, required: bool) -> Result<(), String> {
    let value = value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if required && value.is_none() {
        return Err(format!("{label} is required."));
    }
    let Some(value) = value else {
        return Ok(());
    };
    let parsed = url::Url::parse(value).map_err(|_| format!("{label} must be a valid URL."))?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err(format!("{label} must use HTTP or HTTPS."));
    }
    Ok(())
}

fn validate_profile(profile: &ResearchProviderProfile) -> Result<(), String> {
    required_text(&profile.profile_id, "Profile ID")?;
    required_text(&profile.name, "Profile name")?;
    required_text(&profile.model, "Model")?;
    required_text(&profile.embedding_model, "Embedding model")?;
    if profile.profile_id.len() > 64
        || !profile.profile_id.chars().all(|character| {
            character.is_ascii_alphanumeric()
                || character == '-'
                || character == '_'
                || character == '.'
        })
    {
        return Err(
            "Profile ID must be at most 64 characters and use letters, numbers, '-', '_' or '.'."
                .to_string(),
        );
    }
    if profile.name.len() > 80 {
        return Err("Profile name must be at most 80 characters.".to_string());
    }
    if !matches!(
        profile.model_provider.as_str(),
        "deepseek" | "openai" | "openai-compatible" | "ollama"
    ) {
        return Err("Unsupported model provider.".to_string());
    }
    if !matches!(profile.search_provider.as_str(), "tavily" | "duckduckgo") {
        return Err("Unsupported search provider.".to_string());
    }
    if !matches!(profile.embedding_provider.as_str(), "openai" | "ollama") {
        return Err("Unsupported embedding provider.".to_string());
    }
    validate_base_url(
        &profile.model_base_url,
        "Model base URL",
        matches!(
            profile.model_provider.as_str(),
            "openai-compatible" | "ollama"
        ),
    )?;
    validate_base_url(
        &profile.embedding_base_url,
        "Embedding base URL",
        profile.embedding_provider == "ollama",
    )?;
    if profile.model_provider == "ollama"
        && profile.embedding_provider == "ollama"
        && profile.model_base_url.as_deref().map(str::trim)
            != profile.embedding_base_url.as_deref().map(str::trim)
    {
        return Err(
            "GPT Researcher requires the model and embedding Ollama services to use the same base URL."
                .to_string(),
        );
    }
    if matches!(
        profile.model_provider.as_str(),
        "openai" | "openai-compatible"
    ) && profile.embedding_provider == "openai"
        && profile.model_base_url.as_deref().map(str::trim)
            != profile.embedding_base_url.as_deref().map(str::trim)
        && profile.embedding_base_url.is_some()
    {
        return Err(
            "GPT Researcher requires OpenAI model and embedding requests to use the same base URL."
                .to_string(),
        );
    }
    Ok(())
}

fn validate_profiles(profiles: &ResearchProviderProfiles) -> Result<(), String> {
    if profiles.profiles.is_empty() {
        return Err("At least one research provider profile is required.".to_string());
    }
    let mut ids = HashSet::new();
    for profile in &profiles.profiles {
        validate_profile(profile)?;
        if !ids.insert(profile.profile_id.as_str()) {
            return Err("Research provider profile IDs must be unique.".to_string());
        }
    }
    if !ids.contains(profiles.active_profile_id.as_str()) {
        return Err("The active research provider profile does not exist.".to_string());
    }
    Ok(())
}

fn model_key_source(profile: &ResearchProviderProfile) -> Option<(&'static str, &'static str)> {
    match profile.model_provider.as_str() {
        "deepseek" => Some(("model:deepseek", "DEEPSEEK_API_KEY")),
        "openai" => Some(("model:openai", "OPENAI_API_KEY")),
        "openai-compatible" => Some(("model:openai-compatible", "OPENAI_API_KEY")),
        "ollama" => None,
        _ => None,
    }
}

fn search_key_source(profile: &ResearchProviderProfile) -> Option<(&'static str, &'static str)> {
    match profile.search_provider.as_str() {
        "tavily" => Some(("search:tavily", "TAVILY_API_KEY")),
        "duckduckgo" => None,
        _ => None,
    }
}

fn embedding_key_source(profile: &ResearchProviderProfile) -> Option<(&'static str, &'static str)> {
    if profile.embedding_provider != "openai" {
        return None;
    }
    if matches!(
        profile.model_provider.as_str(),
        "openai" | "openai-compatible"
    ) {
        model_key_source(profile)
    } else {
        Some(("embedding:openai", "OPENAI_API_KEY"))
    }
}

fn profile_secret_purposes() -> [&'static str; 8] {
    [
        "model:deepseek",
        "model:openai",
        "model:openai-compatible",
        "search:tavily",
        "embedding:openai",
        "model",
        "search",
        "embedding",
    ]
}

fn configured_profile_key(
    provider: &ResearchProviderState,
    profile: &ResearchProviderProfile,
    source: Option<(&str, &str)>,
) -> Result<Option<String>, String> {
    let Some((purpose, environment_name)) = source else {
        return Ok(None);
    };
    provider.configured_key(
        &provider_secret_account(&profile.profile_id, purpose),
        environment_name,
    )
}

fn profile_key_configuration_source(
    provider: &ResearchProviderState,
    profile: &ResearchProviderProfile,
    source: Option<(&str, &str)>,
) -> Result<Option<&'static str>, String> {
    let Some((purpose, environment_name)) = source else {
        return Ok(Some("not required"));
    };
    provider.key_configuration_source(
        &provider_secret_account(&profile.profile_id, purpose),
        environment_name,
    )
}

fn build_provider_runtime(
    provider: &ResearchProviderState,
) -> Result<RuntimeProviderConfig, String> {
    let profile = provider.active_profile()?;
    validate_profile(&profile)?;
    let model_key = configured_profile_key(provider, &profile, model_key_source(&profile))?;
    let search_key = configured_profile_key(provider, &profile, search_key_source(&profile))?;
    let embedding_key = configured_profile_key(provider, &profile, embedding_key_source(&profile))?;
    if model_key_source(&profile).is_some() && model_key.is_none() {
        return Err("The active Provider Profile is missing model access.".to_string());
    }
    if search_key_source(&profile).is_some() && search_key.is_none() {
        return Err("The active Provider Profile is missing web search access.".to_string());
    }
    if embedding_key_source(&profile).is_some() && embedding_key.is_none() {
        return Err("The active Provider Profile is missing document memory access.".to_string());
    }
    let mut environment = HashMap::new();

    let model_prefix = match profile.model_provider.as_str() {
        "deepseek" => "deepseek",
        "openai" | "openai-compatible" => "openai",
        "ollama" => "ollama",
        _ => return Err("Unsupported model provider.".to_string()),
    };
    let model = format!("{model_prefix}:{}", profile.model.trim());
    for name in ["FAST_LLM", "SMART_LLM", "STRATEGIC_LLM"] {
        environment.insert(name.to_string(), model.clone());
    }
    environment.insert("RETRIEVER".to_string(), profile.search_provider.clone());
    environment.insert(
        "EMBEDDING".to_string(),
        format!(
            "{}:{}",
            profile.embedding_provider,
            profile.embedding_model.trim()
        ),
    );

    if let Some(key) = model_key.as_ref() {
        let environment_name = model_key_source(&profile).unwrap().1;
        environment.insert(environment_name.to_string(), key.clone());
    }
    if let Some(key) = search_key.as_ref() {
        environment.insert("TAVILY_API_KEY".to_string(), key.clone());
    }
    if let Some(key) = embedding_key.as_ref() {
        environment.insert("OPENAI_API_KEY".to_string(), key.clone());
    }
    if let Some(base_url) = profile.model_base_url.as_deref().map(str::trim) {
        let name = if profile.model_provider == "ollama" {
            "OLLAMA_BASE_URL"
        } else {
            "OPENAI_BASE_URL"
        };
        environment.insert(name.to_string(), base_url.to_string());
    }
    if let Some(base_url) = profile.embedding_base_url.as_deref().map(str::trim) {
        let name = if profile.embedding_provider == "ollama" {
            "OLLAMA_BASE_URL"
        } else {
            "OPENAI_BASE_URL"
        };
        environment.insert(name.to_string(), base_url.to_string());
    }

    let sensitive_values = [model_key, search_key, embedding_key]
        .into_iter()
        .flatten()
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    Ok(RuntimeProviderConfig {
        environment,
        sensitive_values,
        profile,
    })
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
    let profiles = provider.profiles()?;
    let active_profile = provider.active_profile()?;
    Ok(ResearchProviderSetup {
        model_key_configured: configured_profile_key(
            provider,
            &active_profile,
            model_key_source(&active_profile),
        )?
        .is_some(),
        search_key_configured: configured_profile_key(
            provider,
            &active_profile,
            search_key_source(&active_profile),
        )?
        .is_some(),
        embedding_key_configured: configured_profile_key(
            provider,
            &active_profile,
            embedding_key_source(&active_profile),
        )?
        .is_some(),
        profiles,
        active_profile,
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
    validate_profile(&input.profile)?;
    let profile_id = input.profile.profile_id.clone();
    if let Some((purpose, _)) = model_key_source(&input.profile) {
        provider.store.save(
            &provider_secret_account(&profile_id, purpose),
            input.model_api_key.as_deref(),
        )?;
    }
    if let Some((purpose, _)) = search_key_source(&input.profile) {
        provider.store.save(
            &provider_secret_account(&profile_id, purpose),
            input.search_api_key.as_deref(),
        )?;
    }
    if let Some((purpose, _)) = embedding_key_source(&input.profile) {
        if purpose.starts_with("embedding:") {
            provider.store.save(
                &provider_secret_account(&profile_id, purpose),
                input.embedding_api_key.as_deref(),
            )?;
        }
    }

    let mut profiles = provider.profiles()?;
    if let Some(existing) = profiles
        .profiles
        .iter_mut()
        .find(|profile| profile.profile_id == profile_id)
    {
        *existing = input.profile;
    } else {
        profiles.profiles.push(input.profile);
    }
    profiles.active_profile_id = profile_id;
    provider.save_profiles(profiles)?;
    provider_setup_state(provider.inner())
}

#[tauri::command]
fn activate_research_provider_profile(
    provider: State<'_, ResearchProviderState>,
    profile_id: String,
) -> Result<ResearchProviderSetup, String> {
    let mut profiles = provider.profiles()?;
    if !profiles
        .profiles
        .iter()
        .any(|profile| profile.profile_id == profile_id)
    {
        return Err("Research provider profile not found.".to_string());
    }
    profiles.active_profile_id = profile_id;
    provider.save_profiles(profiles)?;
    provider_setup_state(provider.inner())
}

#[tauri::command]
fn delete_research_provider_profile(
    provider: State<'_, ResearchProviderState>,
    profile_id: String,
) -> Result<ResearchProviderSetup, String> {
    let mut profiles = provider.profiles()?;
    if !profiles
        .profiles
        .iter()
        .any(|profile| profile.profile_id == profile_id)
    {
        return Err("Research provider profile not found.".to_string());
    }
    for purpose in profile_secret_purposes() {
        provider
            .store
            .clear(&provider_secret_account(&profile_id, purpose))?;
    }
    profiles
        .profiles
        .retain(|profile| profile.profile_id != profile_id);
    if profiles.profiles.is_empty() {
        profiles = ResearchProviderProfiles::default();
    } else if profiles.active_profile_id == profile_id {
        profiles.active_profile_id = profiles.profiles[0].profile_id.clone();
    }
    provider.save_profiles(profiles)?;
    provider_setup_state(provider.inner())
}

#[tauri::command]
fn clear_research_provider_setup(
    provider: State<'_, ResearchProviderState>,
) -> Result<ResearchProviderSetup, String> {
    let profile = provider.active_profile()?;
    for purpose in profile_secret_purposes() {
        provider
            .store
            .clear(&provider_secret_account(&profile.profile_id, purpose))?;
    }
    provider_setup_state(provider.inner())
}

fn ollama_endpoint_reachable(base_url: &str) -> Result<(), String> {
    let parsed = url::Url::parse(base_url).map_err(|error| error.to_string())?;
    let host = parsed
        .host_str()
        .ok_or_else(|| "Ollama base URL has no host.".to_string())?;
    let port = parsed
        .port_or_known_default()
        .ok_or_else(|| "Ollama base URL has no port.".to_string())?;
    let addresses = (host, port)
        .to_socket_addrs()
        .map_err(|error| error.to_string())?;
    for address in addresses {
        if TcpStream::connect_timeout(&address, Duration::from_millis(300)).is_ok() {
            return Ok(());
        }
    }
    Err(format!("Nothing is listening at {host}:{port}."))
}

fn add_provider_key_preflight(
    provider: &ResearchProviderState,
    profile: &ResearchProviderProfile,
    source: Option<(&str, &str)>,
    key: &str,
    label: &str,
    checks: &mut Vec<ResearchPreflightCheck>,
    fixes: &mut Vec<String>,
) {
    match profile_key_configuration_source(provider, profile, source) {
        Ok(Some("not required")) => checks.push(preflight_check(
            key,
            label,
            "pass",
            &format!("{} does not require an API key.", label),
            Some("Configured by the active provider profile.".to_string()),
        )),
        Ok(Some(configuration_source)) => checks.push(preflight_check(
            key,
            label,
            "pass",
            &format!("{} is configured.", label),
            Some(format!("Configured through {configuration_source}.")),
        )),
        Ok(None) => {
            checks.push(preflight_check(
                key,
                label,
                "fail",
                &format!("{} is not configured.", label),
                None,
            ));
            fixes.push(format!(
                "Add {label} access to the active Provider Profile."
            ));
        }
        Err(error) => {
            checks.push(preflight_check(
                key,
                label,
                "fail",
                &format!("Wutai could not check {}.", label.to_lowercase()),
                Some(error),
            ));
            fixes.push(format!("Save {label} access again in Provider Profiles."));
        }
    }
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

    match provider.active_profile() {
        Ok(profile) => {
            checks.push(preflight_check(
                "provider_profile",
                "Provider Profile",
                "pass",
                &format!("{} is active.", profile.name),
                Some(format!(
                    "Model: {} / Search: {} / Embedding: {}",
                    profile.model_provider, profile.search_provider, profile.embedding_provider
                )),
            ));
            add_provider_key_preflight(
                provider.inner(),
                &profile,
                model_key_source(&profile),
                "model_access",
                "Model access",
                &mut checks,
                &mut fixes,
            );
            add_provider_key_preflight(
                provider.inner(),
                &profile,
                search_key_source(&profile),
                "search_access",
                "Web search",
                &mut checks,
                &mut fixes,
            );
            add_provider_key_preflight(
                provider.inner(),
                &profile,
                embedding_key_source(&profile),
                "embedding_access",
                "Document memory",
                &mut checks,
                &mut fixes,
            );

            if profile.model_provider == "ollama" || profile.embedding_provider == "ollama" {
                let base_url = if profile.model_provider == "ollama" {
                    profile.model_base_url.as_deref()
                } else {
                    profile.embedding_base_url.as_deref()
                };
                match base_url
                    .ok_or_else(|| "Ollama base URL is missing.".to_string())
                    .and_then(ollama_endpoint_reachable)
                {
                    Ok(()) => checks.push(preflight_check(
                        "ollama_endpoint",
                        "Ollama",
                        "pass",
                        "Wutai can reach the local Ollama service.",
                        base_url.map(str::to_string),
                    )),
                    Err(error) => {
                        checks.push(preflight_check(
                            "ollama_endpoint",
                            "Ollama",
                            "fail",
                            "Wutai cannot reach the configured Ollama service.",
                            Some(error),
                        ));
                        fixes.push(
                            "Start Ollama or change its base URL in Advanced settings.".to_string(),
                        );
                    }
                }
            }
        }
        Err(error) => {
            checks.push(preflight_check(
                "provider_profile",
                "Provider Profile",
                "fail",
                "Wutai could not load the active Provider Profile.",
                Some(error),
            ));
            fixes.push("Open Provider Profiles and save a valid profile.".to_string());
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
    let runtime = build_provider_runtime(provider.inner())?;
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
            .stderr(Stdio::piped())
            .envs(&runtime.environment);

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
            read_stderr_with_progress(stderr, progress.clone(), runtime.sensitive_values.clone());
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
            if let Some(audit) = output.audit.as_object_mut() {
                audit.insert(
                    "providerProfile".to_string(),
                    serde_json::json!({
                        "profileId": runtime.profile.profile_id,
                        "name": runtime.profile.name,
                        "modelProvider": runtime.profile.model_provider,
                        "model": runtime.profile.model,
                        "searchProvider": runtime.profile.search_provider,
                        "embeddingProvider": runtime.profile.embedding_provider,
                        "embeddingModel": runtime.profile.embedding_model,
                    }),
                );
            }
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
        .setup(|app| {
            let profile_path = app.path().app_data_dir()?.join(PROFILE_CONFIG_FILE);
            app.state::<ResearchProviderState>()
                .initialize_profiles(profile_path)
                .map_err(std::io::Error::other)?;
            Ok(())
        })
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:wutai.db", migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            activate_research_provider_profile,
            cancel_gpt_researcher,
            check_gpt_researcher,
            clear_research_provider_setup,
            delete_research_provider_profile,
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
                activate_research_provider_profile,
                cancel_gpt_researcher,
                check_gpt_researcher,
                clear_research_provider_setup,
                delete_research_provider_profile,
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
        let account = provider_secret_account("test-profile", "model:openai");

        store.save(&account, Some("  stored-secret  ")).unwrap();
        assert_eq!(
            store.read(&account).unwrap().as_deref(),
            Some("stored-secret")
        );

        store.save(&account, Some("   ")).unwrap();
        assert_eq!(
            store.read(&account).unwrap().as_deref(),
            Some("stored-secret")
        );

        store.clear(&account).unwrap();
        assert_eq!(store.read(&account).unwrap(), None);
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
    fn deepseek_profile_maps_to_gpt_researcher_environment() {
        let store = Arc::new(MemorySecretStore::default());
        store
            .save(
                &provider_secret_account("deepseek-local", "model:deepseek"),
                Some("deepseek-secret"),
            )
            .unwrap();
        store
            .save(
                &provider_secret_account("deepseek-local", "search:tavily"),
                Some("tavily-secret"),
            )
            .unwrap();
        let provider = ResearchProviderState::new(store, HashMap::new());

        let runtime = build_provider_runtime(&provider).unwrap();

        assert_eq!(
            runtime.environment["FAST_LLM"],
            "deepseek:deepseek-v4-flash"
        );
        assert_eq!(
            runtime.environment["SMART_LLM"],
            "deepseek:deepseek-v4-flash"
        );
        assert_eq!(runtime.environment["RETRIEVER"], "tavily");
        assert_eq!(runtime.environment["EMBEDDING"], "ollama:nomic-embed-text");
        assert_eq!(runtime.environment["DEEPSEEK_API_KEY"], "deepseek-secret");
        assert_eq!(runtime.environment["TAVILY_API_KEY"], "tavily-secret");
        assert_eq!(
            runtime.environment["OLLAMA_BASE_URL"],
            "http://127.0.0.1:11434"
        );
        assert!(!runtime.environment.contains_key("OPENAI_API_KEY"));
        assert_eq!(runtime.sensitive_values.len(), 2);
    }

    #[test]
    fn openai_model_key_is_reused_for_openai_embeddings() {
        let store = Arc::new(MemorySecretStore::default());
        let profile = ResearchProviderProfile {
            profile_id: "openai-test".to_string(),
            name: "OpenAI test".to_string(),
            model_provider: "openai".to_string(),
            model: "gpt-4o-mini".to_string(),
            model_base_url: None,
            search_provider: "duckduckgo".to_string(),
            embedding_provider: "openai".to_string(),
            embedding_model: "text-embedding-3-small".to_string(),
            embedding_base_url: None,
        };
        store
            .save(
                &provider_secret_account(&profile.profile_id, "model:openai"),
                Some("one-openai-secret"),
            )
            .unwrap();
        let provider = ResearchProviderState::new(store, HashMap::new());
        provider
            .save_profiles(ResearchProviderProfiles {
                active_profile_id: profile.profile_id.clone(),
                profiles: vec![profile],
            })
            .unwrap();

        let runtime = build_provider_runtime(&provider).unwrap();

        assert_eq!(runtime.environment["FAST_LLM"], "openai:gpt-4o-mini");
        assert_eq!(runtime.environment["RETRIEVER"], "duckduckgo");
        assert_eq!(
            runtime.environment["EMBEDDING"],
            "openai:text-embedding-3-small"
        );
        assert_eq!(runtime.environment["OPENAI_API_KEY"], "one-openai-secret");
        assert_eq!(runtime.sensitive_values, ["one-openai-secret"]);
    }

    #[test]
    fn provider_specific_key_is_not_reused_after_switching_model_provider() {
        let store = Arc::new(MemorySecretStore::default());
        store
            .save(
                &provider_secret_account("deepseek-local", "model:openai"),
                Some("openai-only-secret"),
            )
            .unwrap();
        store
            .save(
                &provider_secret_account("deepseek-local", "search:tavily"),
                Some("search-secret"),
            )
            .unwrap();
        let provider = ResearchProviderState::new(store, HashMap::new());

        assert_eq!(
            build_provider_runtime(&provider).unwrap_err(),
            "The active Provider Profile is missing model access."
        );
    }

    #[test]
    fn profile_metadata_persists_without_keychain_secrets() {
        let store = Arc::new(MemorySecretStore::default());
        store
            .save(
                &provider_secret_account("deepseek-local", "model:deepseek"),
                Some("must-not-enter-profile-json"),
            )
            .unwrap();
        let provider = ResearchProviderState::new(store, HashMap::new());
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "wutai-provider-profiles-{}-{unique}.json",
            std::process::id()
        ));
        provider.initialize_profiles(path.clone()).unwrap();
        let mut profiles = provider.profiles().unwrap();
        profiles.profiles[0].name = "Persisted profile".to_string();
        provider.save_profiles(profiles).unwrap();

        let content = fs::read_to_string(&path).unwrap();
        assert!(content.contains("Persisted profile"));
        assert!(!content.contains("must-not-enter-profile-json"));

        let reloaded =
            ResearchProviderState::new(Arc::new(MemorySecretStore::default()), HashMap::new());
        reloaded.initialize_profiles(path.clone()).unwrap();
        assert_eq!(reloaded.active_profile().unwrap().name, "Persisted profile");
        fs::remove_file(path).unwrap();
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
                    "profile": {
                        "profileId": "openai-test",
                        "name": "OpenAI test",
                        "modelProvider": "openai",
                        "model": "gpt-4o-mini",
                        "modelBaseUrl": null,
                        "searchProvider": "tavily",
                        "embeddingProvider": "openai",
                        "embeddingModel": "text-embedding-3-small",
                        "embeddingBaseUrl": null
                    },
                    "modelApiKey": "model-secret",
                    "searchApiKey": "search-secret",
                    "embeddingApiKey": null
                }
            }),
        )
        .unwrap();
        assert_eq!(saved["activeProfile"]["profileId"], "openai-test");
        assert_eq!(saved["modelKeyConfigured"], true);
        assert_eq!(saved["searchKeyConfigured"], true);
        assert_eq!(saved["embeddingKeyConfigured"], true);
        assert_eq!(
            store
                .read(&provider_secret_account("openai-test", "model:openai"))
                .unwrap()
                .as_deref(),
            Some("model-secret")
        );

        let preflight = invoke_json(&webview, "check_gpt_researcher", json!({})).unwrap();
        let checks = preflight["checks"].as_array().unwrap();
        for key in ["model_access", "search_access", "embedding_access"] {
            let check = checks.iter().find(|check| check["key"] == key).unwrap();
            assert_eq!(check["status"], "pass");
            assert_eq!(check["detail"], "Configured through Wutai setup.");
        }

        let cleared = invoke_json(&webview, "clear_research_provider_setup", json!({})).unwrap();
        assert_eq!(cleared["modelKeyConfigured"], false);
        assert_eq!(cleared["searchKeyConfigured"], false);
        assert_eq!(cleared["embeddingKeyConfigured"], false);
        assert_eq!(
            store
                .read(&provider_secret_account("openai-test", "model:openai"))
                .unwrap(),
            None
        );
        assert_eq!(
            store
                .read(&provider_secret_account("openai-test", "search:tavily"))
                .unwrap(),
            None
        );

        let deleted = invoke_json(
            &webview,
            "delete_research_provider_profile",
            json!({ "profileId": "openai-test" }),
        )
        .unwrap();
        assert_eq!(deleted["activeProfile"]["profileId"], "deepseek-local");
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

import { invoke } from "@tauri-apps/api/core";

export interface ResearchProviderSetup {
  openaiKeyConfigured: boolean;
  tavilyKeyConfigured: boolean;
  secretStore: string;
}

export interface ResearchProviderSetupInput {
  openaiApiKey: string | null;
  tavilyApiKey: string | null;
}

export function saveResearchProviderSetup(input: ResearchProviderSetupInput) {
  return invoke<ResearchProviderSetup>("save_research_provider_setup", {
    input,
  });
}

export function clearResearchProviderSetup() {
  return invoke<ResearchProviderSetup>("clear_research_provider_setup");
}

import { invoke } from "@tauri-apps/api/core";

export type ModelProvider =
  | "deepseek"
  | "openai"
  | "openai-compatible"
  | "ollama";
export type SearchProvider = "tavily" | "duckduckgo";
export type EmbeddingProvider = "openai" | "ollama";

export interface ResearchProviderProfile {
  profileId: string;
  name: string;
  modelProvider: ModelProvider;
  model: string;
  modelBaseUrl: string | null;
  searchProvider: SearchProvider;
  embeddingProvider: EmbeddingProvider;
  embeddingModel: string;
  embeddingBaseUrl: string | null;
}

export interface ResearchProviderProfiles {
  activeProfileId: string;
  profiles: ResearchProviderProfile[];
}

export interface ResearchProviderSetup {
  profiles: ResearchProviderProfiles;
  activeProfile: ResearchProviderProfile;
  modelKeyConfigured: boolean;
  searchKeyConfigured: boolean;
  embeddingKeyConfigured: boolean;
  secretStore: string;
}

export interface ResearchProviderSetupInput {
  profile: ResearchProviderProfile;
  modelApiKey: string | null;
  searchApiKey: string | null;
  embeddingApiKey: string | null;
}

export function getResearchProviderSetup() {
  return invoke<ResearchProviderSetup>("get_research_provider_setup");
}

export function saveResearchProviderSetup(input: ResearchProviderSetupInput) {
  return invoke<ResearchProviderSetup>("save_research_provider_setup", {
    input,
  });
}

export function activateResearchProviderProfile(profileId: string) {
  return invoke<ResearchProviderSetup>("activate_research_provider_profile", {
    profileId,
  });
}

export function deleteResearchProviderProfile(profileId: string) {
  return invoke<ResearchProviderSetup>("delete_research_provider_profile", {
    profileId,
  });
}

export function clearResearchProviderSetup() {
  return invoke<ResearchProviderSetup>("clear_research_provider_setup");
}

import { gptResearcherAdapter } from "./gptResearcherAdapter";
import { mockResearchAdapter } from "./mockResearchAdapter";
import type { ResearchAdapter } from "./researchAdapter";

function isTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

export function createResearchAdapter(): ResearchAdapter {
  const requestedAdapter = import.meta.env.VITE_WUTAI_RESEARCH_ADAPTER;

  if (requestedAdapter === "gpt-researcher" && isTauriRuntime()) {
    return gptResearcherAdapter;
  }

  return mockResearchAdapter;
}

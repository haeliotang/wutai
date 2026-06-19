import { expect, test } from "@playwright/test";

test.skip(
  process.env.VITE_WUTAI_RESEARCH_ADAPTER !== "gpt-researcher",
  "Provider Profiles require the GPT Researcher build flag.",
);

test("renders and edits Provider Profiles through the Tauri contract", async ({
  page,
}) => {
  const setup = {
    profiles: {
      activeProfileId: "deepseek-local",
      profiles: [
        {
          profileId: "deepseek-local",
          name: "DeepSeek + local memory",
          modelProvider: "deepseek",
          model: "deepseek-v4-flash",
          modelBaseUrl: null,
          searchProvider: "tavily",
          embeddingProvider: "ollama",
          embeddingModel: "nomic-embed-text",
          embeddingBaseUrl: "http://127.0.0.1:11434",
        },
      ],
    },
    activeProfile: {
      profileId: "deepseek-local",
      name: "DeepSeek + local memory",
      modelProvider: "deepseek",
      model: "deepseek-v4-flash",
      modelBaseUrl: null,
      searchProvider: "tavily",
      embeddingProvider: "ollama",
      embeddingModel: "nomic-embed-text",
      embeddingBaseUrl: "http://127.0.0.1:11434",
    },
    modelKeyConfigured: false,
    searchKeyConfigured: false,
    embeddingKeyConfigured: false,
    secretStore: "system keychain",
  };
  const preflight = {
    ready: false,
    summary: "GPT Researcher needs setup before Wutai can run real web research.",
    checks: [
      {
        key: "provider_profile",
        label: "Provider Profile",
        status: "pass",
        message: "DeepSeek + local memory is active.",
      },
      {
        key: "model_access",
        label: "Model access",
        status: "fail",
        message: "Model access is not configured.",
      },
    ],
    fixes: ["Add Model access to the active Provider Profile."],
  };

  await page.addInitScript(
    ({ setupState, preflightState }) => {
      Object.defineProperty(window, "__TAURI_INTERNALS__", {
        configurable: true,
        value: {
          invoke: async (command: string) => {
            if (command === "plugin:sql|load") return "sqlite:wutai.db";
            if (command === "plugin:sql|select") return [];
            if (command === "check_gpt_researcher") return preflightState;
            if (command === "get_research_provider_setup") return setupState;
            throw new Error(`Unexpected mocked command: ${command}`);
          },
        },
      });
    },
    { setupState: setup, preflightState: preflight },
  );

  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto("/");

  await expect(page.getByLabel("Provider Profiles")).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Provider Profile", exact: true }),
  ).toHaveValue("deepseek-local");
  await expect(
    page.getByRole("combobox", { name: "Model service", exact: true }),
  ).toHaveValue("deepseek");
  await expect(
    page.getByRole("textbox", { name: "Model", exact: true }),
  ).toHaveValue("deepseek-v4-flash");
  await expect(
    page.getByRole("combobox", { name: "Document memory", exact: true }),
  ).not.toBeVisible();

  await page.getByText("Advanced", { exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Document memory", exact: true }),
  ).toHaveValue("ollama");
  await expect(
    page.getByRole("textbox", { name: "Embedding model", exact: true }),
  ).toHaveValue("nomic-embed-text");

  await page
    .getByRole("combobox", { name: "Model service", exact: true })
    .selectOption("openai-compatible");
  await expect(
    page.getByRole("textbox", { name: "Model base URL", exact: true }),
  ).toHaveValue("https://api.example.com/v1");

  if (process.env.WUTAI_CAPTURE_UI === "1") {
    await page.screenshot({
      path: "test-results/provider-profiles.png",
      fullPage: true,
    });
  }

  await page.setViewportSize({ width: 860, height: 700 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

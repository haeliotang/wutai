import { expect, test } from "@playwright/test";

test("runs the v0.1 mock research task lifecycle", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("WUTAI / OBSERVE MODE")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create plan" })).toBeVisible();
  await expect(page.getByText("Adapter: Mock research adapter")).toBeVisible();
  await expect(page.getByLabel("Research setup")).toHaveCount(0);

  await page.getByRole("button", { name: "Create plan" }).click();

  await expect(page.getByText("Permission required")).toBeVisible();
  await expect(page.getByText("No form submission")).toBeVisible();

  await page.getByRole("button", { name: "Allow for this task" }).click();

  await expect(page.getByText("Research task completed.")).toBeVisible();
  await expect(page.getByLabel("Evidence Gate")).toBeVisible();
  await expect(page.getByText("Evidence passed")).toBeVisible();
  await expect(
    page.getByText("Evidence checks passed for the mock research fixture."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download claims" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download verification" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download manifest" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Artifact preview" })).toBeVisible();
  await expect(page.getByText("Wutai v0.1 Mock Research Report")).toBeVisible();
  await expect(
    page.getByText(
      "Saved manifest, report, sources, claims, verification, and audit artifacts.",
    ),
  ).toBeVisible();
  const manifest = await page.evaluate(() => {
    const tasks = JSON.parse(window.localStorage.getItem("wutai.v0.tasks") ?? "[]");
    const activeTask = tasks[0];
    const artifact = activeTask.artifacts.find(
      (item: { name: string }) => item.name === "manifest.json",
    );
    return artifact ? JSON.parse(artifact.content) : null;
  });
  expect(manifest.schemaVersion).toBe(2);
  expect(manifest.kind).toBe("wutai.work_packet_manifest");
  expect(manifest.packetType).toBe("research");
  expect(manifest.producer.adapter).toBe("mockResearchAdapter");
  expect(manifest.artifacts.map((item: { name: string }) => item.name)).toEqual([
    "report.md",
    "sources.json",
    "claims.json",
    "verification.json",
    "audit.json",
  ]);
  expect(manifest.artifacts[0].sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(manifest.evidence.status).toBe("pass");

  await page.setViewportSize({ width: 860, height: 700 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

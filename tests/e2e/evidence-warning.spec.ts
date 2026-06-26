import { expect, test } from "@playwright/test";

test("shows evidence warnings as a distinct completed state", async ({ page }) => {
  const createdAt = "2026-06-20T00:00:00.000Z";
  const verification = {
    schemaVersion: 1,
    taskId: "task_warning_fixture",
    status: "warning",
    readyForTrust: false,
    summary: "The report was produced, but some claims need stronger evidence.",
    generatedAt: createdAt,
    metrics: {
      claimCount: 3,
      factualClaimCount: 3,
      citationCoverage: 0.6667,
      primarySourceCount: 1,
      highRiskGapCount: 1,
      conflictCount: 0,
    },
    checks: [
      {
        key: "primary_evidence",
        label: "Primary evidence",
        status: "warning",
        message: "1 high-risk claim needs stronger primary evidence.",
        claimIds: ["claim_003"],
      },
    ],
  };
  const task = {
    taskId: "task_warning_fixture",
    title: "Research agent work governance tools",
    userRequest: "Compare desktop agents.",
    status: "completed_with_warnings",
    plan: ["Research and verify claims."],
    createdAt,
    updatedAt: createdAt,
    events: [],
    permissions: [],
    sources: [],
    artifacts: [
      {
        artifactId: "artifact_report",
        taskId: "task_warning_fixture",
        type: "markdown",
        name: "report.md",
        virtualPath: "artifacts/task_warning_fixture/report.md",
        content: "# Report\n\nReview required.",
        createdAt,
      },
      {
        artifactId: "artifact_claims",
        taskId: "task_warning_fixture",
        type: "json",
        name: "claims.json",
        virtualPath: "artifacts/task_warning_fixture/claims.json",
        content: JSON.stringify({ schemaVersion: 1, claims: [] }),
        createdAt,
      },
      {
        artifactId: "artifact_verification",
        taskId: "task_warning_fixture",
        type: "json",
        name: "verification.json",
        virtualPath: "artifacts/task_warning_fixture/verification.json",
        content: JSON.stringify(verification),
        createdAt,
      },
    ],
  };

  await page.addInitScript((fixture) => {
    window.localStorage.setItem("wutai.v0.tasks", JSON.stringify([fixture]));
  }, task);
  await page.goto("/");

  const evidencePanel = page.getByLabel("Evidence Gate");
  await expect(evidencePanel).toBeVisible();
  await expect(evidencePanel.getByText("Needs evidence review")).toBeVisible();
  await expect(
    evidencePanel.getByText("1 high-risk claim needs stronger primary evidence."),
  ).toBeVisible();
  await expect(
    evidencePanel.getByRole("button", { name: "Download claims" }),
  ).toBeVisible();
  await expect(
    evidencePanel.getByRole("button", { name: "Download verification" }),
  ).toBeVisible();

  await page.setViewportSize({ width: 860, height: 700 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  if (process.env.WUTAI_CAPTURE_UI === "1") {
    await page.screenshot({
      path: "test-results/evidence-warning.png",
      fullPage: true,
    });
  }
});

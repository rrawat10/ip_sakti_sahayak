import { test, expect } from "@playwright/test";

test("published benchmark report shows denominators and missing scores", async ({
  page,
  context,
}) => {
  await context.route("**/benchmarks/report.json", (route) =>
    route.fulfill({
      json: {
        status: "measured",
        engineering_only: true,
        evaluated_at: "2026-09-26T00:00:00Z",
        case_count: 6,
        final_k: 5,
        split: "held_out",
        rows: ["BM25", "Vector", "Hybrid"].map((method) => ({
          method,
          faithfulness: { mean: 0.75, n: 4 },
          recall: { mean: 0.5, n: 4 },
          abstention: { mean: null, n: 0 },
        })),
      },
    }),
  );
  await context.route("**/benchmarks/retrieval.json", (route) =>
    route.fulfill({
      json: {
        status: "measured", engineering_only: true,
        evaluated_at: "2026-09-27T00:00:00Z", case_count: 17,
        document_count: 17, final_k: 8,
        limitations: "Retrieval only.",
        rows: ["BM25", "Vector", "Hybrid"].map((method) => ({
          method, cases: 17, hit_rate_at_k: 1, mrr_at_k: 0.9,
          latency_p50_ms: 120, scope_violations: 0, errors: 0,
        })),
      },
    }),
  );
  await page.goto("/");
  await expect(
    page.getByText("Engineering evaluation", { exact: true }),
  ).toBeVisible();
  const retrievalTable = page.getByRole("table", { name: "Corpus retrieval evaluation" });
  await expect(retrievalTable).toContainText("Hit@8");
  await expect(retrievalTable).toContainText("100%");
  await expect(page.getByText(/17 cases covering 17 active documents/)).toBeVisible();
  const answerTable = page.getByRole("table", { name: "Answer quality evaluation" });
  await expect(answerTable).toContainText("Recall@5");
  await expect(answerTable).toContainText("75%");
  await expect(answerTable).toContainText("n = 4");
  await expect(answerTable).toContainText("Not measured");
  await expect(
    page.getByRole("link", { name: "Open answer report" }),
  ).toHaveAttribute("href", "/benchmarks/report.json");
});

test("landing tour, benchmark disclosure and reduced motion", async ({
  page, context,
}) => {
  for (const name of ["report", "retrieval"]) {
    await context.route(`**/benchmarks/${name}.json`, (route) =>
      route.fulfill({ json: { status: "pending" } }),
    );
  }
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Your Ayurveda research/ }),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(() => document.fonts.check('500 16px "Geist"')),
  ).toBe(true);
  if (test.info().project.name === "mobile") {
    await page.getByRole("button", { name: "Open menu" }).click();
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "About" })
      .click();
    await expect(page).toHaveURL(/\/about$/);
    await page.goto("/");
  }
  await expect(page.getByText("Evaluation pending")).toBeVisible();
  for (const table of await page.getByRole("table").all()) {
    await expect(table).toContainText("BM25");
    await expect(table).toContainText("Not measured");
    await expect(table).not.toContainText("94%");
  }
  await page.getByRole("button", { name: "Pause audience animation" }).click();
  await expect(page.locator(".audience-track")).toHaveCSS(
    "animation-play-state",
    "paused",
  );
  await page.getByRole("button", { name: /Inspect the sources/ }).click();
  await page.locator(".tour-source").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: /Review the evidence/ }).click();
  await expect(
    page.getByText(
      "Review preview · these checks have not run on this example",
    ),
  ).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".audience-track")).toHaveCSS(
    "animation-name",
    "none",
  );
  await expect(
    page.locator('.audience-group[aria-hidden="true"]'),
  ).toBeHidden();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/landing-${test.info().project.name}.png`,
    fullPage: true,
  });
});

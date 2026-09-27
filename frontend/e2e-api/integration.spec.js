import { test, expect } from "@playwright/test";

test("real HTTP Clerk identity, SSE progress, persistence and export", async ({
  page,
}) => {
  await page.goto("/consultations");
  await expect(
    page.getByRole("heading", { name: "What are you working on?" }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: /Describe your product/ })
    .fill("Explain the reviewed patent source.");
  await page
    .getByRole("button", { name: "Send question", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    /Understanding|Retrieving|Preparing|Checking/,
  );
  await expect(
    page.getByRole("heading", { name: "Answer", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Source evidence: Source" }),
  ).toHaveAttribute("href", "https://example.org/source");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Answer", exact: true }),
  ).toBeVisible();
  await page.getByText("Answer evidence review").click();
  await expect(page.getByText("6/6 automated checks passed")).toBeVisible();
  await expect(
    page.getByText("Jurisdiction matches", { exact: true }),
  ).toBeVisible();
  const data = await page.evaluate(async () => {
    const response = await fetch("/api/v1/auth/export", {
      headers: { Authorization: "Bearer test:browser-user" },
    });
    if (!response.ok) throw new Error(`Export failed: ${response.status}`);
    return response.json();
  });
  expect(data.consultations).toHaveLength(1);
  expect(data.consultations[0].messages).toHaveLength(2);
  expect(JSON.stringify(data)).not.toContain("password_hash");
});

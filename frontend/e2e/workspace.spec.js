import { test, expect } from "@playwright/test";

async function createDemoAccount(page) {
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Demo Researcher");
  await page.getByLabel("Email").fill("demo@example.test");
  await page.getByLabel("Password").fill("demo-password-123");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
}

test("clarification, selected expert brief, rename and deletion", async ({ page }) => {
  await createDemoAccount(page);
  const composer = page.getByRole("textbox", { name: /Describe your product/ });
  const send = page.getByRole("button", { name: "Send question", exact: true });
  await composer.fill("Help classify my product");
  await send.click();
  await expect(page.getByText(/How will the product be used and described/).first()).toBeVisible();
  await page.getByRole("radio", { name: /For medicinal use/ }).check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByText(/Is the formulation and preparation method/).first()).toBeVisible();
  await composer.fill("I changed the preparation");
  await send.click();
  await expect(page.getByText(/Your intended use and formulation background are recorded/).first()).toBeVisible();
  await page.getByRole("button", { name: "Prepare expert brief" }).click();
  const downloadButton = page.getByRole("button", { name: "Download brief" });
  await expect(downloadButton).toBeDisabled();
  await page.getByRole("checkbox", { name: /Help classify my product/ }).check();
  const downloaded = page.waitForEvent("download");
  await downloadButton.click();
  expect((await downloaded).suggestedFilename()).toBe("ip-sakti-expert-brief.txt");
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page.getByRole("textbox", { name: "Rename", exact: true }).fill("Renamed research");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".workspace-breadcrumb")).toContainText("Renamed research");
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("heading", { name: "What are you working on?" })).toBeVisible();
  await page.goto("/settings");
  await expect(page.getByText("No authorized subscription provider is connected yet.")).toBeVisible();
});

test("signup-only demo entry opens the full temporary workspace", async ({ page }, testInfo) => {
  await page.goto("/sign-up");
  await page.getByRole("link", { name: "Open demo workspace" }).click();
  await expect(page.getByRole("heading", { name: "What are you working on?" })).toBeVisible();
  await page.getByRole("button", { name: "International", exact: true }).click();
  await page.locator("textarea").fill("Does a PCT application itself grant a worldwide patent?");
  await page.getByRole("button", { name: "Send question", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Begin with the official pathway" })).toBeVisible();
  await page.getByRole("button", { name: /Introduction to the Patent Cooperation Treaty/ }).last().click();
  await expect(page.getByRole("link", { name: "Open official source" })).toHaveAttribute("href", /wipo.int/);
  await page.getByRole("button", { name: "Close", exact: true }).last().click();
  await expect(page.locator(".workspace-sidebar").first()).toContainText(/PCT application/);
  if (testInfo.project.name === "mobile") {
    await page.getByRole("button", { name: "View consultation context" }).click();
    await expect(page.locator(".context-panel").last()).toBeVisible();
    await page.getByRole("button", { name: "Close", exact: true }).last().click();
  } else {
    await expect(page.locator(".context-panel").first()).toBeVisible();
  }
  await page.reload();
  await expect(page.getByRole("heading", { name: "What are you working on?" })).toBeVisible();
  await expect(page.locator(".workspace-sidebar").first()).not.toContainText(/PCT application/);
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.locator(".theme-dark")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/workspace-${testInfo.project.name}.png`, fullPage: true });
});
test("public navigator and source filters work", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Your Ayurveda research/ }),
  ).toBeVisible();
  await page.screenshot({
    path: `test-results/home-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.goto("/sources");
  await page
    .getByRole("textbox", { name: "Search sources or authorities" })
    .fill("FDA");
  await expect(
    page.getByRole("heading", {
      name: "Botanical Drug Development: Guidance for Industry",
    }),
  ).toBeVisible();
  await page.goto("/learn?topic=abs");
  await expect(
    page.getByRole("heading", {
      name: "Biological resources & ABS",
      exact: true,
    }),
  ).toBeVisible();
});

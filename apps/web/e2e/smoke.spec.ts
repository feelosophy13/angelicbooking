import { test, expect } from "@playwright/test";

/**
 * End-to-end smoke: a brand-new business signs up, adds a service, books a
 * client, checks out with cash, and the public booking page renders.
 */
const stamp = Date.now();
const email = `e2e-${stamp}@example.com`;
const password = `e2e-pass-${stamp}`;
const bizName = `E2E Salon ${stamp}`;

test("sign up → onboard → service → book → checkout → public page", async ({ page }) => {
  await page.goto("/sign-up");
  await page.getByLabel(/^Your name/).fill("E2E Owner");
  await page.getByLabel(/^Email/).fill(email);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole("button", { name: "Create account" }).click();

  await page.waitForURL("**/onboarding");
  await page.getByLabel(/^Business name/).fill(bizName);
  await page.getByRole("button", { name: "Create business" }).click();
  await page.waitForURL(/\/app\/[^/]+$/);
  const slug = new URL(page.url()).pathname.split("/")[2]!;

  // Service
  await page.goto(`/app/${slug}/services/new`);
  await page.getByLabel(/^Name\b/).fill("Blowout");
  await page.getByLabel(/^Price/).fill("45");
  await page.getByRole("button", { name: "Create service" }).click();
  await expect(page.getByText("Blowout added")).toBeVisible();

  // Client
  await page.goto(`/app/${slug}/clients/new`);
  await page.getByLabel(/^First name/).fill("Casey");
  await page.getByLabel(/^Last name/).fill("Tester");
  await page.getByLabel(/^Mobile phone/).fill("5550101234");
  await page.getByRole("button", { name: "Create client" }).click();
  await page.waitForURL(/\/clients\/[0-9a-f-]+$/);

  // Book tomorrow (owner has default hours Tue–Sat; pick the next day with slots)
  await page.goto(`/app/${slug}/appointments/new`);
  const clientValue = await page.getByLabel(/^Client/).locator("option", { hasText: "Casey Tester" }).getAttribute("value");
  await page.getByLabel(/^Client/).selectOption(clientValue!);
  const serviceValue = await page.getByLabel(/^Service/).locator("option", { hasText: "Blowout" }).getAttribute("value");
  await page.getByLabel(/^Service/).selectOption(serviceValue!);
  let found = false;
  for (let i = 1; i <= 7 && !found; i++) {
    const d = new Date(Date.now() + i * 86_400_000).toISOString().slice(0, 10);
    await page.getByLabel(/^Date/).fill(d);
    await page.getByRole("button", { name: "Find times" }).click();
    await page.waitForURL(/serviceId=/);
    await page.waitForLoadState("networkidle");
    const slot = page.getByRole("button", { name: /^\d{1,2}:\d{2} (AM|PM)$/ }).first();
    if (await slot.waitFor({ state: "visible", timeout: 4000 }).then(() => true, () => false)) {
      await slot.click();
      await page.getByRole("button", { name: /^Book / }).click();
      found = true;
    }
  }
  expect(found).toBeTruthy();
  await page.waitForURL(/\/app\/[^/]+\?date=/);

  // Open the appointment and check out with cash
  await page.getByRole("button", { name: /Casey Tester/ }).first().click();
  await page.waitForURL(/\/appointments\//);
  await page.getByRole("button", { name: /Check out/ }).click();
  await page.waitForURL(/\/sales\//);
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByText("Paid in full")).toBeVisible();

  // Public booking page renders
  await page.goto(`/book/${slug}`);
  await expect(page.getByText("Choose a service")).toBeVisible();
  await expect(page.getByText("Blowout")).toBeVisible();
});

import { test, expect, type Page } from "@playwright/test";

// Monotonic per-run suffix so distinct signups never collide, even within the
// same millisecond. email and phone_number are both UNIQUE in the DB.
let seq = 0;
function uniqueSuffix() {
  seq += 1;
  return `${Date.now()}${seq}`;
}

function uniqueEmail() {
  return `e2e+${uniqueSuffix()}@example.com`;
}

function uniquePhone() {
  return uniqueSuffix().slice(-10).padStart(10, "0");
}

const PASSWORD = "password123";

async function signUp(page: Page, email: string) {
  await page.goto("/auth/signup");
  await page.getByLabel(/first name/i).fill("Test");
  await page.getByLabel(/last name/i).fill("User");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/phone/i).fill(uniquePhone());
  await page.getByLabel(/date of birth/i).fill("1990-01-01");
  await page.getByLabel(/sin/i).fill("123456789");
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /sign up|create/i }).click();
  // On success the form routes to sign-in; waiting confirms signup completed.
  await page.waitForURL("**/auth/signin");
}

async function signIn(page: Page, email: string) {
  await page.goto("/auth/signin");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL("**/dashboard");
}

test("sign up, sign in, reach dashboard, log out", async ({ page }) => {
  const email = uniqueEmail();
  await signUp(page, email);
  await signIn(page, email);

  await expect(page.getByText(/welcome back/i)).toBeVisible();

  await page.getByRole("button", { name: /log out/i }).click();
  await page.waitForURL("**/auth/signin");
});

test("access-token cookie is short-lived; refresh cookie is long-lived", async ({ page, context }) => {
  const email = uniqueEmail();
  await signUp(page, email);
  await signIn(page, email);

  const cookies = await context.cookies();
  const access = cookies.find((c) => c.name === "access_token");
  const refresh = cookies.find((c) => c.name === "refresh_token");
  expect(access, "access_token cookie present").toBeTruthy();
  expect(refresh, "refresh_token cookie present").toBeTruthy();
  // The access token must expire far sooner than the refresh token (fix from PR #35).
  expect(refresh!.expires - access!.expires).toBeGreaterThan(3 * 24 * 60 * 60);
});

test("silent refresh: expired access cookie is rotated, not a crash", async ({ page, context }) => {
  const email = uniqueEmail();
  await signUp(page, email);
  await signIn(page, email);

  // Simulate an expired/absent access token while the refresh token is still valid.
  await context.clearCookies({ name: "access_token" });

  await page.goto("/dashboard");
  // Should land back on the dashboard (via /api/auth/refresh), not the error page.
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByText(/welcome back/i)).toBeVisible();
  const access = (await context.cookies()).find((c) => c.name === "access_token");
  expect(access, "a fresh access_token was set").toBeTruthy();
});

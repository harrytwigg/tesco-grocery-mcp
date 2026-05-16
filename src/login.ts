import { join } from "node:path";
import { homedir } from "node:os";
import { setCredentials, checkTokenExpiry, loadUserCredentials, base64UrlDecode, getStoredEmail } from "./client.js";
import type { AuthResult } from "./types.js";

export type LoginResult =
  | { success: true; result: AuthResult }
  | { success: false; error: string; message: string };

/** Random delay between min and max milliseconds */
function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Move cursor to an element with a realistic multi-step path, then click */
async function humanClick(page: any, locator: any): Promise<void> {
  const box = await locator.boundingBox();
  if (!box) {
    await locator.click();
    return;
  }
  // Target a random spot within the element
  const targetX = box.x + box.width * (0.3 + Math.random() * 0.4);
  const targetY = box.y + box.height * (0.3 + Math.random() * 0.4);
  // Move mouse in steps (simulates human cursor path)
  await page.mouse.move(targetX, targetY, { steps: Math.floor(Math.random() * 15) + 10 });
  await randomDelay(80, 250);
  await page.mouse.click(targetX, targetY);
}

/** Simulate idle mouse movement on the page (Akamai tracks this) */
async function idleMouseMovement(page: any): Promise<void> {
  const moves = Math.floor(Math.random() * 3) + 2;
  for (let i = 0; i < moves; i++) {
    const x = Math.floor(Math.random() * 800) + 100;
    const y = Math.floor(Math.random() * 400) + 100;
    await page.mouse.move(x, y, { steps: Math.floor(Math.random() * 10) + 5 });
    await randomDelay(200, 800);
  }
}

/**
 * Extract the OAuth.AccessToken cookie, validate the JWT, and persist credentials.
 * Returns a LoginResult on success/failure.
 */
async function extractAndSaveToken(context: any, email?: string): Promise<LoginResult> {
  const cookies = await context.cookies("https://www.tesco.com");
  console.error(`[auto_login] Cookies found: ${cookies.map((c: { name: string }) => c.name).join(", ")}`);

  const oauthCookie = cookies.find((c: { name: string; value: string }) => c.name === "OAuth.AccessToken");
  if (!oauthCookie) {
    return { success: false, error: "LOGIN_FAILED", message: "OAuth.AccessToken cookie not found after login. Login may have failed, or CAPTCHA / 2FA may be required." };
  }

  const jwt = decodeURIComponent(oauthCookie.value);
  const bearerToken = jwt.startsWith("Bearer ") ? jwt : `Bearer ${jwt}`;

  const rawJwt = bearerToken.slice(7);
  const parts = rawJwt.split(".");
  if (parts.length !== 3) {
    return { success: false, error: "INVALID_TOKEN", message: "OAuth.AccessToken is not a valid JWT." };
  }

  const payload = JSON.parse(base64UrlDecode(parts[1])) as Record<string, unknown>;
  console.error(`[auto_login] JWT claims: ${Object.keys(payload).join(", ")}`);

  const customerUuid = (payload.sub ?? payload.uid ?? payload.uuid ?? payload.customer_uuid) as string | undefined;
  if (!customerUuid) {
    return { success: false, error: "NO_UUID", message: `Could not extract customer UUID from JWT. Available claims: ${Object.keys(payload).join(", ")}` };
  }

  // Check if token is valid (not expired)
  const exp = payload.exp as number | undefined;
  if (exp && exp < Date.now() / 1000) {
    return { success: false, error: "TOKEN_EXPIRED", message: "OAuth.AccessToken is expired." };
  }

  setCredentials(bearerToken, customerUuid, email);
  const { expiresAt } = checkTokenExpiry();
  console.error(`[auto_login] Token saved for ${email ?? "unknown"}, expires: ${expiresAt}`);

  return {
    success: true,
    result: { success: true, expiresAt: expiresAt!, customerUuid },
  };
}

/**
 * Perform the sign-in form flow (email → Next → password → Sign in).
 */
async function performSignIn(page: any, credentials: { email: string; password: string }): Promise<void> {
  // Fill email field
  console.error("[auto_login] Filling email…");
  const emailField = page.locator("#email");
  await emailField.waitFor({ state: "visible", timeout: 10_000 });
  await idleMouseMovement(page);
  await randomDelay(500, 2000);
  await humanClick(page, emailField);
  await randomDelay(300, 800);
  await emailField.type(credentials.email, { delay: Math.floor(Math.random() * 100) + 80 });

  // Click Next
  await randomDelay(800, 3000);
  console.error("[auto_login] Clicking Next…");
  await humanClick(page, page.locator("#signin-button"));

  // Wait for challenges page
  console.error("[auto_login] Waiting for password challenge page…");
  await page.waitForURL("**/challenges**", { timeout: 15_000 });
  await randomDelay(1500, 3000);
  await idleMouseMovement(page);

  // Fill password
  console.error("[auto_login] Filling password…");
  const passwordField = page.locator("#password");
  await passwordField.waitFor({ state: "visible", timeout: 10_000 });
  await randomDelay(500, 2000);
  await humanClick(page, passwordField);
  await randomDelay(300, 800);
  await passwordField.type(credentials.password, { delay: Math.floor(Math.random() * 120) + 80 });

  // Click Sign in
  await randomDelay(800, 3000);
  console.error("[auto_login] Clicking Sign in…");
  await humanClick(page, page.locator("#signin-button"));

  // Wait for post-login redirect
  console.error("[auto_login] Waiting for post-login redirect…");
  await page.waitForURL("https://www.tesco.com/**", { timeout: 30_000 }).catch(() => {
    // May redirect elsewhere — continue to check cookies
  });

  // Settle wait for cookies to be written
  await page.waitForTimeout(3_000);
}

/**
 * Run the full Tesco headless login flow using saved credentials.
 * Uses a persistent Chrome profile + realistic mouse movements to bypass Akamai.
 *
 * If the persistent profile is already logged in (redirected to homepage):
 * - Checks the existing OAuth cookie token validity and UUID match
 * - If valid + same user → reuses it (skips login form)
 * - If wrong user or expired → signs out and retries login
 */
export async function runLogin(options?: { headless?: boolean }): Promise<LoginResult> {
  const credentials = loadUserCredentials();
  if (!credentials) {
    return { success: false, error: "NO_CREDENTIALS", message: "No saved credentials found. Run set_tesco_credentials first." };
  }

  const { chromium } = await import("playwright-extra");
  const { default: StealthPlugin } = await import("puppeteer-extra-plugin-stealth");
  chromium.use(StealthPlugin());

  // Persistent profile so Akamai sees a returning browser, not a fresh one each time
  const userDataDir = join(homedir(), ".config", "tesco-grocery-mcp", "chrome-profile");

  const context = await chromium.launchPersistentContext(userDataDir, {
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : { channel: "chrome" }),
    headless: options?.headless ?? true,
    args: [
      "--disable-blink-features=AutomationControlled",
    ],
    viewport: { width: 1280, height: 800 },
    locale: "en-GB",
    timezoneId: "Europe/London",
    extraHTTPHeaders: {
      "Accept-Language": "en-GB,en;q=0.9",
    },
  });

  try {
    const page = context.pages()[0] || await context.newPage();

    // Step 1: navigate to homepage first to check for existing session
    // (going directly to the sign-in page causes Tesco to sign us out)
    console.error("[auto_login] Navigating to homepage to check session…");
    await page.goto("https://www.tesco.com/", { waitUntil: "domcontentloaded" });
    console.error(`[auto_login] Page loaded — URL: ${page.url()}`);

    // Let Akamai telemetry script load and collect initial sensor data
    await randomDelay(2000, 4000);
    await idleMouseMovement(page);

    // Check if there's already a valid session token in cookies
    const existingResult = await extractAndSaveToken(context);

    if (existingResult.success) {
      // Compare the email stored in .env against the one we're trying to log in as
      const previousEmail = getStoredEmail();
      const targetEmail = credentials.email;

      if (previousEmail && previousEmail.toLowerCase() === targetEmail.toLowerCase()) {
        console.error(`[auto_login] Existing session valid for ${previousEmail} — reusing token`);
        return existingResult;
      }

      console.error(`[auto_login] Email mismatch — stored: ${previousEmail ?? "none"}, target: ${targetEmail}. Signing out…`);

      // Sign out using the known sign-out button id
      try {
        const signOutLink = page.locator("#app-bar-sign-out");
        await signOutLink.waitFor({ state: "visible", timeout: 5_000 });
        await randomDelay(500, 1500);
        await humanClick(page, signOutLink);
        await page.waitForTimeout(3_000);
        console.error("[auto_login] Signed out, navigating to login page…");
      } catch {
        console.error("[auto_login] Could not find #app-bar-sign-out, navigating to login page directly…");
      }
    } else {
      console.error(`[auto_login] No valid session found (${existingResult.error}). Proceeding to login…`);
    }

    // Navigate to login page
    console.error("[auto_login] Navigating to login page…");
    await page.goto("https://www.tesco.com/account/auth/en-GB/login", { waitUntil: "domcontentloaded" });
    await randomDelay(2000, 4000);
    await idleMouseMovement(page);

    // Accept cookie consent banner (non-critical)
    try {
      const acceptBtn = page.locator("#oa-consent-banner button:nth-of-type(1)");
      await acceptBtn.waitFor({ state: "visible", timeout: 3_000 });
      await randomDelay(500, 1500);
      await humanClick(page, acceptBtn);
      console.error("[auto_login] Cookie banner accepted");
      await randomDelay(1000, 3000);
    } catch { /* banner may not appear — continue */ }

    // Perform the sign-in flow
    await performSignIn(page, credentials);
    console.error(`[auto_login] Current URL: ${page.url()}`);

    // Extract and save token (persist the email we logged in with)
    return await extractAndSaveToken(context, credentials.email);
  } finally {
    await context.close();
  }
}

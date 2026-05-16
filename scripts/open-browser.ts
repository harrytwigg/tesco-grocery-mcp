/**
 * Open the same persistent Chrome browser profile used by auto_login.
 * Useful for inspecting the browser state, debugging cookies, or watching pages manually.
 *
 * Usage:
 *   npx tsx scripts/open-browser.ts [url]
 *
 * Default URL: https://www.tesco.com
 * The browser stays open until you close it.
 */

import { join } from "node:path";
import { homedir } from "node:os";

const url = process.argv[2] ?? "https://www.tesco.com";

(async () => {
  const { chromium } = await import("playwright-extra");
  const { default: StealthPlugin } = await import("puppeteer-extra-plugin-stealth");
  chromium.use(StealthPlugin());

  const userDataDir = join(homedir(), ".config", "tesco-grocery-mcp", "chrome-profile");

  console.log(`Opening browser with persistent profile: ${userDataDir}`);
  console.log(`Navigating to: ${url}`);
  console.log("Close the browser window to exit.\n");

  const context = await chromium.launchPersistentContext(userDataDir, {
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : { channel: "chrome" }),
    headless: false,
    args: [
      "--disable-blink-features=AutomationControlled",
    ],
    // viewport: { width: 1280, height: 800 },
    locale: "en-GB",
    timezoneId: "Europe/London",
    extraHTTPHeaders: {
      "Accept-Language": "en-GB,en;q=0.9",
    },
  });

  const page = context.pages()[0] || await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });

  // Keep the process alive until the browser is closed
  await context.waitForEvent("close").catch(() => {});
})();

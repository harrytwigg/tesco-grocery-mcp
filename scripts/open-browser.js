"use strict";
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
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
var node_path_1 = require("node:path");
var node_os_1 = require("node:os");
var url = (_a = process.argv[2]) !== null && _a !== void 0 ? _a : "https://www.tesco.com";
var chromium = (await Promise.resolve().then(function () { return require("playwright-extra"); })).chromium;
var StealthPlugin = (await Promise.resolve().then(function () { return require("puppeteer-extra-plugin-stealth"); })).default;
chromium.use(StealthPlugin());
var userDataDir = (0, node_path_1.join)((0, node_os_1.homedir)(), ".config", "tesco-grocery-mcp", "chrome-profile");
console.log("Opening browser with persistent profile: ".concat(userDataDir));
console.log("Navigating to: ".concat(url));
console.log("Close the browser window to exit.\n");
var context = await chromium.launchPersistentContext(userDataDir, __assign(__assign({}, (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : { channel: "chrome" })), { headless: false, args: [
        "--disable-blink-features=AutomationControlled",
    ], viewport: { width: 1280, height: 800 }, locale: "en-GB", timezoneId: "Europe/London", extraHTTPHeaders: {
        "Accept-Language": "en-GB,en;q=0.9",
    } }));
var page = context.pages()[0] || await context.newPage();
await page.goto(url, { waitUntil: "domcontentloaded" });
// Keep the process alive until the browser is closed
await context.waitForEvent("close").catch(function () { });

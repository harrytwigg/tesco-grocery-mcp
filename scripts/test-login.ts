/**
 * Test the Tesco auto-login flow end-to-end.
 *
 * Usage:
 *   npx tsx scripts/test-login.ts
 *
 * Reads credentials from ~/.config/tesco-grocery-mcp/credentials.json
 * (populated by the set_tesco_credentials MCP tool).
 * Runs in non-headless mode so you can watch the browser.
 */

import { runLogin } from "../src/login.js";
import { loadUserCredentials } from "../src/client.js";

const creds = loadUserCredentials();
if (!creds) {
  console.error("No saved credentials found.");
  console.error("Run the set_tesco_credentials MCP tool first, or create:");
  console.error("  ~/.config/tesco-grocery-mcp/credentials.json");
  console.error('  { "email": "...", "password": "..." }');
  process.exit(1);
}

console.log(`Testing login for: ${creds.email}`);
console.log("Running in non-headless mode so you can watch the browser...\n");

const result = await runLogin({ headless: false });

if (result.success) {
  console.log("\n✓ Login succeeded");
  console.log(`  Customer UUID : ${result.result.customerUuid}`);
  console.log(`  Token expires : ${result.result.expiresAt}`);
  console.log("\nToken has been saved to ~/.config/tesco-grocery-mcp/.env");
} else {
  console.error(`\n✗ Login failed: ${result.error}`);
  console.error(`  ${result.message}`);
  process.exit(1);
}

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { setCredentials, checkTokenExpiry, saveUserCredentials } from "../client.js";
import { runLogin } from "../login.js";
import { toolErrorResponse, type AuthResult } from "../types.js";

export function registerAuthTools(server: McpServer): void {
  server.tool(
    "set_auth_token",
    "Update the bearer token and customer UUID. Called after extracting credentials from the browser.",
    {
      token: z.string().describe("Bearer token (e.g. 'Bearer eyJ...')"),
      customerUuid: z.string().describe("Customer UUID from the authenticated session"),
    },
    async (args) => {
      try {
        setCredentials(args.token, args.customerUuid);
        const { expiresAt } = checkTokenExpiry();

        const result: AuthResult = {
          success: true,
          expiresAt: expiresAt!,
          customerUuid: args.customerUuid,
        };

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (e) {
        return toolErrorResponse(e);
      }
    },
  );

  // ── set_tesco_credentials ───────────────────────────────────────────────

  server.tool(
    "set_tesco_credentials",
    "Save Tesco login email and password to a local file for automated login. Credentials are stored in ~/.config/tesco-grocery-mcp/credentials.json with restricted file permissions (0600).",
    {
      email: z.string().email().describe("Tesco account email address"),
      password: z.string().min(1).describe("Tesco account password"),
    },
    async (args) => {
      try {
        saveUserCredentials(args.email, args.password);
        return {
          content: [{ type: "text", text: JSON.stringify({ success: true, message: "Credentials saved. You can now use auto_login to authenticate." }, null, 2) }],
        };
      } catch (e) {
        return toolErrorResponse(e);
      }
    },
  );

  // ── auto_login ──────────────────────────────────────────────────────────

  server.tool(
    "auto_login",
    "Automatically log in to Tesco using saved credentials. Opens a headless Chromium browser, completes the login flow, extracts the OAuth access token cookie, and saves it for API access. Run set_tesco_credentials first to save your email and password.",
    {},
    async () => {
      try {
        const loginResult = await runLogin();
        if (!loginResult.success) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: loginResult.error, message: loginResult.message }) }],
            isError: true,
          };
        }
        return {
          content: [{ type: "text", text: JSON.stringify(loginResult.result, null, 2) }],
        };
      } catch (e) {
        return toolErrorResponse(e);
      }
    },
  );
}

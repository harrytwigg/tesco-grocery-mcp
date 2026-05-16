import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { Type } from "@sinclair/typebox";
import { setCredentials, checkTokenExpiry, saveUserCredentials } from "../client.js";
import { runLogin } from "../login.js";
import { toolErrorResponse, type AuthResult } from "../types.js";

export function registerAuthTools(api: OpenClawPluginApi): void {
  api.registerTool({
    name: "set_auth_token",
    description: "Update the bearer token and customer UUID. Called after extracting credentials from the browser.",
    parameters: Type.Object({
      token: Type.String({ description: "Bearer token (e.g. 'Bearer eyJ...')" }),
      customerUuid: Type.String({ description: "Customer UUID from the authenticated session" }),
    }),
    async execute(_id, params) {
      try {
        setCredentials(params.token, params.customerUuid);
        const { expiresAt } = checkTokenExpiry();

        const result: AuthResult = {
          success: true,
          expiresAt: expiresAt!,
          customerUuid: params.customerUuid,
        };

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (e) {
        return toolErrorResponse(e);
      }
    },
  });

  // ── set_tesco_credentials ───────────────────────────────────────────────

  api.registerTool({
    name: "set_tesco_credentials",
    description: "Save Tesco login email and password to a local file for automated login. Credentials are stored in ~/.config/tesco-grocery-mcp/credentials.json with restricted file permissions (0600).",
    parameters: Type.Object({
      email: Type.String({ format: "email", description: "Tesco account email address" }),
      password: Type.String({ minLength: 1, description: "Tesco account password" }),
    }),
    async execute(_id, params) {
      try {
        saveUserCredentials(params.email, params.password);
        return {
          content: [{ type: "text", text: JSON.stringify({ success: true, message: "Credentials saved. You can now use auto_login to authenticate." }, null, 2) }],
        };
      } catch (e) {
        return toolErrorResponse(e);
      }
    },
  });

  // ── auto_login ──────────────────────────────────────────────────────────

  api.registerTool({
    name: "auto_login",
    description: "Automatically log in to Tesco using saved credentials. Opens a headless Chromium browser, completes the login flow, extracts the OAuth access token cookie, and saves it for API access. Run set_tesco_credentials first to save your email and password.",
    parameters: Type.Object({}),
    async execute() {
      try {
        const loginResult = await runLogin({
          headless: true,
        });
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
  });
}

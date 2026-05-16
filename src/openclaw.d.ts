/**
 * Minimal type declarations for the OpenClaw Plugin SDK.
 * These are resolved at runtime by the OpenClaw host; this file
 * provides build-time type safety for standalone development.
 */
declare module "openclaw/plugin-sdk/plugin-entry" {
  import type { TSchema } from "@sinclair/typebox";

  export interface OpenClawPluginApi {
    readonly id: string;
    readonly name: string;
    registerTool(
      tool: {
        name: string;
        description: string;
        parameters: TSchema;
        execute(
          id: string,
          params: any,
        ): Promise<{
          content: Array<{ type: string; text: string }>;
          isError?: boolean;
        }>;
      },
      opts?: { optional?: boolean },
    ): void;
  }

  export interface PluginEntryOptions {
    id: string;
    name: string;
    description: string;
    register(api: OpenClawPluginApi): void;
  }

  export function definePluginEntry(options: PluginEntryOptions): unknown;
}

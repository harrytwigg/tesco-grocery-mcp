import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { loadCredentialsFromEnv } from "./client.js";
import { registerAuthTools } from "./tools/auth.js";
import { registerSearchTools } from "./tools/search.js";
import { registerBasketTools } from "./tools/basket.js";
import { registerBrowseTools } from "./tools/browse.js";
import { registerSlotTools } from "./tools/slots.js";

// Load credentials from .env (non-fatal if missing)
loadCredentialsFromEnv();

export default definePluginEntry({
  id: "tesco-grocery",
  name: "Tesco Grocery",
  description: "Search products, manage basket, and book delivery slots on Tesco",
  register(api) {
    registerAuthTools(api);
    registerSearchTools(api);
    registerBasketTools(api);
    registerBrowseTools(api);
    registerSlotTools(api);
  },
});

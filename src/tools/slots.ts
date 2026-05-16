import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { Type } from "@sinclair/typebox";
import { sendOperation, sendOperations, requireAuth, setOrderId, extractOrderId } from "../client.js";
import { buildOperation } from "../queries.js";
import {
  flattenDeliverySlots,
  flattenAvailableWeeks,
  flattenCurrentSlot,
  flattenSlotBooking,
} from "../transform.js";
import { cache, WEEKS_TTL } from "../cache.js";
import { TescoError, toolErrorResponse, type AvailableWeek } from "../types.js";

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

export function registerSlotTools(api: OpenClawPluginApi): void {
  // ─── get_delivery_slots ──────────────────────────────────────────────────

  api.registerTool({
    name: "get_delivery_slots",
    description: "View available delivery slots for a date range. Returns 1-hour time slots grouped by date, including slot IDs needed for book_delivery_slot.",
    parameters: Type.Object({
      start: Type.Optional(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Start date (YYYY-MM-DD, e.g. '2026-04-10'). Defaults to today." })),
      end: Type.Optional(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "End date (YYYY-MM-DD). Defaults to start + 7 days." })),
      showUnavailable: Type.Optional(Type.Boolean({ default: false, description: "Include unavailable slots in results" })),
    }),
    async execute(_id, params) {
      try {
        requireAuth();

        const start = params.start || todayISO();
        const end = params.end || addDays(start, 7);

        const op = buildOperation(
          "DeliverySlots",
          { type: "DELIVERY_VAN", start, end },
          "mfe-slots",
        );
        const response = await sendOperation(op);
        const rawSlots = (response.data?.delivery ?? []) as Array<
          Record<string, unknown>
        >;

        const result = flattenDeliverySlots(
          rawSlots,
          start,
          end,
          params.showUnavailable ?? false,
        );

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (e) {
        return toolErrorResponse(e);
      }
    },
  });

  // ─── get_available_weeks ─────────────────────────────────────────────────

  api.registerTool({
    name: "get_available_weeks",
    description: "View which weeks have delivery slots available. Returns week start/end dates to use as inputs to get_delivery_slots.",
    parameters: Type.Object({}),
    async execute() {
      try {
        requireAuth();

        let weeks = cache.get<AvailableWeek[]>("weeks");

        if (!weeks) {
          const op = buildOperation(
            "GetFulfilment",
            { type: "DELIVERY_VAN" },
            "mfe-slots",
          );
          const response = await sendOperation(op);
          const fulfilment = response.data?.fulfilment as
            | Record<string, unknown>
            | undefined;
          const metadata = fulfilment?.metadata as
            | Record<string, unknown>
            | undefined;
          const rawWeeks = (metadata?.availableWeeks ?? []) as Array<
            Record<string, unknown>
          >;
          weeks = flattenAvailableWeeks(rawWeeks);
          cache.set("weeks", weeks, WEEKS_TTL);
        }

        return {
          content: [{ type: "text", text: JSON.stringify({ weeks }, null, 2) }],
        };
      } catch (e) {
        return toolErrorResponse(e);
      }
    },
  });

  // ─── get_current_slot ────────────────────────────────────────────────────

  api.registerTool({
    name: "get_current_slot",
    description: "Check if the user already has a delivery slot booked. Returns slot details (date, time, charge, expiry) or hasSlot: false.",
    parameters: Type.Object({}),
    async execute() {
      try {
        requireAuth();

        const op = buildOperation("GetBasket", {}, "mfe-basket");
        const response = await sendOperation(op);
        const basketData = response.data?.basket as Record<string, unknown>;

        const oid = extractOrderId(basketData);
        if (oid) setOrderId(oid);

        const result = flattenCurrentSlot(basketData);

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (e) {
        return toolErrorResponse(e);
      }
    },
  });

  // ─── book_delivery_slot ──────────────────────────────────────────────────

  api.registerTool({
    name: "book_delivery_slot",
    description: "Book or unbook a delivery slot. Requires a slotId from get_delivery_slots. IMPORTANT: Always confirm with the user before booking.",
    parameters: Type.Object({
      slotId: Type.String({ description: "Slot ID from get_delivery_slots results" }),
      action: Type.Optional(Type.Union(
        [Type.Literal("BOOK"), Type.Literal("UNBOOK")],
        { default: "BOOK", description: "BOOK to reserve a slot, UNBOOK to release it" },
      )),
    }),
    async execute(_id, params) {
      try {
        requireAuth();

        const action = params.action ?? "BOOK";

        const fulfilmentOp = buildOperation(
          "Fulfilment",
          { slotId: params.slotId, action },
          "mfe-slots",
        );
        const basketOp = buildOperation("GetBasket", {}, "mfe-basket");

        const results = await sendOperations([fulfilmentOp, basketOp]);
        const fulfilmentData = results[0].data?.fulfilment as Record<string, unknown>;
        const basketData = results[1].data?.basket as Record<string, unknown>;

        const oid = extractOrderId(basketData);
        if (oid) setOrderId(oid);

        // Check for GraphQL errors in the fulfilment response
        if (results[0].errors && results[0].errors.length > 0) {
          const msg = results[0].errors.map((e) => e.message).join("; ");
          throw new TescoError("API_ERROR", `Slot booking failed: ${msg}`);
        }

        const result = flattenSlotBooking(fulfilmentData, basketData, action);

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (e) {
        return toolErrorResponse(e);
      }
    },
  });
}

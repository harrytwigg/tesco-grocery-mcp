import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { Type } from "@sinclair/typebox";
import { sendOperation, sendOperations, requireAuth, getOrderId, setOrderId, extractOrderId } from "../client.js";
import { buildOperation } from "../queries.js";
import { flattenBasket, flattenBasketUpdate } from "../transform.js";
import { TescoError, toolErrorResponse } from "../types.js";

export function registerBasketTools(api: OpenClawPluginApi): void {
  // ─── get_basket ─────────────────────────────────────────────────────────────

  api.registerTool({
    name: "get_basket",
    description: "Get the current basket contents.",
    parameters: Type.Object({}),
    async execute() {
      try {
        requireAuth();

        const op = buildOperation("GetBasket", {}, "mfe-basket");
        const response = await sendOperation(op);
        const basketData = response.data?.basket as Record<string, unknown>;

        const oid = extractOrderId(basketData);
        if (oid) setOrderId(oid);

        const result = flattenBasket(basketData);

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (e) {
        return toolErrorResponse(e);
      }
    },
  });

  // ─── add_to_basket ──────────────────────────────────────────────────────────

  api.registerTool({
    name: "add_to_basket",
    description: "Add one or more products to the basket, or change their quantity.",
    parameters: Type.Object({
      items: Type.Array(
        Type.Object({
          id: Type.String({ description: "Product ID" }),
          quantity: Type.Integer({ minimum: 0, description: "Desired quantity (0 to remove)" }),
        }),
        { minItems: 1, description: "Products to add/update" },
      ),
    }),
    async execute(_id, params) {
      try {
        requireAuth();

        let orderId = getOrderId();

        if (!orderId) {
          const basketOp = buildOperation("GetBasket", {}, "mfe-basket");
          const basketRes = await sendOperation(basketOp);
          const basketData = basketRes.data?.basket as Record<string, unknown>;
          orderId = extractOrderId(basketData);
          if (orderId) setOrderId(orderId);
        }

        if (!orderId) {
          throw new TescoError("API_ERROR", "Could not determine basket order ID");
        }

        const updateOp = buildOperation(
          "UpdateBasket",
          {
            orderId,
            items: params.items.map((item: { id: string; quantity: number }) => ({
              adjustment: false,
              id: item.id,
              newValue: item.quantity,
              newUnitChoice: "pcs",
            })),
          },
          "mfe-basket",
        );
        const basketOp = buildOperation("GetBasket", {}, "mfe-basket");

        const results = await sendOperations([updateOp, basketOp]);
        const updateData = results[0].data?.basket as Record<string, unknown>;
        const basketData = results[1].data?.basket as Record<string, unknown>;

        const oid2 = extractOrderId(basketData);
        if (oid2) setOrderId(oid2);

        const result = flattenBasketUpdate(updateData, basketData);

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (e) {
        return toolErrorResponse(e);
      }
    },
  });

  // ─── remove_from_basket ─────────────────────────────────────────────────────

  api.registerTool({
    name: "remove_from_basket",
    description: "Remove one or more products from the basket.",
    parameters: Type.Object({
      ids: Type.Array(Type.String(), { minItems: 1, description: "Product IDs to remove" }),
    }),
    async execute(_id, params) {
      try {
        requireAuth();

        let orderId = getOrderId();

        if (!orderId) {
          const basketOp = buildOperation("GetBasket", {}, "mfe-basket");
          const basketRes = await sendOperation(basketOp);
          const basketData = basketRes.data?.basket as Record<string, unknown>;
          orderId = extractOrderId(basketData);
          if (orderId) setOrderId(orderId);
        }

        if (!orderId) {
          throw new TescoError("API_ERROR", "Could not determine basket order ID");
        }

        const updateOp = buildOperation(
          "UpdateBasket",
          {
            orderId,
            items: params.ids.map((id: string) => ({
              adjustment: false,
              id,
              newValue: 0,
              newUnitChoice: "pcs",
            })),
          },
          "mfe-basket",
        );
        const basketOp = buildOperation("GetBasket", {}, "mfe-basket");

        const results = await sendOperations([updateOp, basketOp]);
        const updateData = results[0].data?.basket as Record<string, unknown>;
        const basketData = results[1].data?.basket as Record<string, unknown>;

        const oid3 = extractOrderId(basketData);
        if (oid3) setOrderId(oid3);

        const result = flattenBasketUpdate(updateData, basketData);

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (e) {
        return toolErrorResponse(e);
      }
    },
  });
}

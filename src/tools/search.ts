import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { Type } from "@sinclair/typebox";
import { sendOperation, sendOperations } from "../client.js";
import { buildOperation } from "../queries.js";
import { flattenProducts, refineSearchProducts } from "../transform.js";
import { toolErrorResponse, type ProductList, type SearchProductList } from "../types.js";

// ─── Shared Helpers ─────────────────────────────────────────────────────────

function buildSearchVariables(
  query: string,
  page: number,
  count: number,
  sort: string,
): Record<string, unknown> {
  return {
    query,
    page,
    count,
    sortBy: sort,
    includeRestrictions: true,
    includeVariations: true,
    showDepositReturnCharge: false,
    showPopularFilter: true,
    showExpandedResults: false,
    includeRangeFilter: false,
    showSuggestedSearch: false,
    includeAdditionalInfo: true,
    includeIsInAnyList: true,
    filterCriteria: [{ name: "inputType", values: ["free text"] }],
    appliedFacetArgs: [],
    configs: [],
    suggestionsMaxTimeOut: 600,
  };
}

// ─── Registration ───────────────────────────────────────────────────────────

export function registerSearchTools(api: OpenClawPluginApi): void {
  // ── search_products ─────────────────────────────────────────────────────

  api.registerTool({
    name: "search_products",
    description: "Search for grocery products. Pass an array of queries to run many searches in one call — use this to fan out a shopping list without spending multiple turns.",
    parameters: Type.Object({
      queries: Type.Array(
        Type.Object({
          query: Type.String({ minLength: 1, description: "Search query text" }),
          page: Type.Optional(Type.Integer({ minimum: 1, default: 1, description: "Page number" })),
          count: Type.Optional(Type.Integer({ minimum: 1, maximum: 24, default: 12, description: "Results per page (max 24)" })),
          sort: Type.Optional(Type.Union(
            [Type.Literal("relevance"), Type.Literal("price-ascending"), Type.Literal("price-descending")],
            { default: "relevance", description: "Sort order" },
          )),
        }),
        {
          minItems: 1,
          maxItems: 10,
          description: "Up to 10 searches executed in a single batched HTTP request. Pass one entry per item on the shopping list. If you have more than 10 items, split them across multiple tool calls.",
        },
      ),
    }),
    async execute(_id, params) {
      try {
        const normalised = params.queries.map((q: { query: string; page?: number; count?: number; sort?: string }) => ({
          query: q.query,
          page: q.page ?? 1,
          count: q.count ?? 12,
          sort: q.sort ?? "relevance",
        }));

        const ops = normalised.map((q: { query: string; page: number; count: number; sort: string }) =>
          buildOperation(
            "Search",
            buildSearchVariables(q.query, q.page, q.count, q.sort),
            "mfe-plp",
          ),
        );

        const responses = await sendOperations(ops, { authenticated: false });

        type QueryResult = {
          query: string;
          index: number;
          ok: boolean;
          productList?: SearchProductList;
          error?: { code: string; message: string };
        };

        const results: QueryResult[] = responses.map((response, index) => {
          const input = normalised[index];
          const search = response.data?.search as Record<string, unknown> | undefined;

          if (response.errors?.length || !search) {
            const message =
              response.errors?.[0]?.message ?? "Search returned no data";
            return {
              query: input.query,
              index,
              ok: false,
              error: { code: "SEARCH_FAILED", message },
            };
          }

          const pageInformation = search.pageInformation as
            | Record<string, unknown>
            | undefined;
          const hits = (search.results ?? []) as Array<Record<string, unknown>>;
          const products = refineSearchProducts(flattenProducts(hits));

          const productList: SearchProductList = {
            totalCount:
              typeof pageInformation?.totalCount === "number"
                ? pageInformation.totalCount
                : products.length,
            page: input.page,
            pageSize: input.count,
            products,
          };

          return { query: input.query, index, ok: true, productList };
        });

        const succeeded = results.filter((r) => r.ok).length;
        const envelope = {
          results,
          summary: {
            total: results.length,
            succeeded,
            failed: results.length - succeeded,
          },
        };

        return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }] };
      } catch (e) {
        return toolErrorResponse(e);
      }
    },
  });

  // ── get_product_details ─────────────────────────────────────────────────

  api.registerTool({
    name: "get_product_details",
    description: "Get detailed information for a single product by ID.",
    parameters: Type.Object({
      id: Type.String({ description: "Product ID from search results" }),
    }),
    async execute(_id, params) {
      try {
        const op = buildOperation(
          "Search",
          buildSearchVariables(params.id, 1, 1, "relevance"),
          "mfe-plp",
        );

        const response = await sendOperation(op, { authenticated: false });

        const search = response.data?.search as Record<string, unknown> | undefined;
        const results = (search?.results ?? []) as Array<Record<string, unknown>>;

        const products = flattenProducts(results);

        if (products.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: "PRODUCT_NOT_FOUND",
                  message: `No product found with ID ${params.id}`,
                }),
              },
            ],
            isError: true,
          };
        }

        return { content: [{ type: "text", text: JSON.stringify(products[0], null, 2) }] };
      } catch (e) {
        return toolErrorResponse(e);
      }
    },
  });

  // ── get_offers ──────────────────────────────────────────────────────────

  api.registerTool({
    name: "get_offers",
    description: "Search for products currently on promotion or Clubcard price.",
    parameters: Type.Object({
      query: Type.Optional(Type.String({ default: "", description: "Filter offers by search term" })),
      clubcardOnly: Type.Optional(Type.Boolean({ default: false, description: "Only show Clubcard prices" })),
    }),
    async execute(_id, params) {
      try {
        const searchQuery = params.query || "offers";
        const op = buildOperation(
          "Search",
          buildSearchVariables(searchQuery, 1, 48, "relevance"),
          "mfe-plp",
        );

        const response = await sendOperation(op, { authenticated: false });

        const search = response.data?.search as Record<string, unknown> | undefined;
        const results = (search?.results ?? []) as Array<Record<string, unknown>>;

        let products = flattenProducts(results);

        // Filter to promoted products only
        products = products.filter((p) => p.promotion !== null);

        // Optionally filter to Clubcard-only deals
        if (params.clubcardOnly) {
          products = products.filter((p) => p.promotion?.clubcardOnly === true);
        }

        const result: ProductList = {
          totalCount: products.length,
          page: 1,
          pageSize: 48,
          products,
        };

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return toolErrorResponse(e);
      }
    },
  });

  // ── get_substitutions ──────────────────────────────────────────────────

  api.registerTool({
    name: "get_substitutions",
    description: "Find alternative products for substitution. Searches for similar products, filtering to only those available for sale. Use when a basket item is unavailable (isForSale: false).",
    parameters: Type.Object({
      query: Type.String({ description: "Search terms for alternatives (e.g. the product title or key words like 'semi skimmed milk 4 pints')" }),
      excludeId: Type.Optional(Type.String({ description: "Product ID to exclude from results (the unavailable product)" })),
      count: Type.Optional(Type.Integer({ minimum: 1, maximum: 24, default: 8, description: "Number of suggestions to return" })),
    }),
    async execute(_id, params) {
      try {
        const count = params.count ?? 8;

        const op = buildOperation(
          "Search",
          buildSearchVariables(params.query, 1, count, "relevance"),
          "mfe-plp",
        );

        const response = await sendOperation(op, { authenticated: false });

        const search = response.data?.search as Record<string, unknown> | undefined;
        const results = (search?.results ?? []) as Array<Record<string, unknown>>;

        let products = flattenProducts(results);

        // Filter to available products only
        products = products.filter((p) => p.isForSale);

        // Exclude the original product if specified
        if (params.excludeId) {
          products = products.filter((p) => p.id !== params.excludeId);
        }

        const result: ProductList = {
          totalCount: products.length,
          page: 1,
          pageSize: count,
          products,
        };

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (e) {
        return toolErrorResponse(e);
      }
    },
  });
}

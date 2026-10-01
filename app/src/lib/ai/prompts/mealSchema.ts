import { MEAL_TYPES, PORTION_SIZES, PORTION_UNITS } from "@/domain/food";

/**
 * The JSON Schema sent to the providers (Gemini `responseJsonSchema`, Groq `json_schema`). It
 * mirrors `mealWireSchema` in ../schemas.ts property for property; a test keeps the two in step.
 *
 * It is written for the strictest consumer, Groq's strict mode: every object has
 * `additionalProperties: false`, every property is required, and "may be empty" is a type
 * union with "null". It deliberately carries no minimum/maximum/maxItems: those limits live in
 * Zod, which is the only thing that is trusted.
 */
export const MEAL_ITEM_PROPERTIES = [
  "name",
  "portion_size",
  "portion_amount",
  "portion_unit",
  "portion_estimated",
  "confidence",
  "uncertain",
] as const;

export const MEAL_PROPERTIES = ["items", "unclear", "overall_confidence", "meal_type", "day", "local_time", "not_food"] as const;

export const MEAL_DAY_VALUES = ["today", "yesterday"] as const;

export interface JsonSchemaNode {
  type?: string | readonly string[];
  enum?: readonly (string | null)[];
  properties?: Record<string, JsonSchemaNode>;
  required?: readonly string[];
  items?: JsonSchemaNode;
  additionalProperties?: boolean;
  description?: string;
}

export const MEAL_JSON_SCHEMA: JsonSchemaNode = {
  type: "object",
  additionalProperties: false,
  required: MEAL_PROPERTIES,
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: MEAL_ITEM_PROPERTIES,
        properties: {
          name: { type: "string", description: "Short natural food name, in the language of the input" },
          portion_size: { type: ["string", "null"], enum: [...PORTION_SIZES, null] },
          portion_amount: { type: ["number", "null"] },
          portion_unit: { type: ["string", "null"], enum: [...PORTION_UNITS, null] },
          portion_estimated: { type: "boolean" },
          confidence: { type: "number" },
          uncertain: { type: "boolean" },
        },
      },
    },
    unclear: { type: "array", items: { type: "string" } },
    overall_confidence: { type: "number" },
    meal_type: { type: ["string", "null"], enum: [...MEAL_TYPES, null] },
    day: { type: ["string", "null"], enum: [...MEAL_DAY_VALUES, null] },
    local_time: { type: ["string", "null"], description: "HH:MM, only when the input states a clock time" },
    not_food: { type: "boolean" },
  },
};

/** The same shape described in words, for providers whose JSON mode has no schema (Groq `json_object`). */
export function describeMealShape(): string {
  return [
    'JSON shape: {"items":[{"name":string,"portion_size":"small"|"medium"|"large"|null,"portion_amount":number|null,',
    `"portion_unit":${PORTION_UNITS.map((u) => `"${u}"`).join("|")}|null,"portion_estimated":boolean,"confidence":number,"uncertain":boolean}],`,
    '"unclear":[string],"overall_confidence":number,',
    `"meal_type":${MEAL_TYPES.map((t) => `"${t}"`).join("|")}|null,"day":"today"|"yesterday"|null,"local_time":"HH:MM"|null,"not_food":boolean}`,
  ].join("");
}

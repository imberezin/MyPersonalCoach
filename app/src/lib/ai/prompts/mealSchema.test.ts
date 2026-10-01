import { describe, expect, it } from "vitest";
import { MEAL_TYPES, PORTION_SIZES, PORTION_UNITS } from "@/domain/food";
import { mealWireItemSchema, mealWireSchema } from "../schemas";
import { MEAL_ITEM_PROPERTIES, MEAL_JSON_SCHEMA, MEAL_PROPERTIES, describeMealShape, type JsonSchemaNode } from "./mealSchema";

/** A tiny checker for the subset of JSON Schema the meal schema uses. It is enough to prove the golden samples fit. */
function check(node: JsonSchemaNode, value: unknown, path = "$"): string[] {
  const errors: string[] = [];
  const types = node.type === undefined ? null : Array.isArray(node.type) ? node.type : [node.type];
  if (types) {
    const actual = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    if (!types.includes(actual)) errors.push(`${path}: expected ${types.join("|")}, got ${actual}`);
  }
  if (node.enum && !node.enum.includes(value as string | null)) errors.push(`${path}: ${String(value)} not in enum`);
  if (node.properties && typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const key of node.required ?? []) if (!(key in record)) errors.push(`${path}.${key}: required`);
    for (const [key, child] of Object.entries(record)) {
      const schema = node.properties[key];
      if (schema) errors.push(...check(schema, child, `${path}.${key}`));
      else if (node.additionalProperties === false) errors.push(`${path}.${key}: not allowed`);
    }
  }
  if (node.items && Array.isArray(value)) value.forEach((v, i) => errors.push(...check(node.items!, v, `${path}[${i}]`)));
  return errors;
}

const goldenItem = {
  name: "שניצל",
  portion_size: "medium",
  portion_amount: null,
  portion_unit: null,
  portion_estimated: false,
  confidence: 0.9,
  uncertain: false,
};
const golden = [
  { items: [goldenItem], unclear: [], overall_confidence: 0.9, meal_type: null, day: null, local_time: null, not_food: false },
  {
    items: [{ ...goldenItem, portion_size: null, portion_amount: 2, portion_unit: "slice", portion_estimated: true }],
    unclear: ["משהו לא ברור"],
    overall_confidence: 0.5,
    meal_type: "breakfast",
    day: "yesterday",
    local_time: "07:30",
    not_food: false,
  },
  { items: [], unclear: [], overall_confidence: 0.8, meal_type: null, day: null, local_time: null, not_food: true },
];

describe("MEAL_JSON_SCHEMA", () => {
  it("has the same property names as the Zod wire shape", () => {
    expect(Object.keys(mealWireSchema.shape).sort()).toEqual([...MEAL_PROPERTIES].sort());
    expect(Object.keys(mealWireItemSchema.shape).sort()).toEqual([...MEAL_ITEM_PROPERTIES].sort());
    expect(Object.keys(MEAL_JSON_SCHEMA.properties!).sort()).toEqual([...MEAL_PROPERTIES].sort());
    expect(Object.keys(MEAL_JSON_SCHEMA.properties!.items.items!.properties!).sort()).toEqual([...MEAL_ITEM_PROPERTIES].sort());
  });

  it("is strict-mode friendly: closed objects, every property required, no limit keywords", () => {
    const walk = (node: JsonSchemaNode) => {
      if (node.properties) {
        expect(node.additionalProperties).toBe(false);
        expect([...(node.required ?? [])].sort()).toEqual(Object.keys(node.properties).sort());
        Object.values(node.properties).forEach(walk);
      }
      if (node.items) walk(node.items);
    };
    walk(MEAL_JSON_SCHEMA);
    expect(JSON.stringify(MEAL_JSON_SCHEMA)).not.toMatch(/minimum|maximum|maxItems|minItems|pattern/);
  });

  it("lists exactly the domain's enums", () => {
    const item = MEAL_JSON_SCHEMA.properties!.items.items!.properties!;
    expect(item.portion_size.enum).toEqual([...PORTION_SIZES, null]);
    expect(item.portion_unit.enum).toEqual([...PORTION_UNITS, null]);
    expect(MEAL_JSON_SCHEMA.properties!.meal_type.enum).toEqual([...MEAL_TYPES, null]);
    expect(MEAL_JSON_SCHEMA.properties!.day.enum).toEqual(["today", "yesterday", null]);
  });

  it("asks for nothing nutritional", () => {
    expect(JSON.stringify(MEAL_JSON_SCHEMA)).not.toMatch(/calor|nutri|health|score/i);
  });

  it.each(golden.map((g, i) => [i, g] as const))("golden sample %s validates against the JSON Schema and against Zod", (_i, sample) => {
    expect(check(MEAL_JSON_SCHEMA, sample)).toEqual([]);
    expect(mealWireSchema.safeParse(sample).success).toBe(true);
  });

  it("the checker really rejects a wrong sample (a surplus key, a bad enum, a missing key)", () => {
    expect(check(MEAL_JSON_SCHEMA, { ...golden[0], calories: 5 })).not.toEqual([]);
    expect(check(MEAL_JSON_SCHEMA, { ...golden[0], meal_type: "brunch" })).not.toEqual([]);
    const partial = Object.fromEntries(Object.entries(golden[0]).filter(([key]) => key !== "not_food"));
    expect(check(MEAL_JSON_SCHEMA, partial)).not.toEqual([]);
  });
});

describe("describeMealShape", () => {
  it("spells out every property and every allowed word, for providers whose JSON mode has no schema", () => {
    const text = describeMealShape();
    for (const key of [...MEAL_PROPERTIES, ...MEAL_ITEM_PROPERTIES]) expect(text).toContain(key);
    for (const word of [...PORTION_UNITS, ...MEAL_TYPES, ...PORTION_SIZES]) expect(text).toContain(`"${word}"`);
  });
});

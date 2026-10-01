import { describe, expect, it } from "vitest";
import { FOOD_FORM, FOOD_QUERY, FOOD_ROUTES, RESUME_WINDOW_MS, isUuid } from "./routes";

const ID = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

describe("FOOD_ROUTES", () => {
  it("has the six screens of the flow", () => {
    expect(FOOD_ROUTES.chooser).toBe("/report/food");
    expect(FOOD_ROUTES.photo).toBe("/report/food/photo");
    expect(FOOD_ROUTES.text).toBe("/report/food/text");
    expect(FOOD_ROUTES.confirm(ID)).toBe(`/report/food/${ID}`);
    expect(FOOD_ROUTES.edit(ID)).toBe(`/report/food/${ID}/edit`);
    expect(FOOD_ROUTES.saved(ID)).toBe(`/report/food/${ID}/saved`);
  });
});

describe("the form and query names", () => {
  it("are the ones the contract names", () => {
    expect(FOOD_FORM).toEqual({ id: "id", revision: "revision", stage: "stage" });
    expect(FOOD_QUERY).toEqual({ refreshed: "refreshed", failed: "failed" });
  });

  it("offers an unfinished report for 2 hours", () => {
    expect(RESUME_WINDOW_MS).toBe(2 * 60 * 60 * 1000);
  });
});

describe("isUuid", () => {
  it("accepts a UUID in either case", () => {
    expect(isUuid(ID)).toBe(true);
    expect(isUuid(ID.toUpperCase())).toBe(true);
    expect(isUuid("11111111-1111-4111-8111-111111111111")).toBe(true);
  });

  it("rejects anything else, including path tricks and non-strings", () => {
    for (const bad of ["", "abc", `${ID}x`, ` ${ID}`, ID.slice(1), "../etc/passwd", `${ID}/edit`, "3f1c2d4e5a6b4c7d8e9f0a1b2c3d4e5f", null, undefined, 5, {}]) {
      expect(isUuid(bad), String(bad)).toBe(false);
    }
  });
});

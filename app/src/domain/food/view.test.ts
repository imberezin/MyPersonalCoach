import { describe, expect, it } from "vitest";
import { mealOf, revisionOf } from "./draft";
import type { MealDraft, Understanding } from "./types";
import { buildConfirmView } from "./view";

const TZ = "Asia/Jerusalem";
const ctx = { now: new Date("2027-01-12T10:30:00Z"), timeZone: TZ }; // 12:30 in Jerusalem

const understanding = (over: Partial<Understanding> = {}): Understanding => ({
  id: "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
  kind: "text",
  provider: "gemini",
  model: "m",
  promptVersion: "meal-v1",
  status: "pending",
  items: [
    { name: "bread", portion: { kind: "amount", amount: 2, unit: "slice", estimated: false }, uncertain: false, confidence: 0.9 },
    { name: "coffee", portion: null, uncertain: false, confidence: 0.8 },
  ],
  unclear: [],
  overallConfidence: 0.85,
  proposed: { mealType: "breakfast", occurredAt: new Date("2027-01-12T05:42:00Z") },
  draft: null,
  createdAt: new Date("2027-01-12T10:00:00Z"),
  ...over,
});

describe("buildConfirmView", () => {
  it("shows an AI report", () => {
    const view = buildConfirmView(understanding(), ctx);
    expect(view).toMatchObject({
      id: "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
      manual: false,
      fake: false,
      anyEstimated: false,
      mealType: "breakfast",
      day: "today",
      time: "07:42",
      unclear: [],
    });
    expect(view.items).toEqual([
      { name: "bread", portion: { kind: "amount", amount: 2, unit: "slice", estimated: false }, uncertain: false },
      { name: "coffee", portion: null, uncertain: false },
    ]);
  });

  it("leaves confidence out of the items", () => {
    for (const item of buildConfirmView(understanding(), ctx).items) expect(Object.keys(item).sort()).toEqual(["name", "portion", "uncertain"]);
  });

  it("marks a manual report", () => {
    expect(buildConfirmView(understanding({ provider: "manual" }), ctx)).toMatchObject({ manual: true, fake: false });
  });

  it("marks a development fake report", () => {
    expect(buildConfirmView(understanding({ provider: "fake" }), ctx)).toMatchObject({ manual: false, fake: true });
  });

  it("carries an uncertain item and the unclear parts", () => {
    const view = buildConfirmView(
      understanding({
        items: [{ name: "soup", portion: null, uncertain: true, confidence: 0.4 }],
        unclear: ["something blurry on the left"],
      }),
      ctx,
    );
    expect(view.items).toEqual([{ name: "soup", portion: null, uncertain: true }]);
    expect(view.unclear).toEqual(["something blurry on the left"]);
  });

  it("sets anyEstimated when any portion is estimated", () => {
    const view = buildConfirmView(
      understanding({
        items: [
          { name: "a", portion: null, uncertain: false, confidence: 1 },
          { name: "b", portion: { kind: "size", size: "large", estimated: true }, uncertain: false, confidence: 1 },
        ],
      }),
      ctx,
    );
    expect(view.anyEstimated).toBe(true);
  });

  it("is not estimated when no portion exists or all are stated", () => {
    expect(buildConfirmView(understanding({ items: [{ name: "a", portion: null, uncertain: false, confidence: 1 }] }), ctx).anyEstimated).toBe(false);
  });

  it("shows the day as today, yesterday or other", () => {
    const at = (iso: string) => buildConfirmView(understanding({ proposed: { mealType: "dinner", occurredAt: new Date(iso) } }), ctx);
    expect(at("2027-01-12T10:00:00Z")).toMatchObject({ day: "today", time: "12:00" });
    expect(at("2027-01-11T17:30:00Z")).toMatchObject({ day: "yesterday", time: "19:30" });
    expect(at("2027-01-10T17:30:00Z")).toMatchObject({ day: "other", time: "19:30" });
  });

  it("shows the draft instead of the proposal once the user edited it", () => {
    const draft: MealDraft = {
      items: [{ name: "tea", portion: { kind: "size", size: "small", estimated: false }, uncertain: false }],
      mealType: "snack",
      occurredAt: new Date("2027-01-11T14:00:00Z"),
    };
    const view = buildConfirmView(understanding({ draft }), ctx);
    expect(view).toMatchObject({ mealType: "snack", day: "yesterday", time: "16:00", anyEstimated: false });
    expect(view.items.map((i) => i.name)).toEqual(["tea"]);
  });

  it("carries a revision equal to revisionOf(mealOf(...)) for the proposal and for the draft", () => {
    const u = understanding();
    expect(buildConfirmView(u, ctx).revision).toBe(revisionOf(mealOf(u)));

    const edited = understanding({ draft: { items: [{ name: "tea", portion: null, uncertain: false }], mealType: "snack", occurredAt: new Date("2027-01-12T09:00:00Z") } });
    expect(buildConfirmView(edited, ctx).revision).toBe(revisionOf(mealOf(edited)));
    expect(buildConfirmView(edited, ctx).revision).not.toBe(buildConfirmView(u, ctx).revision);
  });

  it("does not change the revision when only the clock moves (the page is the same page)", () => {
    const later = { ...ctx, now: new Date("2027-01-12T10:45:00Z") };
    expect(buildConfirmView(understanding(), later).revision).toBe(buildConfirmView(understanding(), ctx).revision);
  });
});

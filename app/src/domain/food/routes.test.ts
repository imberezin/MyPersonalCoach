import { describe, expect, it } from "vitest";
import {
  FOOD_FORM,
  FOOD_QUERY,
  FOOD_ROUTES,
  MEALS_FORM,
  MEALS_QUERY,
  MEALS_ROUTES,
  MEAL_DELETE_FROM,
  MEAL_NOTICES,
  RESUME_WINDOW_MS,
  isStaleReport,
  isUuid,
  parseDeleteFrom,
  parseNotice,
  parseNoticeToken,
} from "./routes";

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

  it("calls a report stale from exactly the resume window on", () => {
    const now = new Date("2026-10-01T12:00:00Z");
    expect(isStaleReport(new Date(now.getTime() - RESUME_WINDOW_MS + 1), now)).toBe(false);
    expect(isStaleReport(new Date(now.getTime() - RESUME_WINDOW_MS), now)).toBe(true);
    expect(isStaleReport(now, now)).toBe(false);
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

describe("MEALS_ROUTES", () => {
  const TOKEN = "11111111-2222-4333-8444-555555555555";

  it("names the list and its parent", () => {
    expect(MEALS_ROUTES.list).toBe("/me/meals");
    expect(MEALS_ROUTES.me).toBe("/me");
  });

  it("names the query values and form fields", () => {
    expect(MEALS_QUERY).toEqual({ pages: "pages", notice: "notice", token: "n" });
    expect(MEALS_FORM).toEqual({ entryId: "entryId", from: "from", pages: "pages" });
    expect(MEAL_NOTICES).toEqual(["deleted", "gone", "error"]);
    expect(MEAL_DELETE_FROM).toEqual(["list", "saved"]);
  });

  it("listPage has no query for one page or less, and a page count above that", () => {
    expect(MEALS_ROUTES.listPage(1)).toBe("/me/meals");
    expect(MEALS_ROUTES.listPage(0)).toBe("/me/meals");
    expect(MEALS_ROUTES.listPage(-1)).toBe("/me/meals");
    expect(MEALS_ROUTES.listPage(Number.NaN)).toBe("/me/meals");
    expect(MEALS_ROUTES.listPage(2)).toBe("/me/meals?pages=2");
    expect(MEALS_ROUTES.listPage(3)).toBe("/me/meals?pages=3");
    expect(MEALS_ROUTES.listPage(2.9)).toBe("/me/meals?pages=2");
    expect(MEALS_ROUTES.listPage(99)).toBe("/me/meals?pages=6");
  });

  it("withNotice carries only the notice when there are no options", () => {
    for (const notice of MEAL_NOTICES) expect(MEALS_ROUTES.withNotice(notice)).toBe(`/me/meals?notice=${notice}`);
    expect(MEALS_ROUTES.withNotice("deleted", {})).toBe("/me/meals?notice=deleted");
  });

  it("withNotice adds the token, then the page count, in that order", () => {
    expect(MEALS_ROUTES.withNotice("gone", { token: TOKEN })).toBe(`/me/meals?notice=gone&n=${TOKEN}`);
    expect(MEALS_ROUTES.withNotice("error", { token: TOKEN, pages: 3 })).toBe(`/me/meals?notice=error&n=${TOKEN}&pages=3`);
    expect(MEALS_ROUTES.withNotice("deleted", { pages: 4 })).toBe("/me/meals?notice=deleted&pages=4");
  });

  it("withNotice keeps the page count only above 1 and clamps it", () => {
    expect(MEALS_ROUTES.withNotice("deleted", { token: TOKEN, pages: 1 })).toBe(`/me/meals?notice=deleted&n=${TOKEN}`);
    expect(MEALS_ROUTES.withNotice("deleted", { token: TOKEN, pages: 0 })).toBe(`/me/meals?notice=deleted&n=${TOKEN}`);
    expect(MEALS_ROUTES.withNotice("deleted", { token: TOKEN, pages: Number.NaN })).toBe(`/me/meals?notice=deleted&n=${TOKEN}`);
    expect(MEALS_ROUTES.withNotice("deleted", { token: TOKEN, pages: 99 })).toBe(`/me/meals?notice=deleted&n=${TOKEN}&pages=6`);
  });

  it("withNotice never puts anything but a UUID in the token slot", () => {
    for (const token of ["", "abc", "a&notice=error", "../x", `${TOKEN}&x=1`]) {
      expect(MEALS_ROUTES.withNotice("deleted", { token }), token).toBe("/me/meals?notice=deleted");
    }
  });

  it("gives two different tokens two different URLs", () => {
    const other = "99999999-8888-4777-8666-555555555555";
    expect(MEALS_ROUTES.withNotice("deleted", { token: TOKEN })).not.toBe(MEALS_ROUTES.withNotice("deleted", { token: other }));
  });
});

describe("parseNotice", () => {
  it("accepts each known notice, and the first element of an array", () => {
    for (const notice of MEAL_NOTICES) {
      expect(parseNotice(notice)).toBe(notice);
      expect(parseNotice([notice, "error"])).toBe(notice);
    }
  });

  it("is null for anything else and never throws", () => {
    for (const bad of [undefined, null, "", "Deleted", "delete", "deleted ", "<b>", 5, {}, [], [5], true, () => "deleted"]) {
      expect(parseNotice(bad), String(bad)).toBeNull();
    }
  });
});

describe("parseNoticeToken", () => {
  const TOKEN = "11111111-2222-4333-8444-555555555555";

  it("accepts a UUID, and the first element of an array", () => {
    expect(parseNoticeToken(TOKEN)).toBe(TOKEN);
    expect(parseNoticeToken([TOKEN, "x"])).toBe(TOKEN);
  });

  it("is null for anything that is not a UUID and never throws", () => {
    for (const bad of [undefined, null, "", "abc", `${TOKEN}x`, "x".repeat(65), `${"a".repeat(64)}`, 5, {}, [], ["x", TOKEN]]) {
      expect(parseNoticeToken(bad), String(bad)).toBeNull();
    }
  });
});

describe("parseDeleteFrom", () => {
  it("keeps the two known origins and turns anything forged into list", () => {
    expect(parseDeleteFrom("list")).toBe("list");
    expect(parseDeleteFrom("saved")).toBe("saved");
    for (const bad of [undefined, null, "", "Saved", "home", "saved ", 5, {}, ["saved"], new Blob([])]) {
      expect(parseDeleteFrom(bad), String(bad)).toBe("list");
    }
  });
});

import { describe, expect, it } from "vitest";
import { isUuid as foodIsUuid } from "../food/routes";
import {
  WEIGHT_DELETE_FIELDS,
  WEIGHT_FORM,
  WEIGHT_NOTICES,
  WEIGHT_QUERY,
  WEIGHT_ROUTES,
  isUuid,
  parseDeleteFrom,
  parseWeightCursor,
  parseWeightNotice,
  parseWeightNoticeToken,
} from "./routes";

const UUID = "3f2b8c1e-5a47-4d09-9c1b-2e7a6d4f8b10";
const OTHER = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";

describe("WEIGHT_ROUTES", () => {
  it("has the addresses of the flow", () => {
    expect(WEIGHT_ROUTES.entry).toBe("/report/weight");
    expect(WEIGHT_ROUTES.saved(UUID)).toBe(`/report/weight/${UUID}/saved`);
    expect(WEIGHT_ROUTES.savedEdited(UUID)).toBe(`/report/weight/${UUID}/saved?edited=1`);
    expect(WEIGHT_ROUTES.edit(UUID)).toBe(`/report/weight/${UUID}/edit`);
    expect(WEIGHT_ROUTES.list).toBe("/me/weights");
    expect(WEIGHT_ROUTES.progress).toBe("/progress");
    expect(WEIGHT_ROUTES.me).toBe("/me");
  });

  it("keeps the field and query names the pages and actions share", () => {
    expect(WEIGHT_FORM).toEqual({ id: "id", weight: "weight", day: "day", note: "note", confirmed: "confirmed" });
    expect(WEIGHT_QUERY).toEqual({ after: "after", notice: "notice", token: "n", edited: "edited" });
    expect(WEIGHT_DELETE_FIELDS).toEqual({ entryId: "entryId", from: "from", after: "after" });
    expect(WEIGHT_NOTICES).toEqual(["deleted", "gone", "error"]);
  });

  describe("listAfter", () => {
    it("is the newest page for null and for anything that is not a UUID", () => {
      expect(WEIGHT_ROUTES.listAfter(null)).toBe("/me/weights");
      expect(WEIGHT_ROUTES.listAfter("2026-10-02")).toBe("/me/weights");
      expect(WEIGHT_ROUTES.listAfter("118.7")).toBe("/me/weights");
      expect(WEIGHT_ROUTES.listAfter("")).toBe("/me/weights");
    });

    it("carries a UUID cursor", () => {
      expect(WEIGHT_ROUTES.listAfter(UUID)).toBe(`/me/weights?after=${UUID}`);
    });
  });

  describe("withNotice", () => {
    it("builds the notice landing with no token and no cursor", () => {
      expect(WEIGHT_ROUTES.withNotice("deleted")).toBe("/me/weights?notice=deleted");
      expect(WEIGHT_ROUTES.withNotice("gone", {})).toBe("/me/weights?notice=gone");
    });

    it("keeps the token and the cursor only when they are UUIDs", () => {
      expect(WEIGHT_ROUTES.withNotice("deleted", { token: UUID })).toBe(`/me/weights?notice=deleted&n=${UUID}`);
      expect(WEIGHT_ROUTES.withNotice("error", { token: UUID, after: OTHER })).toBe(`/me/weights?notice=error&n=${UUID}&after=${OTHER}`);
      expect(WEIGHT_ROUTES.withNotice("deleted", { after: OTHER })).toBe(`/me/weights?notice=deleted&after=${OTHER}`);
    });

    it.each(["118.7", "2026-10-02", "<script>", "", "abc"])("drops a token or cursor that is %j (nothing but a random id rides in the URL)", (bad) => {
      expect(WEIGHT_ROUTES.withNotice("deleted", { token: bad, after: bad })).toBe("/me/weights?notice=deleted");
    });

    it("drops a null cursor", () => {
      expect(WEIGHT_ROUTES.withNotice("gone", { token: UUID, after: null })).toBe(`/me/weights?notice=gone&n=${UUID}`);
    });
  });
});

describe("parseWeightNotice", () => {
  it.each(["deleted", "gone", "error"] as const)("accepts %s", (notice) => {
    expect(parseWeightNotice(notice)).toBe(notice);
  });

  it("takes the first value of an array", () => {
    expect(parseWeightNotice(["gone", "deleted"])).toBe("gone");
  });

  it.each([undefined, null, "", "DELETED", "ok", 1, {}, [], ["x"]])("rejects %j", (raw) => {
    expect(parseWeightNotice(raw)).toBeNull();
  });
});

describe("parseWeightNoticeToken", () => {
  it("accepts a UUID, also the first of an array", () => {
    expect(parseWeightNoticeToken(UUID)).toBe(UUID);
    expect(parseWeightNoticeToken([UUID, OTHER])).toBe(UUID);
  });

  it.each([undefined, null, "", "118.7", "not-a-uuid", 5, {}, []])("rejects %j", (raw) => {
    expect(parseWeightNoticeToken(raw)).toBeNull();
  });
});

describe("parseDeleteFrom", () => {
  it("accepts the two places", () => {
    expect(parseDeleteFrom("list")).toBe("list");
    expect(parseDeleteFrom("saved")).toBe("saved");
  });

  it.each([undefined, null, "", "LIST", "home", 1, ["saved"]])("turns a forged value (%j) into list", (raw) => {
    expect(parseDeleteFrom(raw)).toBe("list");
  });
});

describe("parseWeightCursor", () => {
  it("passes a UUID", () => {
    expect(parseWeightCursor(UUID)).toBe(UUID);
  });

  it.each([undefined, null, "", "garbage", "2026-10-02", 5, {}, [UUID], [], ["a", "b"]])("turns %j into null (the newest page)", (raw) => {
    expect(parseWeightCursor(raw)).toBeNull();
  });
});

describe("isUuid", () => {
  it("is the food flow's own function, not a copy", () => {
    expect(isUuid).toBe(foodIsUuid);
  });
});

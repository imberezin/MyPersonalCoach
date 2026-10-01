import { describe, expect, it } from "vitest";
import { PLACES, getPlace, validateShabbatChoice } from "./places";

describe("PLACES", () => {
  it("has unique, well-formed keys", () => {
    const keys = PLACES.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(/^[a-z][a-z0-9_]{0,63}$/);
  });

  it("has coordinates on Earth, to two decimals", () => {
    for (const p of PLACES) {
      expect(p.latitude).toBeGreaterThanOrEqual(-90);
      expect(p.latitude).toBeLessThanOrEqual(90);
      expect(p.longitude).toBeGreaterThanOrEqual(-180);
      expect(p.longitude).toBeLessThanOrEqual(180);
      expect(Math.round(p.latitude * 100) / 100).toBe(p.latitude);
      expect(Math.round(p.longitude * 100) / 100).toBe(p.longitude);
      expect(p.cityName.trim()).not.toBe("");
    }
  });

  it("uses time zones the runtime knows", () => {
    for (const p of PLACES) {
      expect(() => new Intl.DateTimeFormat("en", { timeZone: p.timezone })).not.toThrow();
    }
  });

  it("is in Israel exactly when the zone is Asia/Jerusalem", () => {
    for (const p of PLACES) expect(p.inIsrael).toBe(p.timezone === "Asia/Jerusalem");
  });

  it("starts from the usual candle-lighting minutes", () => {
    for (const p of PLACES) {
      if (!p.inIsrael) expect(p.candleDefault).toBe(18);
      else if (p.key === "jerusalem") expect(p.candleDefault).toBe(40);
      else if (p.key === "haifa" || p.key === "zikhron_yaakov") expect(p.candleDefault).toBe(30);
      else expect(p.candleDefault).toBe(20);
    }
  });

  it("is big enough to be useful", () => {
    expect(PLACES.filter((p) => p.inIsrael).length).toBeGreaterThanOrEqual(20);
    expect(PLACES.filter((p) => !p.inIsrael).length).toBeGreaterThanOrEqual(10);
  });

  it("contains the cities the Shabbat times are checked against", () => {
    const required = [
      "jerusalem", "tel_aviv", "haifa", "beer_sheva", "eilat", "tiberias", "petah_tikva", "ashdod", "zikhron_yaakov",
      "new_york", "los_angeles", "chicago", "miami", "toronto", "london", "paris", "johannesburg", "sydney", "buenos_aires",
    ];
    for (const key of required) expect(getPlace(key), key).toBeDefined();
  });
});

describe("getPlace", () => {
  it("finds a place by key and nothing else", () => {
    expect(getPlace("haifa")?.cityName).toBe("Haifa");
    expect(getPlace("nowhere")).toBeUndefined();
    expect(getPlace("constructor")).toBeUndefined();
    expect(getPlace("")).toBeUndefined();
  });
});

describe("validateShabbatChoice", () => {
  it("asks for a place when there is none", () => {
    for (const blank of [undefined, null, "", "   "]) {
      expect(validateShabbatChoice(blank, 20)).toEqual({ ok: false, code: "place_required" });
    }
  });

  it("rejects a key that is not on the list or not a key", () => {
    expect(validateShabbatChoice("atlantis", 20)).toEqual({ ok: false, code: "unknown_place" });
    expect(validateShabbatChoice("Haifa", 20)).toEqual({ ok: false, code: "unknown_place" });
    expect(validateShabbatChoice("__proto__", 20)).toEqual({ ok: false, code: "unknown_place" });
    expect(validateShabbatChoice(42, 20)).toEqual({ ok: false, code: "unknown_place" });
  });

  it("uses the place default when the minutes are missing", () => {
    const jerusalem = validateShabbatChoice("jerusalem", null);
    expect(jerusalem).toMatchObject({ ok: true, candleMinutes: 40 });
    expect(validateShabbatChoice("haifa", undefined)).toMatchObject({ ok: true, candleMinutes: 30 });
    expect(validateShabbatChoice("new_york", undefined)).toMatchObject({ ok: true, candleMinutes: 18 });
  });

  it("keeps minutes the user chose, from 0 to 90", () => {
    expect(validateShabbatChoice("tel_aviv", 18)).toMatchObject({ ok: true, candleMinutes: 18 });
    expect(validateShabbatChoice("tel_aviv", 0)).toMatchObject({ ok: true, candleMinutes: 0 });
    expect(validateShabbatChoice("tel_aviv", 90)).toMatchObject({ ok: true, candleMinutes: 90 });
  });

  it("rejects minutes out of range or not whole", () => {
    for (const bad of [-1, 91, 20.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(validateShabbatChoice("tel_aviv", bad)).toEqual({ ok: false, code: "out_of_range" });
    }
  });

  it("returns the place itself", () => {
    const result = validateShabbatChoice("sydney", 18);
    expect(result.ok && result.place.timezone).toBe("Australia/Sydney");
  });
});

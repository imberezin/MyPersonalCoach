import { describe, expect, it } from "vitest";
import { effectivePatternStatus, feedbackFromAnswer, toDbStatus } from "./status";
import type { PatternFeedback, PatternRow, PatternView } from "./types";

const TZ = "Asia/Jerusalem";
const at = (iso: string) => new Date(iso);

/** Evenings (21:30 local, UTC+2) on the given January 2027 days. */
const evenings = (...days: number[]): Date[] => days.map((d) => new Date(Date.UTC(2027, 0, d, 19, 30)));

const row = (overrides: Partial<PatternRow> = {}): PatternRow => ({
  id: "p1",
  status: "OBSERVATION",
  feedback: null,
  feedbackAt: null,
  ...overrides,
});

const level = (occurrences: Date[], r: PatternRow | null = null): PatternView =>
  effectivePatternStatus({ occurrences, timeZone: TZ, row: r });

describe("effectivePatternStatus: the thresholds, through the real classifier", () => {
  it.each([
    ["0 evenings", [], "NONE"],
    ["1 evening", [1], "NONE"],
    ["2 evenings", [1, 2], "EARLY_SIGNAL"],
    ["3 evenings", [1, 2, 3], "CANDIDATE"],
    ["4 evenings over 20 days", [1, 5, 12, 21], "CANDIDATE"],
    ["5 evenings spanning 13 days", [1, 4, 8, 11, 14], "CANDIDATE"],
    ["5 evenings spanning exactly 14 days", [1, 4, 8, 11, 15], "VALIDATED"],
    ["6 evenings over 20 days", [1, 3, 8, 12, 16, 21], "VALIDATED"],
  ] as const)("%s -> %s", (_name, days, expected) => {
    expect(level(evenings(...days))).toBe(expected);
  });

  it("does not depend on the order of the occurrences, nor mutate them", () => {
    const list = evenings(11, 1, 15, 4, 8);
    const snapshot = list.map((d) => d.getTime());
    expect(level(list)).toBe("VALIDATED");
    expect(list.map((d) => d.getTime())).toEqual(snapshot);
  });

  it("ignores an invalid date", () => {
    expect(level([...evenings(1, 2), new Date("nope")])).toBe("EARLY_SIGNAL");
  });

  it("treats a garbage zone like Jerusalem", () => {
    const list = evenings(1, 2, 3);
    expect(effectivePatternStatus({ occurrences: list, timeZone: "Not/AZone", row: null })).toBe(level(list));
  });
});

describe("effectivePatternStatus: the person's answer", () => {
  it("never promotes on a confirmation alone: 'Sounds right' at 2 evenings stays EARLY_SIGNAL", () => {
    const given = row({ feedback: "confirm", feedbackAt: at("2027-01-02T20:00:00Z") });
    expect(level(evenings(1, 2), given)).toBe("EARLY_SIGNAL");
    expect(level(evenings(1, 2), row({ feedback: "confirm", feedbackAt: at("2030-01-01T00:00:00Z") }))).toBe("EARLY_SIGNAL");
  });

  it("counts a yes given BEFORE the third evening as nothing: the person only saw the Early Signal", () => {
    const given = row({ feedback: "confirm", feedbackAt: at("2027-01-02T21:00:00Z") });
    expect(level(evenings(1, 2, 3), given)).toBe("CANDIDATE");
    expect(level(evenings(1, 2, 3, 4), given)).toBe("CANDIDATE");
  });

  it("counts a yes given exactly at the third evening, or after it: VALIDATED", () => {
    const third = evenings(1, 2, 3)[2];
    expect(level(evenings(1, 2, 3), row({ feedback: "confirm", feedbackAt: third }))).toBe("VALIDATED");
    expect(level(evenings(1, 2, 3), row({ feedback: "confirm", feedbackAt: new Date(third.getTime() + 1) }))).toBe("VALIDATED");
    expect(level(evenings(1, 2, 3), row({ feedback: "confirm", feedbackAt: new Date(third.getTime() - 1) }))).toBe("CANDIDATE");
  });

  it("compares with the THIRD evening, not the second", () => {
    // A yes between the second and the third evening: at the second the claim was only an Early Signal.
    const given = row({ feedback: "confirm", feedbackAt: at("2027-01-02T19:30:00Z") });
    expect(level(evenings(1, 2, 3), given)).toBe("CANDIDATE");
  });

  it("does not count a confirm with no time", () => {
    expect(level(evenings(1, 2, 3), row({ feedback: "confirm", feedbackAt: null }))).toBe("CANDIDATE");
  });

  it("does not count a confirm with an invalid time", () => {
    expect(level(evenings(1, 2, 3), row({ feedback: "confirm", feedbackAt: new Date("nope") }))).toBe("CANDIDATE");
  });

  it("leaves the level alone for 'not sure'", () => {
    const given = row({ feedback: "unsure", feedbackAt: at("2027-01-10T00:00:00Z") });
    expect(level(evenings(1, 2), given)).toBe("EARLY_SIGNAL");
    expect(level(evenings(1, 2, 3), given)).toBe("CANDIDATE");
    expect(level(evenings(1, 4, 8, 11, 15), given)).toBe("VALIDATED");
  });

  it("is REJECTED for a rejected row, whatever the occurrences", () => {
    const rejected = row({ status: "REJECTED", feedback: "reject", feedbackAt: at("2027-01-02T00:00:00Z") });
    for (const days of [[], [1], [1, 2], [1, 2, 3], [1, 4, 8, 11, 15]]) expect(level(evenings(...days), rejected)).toBe("REJECTED");
    // Either mark of the person's own word is enough.
    expect(level(evenings(1, 2, 3), row({ status: "REJECTED" }))).toBe("REJECTED");
    expect(level(evenings(1, 2, 3), row({ feedback: "reject" }))).toBe("REJECTED");
  });
});

describe("effectivePatternStatus: the stored status is a mirror and is ignored", () => {
  it("a row that says CANDIDATE with 1 evening is NONE", () => {
    expect(level(evenings(1), row({ status: "CANDIDATE" }))).toBe("NONE");
  });

  it("a row that says VALIDATED with 2 evenings is EARLY_SIGNAL", () => {
    expect(level(evenings(1, 2), row({ status: "VALIDATED" }))).toBe("EARLY_SIGNAL");
  });

  it("a row that says OBSERVATION with 3 evenings is CANDIDATE", () => {
    expect(level(evenings(1, 2, 3), row({ status: "OBSERVATION" }))).toBe("CANDIDATE");
  });
});

describe("toDbStatus", () => {
  it.each([
    ["NONE", "OBSERVATION"],
    ["EARLY_SIGNAL", "OBSERVATION"],
    ["CANDIDATE", "CANDIDATE"],
    ["VALIDATED", "VALIDATED"],
  ] as const)("%s is stored as %s", (view, stored) => {
    expect(toDbStatus(view)).toBe(stored);
  });
});

describe("feedbackFromAnswer", () => {
  it.each<PatternFeedback>(["confirm", "unsure", "reject"])("accepts %s", (word) => {
    expect(feedbackFromAnswer(word)).toBe(word);
  });

  it.each([
    "",
    "Confirm",
    " confirm",
    "confirm ",
    "yes",
    "REJECT",
    ["confirm"],
    new File(["x"], "x.txt"),
    1,
    null,
    undefined,
    {},
    true,
  ])("rejects %j", (value) => {
    expect(feedbackFromAnswer(value)).toBeNull();
  });
});

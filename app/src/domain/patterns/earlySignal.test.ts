import { describe, expect, it } from "vitest";
import { INTERVENTION_RULES } from "../interventions/library";
import { decideEarlySignal, EARLY_SIGNAL } from "./earlySignal";
import type { PatternFeedback, PatternRow, PatternView } from "./types";

const NOW = new Date("2027-02-01T10:00:00Z");
const DAY = 86_400_000;

const row = (feedback: PatternFeedback | null, feedbackAt: Date | null = null, status: PatternRow["status"] = "OBSERVATION"): PatternRow => ({
  id: "p1",
  status,
  feedback,
  feedbackAt,
});

const decide = (view: PatternView, r: PatternRow | null, now: Date = NOW) => decideEarlySignal({ view, row: r, now });

const NOT_DUE = { due: false, level: null };

describe("decideEarlySignal: never due", () => {
  it.each(["NONE", "VALIDATED", "REJECTED"] as const)("%s is never due, with or without a row", (view) => {
    expect(decide(view, null)).toEqual(NOT_DUE);
    expect(decide(view, row(null))).toEqual(NOT_DUE);
    expect(decide(view, row("unsure", new Date(NOW.getTime() - 100 * DAY)))).toEqual(NOT_DUE);
  });
});

describe("decideEarlySignal: unanswered", () => {
  it("is due at EARLY_SIGNAL with no row and with a row that has no feedback", () => {
    expect(decide("EARLY_SIGNAL", null)).toEqual({ due: true, level: "EARLY_SIGNAL" });
    expect(decide("EARLY_SIGNAL", row(null))).toEqual({ due: true, level: "EARLY_SIGNAL" });
  });

  it("is due at CANDIDATE with no row and with a row that has no feedback", () => {
    expect(decide("CANDIDATE", null)).toEqual({ due: true, level: "CANDIDATE" });
    expect(decide("CANDIDATE", row(null))).toEqual({ due: true, level: "CANDIDATE" });
  });
});

describe("decideEarlySignal: answered", () => {
  it.each(["confirm", "reject"] as const)("'%s' is never due again, at any level or any age", (feedback) => {
    const old = new Date(NOW.getTime() - 400 * DAY);
    for (const view of ["EARLY_SIGNAL", "CANDIDATE"] as const) {
      expect(decide(view, row(feedback, old))).toEqual(NOT_DUE);
      expect(decide(view, row(feedback, null))).toEqual(NOT_DUE);
    }
  });

  it("'unsure' at EARLY_SIGNAL is never due again, however old", () => {
    expect(decide("EARLY_SIGNAL", row("unsure", new Date(NOW.getTime() - 400 * DAY)))).toEqual(NOT_DUE);
  });

  describe("'unsure' at CANDIDATE comes back only after the cooldown", () => {
    const cooldownMs = EARLY_SIGNAL.cooldownDays * DAY;

    it("is not due one millisecond before feedbackAt + 14 days", () => {
      const answeredAt = new Date(NOW.getTime() - cooldownMs + 1);
      expect(decide("CANDIDATE", row("unsure", answeredAt))).toEqual(NOT_DUE);
    });

    it("is due at exactly feedbackAt + 14 days", () => {
      const answeredAt = new Date(NOW.getTime() - cooldownMs);
      expect(decide("CANDIDATE", row("unsure", answeredAt))).toEqual({ due: true, level: "CANDIDATE" });
    });

    it("is due long after", () => {
      expect(decide("CANDIDATE", row("unsure", new Date(NOW.getTime() - 60 * DAY)))).toEqual({ due: true, level: "CANDIDATE" });
    });

    it("is not due with no feedbackAt (the cooldown cannot be shown to have passed)", () => {
      expect(decide("CANDIDATE", row("unsure", null))).toEqual(NOT_DUE);
    });

    it("is not due for an invalid time or an invalid now", () => {
      expect(decide("CANDIDATE", row("unsure", new Date("nope")))).toEqual(NOT_DUE);
      expect(decide("CANDIDATE", row("unsure", new Date(NOW.getTime() - 60 * DAY)), new Date("nope"))).toEqual(NOT_DUE);
    });
  });

  it("takes the cooldown from the library's own constant", () => {
    expect(EARLY_SIGNAL.cooldownDays).toBe(INTERVENTION_RULES.cooldownDays);
    expect(EARLY_SIGNAL.cooldownDays).toBe(14);
  });

  it("does not read the stored status", () => {
    // The mirror says VALIDATED, the live view says EARLY_SIGNAL: the card is due.
    expect(decide("EARLY_SIGNAL", row(null, null, "VALIDATED"))).toEqual({ due: true, level: "EARLY_SIGNAL" });
  });
});

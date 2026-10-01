// The notice takes focus when it appears, which is what makes a screen reader read "The meal was deleted".
// Without a DOM: the component is called as a plain function with useRef and useEffect replaced by recorders.
// (The markup is in Notices.test.ts.)
import { describe, expect, it, vi } from "vitest";
import { MEAL_NOTICES } from "@/domain/food/routes";
import { MealsNotice } from "./MealsNotice";

const hooks = vi.hoisted(() => ({
  ref: { current: null as unknown },
  effect: null as null | (() => void),
  deps: undefined as unknown[] | undefined,
}));

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useRef: () => hooks.ref,
  useEffect: (effect: () => void, deps?: unknown[]) => {
    hooks.effect = effect;
    hooks.deps = deps;
  },
}));
vi.mock("use-intl", () => ({ useTranslations: () => (key: string) => key }));

const runEffect = () => hooks.effect?.();

describe("MealsNotice focus", () => {
  it.each(MEAL_NOTICES)("%s: focuses its own wrapper once, on mount only", (notice) => {
    const focus = vi.fn();
    hooks.ref = { current: { focus } };
    hooks.effect = null;
    MealsNotice({ notice });
    expect(hooks.deps).toEqual([]);
    expect(focus).not.toHaveBeenCalled();
    runEffect();
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("does not throw when the wrapper is not there yet", () => {
    hooks.ref = { current: null };
    MealsNotice({ notice: "deleted" });
    expect(runEffect).not.toThrow();
  });
});

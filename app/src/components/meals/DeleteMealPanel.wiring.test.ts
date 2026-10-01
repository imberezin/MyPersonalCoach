// The panel's behaviour, without a DOM: the component and its inner Answers are called as plain functions with
// React's hooks replaced by recorders. What this pins: Esc keeps the meal but never while a delete is in flight,
// Keep is off while it is in flight, Keep calls onKeep, and the in-flight flag really reaches the Esc handler.
// (The markup is in DeleteMeal.test.ts; the Esc rule itself is in deleteConfirm.test.ts.)
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/Button";
import { DeleteMealPanel } from "./DeleteMealPanel";

const hooks = vi.hoisted(() => ({
  pending: false,
  refs: [] as Array<{ current: unknown }>,
  effect: null as null | (() => void),
}));

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useId: () => "panel-title",
  useRef: (initial: unknown) => {
    const ref = { current: initial };
    hooks.refs.push(ref);
    return ref;
  },
  useEffect: (effect: () => void) => {
    hooks.effect = effect;
  },
}));
vi.mock("react-dom", async (original) => ({
  ...(await original<typeof import("react-dom")>()),
  useFormStatus: () => ({ pending: hooks.pending }),
}));
vi.mock("use-intl", () => ({ useTranslations: () => (key: string) => key }));

type Props = Record<string, unknown>;

/** Renders the panel once and returns its group props, the form's Answers element and the in-flight ref it made. */
function render(onKeep: () => void) {
  hooks.refs = [];
  const group = DeleteMealPanel({ entryId: "e", from: "list", action: async () => {}, onKeep }) as ReactElement<Props>;
  const form = (group.props.children as ReactElement<Props>[]).find((child) => child?.type === "form") as ReactElement<{ children: ReactElement<Props>[] }>;
  const answers = form.props.children.at(-1) as ReactElement<{ onKeep: () => void; pendingRef: { current: boolean } }>;
  return { group, answers, pendingRef: hooks.refs[0] as { current: boolean } };
}

const escape = (group: ReactElement<Props>, key = "Escape") => (group.props.onKeyDown as (event: { key: string }) => void)({ key });

beforeEach(() => {
  hooks.pending = false;
  hooks.effect = null;
});

describe("DeleteMealPanel wiring", () => {
  it("Esc keeps the meal while nothing is in flight, and any other key does nothing", () => {
    const onKeep = vi.fn();
    const { group } = render(onKeep);
    escape(group, "Enter");
    escape(group, "a");
    expect(onKeep).not.toHaveBeenCalled();
    escape(group);
    expect(onKeep).toHaveBeenCalledTimes(1);
  });

  it("Esc is ignored while a delete is in flight", () => {
    const onKeep = vi.fn();
    const { group, pendingRef } = render(onKeep);
    pendingRef.current = true;
    escape(group);
    expect(onKeep).not.toHaveBeenCalled();
  });

  it("the Answers get the same onKeep and the same in-flight ref the Esc handler reads", () => {
    const onKeep = vi.fn();
    const { answers, pendingRef } = render(onKeep);
    expect(answers.props.onKeep).toBe(onKeep);
    expect(answers.props.pendingRef).toBe(pendingRef);
  });

  it("copies the form's in-flight state into that ref, after render", () => {
    const { answers, pendingRef } = render(vi.fn());
    for (const pending of [true, false]) {
      hooks.pending = pending;
      pendingRef.current = !pending;
      (answers.type as (props: typeof answers.props) => unknown)(answers.props);
      hooks.effect?.();
      expect(pendingRef.current).toBe(pending);
    }
  });

  it("Keep is the first button, calls onKeep, and is on until the delete is sent, then off", () => {
    const onKeep = vi.fn();
    const { answers } = render(onKeep);
    const answersOf = (pending: boolean) => {
      hooks.pending = pending;
      const row = (answers.type as (props: typeof answers.props) => ReactElement<{ children: ReactElement<Props>[] }>)(answers.props);
      return row.props.children;
    };

    const [keepIdle] = answersOf(false);
    expect(keepIdle.type).toBe(Button);
    expect(keepIdle.props.disabled).toBe(false);
    (keepIdle.props.onClick as () => void)();
    expect(onKeep).toHaveBeenCalledTimes(1);

    const [keepBusy] = answersOf(true);
    expect(keepBusy.props.disabled).toBe(true);
  });
});

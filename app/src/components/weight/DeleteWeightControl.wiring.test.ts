// The control's wiring, without a DOM: the component is called as a plain function with React's hooks
// replaced by recorders, and the element tree it returns is read. What this pins: the trigger opens the panel,
// Keep closes it, focus goes where the person looks next, and the panel gets exactly the props it needs.
// (The closed and open markup is in DeleteWeight.test.ts.)
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/Button";
import { DeleteWeightControl, type DeleteWeightControlProps } from "./DeleteWeightControl";
import { DeleteWeightPanel } from "./DeleteWeightPanel";

const hooks = vi.hoisted(() => ({
  state: { phase: "closed" } as { phase: "closed" | "confirming" },
  dispatch: vi.fn(),
  refs: [] as Array<{ current: unknown }>,
  effect: null as null | (() => void),
}));

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useReducer: () => [hooks.state, hooks.dispatch],
  useRef: (initial: unknown) => {
    const ref = { current: initial };
    hooks.refs.push(ref);
    return ref;
  },
  useEffect: (effect: () => void) => {
    hooks.effect = effect;
  },
}));
vi.mock("use-intl", () => ({ useTranslations: () => (key: string) => key }));

const ID = "0b6f7e0a-8d9c-4f3e-a1b2-c3d4e5f60718";
const action = async () => {};
const summary = "the weight again";

type Props = Record<string, unknown>;
type Root = { querySelector: (selector: string) => { focus: () => void } | null };

/** Renders once in the given state and returns the single child of the wrapper, plus the two refs the component made. */
function render(phase: "closed" | "confirming", over: Partial<DeleteWeightControlProps> = {}) {
  hooks.state = { phase };
  hooks.refs = [];
  hooks.effect = null;
  const tree = DeleteWeightControl({ entryId: ID, from: "list", action, ...over }) as ReactElement<{ children: ReactElement<Props> }>;
  const [rootRef, pendingFocus] = hooks.refs;
  return { child: tree.props.children, rootRef, pendingFocus };
}

/** Runs the committed effect against a fake wrapper and reports which selector was asked for and whether focus was called. */
function runEffect(rootRef: { current: unknown }) {
  const queries: string[] = [];
  const focus = vi.fn();
  const root: Root = {
    querySelector: (selector) => {
      queries.push(selector);
      return { focus };
    },
  };
  rootRef.current = root;
  hooks.effect?.();
  return { queries, focus };
}

beforeEach(() => {
  hooks.dispatch.mockReset();
});

describe("DeleteWeightControl wiring: closed", () => {
  it("shows the quiet trigger, and pressing it asks (ASK) and sends focus to the panel's heading", () => {
    const { child, pendingFocus, rootRef } = render("closed");
    expect(child.type).toBe(Button);
    (child.props.onClick as () => void)();
    expect(hooks.dispatch).toHaveBeenCalledExactlyOnceWith({ type: "ASK" });
    expect(pendingFocus.current).toBe("panel");

    const { queries, focus } = runEffect(rootRef);
    expect(queries).toEqual(["h2"]);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(pendingFocus.current).toBeNull();
  });

  it("moves no focus when nothing was asked (the first mount)", () => {
    const { rootRef, pendingFocus } = render("closed");
    const { queries, focus } = runEffect(rootRef);
    expect(queries).toEqual([]);
    expect(focus).not.toHaveBeenCalled();
    expect(pendingFocus.current).toBeNull();
  });

  it("describes the trigger by the outside id only", () => {
    expect(render("closed", { describedBy: "weight-row" }).child.props["aria-describedby"]).toBe("weight-row");
    expect(render("closed", { summaryId: "weight-x" }).child.props["aria-describedby"]).toBeUndefined();
  });
});

describe("DeleteWeightControl wiring: open", () => {
  it("renders the panel with exactly the props it needs, and Keep closes it (KEEP) and returns focus to the trigger", () => {
    const { child, pendingFocus, rootRef } = render("confirming", { describedBy: "weight-row", after: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d" });
    expect(child.type).toBe(DeleteWeightPanel);
    expect(child.props).toEqual({
      entryId: ID,
      from: "list",
      action,
      describedBy: "weight-row",
      summary: undefined,
      after: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
      onKeep: expect.any(Function),
    });

    (child.props.onKeep as () => void)();
    expect(hooks.dispatch).toHaveBeenCalledExactlyOnceWith({ type: "KEEP" });
    expect(pendingFocus.current).toBe("trigger");

    const { queries, focus } = runEffect(rootRef);
    expect(queries).toEqual(["button"]);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(pendingFocus.current).toBeNull();
  });

  it("on the Saved screen the panel repeats the weight and is described by the summary's id", () => {
    const { child } = render("confirming", { from: "saved", summary, summaryId: "weight-x" });
    expect(child.props).toMatchObject({ entryId: ID, from: "saved", action, describedBy: "weight-x", summary, after: undefined });
  });

  it("prefers the outside description over the summary id when both are given", () => {
    expect(render("confirming", { describedBy: "weight-row", summaryId: "weight-x" }).child.props.describedBy).toBe("weight-row");
  });
});

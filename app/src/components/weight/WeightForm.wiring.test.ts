// The form's behaviour, without a DOM: the component is called as a plain function with React's hooks replaced by
// recorders, and the element tree it returns is read. What this pins: a new answer rebuilds the fields from the values the
// server sent, the "is that right?" step leaves when the person fixes the number (by the button or by typing), the
// confirmation exists only inside the step, and focus goes where the answer is. (The markup is in WeightForm.test.ts.)
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/Button";
import type { WeightFormState, WeightFormValues } from "@/domain/weight/entry";
import { WeightForm } from "./WeightForm";

const hooks = vi.hoisted(() => ({
  slots: [] as unknown[],
  setters: [] as Array<ReturnType<typeof vi.fn>>,
  index: 0,
  state: null as unknown,
  effects: [] as Array<{ run: () => void | (() => void); deps: unknown[] | undefined }>,
  refs: [] as Array<{ current: unknown }>,
}));

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useId: () => "base",
  useActionState: () => [hooks.state, () => {}],
  useState: (initial: unknown) => {
    const i = hooks.index++;
    if (!(i in hooks.slots)) hooks.slots[i] = typeof initial === "function" ? (initial as () => unknown)() : initial;
    hooks.setters[i] ??= vi.fn();
    return [hooks.slots[i], hooks.setters[i]];
  },
  useRef: (initial: unknown) => {
    const ref = { current: initial };
    hooks.refs.push(ref);
    return ref;
  },
  useEffect: (run: () => void | (() => void), deps?: unknown[]) => {
    hooks.effects.push({ run, deps });
  },
}));
vi.mock("use-intl", () => ({ useTranslations: () => (key: string) => key }));

const options = [{ value: "now", label: "Now" }];
const values = (over: Partial<WeightFormValues> = {}): WeightFormValues => ({ weight: "181", day: "now", note: "n", confirmed: false, ...over });
const check = (v = values()): WeightFormState => ({ status: "check", values: v });
const refused = (v = values()): WeightFormState => ({ status: "error", errors: [{ code: "required", field: "weight" }], values: v });

/** Slot numbers, in the order the component declares its state. */
const FIELDS = 0;
const SEEN = 1;
const GENERATION = 2;
const DISMISSED = 3;

/** Renders once. `seen` is what the component believes it has already shown; `dismissed` the answer set aside. */
function render(state: WeightFormState, seen: WeightFormState = state, dismissed: WeightFormState = null) {
  hooks.state = state;
  hooks.index = 0;
  hooks.effects = [];
  hooks.refs = [];
  hooks.slots[FIELDS] ??= { weight: "181", day: "now", note: "n" };
  hooks.slots[SEEN] = seen;
  hooks.slots[GENERATION] ??= 0;
  hooks.slots[DISMISSED] = dismissed;
  const tree = WeightForm({ mode: "new", id: "id", options, initial: { weight: "", day: "now", note: "" }, action: async () => null, backHref: "/" }) as ReactElement;
  return { tree, refs: hooks.refs, effects: hooks.effects };
}

function elements(node: ReactNode, found: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) {
    for (const child of node) elements(child, found);
  } else if (isValidElement(node)) {
    found.push(node);
    elements((node.props as { children?: ReactNode }).children, found);
  }
  return found;
}
const byName = (tree: ReactElement, name: string) => elements(tree).find((el) => el.type === "input" && (el.props as { name?: string }).name === name);
const buttons = (tree: ReactElement) => elements(tree).filter((el) => el.type === Button) as ReactElement<{ onClick?: () => void; children: string }>[];

beforeEach(() => {
  hooks.slots = [];
  hooks.setters = [];
  hooks.index = 0;
});

describe("WeightForm wiring: a new answer", () => {
  it("rebuilds the fields from the values the server sent and remounts them, once", () => {
    const answer = refused(values({ weight: "12", note: "typed" }));
    render(answer, null);
    expect(hooks.setters[SEEN]).toHaveBeenCalledWith(answer);
    expect(hooks.setters[GENERATION]).toHaveBeenCalledTimes(1);
    expect(hooks.setters[FIELDS]).toHaveBeenCalledWith({ weight: "12", day: "now", note: "typed" });
  });

  it("does nothing while the answer is the one already shown", () => {
    const answer = refused();
    render(answer, answer);
    expect(hooks.setters[SEEN]).not.toHaveBeenCalled();
    expect(hooks.setters[GENERATION]).not.toHaveBeenCalled();
    expect(hooks.setters[FIELDS]).not.toHaveBeenCalled();
  });

  it("moves focus to the replies once a new answer has been shown, and not on the first render", () => {
    hooks.slots[GENERATION] = 1;
    const { effects, refs } = render(refused());
    const focus = vi.fn();
    // refs: replies, weightInput, focusWeight (in declaration order); the replies ref is the first.
    refs[0].current = { focus };
    effects[0].run();
    expect(focus).toHaveBeenCalledTimes(1);

    hooks.slots[GENERATION] = 0;
    const first = render(refused());
    const never = vi.fn();
    first.refs[0].current = { focus: never };
    first.effects[0].run();
    expect(never).not.toHaveBeenCalled();
  });
});

describe("WeightForm wiring: the 'is that right?' step", () => {
  it("shows the confirmation field, 'Yes, it is right' and 'I'll fix it' only while the question stands", () => {
    const asked = check();
    const { tree } = render(asked);
    expect(byName(tree, "confirmed")?.props).toMatchObject({ type: "hidden", value: "1" });
    expect(buttons(tree).map((b) => b.props.children)).toEqual(["check.fix"]);

    const gone = render(asked, asked, asked);
    expect(byName(gone.tree, "confirmed")).toBeUndefined();
    expect(buttons(gone.tree)).toHaveLength(0);
  });

  it("'I'll fix it' sets the question aside, for that answer only, and asks to focus the number afterwards", () => {
    const asked = check();
    const { tree, refs } = render(asked);
    const [fix] = buttons(tree);
    fix.props.onClick?.();
    expect(hooks.setters[DISMISSED]).toHaveBeenCalledWith(asked);
    // refs: replies, weightInput, focusWeight
    expect(refs[2].current).toBe(true);
  });

  it("returns focus to the number once the question has gone, and not while it still stands", () => {
    const asked = check();
    const standing = render(asked);
    standing.refs[2].current = true;
    const focusStanding = vi.fn();
    standing.refs[1].current = { focus: focusStanding };
    standing.effects[1].run();
    expect(focusStanding).not.toHaveBeenCalled();

    const gone = render(asked, asked, asked);
    gone.refs[2].current = true;
    const focus = vi.fn();
    gone.refs[1].current = { focus };
    gone.effects[1].run();
    expect(focus).toHaveBeenCalledTimes(1);
    expect(gone.refs[2].current).toBe(false);
  });

  it("typing a different number leaves the step, so a confirmation never covers a number nobody questioned", () => {
    const asked = check();
    const { tree } = render(asked);
    (byName(tree, "weight")?.props as { onChange: (e: { target: { value: string } }) => void }).onChange({ target: { value: "118.7" } });
    expect(hooks.setters[DISMISSED]).toHaveBeenCalledWith(asked);
    expect(hooks.setters[FIELDS]).toHaveBeenCalledTimes(1);
  });

  it("typing a number outside the step only updates the field", () => {
    const { tree } = render(refused());
    (byName(tree, "weight")?.props as { onChange: (e: { target: { value: string } }) => void }).onChange({ target: { value: "118.7" } });
    expect(hooks.setters[DISMISSED]).not.toHaveBeenCalled();
    expect(hooks.setters[FIELDS]).toHaveBeenCalledTimes(1);
  });

  it("asks again for a new check answer, even after the earlier one was set aside", () => {
    const first = check();
    const second = check();
    const { tree } = render(second, second, first);
    expect(byName(tree, "confirmed")).toBeDefined();
  });
});

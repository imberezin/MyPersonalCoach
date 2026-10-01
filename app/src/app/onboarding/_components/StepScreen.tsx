import { Card } from "@/components/ui/Card";
import type { OnboardingRow, RawFields, StepId } from "@/domain/onboarding";
import type { StepBaseProps } from "./StepForm";
import { AboutYouStep } from "./steps/AboutYouStep";
import { FoodStep } from "./steps/FoodStep";
import { GoalWeightStep } from "./steps/GoalWeightStep";
import { GoalsStep } from "./steps/GoalsStep";
import { KashrutStep } from "./steps/KashrutStep";
import { MovementStep } from "./steps/MovementStep";
import { NotificationsStep } from "./steps/NotificationsStep";
import { OfflineStep } from "./steps/OfflineStep";
import { ReadyStep } from "./steps/ReadyStep";
import { WeightStep } from "./steps/WeightStep";
import { WelcomeStep } from "./steps/WelcomeStep";
import { WhyStep } from "./steps/WhyStep";

interface StepScreenProps {
  step: StepId;
  /** Part of the page's contract; the saved answers reach the screens through `initial`. */
  row: OnboardingRow;
  /** The saved answers, in the shape of the submitted form. */
  initial: RawFields;
  phase: "choices" | "device";
  backHref: string | null;
  skippable: boolean;
  push: { configured: boolean; publicKey: string | null };
}

interface ScreenProps extends StepBaseProps {
  step: StepId;
  phase: "choices" | "device";
  push: { configured: boolean; publicKey: string | null };
}

function Screen({ step, phase, push, ...base }: ScreenProps) {
  switch (step) {
    case "welcome":
      return <WelcomeStep {...base} />;
    case "goals":
      return <GoalsStep {...base} />;
    case "weight":
      return <WeightStep {...base} />;
    case "goal-weight":
      return <GoalWeightStep {...base} />;
    case "about-you":
      return <AboutYouStep {...base} />;
    case "movement":
      return <MovementStep {...base} />;
    case "food":
      return <FoodStep {...base} />;
    case "kashrut":
      return <KashrutStep {...base} />;
    case "offline":
      return <OfflineStep {...base} />;
    case "why":
      return <WhyStep {...base} />;
    case "notifications":
      return <NotificationsStep {...base} phase={phase} push={push} />;
    case "ready":
      return <ReadyStep {...base} />;
  }
}

/** Picks the screen for a step. All the screens share the same card, form and buttons. */
export function StepScreen({ step, initial, phase, backHref, skippable, push }: StepScreenProps) {
  return (
    // The key starts each step (and each half of A11) fresh: its own form state and entrance.
    <Card key={`${step}:${phase}`}>
      <Screen step={step} phase={phase} push={push} initial={initial} backHref={backHref} skippable={skippable} />
    </Card>
  );
}

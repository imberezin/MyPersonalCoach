import { redirect } from "next/navigation";
import {
  STEP_META,
  decideRoute,
  notificationsPhase,
  prefillFor,
  resolveStep,
  stepBefore,
  stepPath,
} from "@/domain/onboarding";
import { getPushClientConfig } from "@/lib/notifications/config";
import { loadOnboardingContext } from "@/lib/onboarding/context";
import { OnboardingUnavailable } from "../_components/OnboardingUnavailable";
import { StepScreen } from "../_components/StepScreen";

export default async function OnboardingStepPage(props: PageProps<"/onboarding/[step]">) {
  const [{ step: requested }, query] = await Promise.all([props.params, props.searchParams]);

  const context = await loadOnboardingContext();
  if (context.kind === "signed_out") redirect("/login");
  if (context.kind !== "ready") return <OnboardingUnavailable reason={context.kind} />;
  const { row } = context;

  const route = decideRoute("onboarding", row.lifecycle_state);
  if (route.kind === "redirect") redirect(route.to);

  // Typing a URL cannot skip ahead: anything past the resume step is sent back to it.
  const resolved = resolveStep(requested, row);
  if (resolved.kind === "redirect") redirect(stepPath(resolved.id));
  const step = resolved.id;

  const phaseParam = Array.isArray(query.phase) ? query.phase[0] : query.phase;
  const phase = step === "notifications" ? notificationsPhase(phaseParam, row) : "choices";

  const before = stepBefore(step, row);
  const backHref =
    phase === "device" ? `${stepPath("notifications")}?phase=choices` : before ? stepPath(before) : null;

  return (
    <StepScreen
      step={step}
      row={row}
      initial={prefillFor(step, row)}
      phase={phase}
      backHref={backHref}
      // The device panel only moves on, so there is nothing to skip there.
      skippable={STEP_META[step].skippable && phase !== "device"}
      push={getPushClientConfig()}
    />
  );
}

import { redirect } from "next/navigation";
import { decideRoute, resumeStep, stepPath } from "@/domain/onboarding";
import { loadOnboardingContext } from "@/lib/onboarding/context";
import { OnboardingUnavailable } from "./_components/OnboardingUnavailable";

// Nothing to show here: this URL only sends the user to the step they should be on.
export default async function OnboardingIndexPage() {
  const context = await loadOnboardingContext();

  if (context.kind === "signed_out") redirect("/login");
  if (context.kind !== "ready") return <OnboardingUnavailable reason={context.kind} />;

  const route = decideRoute("onboarding", context.row.lifecycle_state);
  if (route.kind === "redirect") redirect(route.to);

  redirect(stepPath(resumeStep(context.row)));
}

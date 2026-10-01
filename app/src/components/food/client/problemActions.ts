import type { ProblemReason } from "@/domain/food/analyzeTypes";

export type ProblemAction = "retry" | "writeInstead" | "saveAsWritten" | "checkPending" | "goHome" | "signIn";
export type ProblemFlow = "photo" | "text" | "manual";

/**
 * These three reasons offer "keep it as I wrote it" to someone who typed, which a photo report cannot
 * (nothing was written), so the problem panel has a different body for the photo flow.
 */
export const PHOTO_BODY_REASONS: readonly ProblemReason[] = ["ai_unavailable", "daily_cap", "rate_limited"];

/** The reason's actions in DISPLAY ORDER: the first is the primary button. */
function actionsForText(reason: ProblemReason): ProblemAction[] {
  switch (reason) {
    case "ai_unavailable":
    case "daily_cap":
      return ["saveAsWritten"];
    case "rate_limited":
    case "ai_error":
      return ["retry", "saveAsWritten"];
    case "nothing_found":
    case "invalid_input":
    case "too_large":
    case "unsupported_type":
      return ["retry"];
    case "not_signed_in":
      return ["signIn"];
    case "save_error":
      return ["retry", "goHome"];
    case "network":
      // The report may already have arrived, so looking for it comes before sending it again.
      return ["checkPending", "retry"];
  }
}

function actionsForPhoto(reason: ProblemReason): ProblemAction[] {
  switch (reason) {
    case "ai_unavailable":
    case "daily_cap":
      return ["writeInstead"];
    case "rate_limited":
    case "ai_error":
      return ["retry", "writeInstead"];
    case "nothing_found":
      return ["retry", "writeInstead"];
    case "too_large":
    case "unsupported_type":
      // Sending the same file again cannot help; "A different photo" is always on the screen.
      return ["writeInstead"];
    case "invalid_input":
      return ["retry"];
    case "not_signed_in":
      return ["signIn"];
    case "save_error":
      return ["retry", "goHome"];
    case "network":
      return ["checkPending", "retry"];
  }
}

export function problemActionsFor(reason: ProblemReason, flow: ProblemFlow): ProblemAction[] {
  if (flow === "photo") return actionsForPhoto(reason);
  const actions = actionsForText(reason);
  if (flow === "text") return actions;
  // The manual flow already is the written list: neither "keep it as I wrote it" nor "write instead" applies.
  const manual = actions.filter((action) => action !== "saveAsWritten" && action !== "writeInstead");
  return manual.length > 0 ? manual : ["retry"];
}

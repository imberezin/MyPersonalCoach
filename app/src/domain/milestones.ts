export const MILESTONE_STEP_KG = 5;

/**
 * A step that would land closer than this to the goal is skipped, so the goal is not
 * crowded by a milestone one kilogram before it (120 to 99 gives 120, 115, 110, 105, 99).
 */
export const MILESTONE_MIN_GAP_KG = MILESTONE_STEP_KG / 2;

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Motivational landmarks, never pass/fail levels. One every 5 kg from the starting weight
 * toward the goal; the last one is the goal itself. With no numeric goal (or a goal that is
 * not below the starting weight) there are no weight milestones.
 */
export function computeMilestones(startKg: number, goalKg: number | null | undefined): number[] {
  if (goalKg == null || !Number.isFinite(startKg) || !Number.isFinite(goalKg) || goalKg >= startKg) return [];

  const milestones = [round1(startKg)];
  for (let w = startKg - MILESTONE_STEP_KG; w - goalKg > 1e-9; w -= MILESTONE_STEP_KG) {
    if (w - goalKg >= MILESTONE_MIN_GAP_KG) milestones.push(round1(w));
  }
  milestones.push(round1(goalKg));
  return milestones;
}

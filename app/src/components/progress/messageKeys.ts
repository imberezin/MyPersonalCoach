const leaves = (prefix: string, names: readonly string[]) => names.map((name) => `${prefix}.${name}`);

/**
 * The copy the Progress screen and the landmark card on Home read, as dotted keys from the catalog root. This is the
 * contract with whoever renders them: progress.messages.test.ts demands every key in he.json and en.json, and refuses a
 * key in the `progress` namespace or in the `home.milestone*` keys that nothing here lists. `progress.title`, `lead` and
 * `body` pre-date this item (the page's heading, its lead and its "nothing to show yet" line).
 */
export const PROGRESS_MESSAGE_KEYS: readonly string[] = [
  ...leaves("progress", ["title", "lead", "body"]),
  ...leaves("progress.weight", [
    "title",
    "none",
    "startOnly",
    "notEnough",
    "plateau",
    "add",
    "list",
    "unavailable",
  ]),
  ...leaves("progress.weight.direction", ["down", "steady", "up", "unknown", "stale"]),
  ...leaves("progress.weight.sinceStart", ["lower", "same", "higher"]),
  ...leaves("progress.weight.chart", ["title", "desc", "start"]),
  ...leaves("progress.weight.numbers", ["summary", "week", "start"]),
  ...leaves("progress.milestones", ["title", "lead", "listLabel", "goalReached"]),
  ...leaves("progress.milestones.item", ["start", "goal", "reached", "next", "kg"]),
  ...leaves("progress.noticed", ["title", "lateEvening", "experiment"]),
  ...leaves("progress.unavailable", ["title", "body"]),
  ...leaves("home.milestoneReached", ["title", "body"]),
  ...leaves("home.milestoneGoalReached", ["title", "body"]),
  ...leaves("home", ["milestoneCta", "milestoneAck"]),
  // Reused, not owned: the pending label of the "Thanks" button.
  "common.loading",
];

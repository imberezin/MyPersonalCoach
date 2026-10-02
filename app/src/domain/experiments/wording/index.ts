export { AI_WORDING } from "./constants";
export {
  WORDING_GATE_REASONS,
  decideWordingGate,
  isWordingGateReason,
  type AllowanceFact,
  type PatternLevel,
  type WordingGate,
  type WordingGateReason,
} from "./gate";
export {
  ADVICE_MARKERS,
  COPY_LINT_WORDS,
  FOOD_WORDS,
  JUDGMENT_WORDS,
  NEGATORS,
  NUMBER_WORDS,
  QUANTIFIERS,
  UNIT_WORDS,
  copyLintHits,
} from "./lint";
export { WORDING_CHECKS, measureWording, validateWording, type WordingCheck, type WordingVerdict } from "./validate";
export { MAX_ACTION_ANCHORS, MAX_VERBATIM_ANCHORS, extractWordingAnchors, wordingAnchorsFact, type WordingAnchors } from "./anchors";

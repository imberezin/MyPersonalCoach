// A left-to-right isolate and its pop: a number stays one left-to-right run inside a right-to-left sentence, whatever the
// neighbouring words are. The same trick as the clock time on Home.
const LTR_ISOLATE = "\u2066";
const RTL_ISOLATE = String.fromCharCode(0x2067);
const POP_ISOLATE = "\u2069";

/** A kilogram value (or any number) to put inside a sentence of either language. */
export function isolateLtr(text: string): string {
  return `${LTR_ISOLATE}${text}${POP_ISOLATE}`;
}

/** A right-to-left label (a Hebrew date) that must keep its own order inside a left-to-right context, such as the chart. */
export function isolateRtl(text: string): string {
  return `${RTL_ISOLATE}${text}${POP_ISOLATE}`;
}

// Imported by the shell tests only. The tests wrap components in an IntlProvider with these messages
// instead of the real catalogs, so they check structure and order, never production wording.
import { SHELL_MESSAGE_KEYS } from "./messageKeys";

// The labels of the bar, so the order test reads naturally. Every other key gets its own name as text.
const NAV_TEXT: Readonly<Record<string, string>> = {
  "nav.ariaLabel": "ניווט ראשי",
  "nav.home": "בית",
  "nav.progress": "התקדמות",
  "nav.report": "דיווח",
  "nav.coach": "מאמן",
  "nav.me": "אני",
};

/** A nested messages object with one entry per SHELL_MESSAGE_KEYS item, plus `app.shortName`. */
export function buildShellTestMessages(): Record<string, unknown> {
  const messages: Record<string, unknown> = { app: { shortName: "Eating Coach" } };
  for (const key of SHELL_MESSAGE_KEYS) {
    const path = key.split(".");
    const leafKey = path.pop() as string;
    let node = messages;
    for (const part of path) {
      node[part] = node[part] ?? {};
      node = node[part] as Record<string, unknown>;
    }
    node[leafKey] = NAV_TEXT[key] ?? `[${key}]`;
  }
  return messages;
}

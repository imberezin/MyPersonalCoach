import { OpenReportSheetButton } from "@/components/shell/OpenReportSheetButton";
import type { HomeAction, HomeDecision } from "@/domain/home";
import { getLocale, getTranslations } from "@/i18n/server";
import { HomeCard } from "./HomeCard";
import { HomeRefresher } from "./HomeRefresher";
import { homeCopyFor } from "./homeCopy";

// Where each action lands. Every new action kind has to name a landing place that exists, and the
// `never` below makes the compiler ask for it.
function renderAction(action: HomeAction, label: string) {
  switch (action.kind) {
    case "OPEN_REPORT_SHEET":
      return <OpenReportSheetButton variant="primary">{label}</OpenReportSheetButton>;
    default: {
      const unhandled: never = action.kind;
      return unhandled;
    }
  }
}

/**
 * A decision, in words. `renderedAt` is the server's clock reading for this render; the refresher
 * uses it to notice when a Home that iOS restored from memory is old.
 */
export async function HomeView({
  decision,
  timeZone,
  renderedAt,
}: {
  decision: HomeDecision;
  timeZone: string;
  renderedAt: number;
}) {
  const [t, locale] = await Promise.all([getTranslations("home"), getLocale()]);
  const copy = homeCopyFor(decision, t, { locale, timeZone });
  const action = decision.action && copy.invitation ? renderAction(decision.action, copy.invitation.cta) : null;

  return (
    <>
      <HomeCard copy={copy} action={action} />
      <HomeRefresher renderedAt={renderedAt} />
    </>
  );
}

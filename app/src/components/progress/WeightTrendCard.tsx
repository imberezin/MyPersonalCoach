import type { ReactNode } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  WEIGHT_FLOW,
  WEIGHT_ROUTES,
  buildChartModel,
  formatKg,
  formatWeekLabel,
  type WeightTrend,
} from "@/domain/weight";
import type { Translator } from "@/i18n/server";
import type { ProgressLoad } from "@/lib/weight/load";
import { isolateLtr } from "./isolate";
import styles from "./progress.module.css";
import { TrendChart } from "./TrendChart";

const TITLE_ID = "progress-weight-title";

type SinceStartKind = NonNullable<WeightTrend["sinceStart"]>["kind"];
type WeightPart = Extract<ProgressLoad, { kind: "ready" }>["weight"];

// The direction sentences. The three are built the same way and weigh the same: an increase carries no explanation a
// decrease lacks. Every new direction has to be written here, and the `never` makes the compiler ask for it.
const DIRECTION_KEY = { DOWN: "weight.direction.down", STEADY: "weight.direction.steady", UP: "weight.direction.up" } as const;

/** "Compared with the start": the same words for both directions, only the sign differs. About the newest COMPLETED week. */
function sinceStartKey(kind: SinceStartKind): "weight.sinceStart.lower" | "weight.sinceStart.same" | "weight.sinceStart.higher" {
  switch (kind) {
    case "LOWER":
      return "weight.sinceStart.lower";
    case "SAME":
      return "weight.sinceStart.same";
    case "HIGHER":
      return "weight.sinceStart.higher";
    default: {
      const unhandled: never = kind;
      return unhandled;
    }
  }
}

/**
 * ONE sentence about where the average is heading. A stale series says only that a little time has passed; four completed
 * weigh-in weeks say a direction; fewer say it is too early. The plateau line (it recommends nothing) comes with the
 * "stayed about where it was" sentence, and only while the goal is not reached: after that, steady is just steady.
 */
function Direction({ trend, goalReached, t }: { trend: WeightTrend; goalReached: boolean; t: Translator }) {
  if (trend.stale) return <p>{t("weight.direction.stale")}</p>;
  if (trend.direction === null) return <p>{t("weight.direction.unknown")}</p>;
  return (
    <>
      <p>{t(DIRECTION_KEY[trend.direction])}</p>
      {trend.plateau && !goalReached ? <p>{t("weight.plateau")}</p> : null}
    </>
  );
}

/** The weekly numbers behind the line, for anyone who wants them and for anyone who cannot see it. */
function Numbers({ trend, locale, t }: { trend: WeightTrend; locale: string; t: Translator }) {
  return (
    <details className={styles.numbers}>
      <summary>{t("weight.numbers.summary")}</summary>
      {trend.baselineKg !== null ? <p>{t("weight.numbers.start", { kg: isolateLtr(formatKg(trend.baselineKg, locale)) })}</p> : null}
      <ul role="list" className={styles.numbersList}>
        {trend.points.map((point) => (
          <li key={point.weekStart}>
            {t("weight.numbers.week", {
              date: formatWeekLabel(point.weekStart, locale),
              kg: isolateLtr(formatKg(point.averageKg, locale)),
            })}
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * The weight card of Progress: an honest sentence for each state of the data, and from two weekly points a line. Weights
 * are never judged: no color, icon or sentence changes with the direction. The numbers are the weekly AVERAGE of what was
 * reported (a daily value is never shown as a result), and "My weights" lists every entry. Pure: no I/O.
 */
export function WeightTrendCard({
  weight,
  goalReached,
  locale,
  t,
}: {
  weight: WeightPart;
  /** The last landmark (the goal) is reached: the plateau line stays silent. */
  goalReached: boolean;
  locale: string;
  /** Scoped to `progress`. */
  t: Translator;
}) {
  let body: ReactNode;
  let withList = false;

  if (weight.kind === "unknown") {
    body = <p>{t("weight.unavailable")}</p>;
  } else {
    const { trend } = weight;
    switch (trend.state) {
      case "NONE":
        body = <p>{t("weight.none")}</p>;
        break;
      case "START_ONLY":
        body = <p>{t("weight.startOnly")}</p>;
        break;
      case "NOT_ENOUGH":
        body = <p>{t("weight.notEnough")}</p>;
        withList = true;
        break;
      case "LINE": {
        const model = buildChartModel({ points: trend.points, baselineKg: trend.baselineKg });
        body = (
          <>
            {model ? (
              <TrendChart
                model={model}
                locale={locale}
                title={t("weight.chart.title")}
                description={t("weight.chart.desc", {
                  from: formatKg(model.summary.fromKg, locale),
                  to: formatKg(model.summary.toKg, locale),
                })}
                startLabel={t("weight.chart.start")}
              />
            ) : null}
            <Direction trend={trend} goalReached={goalReached} t={t} />
            {trend.sinceStart ? (
              <p>{t(sinceStartKey(trend.sinceStart.kind), { kg: isolateLtr(formatKg(trend.sinceStart.kg, locale)) })}</p>
            ) : null}
            <Numbers trend={trend} locale={locale} t={t} />
          </>
        );
        withList = true;
        break;
      }
      default: {
        const unhandled: never = trend.state;
        return unhandled;
      }
    }
  }

  const canReport = WEIGHT_FLOW.reportingEnabled && weight.kind === "ready";
  return (
    <section aria-labelledby={TITLE_ID}>
      <Card>
        <div className={styles.cardBody}>
          <h2 id={TITLE_ID} className={styles.sectionTitle}>
            {t("weight.title")}
          </h2>
          {body}
          {canReport || withList ? (
            <div className={styles.links}>
              {canReport ? (
                <ButtonLink href={WEIGHT_ROUTES.entry} variant="secondary">
                  {t("weight.add")}
                </ButtonLink>
              ) : null}
              {withList ? (
                <ButtonLink href={WEIGHT_ROUTES.list} variant="tertiary">
                  {t("weight.list")}
                </ButtonLink>
              ) : null}
            </div>
          ) : null}
        </div>
      </Card>
    </section>
  );
}

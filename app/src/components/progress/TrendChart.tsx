import { BASELINE_LABEL, CHART, formatKg, formatWeekLabel, type ChartModel } from "@/domain/weight";
import { isolateRtl } from "./isolate";
import styles from "./progress.module.css";

const TITLE_ID = "trend-chart-title";
const DESC_ID = "trend-chart-desc";

/** The gap between the plot and the numbers beside it, in viewBox units. */
const LABEL_GAP = 6;
/** The baseline of the two week labels, near the bottom edge of the viewBox. */
const DATE_LABEL_Y = CHART.height - 10;

/**
 * A Hebrew date label ("4 באוק׳") is a right-to-left run: inside this left-to-right picture the bidi algorithm would put the
 * day on the left of the month, mirrored against every other Hebrew date. An RTL isolate keeps its own order and leaves the
 * text-anchor alone (setting `direction` on the SVG text would swap start and end).
 */
function dateText(label: string, locale: string): string {
  return /^(?:he|ar|fa|ur)(?:-|$)/i.test(locale) ? isolateRtl(label) : label;
}

/**
 * The weekly average as a plain line: inline SVG, no JavaScript, tokens only. The wrapper is `dir="ltr"` in both
 * languages: time runs left to right, and the dates and kilogram values are left-to-right runs, so mirroring the axis in
 * Hebrew would be a surprise. Every series gets the same classes and the same attributes: the geometry (`model`) has no
 * direction in it, and nothing here branches on it, so an increase is never drawn differently from a decrease. The last
 * dot is a little larger, which is a position and not a verdict; it may be the unfinished current week and is drawn
 * exactly like the others. The same numbers are a real list in "Show the numbers", so nothing depends on seeing the line.
 * Pure: no I/O.
 */
export function TrendChart({
  model,
  locale,
  title,
  description,
  startLabel,
}: {
  model: ChartModel;
  locale: string;
  /** The accessible name and description of the picture (`progress.weight.chart.title` and `.desc`). */
  title: string;
  description: string;
  /** The word on the dashed reference line (`progress.weight.chart.start`). */
  startLabel: string;
}) {
  const plotStart = CHART.left;
  const plotEnd = CHART.width - CHART.right;
  const axisY = CHART.height - CHART.bottom;

  return (
    <div className={styles.chart} dir="ltr">
      <svg
        className={styles.chartSvg}
        viewBox={`0 0 ${model.width} ${model.height}`}
        role="img"
        aria-labelledby={`${TITLE_ID} ${DESC_ID}`}
      >
        <title id={TITLE_ID}>{title}</title>
        <desc id={DESC_ID}>{description}</desc>

        <line className={styles.axis} x1={plotStart} y1={axisY} x2={plotEnd} y2={axisY} />
        {model.baseline ? (
          <>
            <line className={styles.baseline} x1={plotStart} y1={model.baseline.y} x2={plotEnd} y2={model.baseline.y} />
          </>
        ) : null}

        <path className={styles.line} d={model.path} />
        {model.dots.map((dot) => (
          <circle key={dot.weekStart} className={styles.dot} cx={dot.x} cy={dot.y} r={dot.isLast ? 4.5 : 3} />
        ))}

        {/* After the line and the dots, so its halo masks them where they pass behind the word; above the dashed line unless the series is there (the model decides, from positions only). */}
        {model.baseline ? (
          <text
            className={styles.baselineLabel}
            x={plotEnd}
            y={model.baseline.y + (model.baseline.labelBelow ? BASELINE_LABEL.belowOffset : BASELINE_LABEL.aboveOffset)}
            textAnchor="end"
          >
            {startLabel}
          </text>
        ) : null}

        {model.yLabels.map((label) => (
          <text key={label.y} className={styles.axisLabel} x={plotStart - LABEL_GAP} y={label.y} textAnchor="end">
            {formatKg(label.kg, locale)}
          </text>
        ))}
        {model.xLabels.map((label) => (
          <text key={label.weekStart} className={styles.dateLabel} x={label.x} y={DATE_LABEL_Y} textAnchor={label.anchor}>
            {dateText(formatWeekLabel(label.weekStart, locale), locale)}
          </text>
        ))}
      </svg>
    </div>
  );
}

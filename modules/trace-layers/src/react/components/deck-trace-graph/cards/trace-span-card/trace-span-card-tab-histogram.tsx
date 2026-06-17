import {MouseEvent, useEffect, useRef, useState} from 'react';

import {formatTimeMs} from '../../../../../trace/index';
import {formatRelativeTraceTimeLabel} from '../trace-span-card-helpers';
import {
  TRACE_BLOCK_CARD_HISTOGRAM_BAR_MAX_HEIGHT,
  TRACE_BLOCK_CARD_HISTOGRAM_BASELINE_Y,
  TRACE_BLOCK_CARD_HISTOGRAM_BIN_WIDTH
} from './trace-span-card-types';

import type {TraceSpanHistogramDistribution, TraceSpanHistogramSpec} from './trace-span-card-types';

/**
 * Props for the top-level histogram tab wrapper.
 */
export type TraceSpanHistogramsTabProps = {
  /** Whether the histogram tab should render interactive controls. */
  interactive?: boolean;
  /** Histogram variants available for the current trace block. */
  histograms: TraceSpanHistogramSpec[];
};

/**
 * Re-export the histogram spec builder for the public TraceSpanCard entrypoint.
 */
export {getTraceSpanHistogramSpecs};

/**
 * Render the top-level histogram tab, including metric switching.
 */
export function TraceSpanHistogramsTab(props: TraceSpanHistogramsTabProps) {
  const [selectedHistogramId, setSelectedHistogramId] = useState(props.histograms[0]?.id ?? '');

  useEffect(() => {
    setSelectedHistogramId(currentId =>
      props.histograms.some(histogram => histogram.id === currentId)
        ? currentId
        : (props.histograms[0]?.id ?? '')
    );
  }, [props.histograms]);

  const selectedHistogram =
    props.histograms.find(histogram => histogram.id === selectedHistogramId) ?? props.histograms[0];
  if (!selectedHistogram) {
    return null;
  }

  return (
    <div className="h-full overflow-y-auto pr-1">
      <TraceSpanHistogramChart
        histogram={selectedHistogram}
        histogramOptions={props.histograms}
        interactive={props.interactive}
        onHistogramChange={setSelectedHistogramId}
      />
    </div>
  );
}

/**
 * Props for the inner histogram chart renderer.
 */
type TraceSpanHistogramChartProps = {
  /** Currently selected histogram metric to render. */
  histogram: TraceSpanHistogramSpec;
  /** All histogram metrics that can be selected for the same block. */
  histogramOptions: TraceSpanHistogramSpec[];
  /** Whether picker, hover, and keyboard interactions should stay enabled. */
  interactive?: boolean;
  /** Callback fired when the selected histogram metric changes. */
  onHistogramChange: (histogramId: string) => void;
};

/**
 * Hover tooltip state for one histogram bar inside the trace-span card.
 */
type TraceSpanHistogramBarTooltip = {
  /** Human-readable process count for the hovered bar. */
  countLabel: string;
  /** Human-readable bucket range for the hovered bar. */
  rangeLabel: string;
  /** X offset inside the tooltip container. */
  x: number;
  /** Y offset inside the tooltip container. */
  y: number;
};

/**
 * Render the interactive histogram chart and its hover/focus tooltip.
 */
function TraceSpanHistogramChart(props: TraceSpanHistogramChartProps) {
  const {histogram, histogramOptions, interactive, onHistogramChange} = props;
  const tooltipContainerRef = useRef<HTMLDivElement | null>(null);
  const [hoveredBarTooltip, setHoveredBarTooltip] = useState<TraceSpanHistogramBarTooltip | null>(
    null
  );
  const [isLogScale, setIsLogScale] = useState(false);
  const svgWidth = Math.max(1, histogram.buckets.length * TRACE_BLOCK_CARD_HISTOGRAM_BIN_WIDTH);
  // Embedded and pinned cards reuse this tab in read-only mode, so keep the metric picker hidden
  // unless the parent surface explicitly opts into interactive controls.
  const showHistogramPicker = Boolean(interactive) && histogramOptions.length > 1;
  const showScaleToggle = Boolean(interactive);
  const histogramViewBoxHeight = TRACE_BLOCK_CARD_HISTOGRAM_BASELINE_Y + 1;
  const countAxis = getHistogramCountAxis(histogram.maxCount);
  const axisTickPositions = countAxis.ticks.map(({value}) => {
    const ratio = getHistogramCountScaleRatio({
      count: value,
      maxCount: countAxis.maxValue,
      isLogScale
    });
    return {
      value,
      ratio,
      percent:
        ((TRACE_BLOCK_CARD_HISTOGRAM_BASELINE_Y -
          ratio * TRACE_BLOCK_CARD_HISTOGRAM_BAR_MAX_HEIGHT) /
          histogramViewBoxHeight) *
        100
    };
  });
  const valueTickRatios = getHistogramValueTickRatios();
  const valueTickLabels = valueTickRatios.map(ratio => ({
    ratio,
    label: formatHistogramAxisValueLabel(histogram, getHistogramValueAtRatio(histogram, ratio))
  }));

  const updateHoveredBarTooltip = (
    clientX: number,
    clientY: number,
    countLabel: string,
    rangeLabel: string
  ) => {
    const tooltipContainerBounds = tooltipContainerRef.current?.getBoundingClientRect();
    if (!tooltipContainerBounds) {
      return;
    }
    setHoveredBarTooltip({
      countLabel,
      rangeLabel,
      x: clientX - tooltipContainerBounds.left,
      y: clientY - tooltipContainerBounds.top
    });
  };

  const handleHistogramMouseMove = (event: MouseEvent<SVGSVGElement>) => {
    const target = event.target;
    if (!(target instanceof SVGRectElement)) {
      return;
    }
    const countLabel = target.dataset.countLabel;
    const rangeLabel = target.dataset.rangeLabel;
    if (!countLabel || !rangeLabel) {
      return;
    }
    updateHoveredBarTooltip(event.clientX, event.clientY, countLabel, rangeLabel);
  };

  return (
    <div className="rounded border border-white/10 bg-slate-900/70 px-2 py-1.5">
      <div className="mb-1 flex items-center justify-between gap-2">
        {showHistogramPicker ? (
          <label className="relative">
            <span className="sr-only">Histogram metric</span>
            <select
              aria-label="Histogram metric"
              className="rounded border border-white/10 bg-slate-950/70 px-2 py-1 text-[9px] uppercase tracking-[0.04em] text-muted-foreground outline-none hover:border-white/20 focus:border-blue-300/50"
              value={histogram.id}
              onChange={event => onHistogramChange(event.target.value)}
            >
              {histogramOptions.map(option => (
                <option key={option.id} value={option.id}>
                  {option.title}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="text-[9px] uppercase tracking-[0.04em] text-muted-foreground">
            {histogram.title}
          </span>
        )}
        <div className="flex items-center gap-1">
          <span className="text-[9px] text-muted-foreground">
            {histogram.totalCount.toLocaleString()} Process
            {histogram.totalCount === 1 ? '' : 'es'}
          </span>
          {showScaleToggle && (
            <button
              type="button"
              className={`rounded border px-1.5 py-0.5 text-[9px] hover:border-white/20 hover:text-white ${
                isLogScale
                  ? 'border-blue-300/60 bg-blue-500/15 text-blue-200'
                  : 'border-white/10 text-muted-foreground'
              }`}
              onClick={() => setIsLogScale(current => !current)}
              aria-pressed={isLogScale}
              title={isLogScale ? 'Log scale enabled' : 'Log scale disabled'}
            >
              {isLogScale ? 'Log Scale' : 'Linear Scale'}
            </button>
          )}
        </div>
      </div>
      <div className="flex items-stretch gap-1">
        <div className="relative h-14 w-6 shrink-0 text-[8px] text-muted-foreground tabular-nums leading-none">
          {axisTickPositions.map(tick => (
            <span
              key={`count-tick-${tick.value}`}
              className="absolute right-0 -translate-y-1/2"
              style={{top: `${tick.percent}%`}}
            >
              {tick.value.toLocaleString()}
            </span>
          ))}
        </div>
        <div ref={tooltipContainerRef} className="relative min-w-0 flex-1">
          {interactive && hoveredBarTooltip && (
            <div
              role="tooltip"
              className="pointer-events-none absolute z-10 rounded border border-white/10 bg-slate-950/95 px-2 py-1 text-[9px] text-foreground shadow-lg"
              style={{
                left: hoveredBarTooltip.x,
                top: Math.max(0, hoveredBarTooltip.y - 6),
                transform: 'translate(-50%, -100%)'
              }}
            >
              <div>{hoveredBarTooltip.countLabel}</div>
              <div className="text-muted-foreground">{hoveredBarTooltip.rangeLabel}</div>
            </div>
          )}
          <svg
            className="h-14 w-full"
            viewBox={`0 0 ${svgWidth} ${TRACE_BLOCK_CARD_HISTOGRAM_BASELINE_Y + 1}`}
            preserveAspectRatio="none"
            aria-label={histogram.ariaLabel}
            onMouseMove={interactive ? handleHistogramMouseMove : undefined}
            onMouseLeave={interactive ? () => setHoveredBarTooltip(null) : undefined}
          >
            {axisTickPositions.map(tick => {
              const y =
                TRACE_BLOCK_CARD_HISTOGRAM_BASELINE_Y -
                tick.ratio * TRACE_BLOCK_CARD_HISTOGRAM_BAR_MAX_HEIGHT;
              return (
                <line
                  key={`gridline-${tick.value}`}
                  x1={0}
                  y1={y}
                  x2={svgWidth}
                  y2={y}
                  stroke={tick.value === 0 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.08)'}
                  strokeWidth={1}
                />
              );
            })}
            <line
              x1={0}
              y1={0}
              x2={0}
              y2={TRACE_BLOCK_CARD_HISTOGRAM_BASELINE_Y}
              stroke="rgba(255,255,255,0.2)"
              strokeWidth={1}
            />
            {valueTickRatios.map(ratio => {
              const x = ratio * svgWidth;
              return (
                <line
                  key={`value-tick-${ratio}`}
                  x1={x}
                  y1={TRACE_BLOCK_CARD_HISTOGRAM_BASELINE_Y}
                  x2={x}
                  y2={TRACE_BLOCK_CARD_HISTOGRAM_BASELINE_Y + 2}
                  stroke="rgba(255,255,255,0.25)"
                  strokeWidth={1}
                />
              );
            })}
            {histogram.buckets.map((count, index) => {
              const barHeight =
                countAxis.maxValue > 0
                  ? getHistogramCountScaleRatio({
                      count,
                      maxCount: countAxis.maxValue,
                      isLogScale
                    }) * TRACE_BLOCK_CARD_HISTOGRAM_BAR_MAX_HEIGHT
                  : 0;
              const [binStartMs, binEndMs] = getHistogramBinRange({histogram, index});
              const countLabel = `${count.toLocaleString()} process${count === 1 ? '' : 'es'}`;
              const rangeLabel = `${histogram.formatValueLabel(binStartMs)} - ${histogram.formatValueLabel(binEndMs)}`;
              const barTooltip = `${countLabel}\n${rangeLabel}`;
              return (
                <g key={`${histogram.id}-bin-${index}`}>
                  <title>{barTooltip}</title>
                  <rect
                    data-histogram-bar="true"
                    x={index * TRACE_BLOCK_CARD_HISTOGRAM_BIN_WIDTH + 0.5}
                    y={TRACE_BLOCK_CARD_HISTOGRAM_BASELINE_Y - barHeight}
                    width={TRACE_BLOCK_CARD_HISTOGRAM_BIN_WIDTH - 1}
                    height={barHeight}
                    rx={0.4}
                    fill="rgba(96,165,250,0.9)"
                    pointerEvents="none"
                  />
                </g>
              );
            })}
            {interactive &&
              histogram.buckets.map((count, index) => {
                const [binStartMs, binEndMs] = getHistogramBinRange({histogram, index});
                const countLabel = `${count.toLocaleString()} process${count === 1 ? '' : 'es'}`;
                const rangeLabel = `${histogram.formatValueLabel(binStartMs)} - ${histogram.formatValueLabel(binEndMs)}`;
                const tooltipX =
                  index * TRACE_BLOCK_CARD_HISTOGRAM_BIN_WIDTH +
                  TRACE_BLOCK_CARD_HISTOGRAM_BIN_WIDTH / 2;
                const tooltipY =
                  TRACE_BLOCK_CARD_HISTOGRAM_BASELINE_Y -
                  getHistogramCountScaleRatio({
                    count,
                    maxCount: countAxis.maxValue,
                    isLogScale
                  }) *
                    TRACE_BLOCK_CARD_HISTOGRAM_BAR_MAX_HEIGHT;
                return (
                  <rect
                    key={`${histogram.id}-bin-hitbox-${index}`}
                    data-histogram-hitbox="true"
                    x={index * TRACE_BLOCK_CARD_HISTOGRAM_BIN_WIDTH}
                    y={0}
                    width={TRACE_BLOCK_CARD_HISTOGRAM_BIN_WIDTH}
                    height={TRACE_BLOCK_CARD_HISTOGRAM_BASELINE_Y}
                    fill="transparent"
                    data-count-label={countLabel}
                    data-range-label={rangeLabel}
                    pointerEvents="all"
                    tabIndex={0}
                    onFocus={() =>
                      setHoveredBarTooltip({
                        countLabel,
                        rangeLabel,
                        x: tooltipX,
                        y: tooltipY
                      })
                    }
                    onBlur={() => setHoveredBarTooltip(null)}
                  />
                );
              })}
          </svg>
          <div className="relative mt-1 h-4 text-[9px] text-foreground">
            {valueTickLabels.map(tick => (
              <span
                key={`value-tick-label-${tick.ratio}`}
                className={`absolute top-0 -translate-x-1/2 whitespace-nowrap ${
                  tick.ratio === 0 ? 'left-0 translate-x-0 text-left' : ''
                } ${tick.ratio === 1 ? 'right-0 translate-x-0 text-right' : ''}`}
                style={
                  tick.ratio > 0 && tick.ratio < 1 ? {left: `${tick.ratio * 100}%`} : undefined
                }
                title={tick.label}
              >
                {tick.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Return the normalized Y-axis ratio for a histogram count in the selected scale.
 */
function getHistogramCountScaleRatio(params: {
  /** Count to project onto the histogram Y axis. */
  count: number;
  /** Axis maximum used to normalize the histogram Y position. */
  maxCount: number;
  /** Whether the histogram should use a logarithmic Y-axis projection. */
  isLogScale: boolean;
}): number {
  if (params.maxCount <= 0 || params.count <= 0) {
    return 0;
  }

  if (params.isLogScale) {
    return Math.log1p(params.count) / Math.log1p(params.maxCount);
  }

  return params.count / params.maxCount;
}

/**
 * Round an approximate histogram count step up to a human-friendly integer step.
 */
function getNiceIntegerTickStep(roughStep: number): number {
  if (!Number.isFinite(roughStep) || roughStep <= 0) {
    return 1;
  }

  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  if (normalized <= 1) {
    return magnitude;
  }
  if (normalized <= 2) {
    return 2 * magnitude;
  }
  if (normalized <= 5) {
    return 5 * magnitude;
  }
  return 10 * magnitude;
}

/**
 * Build the Y-axis scale and count ticks for a histogram.
 */
function getHistogramCountAxis(maxCount: number): {
  maxValue: number;
  ticks: Array<{value: number; ratio: number}>;
} {
  if (maxCount <= 0) {
    return {
      maxValue: 0,
      ticks: [{value: 0, ratio: 0}]
    };
  }

  if (maxCount <= 6) {
    return {
      maxValue: maxCount,
      ticks: Array.from({length: maxCount + 1}, (_, index) => {
        const value = maxCount - index;
        return {
          value,
          ratio: maxCount > 0 ? value / maxCount : 0
        };
      })
    };
  }

  const targetTickCount = 5;
  const step = getNiceIntegerTickStep(maxCount / (targetTickCount - 1));
  const maxValue = Math.max(step, Math.ceil(maxCount / step) * step);
  const ticks = Array.from({length: Math.floor(maxValue / step) + 1}, (_, index) => {
    const value = maxValue - index * step;
    return {
      value,
      ratio: maxValue > 0 ? value / maxValue : 0
    };
  });

  return {
    maxValue,
    ticks
  };
}

/**
 * Return the fixed X-axis tick positions used for the histogram value axis.
 */
function getHistogramValueTickRatios(): number[] {
  return [0, 0.25, 0.5, 0.75, 1];
}

/**
 * Interpolate a histogram domain value at a ratio across the range.
 */
function getHistogramValueAtRatio(histogram: TraceSpanHistogramSpec, ratio: number): number {
  return histogram.lowerBoundMs + (histogram.upperBoundMs - histogram.lowerBoundMs) * ratio;
}

/**
 * Return the bucket range for a histogram bar.
 */
function getHistogramBinRange(params: {
  histogram: TraceSpanHistogramSpec;
  index: number;
}): [number, number] {
  const {histogram, index} = params;
  const bucketCount = Math.max(1, histogram.buckets.length);
  const binStartRatio = index / bucketCount;
  const binEndRatio = (index + 1) / bucketCount;
  return [
    getHistogramValueAtRatio(histogram, binStartRatio),
    getHistogramValueAtRatio(histogram, binEndRatio)
  ];
}

/**
 * Format a duration histogram bound using the standard compact duration formatter.
 */
function formatHistogramDurationLabel(timeMs: number): string {
  return formatTimeMs(timeMs, {space: false, roundDigits: 3});
}

/**
 * Format a histogram axis label using a range-aware representation for completion times.
 */
function formatHistogramAxisValueLabel(histogram: TraceSpanHistogramSpec, valueMs: number): string {
  if (histogram.id !== 'completion') {
    return histogram.formatValueLabel(valueMs);
  }

  const displayValueMs = histogram.getDisplayValueMs(valueMs);
  const displayLowerMs = histogram.getDisplayValueMs(histogram.lowerBoundMs);
  const displayUpperMs = histogram.getDisplayValueMs(histogram.upperBoundMs);
  const displayRangeMs = Math.max(0, displayUpperMs - displayLowerMs);
  const maxDisplayAbsMs = Math.max(Math.abs(displayLowerMs), Math.abs(displayUpperMs));

  if (maxDisplayAbsMs < 1) {
    return formatFixedTimeUnitWithDecimals(displayValueMs, 0.001, 'µs', 3);
  }
  if (maxDisplayAbsMs < 1000) {
    return formatFixedTimeUnitWithDecimals(displayValueMs, 1, 'ms', 3);
  }
  if (maxDisplayAbsMs < 3_600_000 || displayRangeMs < 60_000) {
    return formatFixedTimeUnitWithDecimals(displayValueMs, 1000, 's', 3);
  }
  return histogram.formatValueLabel(valueMs);
}

/**
 * Build all histogram specs supported by the aggregated span userData payload.
 */
function getTraceSpanHistogramSpecs(
  userData: Record<string, unknown>,
  traceStartTimeMs: number
): TraceSpanHistogramSpec[] {
  const aggregates = userData['aggregates'];
  if (!isRecord(aggregates)) {
    return [];
  }

  const durationDistribution = parseHistogramDistribution(aggregates['duration_distribution_us']);
  const completionDistribution = parseHistogramDistribution(
    aggregates['completion_distribution_us']
  );

  return [
    durationDistribution
      ? createHistogramSpec({
          id: 'duration',
          title: 'Duration',
          ariaLabel: 'Duration histogram',
          distribution: durationDistribution,
          getDisplayValueMs: valueMs => valueMs,
          formatValueLabel: formatHistogramDurationLabel
        })
      : null,
    completionDistribution
      ? createHistogramSpec({
          id: 'completion',
          title: 'Completion',
          ariaLabel: 'Completion histogram',
          distribution: completionDistribution,
          getDisplayValueMs: valueMs => Math.max(0, valueMs - traceStartTimeMs),
          formatValueLabel: valueMs => formatHistogramRelativeTimeLabel(valueMs, traceStartTimeMs)
        })
      : null
  ].filter((spec): spec is TraceSpanHistogramSpec => spec !== null);
}

/**
 * Narrow an unknown value to a plain object record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Parse a histogram distribution payload from aggregate span userData.
 */
function parseHistogramDistribution(value: unknown): TraceSpanHistogramDistribution | null {
  if (!isRecord(value)) {
    return null;
  }

  const lowerBoundUs = value['lower_bound'];
  const upperBoundUs = value['upper_bound'];
  const rawBuckets = value['buckets'];
  if (
    typeof lowerBoundUs !== 'number' ||
    !Number.isFinite(lowerBoundUs) ||
    typeof upperBoundUs !== 'number' ||
    !Number.isFinite(upperBoundUs) ||
    !Array.isArray(rawBuckets)
  ) {
    return null;
  }

  const buckets = rawBuckets.map(bucket =>
    typeof bucket === 'number' && Number.isFinite(bucket) ? Math.max(0, bucket) : 0
  );
  if (buckets.length === 0) {
    return null;
  }

  return {
    lowerBoundUs,
    upperBoundUs,
    buckets
  };
}

/**
 * Format a completion histogram bound as a trace-relative time label.
 */
function formatHistogramRelativeTimeLabel(timeMs: number, traceStartTimeMs: number): string {
  return formatRelativeTraceTimeLabel(timeMs, traceStartTimeMs);
}

/**
 * Build a normalized histogram spec from a parsed distribution payload.
 */
function createHistogramSpec(params: {
  id: string;
  title: string;
  ariaLabel: string;
  distribution: TraceSpanHistogramDistribution;
  getDisplayValueMs: (valueMs: number) => number;
  formatValueLabel: (valueMs: number) => string;
}): TraceSpanHistogramSpec {
  const lowerBoundMs = params.distribution.lowerBoundUs / 1000;
  const upperBoundMs = params.distribution.upperBoundUs / 1000;
  const totalCount = params.distribution.buckets.reduce((sum, bucket) => sum + bucket, 0);
  const maxCount = params.distribution.buckets.reduce(
    (currentMax, bucket) => Math.max(currentMax, bucket),
    0
  );

  return {
    id: params.id,
    title: params.title,
    ariaLabel: params.ariaLabel,
    buckets: params.distribution.buckets,
    lowerBoundMs,
    upperBoundMs,
    lowerBoundLabel: params.formatValueLabel(lowerBoundMs),
    upperBoundLabel: params.formatValueLabel(upperBoundMs),
    totalCount,
    maxCount,
    getDisplayValueMs: params.getDisplayValueMs,
    formatValueLabel: params.formatValueLabel
  };
}

/**
 * Format a millisecond value in a fixed unit with caller-controlled precision.
 */
function formatFixedTimeUnitWithDecimals(
  value: number,
  unitMs: number,
  suffix: string,
  decimals: number
): string {
  return `${parseFloat((value / unitMs).toFixed(decimals)).toString()}${suffix}`;
}

// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {CompositeLayer} from '@deck.gl/core';
import {LineLayer, TextLayer} from '@deck.gl/layers';

import {formatTimeMs} from '../utils/format-utils';
import {
  formatDuration,
  formatTimestamp,
  getPrettyTicks,
  getTickStep,
  getZoomedRange
} from '../utils/tick-utils';

import type {
  CompositeLayerProps,
  DefaultProps,
  Layer,
  UpdateParameters,
  Viewport
} from '@deck.gl/core';
import type {TextLayerProps} from '@deck.gl/layers';
import type {Tick, TimeRange} from '../utils/tick-utils';

type TimeAxisColor = [number, number, number, number];
type TimeAxisMode = 'timestamp' | 'duration';
type TimeAxisUnit = 'timestamp' | 'milliseconds' | 'ms' | 's';

/** Runtime values available while formatting one time-axis tick. */
export type TimeAxisTickFormatterContext = {
  /** Ticks currently rendered by the layer. */
  ticks: Tick[];
  /** Major tick step in milliseconds. */
  step: number;
  /** Visible world-space x range. */
  visibleRange: TimeRange;
  /** Covered world-space x range used for generated ticks. */
  coveredRange: TimeRange;
};

/**
 * Formats one time-axis tick label.
 * @param tick - Tick being formatted.
 * @param context - Current generated tick context.
 * @returns Tick label text, or `undefined` to use the default formatter.
 */
export type TimeAxisTickFormatter = (
  tick: Tick,
  context: TimeAxisTickFormatterContext
) => string | undefined;

/** Properties supported by {@link TimeAxisLayer}. */
export type TimeAxisLayerProps = CompositeLayerProps &
  Pick<TextLayerProps, 'characterSet' | 'fontFamily' | 'fontSettings' | 'fontWeight'> & {
    /**
     * Render time as an absolute Unix timestamp or a relative duration.
     * Legacy `unit: 'timestamp' | 'milliseconds'` callers can omit this prop.
     * @defaultValue 'timestamp' for legacy callers, 'duration' for adaptive duration callers.
     */
    mode?: TimeAxisMode;
    /**
     * Time represented by one world-space x unit.
     * Legacy callers may use `'timestamp'` or `'milliseconds'`.
     * @defaultValue 'timestamp' for legacy callers, 'ms' for adaptive callers.
     */
    unit?: TimeAxisUnit;
    /** Do not show ticks at x smaller than this value. @defaultValue -Infinity */
    minX?: number;
    /** Do not show ticks at x larger than this value. @defaultValue Infinity */
    maxX?: number;
    /** Draw grid lines from this y coordinate. @defaultValue 0 for adaptive axes. */
    minY?: number;
    /** Draw grid lines to this y coordinate. @defaultValue 10 for adaptive axes. */
    maxY?: number;
    /**
     * Start time at x=0 for adaptive axes, or the legacy axis range start when `endTimeMs` is set.
     * @defaultValue 0
     */
    startTimeMs?: number;
    /** Legacy axis range end in milliseconds. @defaultValue 100 */
    endTimeMs?: number;
    /** Number of major tick marks across every 1000px for adaptive axes. @defaultValue 5 */
    tickCount?: number;
    /** Density of minor tick marks between major marks. Set to 0 to disable. @defaultValue 3 */
    minorTickCount?: number;
    /** RGBA color for tick labels. @defaultValue [0, 0, 0, 255] */
    textColor?: TimeAxisColor;
    /** RGBA color for grid lines. @defaultValue [0, 0, 0, 255] */
    gridColor?: TimeAxisColor;
    /** Generate additional ticks beyond the visible area. 1 is equivalent to 100vw. @defaultValue 1 */
    coverage?: number;
    /** Display the horizontal axis line. @defaultValue true */
    axisLine?: boolean;
    /** Display tick labels. @defaultValue true */
    tickLabels?: boolean;
    /** Tick font size. @defaultValue 12 */
    fontSize?: number;
    /** Y coordinate used to render tick labels. @defaultValue 0 for adaptive axes. */
    labelY?: number;
    /** Custom tick formatter. Return undefined to fall back to the default label. */
    formatTick?: TimeAxisTickFormatter;
    /** Hours offset applied to timestamps before formatting. @defaultValue 0 */
    timeZoneOffsetHours?: number;
    /** Legacy y coordinate for the axis line. @defaultValue 0 */
    y?: number;
    /** Legacy RGBA color for axis lines and labels. @defaultValue [0, 0, 0, 255] */
    color?: TimeAxisColor;
    /** Legacy viewport bounds override. */
    bounds?: [number, number, number, number];
  };

type TimeAxisState = {
  ticks: Tick[];
  step: number;
  viewportWidth: number;
  visibleRange: TimeRange;
  coveredRange: TimeRange;
};

type NormalizedTimeAxisProps = {
  legacyRange: boolean;
  mode: TimeAxisMode;
  xScale: number;
  offsetMs: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  axisY: number;
  labelY: number;
  tickCount: number;
  minorTickCount: number;
  coverage: number;
  axisLine: boolean;
  tickLabels: boolean;
  textColor: TimeAxisColor;
  gridColor: TimeAxisColor;
  fontSize: number;
};

const DEFAULT_COLOR: TimeAxisColor = [0, 0, 0, 255];
const SINGLE_DATUM = [0] as const;
const EMPTY_RANGE: TimeRange = [0, 0];

/** Renders legacy fixed-range and adaptive timestamp or duration ticks. */
export class TimeAxisLayer extends CompositeLayer<TimeAxisLayerProps> {
  static override layerName = 'TimeAxisLayer';
  static override defaultProps: DefaultProps<TimeAxisLayerProps> = {
    startTimeMs: 0,
    endTimeMs: 100,
    tickCount: 5,
    y: 0,
    color: {type: 'color', value: DEFAULT_COLOR}
  };

  override state: TimeAxisState = {
    ticks: [],
    step: 0,
    viewportWidth: 0,
    visibleRange: EMPTY_RANGE,
    coveredRange: EMPTY_RANGE
  };

  override shouldUpdateState(params: UpdateParameters<TimeAxisLayer>): boolean {
    return params.changeFlags.viewportChanged || super.shouldUpdateState(params);
  }

  override updateState(params: UpdateParameters<TimeAxisLayer>): void {
    const configuration = getNormalizedTimeAxisProps(this.props);
    const viewport = this.context.viewport;
    const visibleRange = getVisibleRange(this.props, configuration, viewport);
    if (!visibleRange) {
      this.setEmptyState(viewport.width);
      super.updateState(params);
      return;
    }

    const targetTickCount = configuration.legacyRange
      ? configuration.tickCount
      : (configuration.tickCount / 1000) * viewport.width;
    const newStep = getTickStep(
      (visibleRange[1] - visibleRange[0]) * configuration.xScale,
      targetTickCount
    );
    const {coveredRange, step, viewportWidth} = this.state;
    const shouldUpdateTicks =
      params.changeFlags.propsChanged ||
      params.changeFlags.viewportChanged ||
      viewportWidth !== viewport.width ||
      step !== newStep ||
      !coveredRange ||
      visibleRange[0] < coveredRange[0] ||
      visibleRange[1] > coveredRange[1];

    if (shouldUpdateTicks) {
      const nextCoveredRange = getCoveredRange(configuration, viewport, visibleRange);
      if (!nextCoveredRange) {
        this.setState({
          ticks: [],
          step: newStep,
          viewportWidth: viewport.width,
          visibleRange,
          coveredRange: EMPTY_RANGE
        });
        super.updateState(params);
        return;
      }

      const ticks = getPrettyTicks(
        configuration.mode,
        nextCoveredRange[0] * configuration.xScale + configuration.offsetMs,
        nextCoveredRange[1] * configuration.xScale + configuration.offsetMs,
        newStep,
        configuration.minorTickCount
      );
      for (const tick of ticks) {
        tick.x = (tick.x - configuration.offsetMs) / configuration.xScale;
      }

      this.setState({
        ticks: ticks.filter(tick => tick.x >= configuration.minX && tick.x <= configuration.maxX),
        step: newStep,
        viewportWidth: viewport.width,
        visibleRange,
        coveredRange: nextCoveredRange
      });
    } else if (!rangesEqual(this.state.visibleRange, visibleRange)) {
      this.setState({visibleRange});
    }

    super.updateState(params);
  }

  override renderLayers(): (Layer | false)[] {
    const {ticks, coveredRange} = this.state;
    const configuration = getNormalizedTimeAxisProps(this.props);
    const lineStart =
      configuration.legacyRange || !Number.isFinite(configuration.minX)
        ? coveredRange[0]
        : configuration.minX;
    const lineEnd =
      configuration.legacyRange || !Number.isFinite(configuration.maxX)
        ? coveredRange[1]
        : configuration.maxX;
    const minorTextColor = withHalfAlpha(configuration.textColor);
    const minorGridColor = withHalfAlpha(configuration.gridColor);

    return [
      configuration.axisLine &&
        new LineLayer(
          this.getSubLayerProps({
            id: 'axis-line',
            data: SINGLE_DATUM,
            getSourcePosition: () => [lineStart, configuration.axisY],
            getTargetPosition: () => [lineEnd, configuration.axisY],
            getColor: configuration.gridColor,
            getWidth: configuration.legacyRange ? 2 : 1,
            updateTriggers: {
              getSourcePosition: [lineStart, configuration.axisY],
              getTargetPosition: [lineEnd, configuration.axisY]
            }
          })
        ),
      configuration.maxY > configuration.minY &&
        new LineLayer<Tick>(
          this.getSubLayerProps({
            id: 'tick-marks',
            data: ticks,
            getSourcePosition: tick => [tick.x, configuration.minY],
            getTargetPosition: tick => [tick.x, configuration.maxY],
            getColor: tick => (tick.type === 'major' ? configuration.gridColor : minorGridColor),
            getWidth: 1
          })
        ),
      configuration.tickLabels &&
        new TextLayer<Tick>(
          this.getSubLayerProps({
            id: 'tick-labels',
            data: ticks,
            getPosition: tick => [tick.x, configuration.labelY],
            getText: tick => this.formatTime(tick, configuration),
            getSize: configuration.fontSize,
            getColor: tick => (tick.type === 'major' ? configuration.textColor : minorTextColor),
            getTextAnchor: configuration.legacyRange ? 'middle' : 'start',
            getAlignmentBaseline: configuration.legacyRange ? 'top' : 'bottom',
            ...(this.props.characterSet === undefined
              ? {}
              : {characterSet: this.props.characterSet}),
            ...(this.props.fontFamily === undefined ? {} : {fontFamily: this.props.fontFamily}),
            ...(this.props.fontSettings === undefined
              ? {}
              : {fontSettings: this.props.fontSettings}),
            ...(this.props.fontWeight === undefined ? {} : {fontWeight: this.props.fontWeight}),
            updateTriggers: {
              getText: [this.props.formatTick, configuration.mode, configuration.legacyRange]
            }
          })
        )
    ];
  }

  private formatTime(tick: Tick, configuration: NormalizedTimeAxisProps): string {
    const label = this.props.formatTick?.(tick, this.state);
    if (label !== undefined) {
      return label;
    }

    if (tick.type === 'minor') {
      return configuration.legacyRange ? '' : formatDuration(tick.value - tick.stepStart, 'short');
    }
    if (configuration.legacyRange) {
      return configuration.mode === 'timestamp'
        ? new Date(tick.value).toLocaleTimeString()
        : formatTimeMs(tick.value, false);
    }
    return configuration.mode === 'timestamp'
      ? formatTimestamp(tick.value)
      : formatDuration(tick.value, 'long');
  }

  private setEmptyState(viewportWidth: number): void {
    this.setState({
      ticks: [],
      step: 0,
      viewportWidth,
      visibleRange: EMPTY_RANGE,
      coveredRange: EMPTY_RANGE
    });
  }
}

function getNormalizedTimeAxisProps(props: TimeAxisLayerProps): NormalizedTimeAxisProps {
  const legacyRange =
    props.mode === undefined &&
    (props.unit === undefined || props.unit === 'timestamp' || props.unit === 'milliseconds');
  const mode =
    props.mode ??
    (props.unit === 'timestamp' || props.unit === undefined ? 'timestamp' : 'duration');
  const xScale = props.unit === 's' ? 1000 : 1;
  const color = props.color ?? DEFAULT_COLOR;
  const axisY = props.y ?? 0;
  const minX = legacyRange ? (props.startTimeMs ?? 0) : (props.minX ?? -Infinity);
  const maxX = legacyRange ? (props.endTimeMs ?? 100) : (props.maxX ?? Infinity);
  const startTimeMs = props.startTimeMs ?? 0;

  return {
    legacyRange,
    mode,
    xScale,
    offsetMs: legacyRange
      ? 0
      : startTimeMs + (mode === 'timestamp' ? (props.timeZoneOffsetHours ?? 0) : 0) * 3_600_000,
    minX,
    maxX,
    minY: props.minY ?? (legacyRange ? axisY - 5 : 0),
    maxY: props.maxY ?? (legacyRange ? axisY + 5 : 10),
    axisY,
    labelY: props.labelY ?? (legacyRange ? axisY - 10 : axisY),
    tickCount: props.tickCount ?? 5,
    minorTickCount: props.minorTickCount ?? (legacyRange ? 0 : 3),
    coverage: props.coverage ?? 1,
    axisLine: props.axisLine ?? true,
    tickLabels: props.tickLabels ?? true,
    textColor: props.textColor ?? color,
    gridColor: props.gridColor ?? color,
    fontSize: props.fontSize ?? 12
  };
}

function getVisibleRange(
  props: TimeAxisLayerProps,
  configuration: NormalizedTimeAxisProps,
  viewport: Viewport
): TimeRange | null {
  if (configuration.legacyRange) {
    const bounds = props.bounds ?? getViewportBounds(viewport);
    if (!bounds) {
      return null;
    }
    return validateRange(getZoomedRange(configuration.minX, configuration.maxX, bounds));
  }
  return getZoomedRange(viewport, 1, configuration.minX, configuration.maxX);
}

function getCoveredRange(
  configuration: NormalizedTimeAxisProps,
  viewport: Viewport,
  visibleRange: TimeRange
): TimeRange | null {
  if (configuration.legacyRange) {
    return visibleRange;
  }
  return getZoomedRange(viewport, configuration.coverage, configuration.minX, configuration.maxX);
}

function getViewportBounds(viewport: Viewport): [number, number, number, number] | null {
  let bounds: unknown;
  try {
    bounds = viewport.getBounds();
  } catch {
    return null;
  }

  if (!Array.isArray(bounds) || bounds.length < 4) {
    return null;
  }
  const [minX, minY, maxX, maxY] = bounds;
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
    return null;
  }
  return [minX, minY, maxX, maxY];
}

function validateRange(range: TimeRange): TimeRange | null {
  return range[1] > range[0] ? range : null;
}

function rangesEqual(left: TimeRange, right: TimeRange): boolean {
  return left[0] === right[0] && left[1] === right[1];
}

function withHalfAlpha(color: TimeAxisColor): TimeAxisColor {
  return [color[0], color[1], color[2], (color[3] ?? 255) / 2];
}

import {CompositeLayer, CompositeLayerProps, DefaultProps, UpdateParameters} from '@deck.gl/core';
import {LineLayer, TextLayer} from '@deck.gl/layers';

import {
  formatDuration,
  formatTimestamp,
  getPrettyTicks,
  getTickStep,
  getZoomedRange,
  Tick
} from '../utils/tick-utils';

import type {Layer} from '@deck.gl/core';
import type {TextLayerProps} from '@deck.gl/layers';

export type TimeAxisTickFormatter = (
  tick: Tick,
  context: {
    ticks: Tick[];
    step: number;
    visibleRange: [start: number, end: number];
    coveredRange: [start: number, end: number];
  }
) => string | undefined;

export type TimeAxisLayerProps = CompositeLayerProps &
  Pick<TextLayerProps, 'characterSet' | 'fontFamily' | 'fontSettings' | 'fontWeight'> & {
    /** Render time as absolute (unix timestamp since epoch) or relative (time span since start)
     * @default duration
     */
    mode: 'timestamp' | 'duration';
    /** Length of time over 1 world unit on the x axis
     * @default ms
     */
    unit: 's' | 'ms';
    /** Do not show ticks at x smaller than this value. */
    minX?: number;
    /** Do not show ticks at x larger than this value. */
    maxX?: number;
    /** Draw grid line from this Y-coordinate */
    minY?: number;
    /** Draw grid line to this Y-coordinate */
    maxY?: number;
    /** Start time at x=0.
     * In timestamp mode, this represents the unix timestamp at x=0.
     * In duration mode, this represents the offset at x=0.
     * @default 0
     */
    startTimeMs?: number;
    /** Number of major tick marks across every 1000px of viewport width.
     * @default 5
     */
    tickCount?: number;
    /** Density of minor tick marks between two major marks. Set to 0 to disable.
     * @default 2
     */
    minorTickCount?: number;
    /** RGBA color for tick labeld
     * @default [0,0,0,255]
     */
    textColor?: [number, number, number, number];

    /** RGBA color for grid lines
     * @default [0,0,0,255]
     */
    gridColor?: [number, number, number, number];
    /** Generate additional ticks to cover beyond the visible area.
     * Bigger value renders more ticks but updates less frequently.
     * 1 is equivalent to 100vw. */
    coverage?: number;

    /** Display horizontal axis line.
     * @default true
     */
    axisLine?: boolean;

    /** Display tick labels.
     * @default true
     */
    tickLabels?: boolean;
    /** Tick font size */
    fontSize?: number;
    /** Y-coordinate to render the tick labels at
     * @default 0
     */
    labelY?: number;
    /** Custom tick formatter.
     * If a string is returned, it is displayed as the tick label.
     * If an empty string is returned, the tick label is hidden.
     * If undefined if returned, fallback to the default label.
     */
    formatTick?: TimeAxisTickFormatter;
    /** Hours offset applied to timestamps before formatting */
    timeZoneOffsetHours?: number;
  };

const SINGLE_DATUM = [0] as const;
const EMPTY_RANGE: [start: number, end: number] = [0, 0];

export class TimeAxisLayer extends CompositeLayer<Required<TimeAxisLayerProps>> {
  static override layerName = 'TimeAxisLayer';
  static override defaultProps: DefaultProps<TimeAxisLayerProps> = {
    startTimeMs: 0,
    tickCount: 5,
    minorTickCount: 3,
    coverage: 1,
    minY: 0,
    maxY: 10,
    axisLine: true,
    tickLabels: true,
    labelY: 0,
    textColor: {type: 'color', value: [0, 0, 0, 255]},
    gridColor: {type: 'color', value: [0, 0, 0, 255]},
    mode: 'duration',
    unit: 'ms',
    timeZoneOffsetHours: 0,
    fontSize: 12,
    characterSet: TextLayer.defaultProps.characterSet,
    fontFamily: TextLayer.defaultProps.fontFamily,
    fontSettings: TextLayer.defaultProps.fontSettings,
    fontWeight: TextLayer.defaultProps.fontWeight
  };

  declare state: {
    ticks: Tick[];
    step: number;
    viewportWidth: number;
    visibleRange: [start: number, end: number];
    coveredRange: [start: number, end: number];
  };

  // Called whenever props/data/viewports change
  override shouldUpdateState(params: UpdateParameters<TimeAxisLayer>): boolean {
    return params.changeFlags.viewportChanged || super.shouldUpdateState(params);
  }

  override updateState(params: UpdateParameters<TimeAxisLayer>) {
    const {step, coveredRange, viewportWidth} = this.state;
    const {props, oldProps} = params;
    const {
      startTimeMs,
      mode,
      unit,
      timeZoneOffsetHours,
      minX = -Infinity,
      maxX = Infinity,
      minorTickCount,
      tickCount,
      coverage
    } = props;
    const viewport = this.context.viewport;
    const xScale = unit === 's' ? 1000 : 1;
    const visibleRange = getZoomedRange(viewport, 1);
    if (!visibleRange) {
      this.setState({
        ticks: [],
        step: 0,
        viewportWidth: viewport.width,
        visibleRange: EMPTY_RANGE,
        coveredRange: EMPTY_RANGE
      });
      super.updateState(params);
      return;
    }
    const newStep = getTickStep(
      (visibleRange[1] - visibleRange[0]) * xScale,
      (tickCount / 1000) * viewport.width
    );

    const shouldUpdateTicks =
      startTimeMs !== oldProps.startTimeMs ||
      timeZoneOffsetHours !== oldProps.timeZoneOffsetHours ||
      unit !== oldProps.unit ||
      minX !== oldProps.minX ||
      maxX !== oldProps.maxX ||
      tickCount !== oldProps.tickCount ||
      minorTickCount !== oldProps.minorTickCount ||
      viewportWidth !== viewport.width ||
      step !== newStep ||
      !coveredRange ||
      Math.max(minX, visibleRange[0]) < coveredRange[0] ||
      Math.min(maxX, visibleRange[1]) > coveredRange[1];

    if (shouldUpdateTicks) {
      // Calculate the visible time range based on the viewport bounds
      const coveredRange = getZoomedRange(viewport, coverage, minX, maxX);
      if (!coveredRange) {
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
      const offsetMs =
        startTimeMs + (mode === 'timestamp' ? timeZoneOffsetHours : 0) * 60 * 60 * 1000;
      const ticks = getPrettyTicks(
        mode,
        coveredRange[0] * xScale + offsetMs,
        coveredRange[1] * xScale + offsetMs,
        newStep,
        minorTickCount
      );
      for (const t of ticks) {
        t.x = (t.x - offsetMs) / xScale;
      }

      // Generate tick positions
      this.setState({
        ticks: ticks.filter(t => t.x >= minX && t.x <= maxX),
        step: newStep,
        viewportWidth: viewport.width,
        visibleRange,
        coveredRange
      });
    }

    super.updateState(params);
  }

  formatTime(tick: Tick) {
    const {formatTick, mode} = this.props;
    if (formatTick) {
      const label = formatTick(tick, this.state);
      if (label !== undefined) return label;
    }

    if (tick.type === 'major') {
      return mode === 'timestamp'
        ? formatTimestamp(tick.value)
        : formatDuration(tick.value, 'long');
    }
    return formatDuration(tick.value - tick.stepStart, 'short');
  }

  override renderLayers(): (Layer | false)[] {
    const {ticks, coveredRange} = this.state;
    const {
      minY,
      maxY,
      minX,
      maxX,
      axisLine,
      tickLabels,
      labelY,
      textColor,
      gridColor,
      characterSet,
      fontFamily,
      fontSize,
      fontSettings,
      fontWeight
    } = this.props;

    const minorTextColor = [textColor[0], textColor[1], textColor[2], (textColor[3] ?? 255) / 2];
    const minorGridColor = [gridColor[0], gridColor[1], gridColor[2], (gridColor[3] ?? 255) / 2];

    return [
      // Axis line
      axisLine &&
        new LineLayer(
          this.getSubLayerProps({
            id: 'axis-line',
            data: SINGLE_DATUM,
            getSourcePosition: () => [minX ?? coveredRange[0], 0],
            getTargetPosition: () => [maxX ?? coveredRange[1], 0],
            getColor: gridColor,
            getWidth: 1,
            updateTriggers: {
              getSourcePosition: [minX ?? coveredRange[0]],
              getTargetPosition: [maxX ?? coveredRange[1]]
            }
          })
        ),
      // Tick marks
      maxY > minY &&
        new LineLayer<Tick>(
          this.getSubLayerProps({
            id: 'tick-marks',
            data: ticks,
            getSourcePosition: (t: Tick) => [t.x, minY],
            getTargetPosition: (t: Tick) => [t.x, maxY],
            getColor: (t: Tick) => (t.type === 'major' ? gridColor : minorGridColor),
            getWidth: 1
          })
        ),
      // Tick labels
      tickLabels &&
        new TextLayer<Tick>(
          this.getSubLayerProps({
            id: 'tick-labels',
            data: ticks,
            getPosition: (t: Tick) => [t.x, labelY],
            getText: (t: Tick) => this.formatTime(t),
            getSize: fontSize,
            getColor: (t: Tick) => (t.type === 'major' ? textColor : minorTextColor),
            getTextAnchor: 'start',
            getAlignmentBaseline: 'bottom',
            characterSet,
            fontFamily,
            fontSettings,
            fontWeight,
            updateTriggers: {
              getText: [this.props.formatTick]
            }
          })
        )
    ];
  }
}

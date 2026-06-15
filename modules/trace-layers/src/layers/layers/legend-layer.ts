import {CompositeLayer} from '@deck.gl/core';
import {TextLayer} from '@deck.gl/layers';

import {
  DEFAULT_TRACE_FONT_FAMILY,
  getLayoutDensityPreset,
  getTraceLayoutProcessLayoutByRef,
  TRACE_COLOR,
  TraceLayout
} from '../../trace/index';
import {
  combineBounds,
  expandBounds,
  getProcessLayoutBounds,
  getStreamLayoutBounds,
  getTextLabelBounds
} from './layer-bounds-utils';

import type {
  ProcessRef,
  ThreadLayout,
  ThreadRef,
  TraceThread,
  TraceThreadId,
  TraceVisSettings
} from '../../trace/index';
import type {GetPickingInfoParams, LayerProps, PickingInfo} from '@deck.gl/core';

const MAX_NAME_LENGTH = 40;
const LEGEND_RANK_LABEL_SIZE = 14 / 8;
const LEGEND_RANK_LABEL_MAX_WIDTH = 48;
const LEGEND_RANK_LABEL_BACKGROUND_PADDING = [6, 4] as const;
const LEGEND_NODE_NAME_SIZE = 8;
const LEGEND_NODE_NAME_MAX_WIDTH = 24;
const LEGEND_NODE_NAME_BACKGROUND_PADDING = [4, 2] as const;
const LEGEND_STREAM_LABEL_GAP_PX = 8;

const truncateName = (value: string, maxLength: number = MAX_NAME_LENGTH) => {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
};

export type TraceLegendLayerProps = LayerProps & {
  threads: readonly TraceThread[];
  traceLayout: Readonly<TraceLayout>;
  settings: TraceVisSettings;
  rankIndex: number;
  /** Exact graph-local process ref owning this legend row. */
  rankProcessRef: ProcessRef;
  rankLabel?: string;
  nodeNameLabel?: string;
  /** Exact graph-local thread refs aligned with `threads`. */
  threadRefs: readonly ThreadRef[];
  /** Callback fired when a stream label should toggle lane collapse. */
  onToggleStream?: (threadId: TraceThreadId, stream: TraceThread, threadRef: ThreadRef) => void;
  isCollapsed?: boolean;
  /** CSS font stack used by legend text labels. */
  fontFamily?: string;
};

type StreamLabelDatum = {
  /** Trace thread represented by this label. */
  stream: TraceThread;
  /** Exact graph-local thread ref represented by this label. */
  threadRef: ThreadRef;
  /** Display label rendered for the trace thread. */
  label: string;
  /** Trace-space X coordinate for the label. */
  x: number;
  /** Trace-space Z coordinate for the label. */
  z: number;
  /** Trace-space Y coordinate for the label. */
  yOffset: number;
  /** Whether this stream has multiple lanes and can be toggled. */
  hasLanes: boolean;
  /** Whether the stream is currently visible. */
  visible: boolean;
};

export class TraceLegendLayer extends CompositeLayer<TraceLegendLayerProps> {
  static layerName = 'TraceLegendLayer';
  static defaultProps: Required<Omit<TraceLegendLayerProps, keyof LayerProps>> = {
    threads: [],
    traceLayout: undefined!,
    settings: undefined!,
    rankIndex: undefined!,
    rankProcessRef: undefined!,
    rankLabel: undefined!,
    nodeNameLabel: undefined!,
    threadRefs: [],
    isCollapsed: false,
    onToggleStream: undefined!,
    fontFamily: DEFAULT_TRACE_FONT_FAMILY
  };

  override getBounds() {
    const {traceLayout, threads, rankProcessRef, rankLabel, nodeNameLabel} = this.props;
    const rankLayout = getTraceLayoutProcessLayoutByRef(traceLayout, rankProcessRef);
    const threadLayouts = threads
      .map((_, streamIndex) => this.getStreamLayoutForStream(streamIndex))
      .filter((layout): layout is ThreadLayout => Boolean(layout));
    const nodeNameBounds =
      nodeNameLabel && rankLayout?.startPosition
        ? getTextLabelBounds({
            x: rankLayout.startPosition[0],
            y: rankLayout.labelY ?? 0,
            text: nodeNameLabel,
            textAnchor: 'end',
            size: LEGEND_NODE_NAME_SIZE,
            maxWidth: LEGEND_NODE_NAME_MAX_WIDTH,
            pixelOffset: [-LEGEND_NODE_NAME_BACKGROUND_PADDING[0], 2],
            backgroundPadding: LEGEND_NODE_NAME_BACKGROUND_PADDING
          })
        : null;
    const rankLabelBounds =
      rankLabel && rankLayout?.startPosition
        ? getTextLabelBounds({
            x: rankLayout.startPosition[0],
            y: rankLayout.labelY ?? 0,
            text: rankLabel,
            textAnchor: 'start',
            size: LEGEND_RANK_LABEL_SIZE,
            maxWidth: LEGEND_RANK_LABEL_MAX_WIDTH,
            pixelOffset: [LEGEND_RANK_LABEL_BACKGROUND_PADDING[0], 3],
            backgroundPadding: LEGEND_RANK_LABEL_BACKGROUND_PADDING
          })
        : null;

    return expandBounds(
      combineBounds([
        getStreamLayoutBounds(threadLayouts),
        getProcessLayoutBounds(rankLayout),
        nodeNameBounds,
        rankLabelBounds
      ])
    );
  }

  // Make sure the layer's click fires
  getPickingInfo({info, sourceLayer}: GetPickingInfoParams): PickingInfo {
    info.layer = sourceLayer;
    return info;
  }

  private getStreamLayoutForStream(streamIndex: number): ThreadLayout | null {
    const {traceLayout, rankProcessRef} = this.props;
    const threadRef = this.props.threadRefs[streamIndex];
    if (threadRef == null) {
      return null;
    }
    return (
      traceLayout.threadLayoutMapByRef.get(threadRef) ??
      getTraceLayoutProcessLayoutByRef(traceLayout, rankProcessRef)?.threadLayouts?.[streamIndex] ??
      null
    );
  }

  private getStreamLabelData(threads: readonly TraceThread[]): StreamLabelDatum[] {
    return threads
      .map((stream, streamIndex) => {
        const layout = this.getStreamLayoutForStream(streamIndex);
        if (!layout) {
          return null;
        }
        const hasLanes = Boolean(layout.lanes && layout.lanes.laneCount > 1);
        const laneIndicator = layout.lanes?.isCollapsed ? '-' : '+';
        const label = hasLanes
          ? `${truncateName(stream.name)} ${laneIndicator}`
          : truncateName(stream.name);
        const startX = layout.startPosition?.[0] ?? 0;
        const startZ = layout.startPosition?.[2] ?? 0;
        const laneYPositions = layout.lanes?.laneYPositions;
        const yOffset =
          laneYPositions && laneYPositions.length > 0
            ? getMinimumLaneYPosition(laneYPositions)
            : Number.isFinite(layout.yPosition)
              ? layout.yPosition
              : 0;
        const threadRef = layout.threadRef ?? this.props.threadRefs[streamIndex];
        if (threadRef == null) {
          return null;
        }
        return {
          stream,
          threadRef,
          label,
          x: startX,
          z: startZ,
          yOffset,
          hasLanes,
          visible: layout.visible
        } satisfies StreamLabelDatum;
      })
      .filter((datum): datum is StreamLabelDatum => Boolean(datum));
  }

  renderLayers() {
    const {threads, rankIndex, isCollapsed, fontFamily} = this.props;

    const layoutDensity = getLayoutDensityPreset(this.props.settings.layoutDensity);

    // Text labels for threads
    const streamLabelSize = layoutDensity.streamLabelFontSize;
    const streamLabelLayer = new TextLayer<StreamLabelDatum, {rankIndex: number}>(
      this.getSubLayerProps({
        id: `legend-stream-names`,
        visible: !isCollapsed
      }),
      {
        data: this.getStreamLabelData(threads),
        getPosition: (item: StreamLabelDatum) => [item.x, item.yOffset, item.z],
        getPixelOffset: [-LEGEND_STREAM_LABEL_GAP_PX, 0],
        getText: (item: StreamLabelDatum) => (item.visible ? item.label : ''),
        getTextAnchor: 'end',
        getAlignmentBaseline: 'center',
        getColor: TRACE_COLOR.THREAD_TEXT,
        getSize: streamLabelSize / 16, // Starts shrinking at zoom <= 4
        sizeUnits: 'common',
        sizeMaxPixels: streamLabelSize,
        wordBreak: 'break-word',
        maxWidth: 300,
        fontFamily,
        fontWeight: 500,
        pickable: Boolean(this.props.onToggleStream),
        parameters: {blend: true, depthWriteEnabled: false, depthCompare: 'always'},
        rankIndex,
        onClick: (info: PickingInfo<StreamLabelDatum>) => {
          const selected = info.object;
          if (!selected || !this.props.onToggleStream || !selected.hasLanes) {
            return;
          }
          this.props.onToggleStream(selected.stream.threadId, selected.stream, selected.threadRef);
        }
      }
    );

    return [streamLabelLayer];
  }
}

function getMinimumLaneYPosition(laneYPositions: readonly number[]): number {
  let minimumYPosition = laneYPositions[0] ?? 0;
  for (let index = 1; index < laneYPositions.length; index++) {
    const laneYPosition = laneYPositions[index]!;
    if (laneYPosition < minimumYPosition) {
      minimumYPosition = laneYPosition;
    }
  }
  return minimumYPosition;
}

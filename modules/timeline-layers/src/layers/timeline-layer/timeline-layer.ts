// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {CompositeLayer, COORDINATE_SYSTEM, type PickingInfo, type Layer} from '@deck.gl/core';
import {SolidPolygonLayer, LineLayer, TextLayer} from '@deck.gl/layers';
import type {CompositeLayerProps} from '@deck.gl/core';
import type {LineLayerProps, SolidPolygonLayerProps, TextLayerProps} from '@deck.gl/layers';

import type {
  TimelineClipInfo,
  TimelineTrackInfo,
  TimelineTrack,
  TrackWithSubtracks,
  TrackPosition,
  TrackBackgroundData,
  TrackLabelData,
  ClipPolygonData,
  ClipLabelData,
  SeparatorLineData,
  AxisLineData,
  AxisLabelData,
  ScrubberLineData,
  ScrubberHandleData,
  ScrubberLabelData,
  TimeAxisLabelFormatter
} from './timeline-types';

import type {SelectionStyle} from './timeline-layout';

import {
  timeAxisFormatters,
  generateTimelineTicks,
  timeToPosition,
  positionToTime
} from './timeline-utils';
import {assignClipsToSubtracks, calculateSubtrackCount} from './timeline-collision';

function lightenColor(
  color: [number, number, number, number],
  amount: number = 30
): [number, number, number, number] {
  return [
    Math.min(255, color[0] + amount),
    Math.min(255, color[1] + amount),
    Math.min(255, color[2] + amount),
    color[3]
  ];
}

const defaultProps = {
  x: 150,
  y: 100,
  width: 800,
  trackHeight: 40,
  trackSpacing: 10,
  currentTimeMs: 0,
  showScrubber: true,
  showClipLabels: true,
  showTrackLabels: true,
  showAxis: true,
  showSubtrackSeparators: true,
  timeFormatter: timeAxisFormatters.seconds,
  selectionStyle: {
    selectedClipColor: [255, 200, 0, 255] as [number, number, number, number],
    hoveredClipColor: [200, 200, 200, 255] as [number, number, number, number],
    selectedTrackColor: [80, 80, 80, 255] as [number, number, number, number],
    hoveredTrackColor: [70, 70, 70, 255] as [number, number, number, number],
    selectedLineWidth: 3,
    hoveredLineWidth: 2
  }
};

export type TimelineLayerProps = CompositeLayerProps & {
  /** Array of timeline tracks, each containing clips */
  data: TimelineTrack[];
  /** Start of the full timeline range in milliseconds */
  timelineStart: number;
  /** End of the full timeline range in milliseconds */
  timelineEnd: number;

  /** X offset of the timeline in canvas coordinates */
  x?: number;
  /** Y offset of the timeline in canvas coordinates */
  y?: number;
  /** Width of the timeline in canvas coordinates */
  width?: number;
  /** Height of each track row in canvas coordinates */
  trackHeight?: number;
  /** Spacing between tracks in canvas coordinates */
  trackSpacing?: number;

  /** Current playhead time in milliseconds */
  currentTimeMs?: number;
  /** Optional zoomed viewport range */
  viewport?: {startMs?: number; endMs?: number};
  /** Formatter for time axis labels */
  timeFormatter?: TimeAxisLabelFormatter;

  /** ID of the currently selected clip */
  selectedClipId?: string | number | null;
  /** ID of the currently hovered clip */
  hoveredClipId?: string | number | null;
  /** ID of the currently selected track */
  selectedTrackId?: string | number | null;
  /** ID of the currently hovered track */
  hoveredTrackId?: string | number | null;
  /** Colors and line widths for selected/hovered states */
  selectionStyle?: SelectionStyle;

  /** Whether to show the playhead scrubber */
  showScrubber?: boolean;
  /** Whether to show labels on clips */
  showClipLabels?: boolean;
  /** Whether to show labels on tracks */
  showTrackLabels?: boolean;
  /** Whether to show the time axis */
  showAxis?: boolean;
  /** Whether to show separators between collision subtracks */
  showSubtrackSeparators?: boolean;

  /** Override props for the clip polygon sub-layer */
  clipProps?: Partial<SolidPolygonLayerProps<ClipPolygonData>>;
  /** Override props for the track background sub-layer */
  trackProps?: Partial<SolidPolygonLayerProps<TrackBackgroundData>>;
  /** Override props for the track label sub-layer */
  trackLabelProps?: Partial<TextLayerProps<TrackLabelData>>;
  /** Override props for the clip label sub-layer */
  clipLabelProps?: Partial<TextLayerProps<ClipLabelData>>;
  /** Override props for the axis line sub-layer */
  axisLineProps?: Partial<LineLayerProps<AxisLineData>>;
  /** Override props for the axis label sub-layer */
  axisLabelProps?: Partial<TextLayerProps<AxisLabelData>>;
  /** Override props for the scrubber line sub-layer */
  scrubberLineProps?: Partial<LineLayerProps<ScrubberLineData>>;

  /** Callback when a clip is clicked */
  onClipClick?: (info: TimelineClipInfo, event: PickingInfo) => void;
  /** Callback when a clip is hovered */
  onClipHover?: (info: TimelineClipInfo | null, event: PickingInfo) => void;
  /** Callback when a track is clicked */
  onTrackClick?: (info: TimelineTrackInfo, event: PickingInfo) => void;
  /** Callback when a track is hovered */
  onTrackHover?: (info: TimelineTrackInfo | null, event: PickingInfo) => void;
  /** Callback when the scrubber handle is hovered */
  onScrubberHover?: (isHovering: boolean, event: PickingInfo) => void;
  /** Callback when a scrubber drag begins */
  onScrubberDragStart?: (event: PickingInfo) => void;
  /** Callback when the scrubber is dragged to a new time */
  onScrubberDrag?: (timeMs: number, event: PickingInfo) => void;
  /** Callback when the timeline background is clicked */
  onTimelineClick?: (timeMs: number, event: PickingInfo) => void;

  /** Callback when the current time changes */
  onCurrentTimeChange?: (timeMs: number) => void;
  /** Callback when the viewport (zoom/pan) changes */
  onViewportChange?: (startMs: number, endMs: number) => void;
  /** Callback when the zoom level changes */
  onZoomChange?: (zoomLevel: number) => void;
};

export class TimelineLayer extends CompositeLayer<TimelineLayerProps> {
  static layerName = 'TimelineLayer';
  static defaultProps = defaultProps;

  /** Convert a canvas X coordinate to a time in milliseconds */
  getTimeFromPosition(x: number): number {
    const {timelineStart, timelineEnd, viewport, x: timelineX = 150, width = 800} = this.props;
    const effectiveStartMs = viewport?.startMs ?? timelineStart;
    const effectiveEndMs = viewport?.endMs ?? timelineEnd;
    return positionToTime(x, timelineX, width, effectiveStartMs, effectiveEndMs);
  }

  /** Zoom the timeline viewport around a canvas X coordinate */
  zoomToPoint(zoomFactor: number, mouseX: number, currentZoomLevel: number): void {
    const {
      timelineStart,
      timelineEnd,
      viewport,
      x: timelineX = 150,
      width = 800,
      onViewportChange,
      onZoomChange
    } = this.props;

    const newZoomLevel = Math.max(1.0, Math.min(100, currentZoomLevel * zoomFactor));
    const mouseRatio = Math.max(0, Math.min(1, (mouseX - timelineX) / width));
    const currentStartMs = viewport?.startMs ?? timelineStart;
    const currentEndMs = viewport?.endMs ?? timelineEnd;
    const mouseTimeMs = currentStartMs + mouseRatio * (currentEndMs - currentStartMs);

    const fullTimeRange = timelineEnd - timelineStart;
    const newViewportRange = fullTimeRange / newZoomLevel;

    let newStartMs = mouseTimeMs - mouseRatio * newViewportRange;
    let newEndMs = newStartMs + newViewportRange;

    if (newStartMs < timelineStart) {
      newStartMs = timelineStart;
      newEndMs = timelineStart + newViewportRange;
    } else if (newEndMs > timelineEnd) {
      newEndMs = timelineEnd;
      newStartMs = timelineEnd - newViewportRange;
    }

    if (newZoomLevel > 1.0) {
      onViewportChange?.(newStartMs, newEndMs);
    } else {
      onViewportChange?.(timelineStart, timelineEnd);
    }

    onZoomChange?.(newZoomLevel);
  }

  // ===== LAYOUT CALCULATION =====

  private _calculateTrackPositions(
    tracksWithSubtracks: TrackWithSubtracks[],
    y: number,
    trackHeight: number,
    trackSpacing: number
  ): {trackPositions: TrackPosition[]; totalTimelineHeight: number} {
    let currentY = y;
    const trackPositions: TrackPosition[] = [];
    const subtrackSpacing = 2;

    for (const {subtrackCount} of tracksWithSubtracks) {
      const trackTotalHeight = subtrackCount * trackHeight + (subtrackCount - 1) * subtrackSpacing;
      trackPositions.push({y: currentY, height: trackTotalHeight, subtrackCount});
      currentY += trackTotalHeight + trackSpacing;
    }

    const totalTimelineHeight = currentY - y - trackSpacing;
    return {trackPositions, totalTimelineHeight};
  }

  // ===== DATA GENERATION =====

  private _generateTrackBackgrounds(
    tracksWithSubtracks: TrackWithSubtracks[],
    trackPositions: TrackPosition[]
  ): TrackBackgroundData[] {
    const {
      x = 150,
      width = 800,
      selectedTrackId,
      hoveredTrackId,
      selectionStyle = defaultProps.selectionStyle
    } = this.props;

    return tracksWithSubtracks.map(({track, trackIndex}, i) => {
      const {y: trackY, height} = trackPositions[i];
      const isSelected = selectedTrackId === track.id;
      const isHovered = hoveredTrackId === track.id;

      let color: [number, number, number, number] = [60, 60, 60, 255];
      if (isSelected) {
        color = selectionStyle.selectedTrackColor!;
      } else if (isHovered) {
        color = lightenColor([60, 60, 60, 255], 20);
      }

      return {
        id: `track-bg-${track.id}`,
        track,
        trackIndex,
        polygon: [
          [x, trackY],
          [x + width, trackY],
          [x + width, trackY + height],
          [x, trackY + height]
        ],
        color
      };
    });
  }

  private _generateTrackLabels(
    tracksWithSubtracks: TrackWithSubtracks[],
    trackPositions: TrackPosition[]
  ): TrackLabelData[] {
    const {x = 150, showTrackLabels = true} = this.props;
    if (!showTrackLabels) return [];

    return tracksWithSubtracks.map(({track}, i) => {
      const label = track.name || `Track ${track.id}`;
      const {y: trackY, height} = trackPositions[i];
      return {text: label, position: [x - 10, trackY + height / 2, 0]};
    });
  }

  private _buildClipPolygon(
    clip: ReturnType<typeof assignClipsToSubtracks>[number],
    opts: {
      track: TimelineTrack;
      trackIndex: number;
      clipIndex: number;
      subtrackHeight: number;
      baseTrackY: number;
      x: number;
      width: number;
      effectiveStartMs: number;
      effectiveEndMs: number;
      selectedClipId: string | number | null | undefined;
      hoveredClipId: string | number | null | undefined;
      selectionStyle: SelectionStyle;
    }
  ): ClipPolygonData | null {
    const {id: clipId, startMs, endMs, subtrackIndex = 0} = clip;
    const {
      track,
      trackIndex,
      clipIndex,
      subtrackHeight,
      baseTrackY,
      x,
      width,
      effectiveStartMs,
      effectiveEndMs,
      selectedClipId,
      hoveredClipId,
      selectionStyle
    } = opts;

    if (endMs <= effectiveStartMs || startMs >= effectiveEndMs) return null;

    const clipPadding = 2;
    const subtrackSpacing = 2;
    const clipTrackY = baseTrackY + subtrackIndex * (subtrackHeight + subtrackSpacing);
    const clipStartRatio = (startMs - effectiveStartMs) / (effectiveEndMs - effectiveStartMs);
    const clipEndRatio = (endMs - effectiveStartMs) / (effectiveEndMs - effectiveStartMs);
    const clipStartX = x + Math.max(0, clipStartRatio) * width;
    const clipEndX = x + Math.min(1, clipEndRatio) * width;

    const baseColor = clip.color || ([80, 120, 160, 220] as [number, number, number, number]);
    const isSelected = selectedClipId !== null && String(selectedClipId) === String(clipId);
    const isHovered = hoveredClipId !== null && String(hoveredClipId) === String(clipId);

    let color = baseColor;
    if (isSelected) {
      color = selectionStyle.selectedClipColor!;
    } else if (isHovered) {
      color = lightenColor(baseColor, 40);
    }

    return {
      id: clipId,
      clip,
      track,
      clipIndex,
      trackIndex,
      subtrackIndex,
      polygon: [
        [clipStartX, clipTrackY + clipPadding],
        [clipEndX, clipTrackY + clipPadding],
        [clipEndX, clipTrackY + subtrackHeight - clipPadding],
        [clipStartX, clipTrackY + subtrackHeight - clipPadding]
      ],
      color,
      label: clip.label || '',
      labelPosition: [clipStartX + (clipEndX - clipStartX) / 2, clipTrackY + subtrackHeight / 2, 0]
    };
  }

  private _generateClipPolygons(
    tracksWithSubtracks: TrackWithSubtracks[],
    trackPositions: TrackPosition[],
    effectiveStartMs: number,
    effectiveEndMs: number
  ): ClipPolygonData[] {
    const {
      x = 150,
      width = 800,
      selectedClipId,
      hoveredClipId,
      selectionStyle = defaultProps.selectionStyle
    } = this.props;

    const subtrackSpacing = 2;
    const clipPolygons: ClipPolygonData[] = [];

    for (let i = 0; i < tracksWithSubtracks.length; i++) {
      const {track, trackIndex, clips, subtrackCount} = tracksWithSubtracks[i];
      const {y: baseTrackY, height: trackTotalHeight} = trackPositions[i];
      const subtrackHeight =
        (trackTotalHeight - (subtrackCount - 1) * subtrackSpacing) / subtrackCount;

      for (let clipIndex = 0; clipIndex < clips.length; clipIndex++) {
        const polygon = this._buildClipPolygon(clips[clipIndex], {
          track,
          trackIndex,
          clipIndex,
          subtrackHeight,
          baseTrackY,
          x,
          width,
          effectiveStartMs,
          effectiveEndMs,
          selectedClipId,
          hoveredClipId,
          selectionStyle
        });
        if (polygon) {
          clipPolygons.push(polygon);
        }
      }
    }

    return clipPolygons;
  }

  private _generateSubtrackSeparators(
    tracksWithSubtracks: TrackWithSubtracks[],
    trackPositions: TrackPosition[]
  ): SeparatorLineData[] {
    const {x = 150, width = 800, showSubtrackSeparators = true} = this.props;
    if (!showSubtrackSeparators) return [];

    const subtrackSpacing = 2;
    const separatorLines: SeparatorLineData[] = [];

    for (let i = 0; i < tracksWithSubtracks.length; i++) {
      const {subtrackCount} = tracksWithSubtracks[i];
      if (subtrackCount <= 1) {
        // No separators needed for single-subtrack rows
      } else {
        const {y: baseTrackY, height: trackTotalHeight} = trackPositions[i];
        const subtrackHeight =
          (trackTotalHeight - (subtrackCount - 1) * subtrackSpacing) / subtrackCount;

        for (let j = 1; j < subtrackCount; j++) {
          const separatorY =
            baseTrackY + j * (subtrackHeight + subtrackSpacing) - subtrackSpacing / 2;
          separatorLines.push({
            sourcePosition: [x, separatorY],
            targetPosition: [x + width, separatorY]
          });
        }
      }
    }

    return separatorLines;
  }

  private _generateAxis(
    totalTimelineHeight: number,
    effectiveStartMs: number,
    effectiveEndMs: number
  ): {axisLines: AxisLineData[]; axisLabels: AxisLabelData[]} {
    const {
      x = 150,
      y = 100,
      width = 800,
      showAxis = true,
      timeFormatter = timeAxisFormatters.seconds
    } = this.props;

    const axisLines: AxisLineData[] = [];
    const axisLabels: AxisLabelData[] = [];

    if (!showAxis) return {axisLines, axisLabels};

    const axisHeight = 30;
    const tickCount = Math.max(4, Math.min(10, Math.floor(width / 80)));

    const timelineTicks = generateTimelineTicks({
      startMs: effectiveStartMs,
      endMs: effectiveEndMs,
      timelineX: x,
      timelineWidth: width,
      tickCount,
      formatter: timeFormatter
    });

    const axisY = y + totalTimelineHeight + axisHeight;

    axisLines.push({sourcePosition: [x, axisY], targetPosition: [x + width, axisY]});

    for (const tick of timelineTicks) {
      axisLines.push({
        sourcePosition: [tick.position, axisY - 5],
        targetPosition: [tick.position, axisY + 5]
      });
      axisLabels.push({text: tick.label, position: [tick.position, axisY + 15, 0]});
    }

    return {axisLines, axisLabels};
  }

  private _generateScrubber(
    totalTimelineHeight: number,
    effectiveStartMs: number,
    effectiveEndMs: number
  ): {
    scrubberLine: ScrubberLineData[];
    scrubberHandle: ScrubberHandleData[];
    scrubberLabel: ScrubberLabelData[];
  } {
    const {
      x = 150,
      y = 100,
      width = 800,
      showScrubber = true,
      currentTimeMs = 0,
      timeFormatter = timeAxisFormatters.seconds
    } = this.props;

    if (!showScrubber) return {scrubberLine: [], scrubberHandle: [], scrubberLabel: []};

    const scrubberPosition = timeToPosition(
      currentTimeMs,
      x,
      width,
      effectiveStartMs,
      effectiveEndMs
    );

    const scrubberLine: ScrubberLineData[] = [
      {
        sourcePosition: [scrubberPosition, y - 30],
        targetPosition: [scrubberPosition, y + totalTimelineHeight + 30]
      }
    ];

    const scrubberHandle: ScrubberHandleData[] = [
      {
        id: 'scrubber-handle',
        polygon: [
          [scrubberPosition - 8, y - 35],
          [scrubberPosition + 8, y - 35],
          [scrubberPosition + 8, y - 20],
          [scrubberPosition - 8, y - 20]
        ],
        color: [255, 100, 100, 255]
      }
    ];

    const scrubberLabel: ScrubberLabelData[] = [
      {text: timeFormatter(currentTimeMs), position: [scrubberPosition, y - 40, 0]}
    ];

    return {scrubberLine, scrubberHandle, scrubberLabel};
  }

  // ===== LAYER CREATION =====

  private _createTrackLayers(
    trackBackgrounds: TrackBackgroundData[],
    trackLabels: TrackLabelData[]
  ): Layer[] {
    const {trackProps, showTrackLabels = true, onTrackClick, onTrackHover} = this.props;
    const layers: Layer[] = [];

    layers.push(
      new SolidPolygonLayer(
        this.getSubLayerProps({
          ...trackProps,
          id: 'tracks',
          data: trackBackgrounds,
          getPolygon: (d: TrackBackgroundData) => d.polygon,
          getFillColor: (d: TrackBackgroundData) => d.color,
          stroked: true,
          getLineColor: [100, 100, 100, 255],
          getLineWidth: 1,
          pickable: Boolean(onTrackClick) || Boolean(onTrackHover),
          onClick: (info: PickingInfo) => {
            if (info.object && onTrackClick) {
              const obj = info.object as TrackBackgroundData;
              onTrackClick({track: obj.track, index: obj.trackIndex}, info);
            }
          },
          onHover: (info: PickingInfo) => {
            if (onTrackHover) {
              const obj = info.object as TrackBackgroundData | undefined;
              onTrackHover(obj ? {track: obj.track, index: obj.trackIndex} : null, info);
            }
          }
        })
      )
    );

    if (showTrackLabels) {
      layers.push(
        new TextLayer({
          id: `${this.props.id}-track-labels`,
          data: trackLabels,
          getText: (d: TrackLabelData) => d.text,
          getPosition: (d: TrackLabelData) => d.position,
          getSize: 12,
          getColor: [60, 60, 60, 255],
          getTextAnchor: 'end',
          getAlignmentBaseline: 'center',
          fontFamily: 'Arial, sans-serif',
          fontWeight: 'bold',
          coordinateSystem: COORDINATE_SYSTEM.CARTESIAN
        })
      );
    }

    return layers;
  }

  private _createClipLayers(
    clipPolygons: ClipPolygonData[],
    clipLabelsData: ClipLabelData[]
  ): Layer[] {
    const {
      clipProps,
      showClipLabels = true,
      selectedClipId,
      selectionStyle = defaultProps.selectionStyle,
      onClipClick,
      onClipHover
    } = this.props;
    const layers: Layer[] = [];

    layers.push(
      new SolidPolygonLayer(
        this.getSubLayerProps({
          ...clipProps,
          id: 'clips',
          data: clipPolygons,
          getPolygon: (d: ClipPolygonData) => d.polygon,
          getFillColor: (d: ClipPolygonData) => d.color,
          stroked: true,
          getLineColor: [255, 255, 255, 200],
          getLineWidth: (d: ClipPolygonData) => {
            const isSelected = selectedClipId !== null && String(selectedClipId) === String(d.id);
            return isSelected ? selectionStyle.selectedLineWidth || 3 : 2;
          },
          pickable: Boolean(onClipClick) || Boolean(onClipHover),
          autoHighlight: true,
          onClick: (info: PickingInfo) => {
            if (info.object && onClipClick) {
              const obj = info.object as ClipPolygonData;
              onClipClick(
                {
                  clip: obj.clip,
                  track: obj.track,
                  clipIndex: obj.clipIndex,
                  trackIndex: obj.trackIndex,
                  subtrackIndex: obj.subtrackIndex
                },
                info
              );
            }
          },
          onHover: (info: PickingInfo) => {
            if (onClipHover) {
              const obj = info.object as ClipPolygonData | undefined;
              onClipHover(
                obj
                  ? {
                      clip: obj.clip,
                      track: obj.track,
                      clipIndex: obj.clipIndex,
                      trackIndex: obj.trackIndex,
                      subtrackIndex: obj.subtrackIndex
                    }
                  : null,
                info
              );
            }
          }
        })
      )
    );

    if (showClipLabels) {
      layers.push(
        new TextLayer({
          id: `${this.props.id}-clip-labels`,
          data: clipLabelsData,
          getText: (d: ClipLabelData) => d.text,
          getPosition: (d: ClipLabelData) => d.position,
          getSize: 10,
          getColor: [255, 255, 255, 255],
          getTextAnchor: 'middle',
          getAlignmentBaseline: 'center',
          fontFamily: 'Arial, sans-serif',
          coordinateSystem: COORDINATE_SYSTEM.CARTESIAN
        })
      );
    }

    return layers;
  }

  private _createSubtrackSeparatorLayer(separators: SeparatorLineData[]): Layer | null {
    const {showSubtrackSeparators = true} = this.props;
    if (!showSubtrackSeparators) return null;

    return new LineLayer({
      id: `${this.props.id}-subtrack-separators`,
      data: separators,
      getSourcePosition: (d: SeparatorLineData) => d.sourcePosition,
      getTargetPosition: (d: SeparatorLineData) => d.targetPosition,
      getColor: [180, 180, 180, 128],
      getWidth: 1,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN
    });
  }

  private _createAxisLayers(axisLines: AxisLineData[], axisLabels: AxisLabelData[]): Layer[] {
    const {axisLineProps, axisLabelProps, showAxis = true} = this.props;
    if (!showAxis) return [];

    return [
      new LineLayer(
        this.getSubLayerProps({
          ...axisLineProps,
          id: 'axis-lines',
          data: axisLines,
          getSourcePosition: (d: AxisLineData) => d.sourcePosition,
          getTargetPosition: (d: AxisLineData) => d.targetPosition,
          getColor: [150, 150, 150, 255],
          getWidth: 2
        })
      ),
      new TextLayer(
        this.getSubLayerProps({
          ...axisLabelProps,
          id: 'axis-labels',
          data: axisLabels,
          getText: (d: AxisLabelData) => d.text,
          getPosition: (d: AxisLabelData) => d.position,
          getSize: 11,
          getColor: [150, 150, 150, 255],
          getTextAnchor: 'middle',
          getAlignmentBaseline: 'top'
        })
      )
    ];
  }

  private _createScrubberLayers(
    scrubberLine: ScrubberLineData[],
    scrubberHandle: ScrubberHandleData[],
    scrubberLabel: ScrubberLabelData[]
  ): Layer[] {
    const {
      scrubberLineProps,
      showScrubber = true,
      onScrubberDragStart,
      onScrubberHover
    } = this.props;
    if (!showScrubber) return [];

    return [
      new LineLayer(
        this.getSubLayerProps({
          ...scrubberLineProps,
          id: 'scrubber-line',
          data: scrubberLine,
          getSourcePosition: (d: ScrubberLineData) => d.sourcePosition,
          getTargetPosition: (d: ScrubberLineData) => d.targetPosition,
          getColor: [255, 100, 100, 255],
          getWidth: 2
        })
      ),
      new SolidPolygonLayer(
        this.getSubLayerProps({
          id: 'scrubber-handle',
          data: scrubberHandle,
          getPolygon: (d: ScrubberHandleData) => d.polygon,
          getFillColor: (d: ScrubberHandleData) => d.color,
          stroked: true,
          getLineColor: [255, 255, 255, 255],
          getLineWidth: 2,
          pickable: true,
          onClick: (info: PickingInfo) => {
            if (onScrubberDragStart && info.object) {
              onScrubberDragStart(info);
            }
          },
          onHover: (info: PickingInfo) => {
            if (onScrubberHover) {
              onScrubberHover(Boolean(info.object), info);
            }
          }
        })
      ),
      new TextLayer(
        this.getSubLayerProps({
          id: 'scrubber-label',
          data: scrubberLabel,
          getText: (d: ScrubberLabelData) => d.text,
          getPosition: (d: ScrubberLabelData) => d.position,
          getSize: 11,
          getColor: [255, 100, 100, 255],
          getTextAnchor: 'middle',
          getAlignmentBaseline: 'bottom'
        })
      )
    ];
  }

  // ===== MAIN RENDER =====

  renderLayers(): Layer[] {
    const {
      data: tracks,
      timelineStart,
      timelineEnd,
      viewport,
      y = 100,
      trackHeight = 40,
      trackSpacing = 10
    } = this.props;

    const effectiveStartMs = viewport?.startMs ?? timelineStart;
    const effectiveEndMs = viewport?.endMs ?? timelineEnd;

    const visibleTracks = tracks.filter((track) => track.visible !== false);

    const tracksWithSubtracks: TrackWithSubtracks[] = visibleTracks.map((track, trackIndex) => {
      const clips = track.clips || [];
      const clipsWithSubtracks = assignClipsToSubtracks(clips);
      const subtrackCount = Math.max(1, calculateSubtrackCount(clips));
      return {track, trackIndex, clips: clipsWithSubtracks, subtrackCount};
    });

    const {trackPositions, totalTimelineHeight} = this._calculateTrackPositions(
      tracksWithSubtracks,
      y,
      trackHeight,
      trackSpacing
    );

    const trackBackgrounds = this._generateTrackBackgrounds(tracksWithSubtracks, trackPositions);
    const trackLabels = this._generateTrackLabels(tracksWithSubtracks, trackPositions);
    const clipPolygons = this._generateClipPolygons(
      tracksWithSubtracks,
      trackPositions,
      effectiveStartMs,
      effectiveEndMs
    );
    const clipLabelsData = clipPolygons.map((clip) => ({
      text: clip.label,
      position: clip.labelPosition
    }));
    const subtrackSeparators = this._generateSubtrackSeparators(
      tracksWithSubtracks,
      trackPositions
    );
    const {axisLines, axisLabels} = this._generateAxis(
      totalTimelineHeight,
      effectiveStartMs,
      effectiveEndMs
    );
    const {scrubberLine, scrubberHandle, scrubberLabel} = this._generateScrubber(
      totalTimelineHeight,
      effectiveStartMs,
      effectiveEndMs
    );

    const layers = [
      ...this._createTrackLayers(trackBackgrounds, trackLabels),
      ...this._createClipLayers(clipPolygons, clipLabelsData),
      this._createSubtrackSeparatorLayer(subtrackSeparators),
      ...this._createAxisLayers(axisLines, axisLabels),
      ...this._createScrubberLayers(scrubberLine, scrubberHandle, scrubberLabel)
    ].filter((layer): layer is Layer => layer !== null);

    return layers;
  }
}

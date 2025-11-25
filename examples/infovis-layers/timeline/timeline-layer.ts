// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {CompositeLayer, COORDINATE_SYSTEM, PickingInfo, Layer} from '@deck.gl/core';
import {SolidPolygonLayer, LineLayer, TextLayer} from '@deck.gl/layers';
import {
  type TimelineLayerProps,
  type TimelineClipInfo,
  type TimelineTrackInfo,
  type TrackWithSubtracks,
  type TrackPosition,
  type TrackBackgroundData,
  type TrackLabelData,
  type ClipPolygonData,
  type ClipLabelData,
  type SeparatorLineData,
  type AxisLineData,
  type AxisLabelData,
  type ScrubberLineData,
  type ScrubberHandleData,
  type ScrubberLabelData,
  type SelectionStyle,
  type TimeAxisLabelFormatter
} from './timeline-types';
import {
  timeAxisFormatters,
  generateTimelineTicks,
  timeToPosition,
  positionToTime
} from './timeline-utils';
import {assignClipsToSubtracks, calculateSubtrackCount} from './timeline-collision';

/**
 * Helper function to lighten a color by adding a fixed amount to RGB channels
 */
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

export class TimelineLayer extends CompositeLayer<TimelineLayerProps> {
  static layerName = 'TimelineLayer';
  static defaultProps = defaultProps;

  getTimeFromPosition(x: number): number {
    const {timelineStart, timelineEnd, viewport, x: timelineX = 150, width = 800} = this.props;
    const effectiveStartMs = viewport?.startMs ?? timelineStart;
    const effectiveEndMs = viewport?.endMs ?? timelineEnd;
    return positionToTime(x, timelineX, width, effectiveStartMs, effectiveEndMs);
  }

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

  // ===== CALCULATION HELPERS =====

  private _calculateTrackPositions(
    tracksWithSubtracks: TrackWithSubtracks[],
    y: number,
    trackHeight: number,
    trackSpacing: number
  ): {trackPositions: TrackPosition[]; totalTimelineHeight: number; subtrackSpacing: number} {
    let currentY = y;
    const trackPositions: TrackPosition[] = [];
    const subtrackSpacing = 2;

    tracksWithSubtracks.forEach(({subtrackCount}) => {
      const trackTotalHeight = subtrackCount * trackHeight + (subtrackCount - 1) * subtrackSpacing;
      trackPositions.push({y: currentY, height: trackTotalHeight, subtrackCount});
      currentY += trackTotalHeight + trackSpacing;
    });

    const totalTimelineHeight = currentY - y - trackSpacing;
    return {trackPositions, totalTimelineHeight, subtrackSpacing};
  }

  // ===== DATA GENERATION HELPERS =====

  private _generateTrackBackgrounds(
    tracksWithSubtracks: TrackWithSubtracks[],
    trackPositions: TrackPosition[],
    x: number,
    width: number,
    selectedTrackId: string | number | null | undefined,
    hoveredTrackId: string | number | null | undefined,
    selectionStyle: SelectionStyle
  ): TrackBackgroundData[] {
    return tracksWithSubtracks.map(({track, trackIndex}, i) => {
      const trackId = track.id;
      const {y: trackY, height} = trackPositions[i];
      const isSelected = selectedTrackId === trackId;
      const isHovered = hoveredTrackId === trackId;

      let color: [number, number, number, number] = [60, 60, 60, 255];
      if (isSelected) {
        color = selectionStyle.selectedTrackColor!;
      } else if (isHovered) {
        // Lighten the base color on hover
        color = lightenColor([60, 60, 60, 255], 20);
      }

      return {
        id: `track-bg-${trackId}`,
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
    trackPositions: TrackPosition[],
    x: number,
    showTrackLabels: boolean
  ): TrackLabelData[] {
    if (!showTrackLabels) return [];

    return tracksWithSubtracks.map(({track}, i) => {
      const label = track.name || `Track ${track.id}`;
      const {y: trackY, height} = trackPositions[i];

      return {
        text: label,
        position: [x - 10, trackY + height / 2, 0]
      };
    });
  }

  private _generateClipPolygons(
    tracksWithSubtracks: TrackWithSubtracks[],
    trackPositions: TrackPosition[],
    x: number,
    width: number,
    effectiveStartMs: number,
    effectiveEndMs: number,
    selectedClipId: string | number | null | undefined,
    hoveredClipId: string | number | null | undefined,
    selectionStyle: SelectionStyle
  ): ClipPolygonData[] {
    const clipPolygons: ClipPolygonData[] = [];
    const clipPadding = 2;
    const subtrackSpacing = 2;

    tracksWithSubtracks.forEach(({track, trackIndex, clips, subtrackCount}, i) => {
      const {y: baseTrackY} = trackPositions[i];
      const subtrackHeight =
        (trackPositions[i].height - (subtrackCount - 1) * subtrackSpacing) / subtrackCount;

      clips.forEach((clip, clipIndex) => {
        const {id: clipId, startMs, endMs, subtrackIndex = 0} = clip;

        if (endMs <= effectiveStartMs || startMs >= effectiveEndMs) return;

        const clipTrackY = baseTrackY + subtrackIndex * (subtrackHeight + subtrackSpacing);

        const clipStartRatio = (startMs - effectiveStartMs) / (effectiveEndMs - effectiveStartMs);
        const clipEndRatio = (endMs - effectiveStartMs) / (effectiveEndMs - effectiveStartMs);

        const clipStartX = x + Math.max(0, clipStartRatio) * width;
        const clipEndX = x + Math.min(1, clipEndRatio) * width;

        const baseColor = clip.color || ([80, 120, 160, 220] as [number, number, number, number]);
        const label = clip.label || '';

        const isSelected = selectedClipId !== null && String(selectedClipId) === String(clipId);
        const isHovered = hoveredClipId !== null && String(hoveredClipId) === String(clipId);

        let color = baseColor;
        if (isSelected) {
          color = selectionStyle.selectedClipColor!;
        } else if (isHovered) {
          // Lighten the base color on hover
          color = lightenColor(baseColor, 40);
        }

        clipPolygons.push({
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
          label,
          labelPosition: [
            clipStartX + (clipEndX - clipStartX) / 2,
            clipTrackY + subtrackHeight / 2,
            0
          ]
        });
      });
    });

    return clipPolygons;
  }

  private _generateClipLabels(
    clipPolygons: ClipPolygonData[],
    showClipLabels: boolean
  ): ClipLabelData[] {
    if (!showClipLabels) return [];
    return clipPolygons.map((clip) => ({text: clip.label, position: clip.labelPosition}));
  }

  private _generateSubtrackSeparators(
    showSubtrackSeparators: boolean,
    tracksWithSubtracks: TrackWithSubtracks[],
    trackPositions: TrackPosition[],
    x: number,
    width: number
  ): SeparatorLineData[] {
    if (!showSubtrackSeparators) return [];

    const separatorLines: SeparatorLineData[] = [];
    const subtrackSpacing = 2;

    tracksWithSubtracks.forEach(({subtrackCount}, i) => {
      if (subtrackCount <= 1) return;

      const {y: baseTrackY, height: trackHeight} = trackPositions[i];
      const subtrackHeight = (trackHeight - (subtrackCount - 1) * subtrackSpacing) / subtrackCount;

      for (let j = 1; j < subtrackCount; j++) {
        const separatorY =
          baseTrackY + j * (subtrackHeight + subtrackSpacing) - subtrackSpacing / 2;
        separatorLines.push({
          sourcePosition: [x, separatorY],
          targetPosition: [x + width, separatorY]
        });
      }
    });

    return separatorLines;
  }

  private _generateAxis(
    showAxis: boolean,
    x: number,
    y: number,
    width: number,
    totalTimelineHeight: number,
    effectiveStartMs: number,
    effectiveEndMs: number,
    timeFormatter: TimeAxisLabelFormatter
  ): {axisLines: AxisLineData[]; axisLabels: AxisLabelData[]} {
    const axisLines: AxisLineData[] = [];
    const axisLabels: AxisLabelData[] = [];

    if (!showAxis) return {axisLines, axisLabels};

    const axisHeight = 30;
    const idealTickSpacing = 80;
    const maxTicks = Math.floor(width / idealTickSpacing);
    const tickCount = Math.max(4, Math.min(10, maxTicks));

    const timelineTicks = generateTimelineTicks(
      effectiveStartMs,
      effectiveEndMs,
      x,
      width,
      tickCount,
      timeFormatter
    );

    const axisY = y + totalTimelineHeight + axisHeight;

    axisLines.push({
      sourcePosition: [x, axisY],
      targetPosition: [x + width, axisY]
    });

    for (const tick of timelineTicks) {
      axisLines.push({
        sourcePosition: [tick.position, axisY - 5],
        targetPosition: [tick.position, axisY + 5]
      });
      axisLabels.push({
        text: tick.label,
        position: [tick.position, axisY + 15, 0]
      });
    }

    return {axisLines, axisLabels};
  }

  private _generateScrubber(
    showScrubber: boolean,
    currentTimeMs: number,
    x: number,
    y: number,
    width: number,
    totalTimelineHeight: number,
    effectiveStartMs: number,
    effectiveEndMs: number,
    timeFormatter: TimeAxisLabelFormatter
  ): {
    scrubberLine: ScrubberLineData[];
    scrubberHandle: ScrubberHandleData[];
    scrubberLabel: ScrubberLabelData[];
  } {
    if (!showScrubber) {
      return {scrubberLine: [], scrubberHandle: [], scrubberLabel: []};
    }

    const scrubberPosition = timeToPosition(
      currentTimeMs,
      x,
      width,
      effectiveStartMs,
      effectiveEndMs
    );

    const scrubberLine = [
      {
        sourcePosition: [scrubberPosition, y - 30] as [number, number],
        targetPosition: [scrubberPosition, y + totalTimelineHeight + 30] as [number, number]
      }
    ];

    const scrubberHandle = [
      {
        id: 'scrubber-handle',
        polygon: [
          [scrubberPosition - 8, y - 35],
          [scrubberPosition + 8, y - 35],
          [scrubberPosition + 8, y - 20],
          [scrubberPosition - 8, y - 20]
        ] as [number, number][],
        color: [255, 100, 100, 255] as [number, number, number, number]
      }
    ];

    const scrubberLabel = [
      {
        text: timeFormatter(currentTimeMs),
        position: [scrubberPosition, y - 40, 0] as [number, number, number]
      }
    ];

    return {scrubberLine, scrubberHandle, scrubberLabel};
  }

  // ===== LAYER CREATION METHODS =====

  private _createTrackLayers(
    trackBackgrounds: TrackBackgroundData[],
    trackLabels: TrackLabelData[],
    showTrackLabels: boolean,
    onTrackClick: ((info: TimelineTrackInfo, event: PickingInfo) => void) | undefined,
    onTrackHover: ((info: TimelineTrackInfo | null, event: PickingInfo) => void) | undefined
  ): Layer[] {
    const {trackProps} = this.props;
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
    clipLabelsData: ClipLabelData[],
    showClipLabels: boolean,
    selectedClipId: string | number | null | undefined,
    selectionStyle: SelectionStyle,
    onClipClick: ((info: TimelineClipInfo, event: PickingInfo) => void) | undefined,
    onClipHover: ((info: TimelineClipInfo | null, event: PickingInfo) => void) | undefined
  ): Layer[] {
    const {clipProps} = this.props;
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

  private _createSubtrackSeparatorLayer(
    subtrackSeparators: SeparatorLineData[],
    showSubtrackSeparators: boolean
  ): Layer | null {
    if (!showSubtrackSeparators) return null;

    return new LineLayer({
      id: `${this.props.id}-subtrack-separators`,
      data: subtrackSeparators,
      getSourcePosition: (d: SeparatorLineData) => d.sourcePosition,
      getTargetPosition: (d: SeparatorLineData) => d.targetPosition,
      getColor: [180, 180, 180, 128],
      getWidth: 1,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN
    });
  }

  private _createAxisLayers(
    axisLines: AxisLineData[],
    axisLabels: AxisLabelData[],
    showAxis: boolean
  ): Layer[] {
    if (!showAxis) return [];

    const {axisLineProps, axisLabelProps} = this.props;
    const layers: Layer[] = [];

    layers.push(
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
      )
    );

    layers.push(
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
    );

    return layers;
  }

  private _createScrubberLayers(
    scrubberLine: ScrubberLineData[],
    scrubberHandle: ScrubberHandleData[],
    scrubberLabel: ScrubberLabelData[],
    showScrubber: boolean,
    onScrubberDragStart: ((event: PickingInfo) => void) | undefined,
    onScrubberHover: ((isHovering: boolean, event: PickingInfo) => void) | undefined
  ): Layer[] {
    if (!showScrubber) return [];

    const {scrubberLineProps} = this.props;
    const layers: Layer[] = [];

    layers.push(
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
      )
    );

    layers.push(
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
      )
    );

    layers.push(
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
    );

    return layers;
  }

  // ===== MAIN RENDER METHOD =====

  renderLayers(): Layer[] {
    const {
      data: tracks,
      timelineStart,
      timelineEnd,
      viewport,
      x = 150,
      y = 100,
      width = 800,
      trackHeight = 40,
      trackSpacing = 10,
      currentTimeMs = 0,
      showScrubber = true,
      showClipLabels = true,
      showTrackLabels = true,
      showAxis = true,
      showSubtrackSeparators = true,
      timeFormatter = timeAxisFormatters.seconds,
      selectedClipId,
      hoveredClipId,
      selectedTrackId,
      hoveredTrackId,
      selectionStyle = defaultProps.selectionStyle,
      onClipClick,
      onClipHover,
      onTrackClick,
      onTrackHover,
      onScrubberHover,
      onScrubberDragStart
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

    const trackBackgrounds = this._generateTrackBackgrounds(
      tracksWithSubtracks,
      trackPositions,
      x,
      width,
      selectedTrackId,
      hoveredTrackId,
      selectionStyle
    );

    const trackLabels = this._generateTrackLabels(
      tracksWithSubtracks,
      trackPositions,
      x,
      showTrackLabels
    );

    const clipPolygons = this._generateClipPolygons(
      tracksWithSubtracks,
      trackPositions,
      x,
      width,
      effectiveStartMs,
      effectiveEndMs,
      selectedClipId,
      hoveredClipId,
      selectionStyle
    );

    const clipLabelsData = this._generateClipLabels(clipPolygons, showClipLabels);

    const subtrackSeparators = this._generateSubtrackSeparators(
      showSubtrackSeparators,
      tracksWithSubtracks,
      trackPositions,
      x,
      width
    );

    const {axisLines, axisLabels} = this._generateAxis(
      showAxis,
      x,
      y,
      width,
      totalTimelineHeight,
      effectiveStartMs,
      effectiveEndMs,
      timeFormatter
    );

    const {scrubberLine, scrubberHandle, scrubberLabel} = this._generateScrubber(
      showScrubber,
      currentTimeMs,
      x,
      y,
      width,
      totalTimelineHeight,
      effectiveStartMs,
      effectiveEndMs,
      timeFormatter
    );

    const layers = [
      ...this._createTrackLayers(
        trackBackgrounds,
        trackLabels,
        showTrackLabels,
        onTrackClick,
        onTrackHover
      ),
      ...this._createClipLayers(
        clipPolygons,
        clipLabelsData,
        showClipLabels,
        selectedClipId,
        selectionStyle,
        onClipClick,
        onClipHover
      ),
      this._createSubtrackSeparatorLayer(subtrackSeparators, showSubtrackSeparators),
      ...this._createAxisLayers(axisLines, axisLabels, showAxis),
      ...this._createScrubberLayers(
        scrubberLine,
        scrubberHandle,
        scrubberLabel,
        showScrubber,
        onScrubberDragStart,
        onScrubberHover
      )
    ].filter(Boolean);

    return layers;
  }
}

// Export types for external use
export type {TimelineClipInfo, TimelineTrackInfo} from './timeline-types';
export {timeAxisFormatters} from './timeline-utils';

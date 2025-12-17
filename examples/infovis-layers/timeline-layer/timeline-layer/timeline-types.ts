// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {CompositeLayerProps, PickingInfo} from '@deck.gl/core';
import type {LineLayerProps, SolidPolygonLayerProps, TextLayerProps} from '@deck.gl/layers';

// ===== CORE DATA TYPES =====

export interface TimelineClip {
  id: string | number;
  startMs: number;
  endMs: number;
  color?: [number, number, number, number];
  label?: string;
  subtrackIndex?: number;
  [key: string]: unknown;
}

export interface TimelineTrack {
  id: string | number;
  clips: TimelineClip[];
  visible?: boolean;
  name?: string;
  [key: string]: unknown;
}

// ===== INTERNAL DATA TYPES =====

export interface TrackWithSubtracks {
  track: TimelineTrack;
  trackIndex: number;
  clips: TimelineClip[];
  subtrackCount: number;
}

export interface TrackPosition {
  y: number;
  height: number;
  subtrackCount: number;
}

export interface TrackBackgroundData {
  id: string;
  track: TimelineTrack;
  trackIndex: number;
  polygon: [number, number][];
  color: [number, number, number, number];
}

export interface TrackLabelData {
  text: string;
  position: [number, number, number];
}

export interface ClipPolygonData {
  id: string | number;
  clip: TimelineClip;
  track: TimelineTrack;
  clipIndex: number;
  trackIndex: number;
  subtrackIndex: number;
  polygon: [number, number][];
  color: [number, number, number, number];
  label: string;
  labelPosition: [number, number, number];
}

export interface ClipLabelData {
  text: string;
  position: [number, number, number];
}

export interface SeparatorLineData {
  sourcePosition: [number, number];
  targetPosition: [number, number];
}

export interface AxisLineData {
  sourcePosition: [number, number];
  targetPosition: [number, number];
}

export interface AxisLabelData {
  text: string;
  position: [number, number, number];
}

export interface ScrubberLineData {
  sourcePosition: [number, number];
  targetPosition: [number, number];
}

export interface ScrubberHandleData {
  id: string;
  polygon: [number, number][];
  color: [number, number, number, number];
}

export interface ScrubberLabelData {
  text: string;
  position: [number, number, number];
}

export interface TimelineTick {
  position: number;
  timeMs: number;
  label: string;
}

// ===== CALLBACK INFO TYPES =====

export interface TimelineViewport {
  startMs?: number;
  endMs?: number;
}

export interface TimelineClipInfo {
  clip: TimelineClip;
  track: TimelineTrack;
  clipIndex: number;
  trackIndex: number;
  subtrackIndex: number;
}

export interface TimelineTrackInfo {
  track: TimelineTrack;
  index: number;
}

export interface TimelineScrubberInfo {
  timeMs: number;
  isDragging: boolean;
}

export interface TimelineViewportInfo {
  startMs: number;
  endMs: number;
  zoomLevel: number;
}

// ===== STYLE TYPES =====

export interface SelectionStyle {
  selectedClipColor?: [number, number, number, number];
  hoveredClipColor?: [number, number, number, number];
  selectedTrackColor?: [number, number, number, number];
  hoveredTrackColor?: [number, number, number, number];
  selectedLineWidth?: number;
  hoveredLineWidth?: number;
}

export interface TimelineLayout {
  x?: number;
  y?: number;
  width?: number;
  trackHeight?: number;
  trackSpacing?: number;
  showTopAxis?: boolean;
  showBottomAxis?: boolean;
  axisHeight?: number;
  axisTickHeight?: number;
  axisLabelSize?: number;
  showVerticalGrid?: boolean;
  showTrackLabels?: boolean;
  trackLabelWidth?: number;
  scrubberWidth?: number;
  scrubberHandleSize?: number;
  scrubberLabelSize?: number;
  clipPadding?: number;
  clipLabelSize?: number;
  showClipLabels?: boolean;
  clipLabelsMinZoom?: number;
  maxClipLabels?: number;
  backgroundColor?: [number, number, number, number];
  trackBackgroundColor?: [number, number, number, number];
  trackBorderColor?: [number, number, number, number];
  scrubberColor?: [number, number, number, number];
  axisColor?: [number, number, number, number];
  gridColor?: [number, number, number, number];
  selectedClipColor?: [number, number, number, number];
  hoveredClipColor?: [number, number, number, number];
}

// ===== FORMATTER TYPE =====

export type TimeAxisLabelFormatter = (timeMs: number) => string;

// ===== LAYER PROPS =====

export interface TimelineLayerProps extends CompositeLayerProps {
  // Required
  data: TimelineTrack[];
  timelineStart: number;
  timelineEnd: number;

  // Layout
  x?: number;
  y?: number;
  width?: number;
  trackHeight?: number;
  trackSpacing?: number;

  // Time
  currentTimeMs?: number;
  viewport?: {startMs?: number; endMs?: number};
  timeFormatter?: TimeAxisLabelFormatter;

  // Selection
  selectedClipId?: string | number | null;
  hoveredClipId?: string | number | null;
  selectedTrackId?: string | number | null;
  hoveredTrackId?: string | number | null;
  selectionStyle?: SelectionStyle;

  // Visibility
  showScrubber?: boolean;
  showClipLabels?: boolean;
  showTrackLabels?: boolean;
  showAxis?: boolean;
  showSubtrackSeparators?: boolean;

  // Sublayer customization
  clipProps?: Partial<SolidPolygonLayerProps<ClipPolygonData>>;
  trackProps?: Partial<SolidPolygonLayerProps<TrackBackgroundData>>;
  trackLabelProps?: Partial<TextLayerProps<TrackLabelData>>;
  clipLabelProps?: Partial<TextLayerProps<ClipLabelData>>;
  axisLineProps?: Partial<LineLayerProps<AxisLineData>>;
  axisLabelProps?: Partial<TextLayerProps<AxisLabelData>>;
  scrubberLineProps?: Partial<LineLayerProps<ScrubberLineData>>;

  // Callbacks
  onClipClick?: (info: TimelineClipInfo, event: PickingInfo) => void;
  onClipHover?: (info: TimelineClipInfo | null, event: PickingInfo) => void;
  onTrackClick?: (info: TimelineTrackInfo, event: PickingInfo) => void;
  onTrackHover?: (info: TimelineTrackInfo | null, event: PickingInfo) => void;
  onScrubberHover?: (isHovering: boolean, event: PickingInfo) => void;
  onScrubberDragStart?: (event: PickingInfo) => void;
  onScrubberDrag?: (timeMs: number, event: PickingInfo) => void;
  onTimelineClick?: (timeMs: number, event: PickingInfo) => void;

  // Interaction callbacks
  onCurrentTimeChange?: (timeMs: number) => void;
  onViewportChange?: (startMs: number, endMs: number) => void;
  onZoomChange?: (zoomLevel: number) => void;
}

// ===== CONSTANTS =====

export const DEFAULT_TIMELINE_LAYOUT: Required<TimelineLayout> = {
  x: 50,
  y: 100,
  width: 800,
  trackHeight: 60,
  trackSpacing: 10,
  showTopAxis: true,
  showBottomAxis: false,
  axisHeight: 30,
  axisTickHeight: 10,
  axisLabelSize: 11,
  showVerticalGrid: true,
  showTrackLabels: true,
  trackLabelWidth: 100,
  scrubberWidth: 3,
  scrubberHandleSize: 16,
  scrubberLabelSize: 10,
  clipPadding: 5,
  clipLabelSize: 10,
  showClipLabels: true,
  clipLabelsMinZoom: 1.5,
  maxClipLabels: 1000,
  backgroundColor: [255, 255, 255, 0],
  trackBackgroundColor: [240, 240, 240, 100],
  trackBorderColor: [200, 200, 200, 255],
  scrubberColor: [255, 69, 0, 255],
  axisColor: [50, 50, 50, 255],
  gridColor: [200, 200, 200, 128],
  selectedClipColor: [255, 255, 0, 220],
  hoveredClipColor: [255, 255, 255, 255]
};

// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

// ===== STYLE TYPES =====

export type SelectionStyle = {
  selectedClipColor?: [number, number, number, number];
  hoveredClipColor?: [number, number, number, number];
  selectedTrackColor?: [number, number, number, number];
  hoveredTrackColor?: [number, number, number, number];
  selectedLineWidth?: number;
  hoveredLineWidth?: number;
};

export type TimelineLayout = {
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
};

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

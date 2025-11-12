// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {useState, useMemo} from 'react';

// Timeline Clip Interface - implement this interface for your clips
export interface TimelineClip {
  id: string;
  trackId: number;
  startMs: number;
  endMs: number;
  label: string;
  color: [number, number, number, number]; // RGBA
}

// Timeline configuration interface
export interface TimelineConfig {
  // Core timeline settings
  trackCount: number;
  trackHeight: number;
  trackSpacing: number;

  // Timeline positioning
  timelineX: number;
  timelineY: number;
  timelineWidth: number;

  // Time range
  timelineStart: number;
  timelineEnd: number;

  // Zoom level
  zoomLevel: number;
  
  // Viewport (visible time range within fixed timeline width)
  viewportStartMs?: number;
  viewportEndMs?: number;
}

// Timeline axis label formatter type
export type TimeAxisLabelFormatter = (timeMs: number) => string;

// Default label formatters
export const timeAxisFormatters = {
  seconds: (timeMs: number): string => (timeMs / 1000).toFixed(1) + 's',
  timestamp: (timeMs: number): string => new Date(timeMs).toLocaleTimeString(),
  minutesSeconds: (timeMs: number): string => {
    const totalSeconds = Math.floor(timeMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  },
  hoursMinutesSeconds: (timeMs: number): string => {
    const totalSeconds = Math.floor(timeMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
};

// Timeline tick generation
const generateTimelineTicks = (
  startMs: number,
  endMs: number,
  timelineX: number,
  timelineWidth: number,
  tickCount: number,
  formatter: TimeAxisLabelFormatter
): {position: number; timeMs: number; label: string}[] => {
  const ticks = [];
  const timeRange = endMs - startMs;
  const step = timeRange / (tickCount - 1);

  for (let i = 0; i < tickCount; i++) {
    const timeMs = startMs + i * step;
    const position = timelineX + (i / (tickCount - 1)) * timelineWidth;
    const label = formatter(timeMs);

    ticks.push({position, timeMs, label});
  }

  return ticks;
};

// Core timeline hook for reusable timeline functionality
export function useTimelineCore(
  clips: TimelineClip[],
  config: TimelineConfig,
  options: {
    labelFormatter?: TimeAxisLabelFormatter;
    showLabelsMinZoom?: number;
    maxLabelsToShow?: number;
    currentTimeMs?: number;
    onCurrentTimeChange?: (timeMs: number) => void;
  } = {}
) {
  const {
    labelFormatter = timeAxisFormatters.seconds,
    showLabelsMinZoom = 1.5,
    maxLabelsToShow = 1000,
    currentTimeMs = config.timelineStart,
    onCurrentTimeChange
  } = options;

  // Interaction state
  const [selectedClip, setSelectedClip] = useState<TimelineClip | null>(null);
  const [hoveredClip, setHoveredClip] = useState<TimelineClip | null>(null);
  const [isDraggingScrubber, setIsDraggingScrubber] = useState(false);

  // Calculate derived values
  const totalTimelineHeight =
    config.trackCount * (config.trackHeight + config.trackSpacing) - config.trackSpacing;
  const minTimelineWidth = 50; // Enforce minimum width
  const actualTimelineWidth = Math.max(minTimelineWidth, config.timelineWidth);
  
  // Use viewport range if available, otherwise use full timeline range
  const effectiveStartMs = config.viewportStartMs ?? config.timelineStart;
  const effectiveEndMs = config.viewportEndMs ?? config.timelineEnd;
  const effectiveTimelineWidth = actualTimelineWidth;

  // Generate track background rectangles
  const trackBackgrounds = useMemo(() => {
    const backgrounds = [];
    for (let i = 0; i < config.trackCount; i++) {
      const y = config.timelineY + i * (config.trackHeight + config.trackSpacing);
      backgrounds.push({
        id: `track-bg-${i}`,
        polygon: [
          [config.timelineX, y],
          [config.timelineX + effectiveTimelineWidth, y],
          [config.timelineX + effectiveTimelineWidth, y + config.trackHeight],
          [config.timelineX, y + config.trackHeight]
        ],
        color: [240, 240, 240, 100] as [number, number, number, number]
      });
    }
    return backgrounds;
  }, [
    config.trackCount,
    config.trackHeight,
    config.trackSpacing,
    config.timelineX,
    config.timelineY,
    effectiveTimelineWidth
  ]);

  // Generate track labels
  const trackLabels = useMemo(() => {
    const labels = [];
    for (let i = 0; i < config.trackCount; i++) {
      const y =
        config.timelineY + i * (config.trackHeight + config.trackSpacing) + config.trackHeight / 2;
      labels.push({
        id: `track-label-${i}`,
        text: `Track ${i + 1}`,
        position: [config.timelineX - 10, y, 0],
        size: 12,
        color: [60, 60, 60, 255],
        textAnchor: 'end',
        alignmentBaseline: 'center'
      });
    }
    return labels;
  }, [
    config.trackCount,
    config.trackHeight,
    config.trackSpacing,
    config.timelineX,
    config.timelineY
  ]);

  // Convert clips to polygons for rendering
  const clipPolygons = useMemo(() => {
    return clips
      .filter((clip) => {
        // Only render clips that overlap with the current viewport
        return clip.endMs > effectiveStartMs && clip.startMs < effectiveEndMs;
      })
      .map((clip) => {
        const trackY = config.timelineY + clip.trackId * (config.trackHeight + config.trackSpacing);
        
        // Calculate clip positions, clamping to visible timeline bounds
        const clipStartRatio = (clip.startMs - effectiveStartMs) / (effectiveEndMs - effectiveStartMs);
        const clipEndRatio = (clip.endMs - effectiveStartMs) / (effectiveEndMs - effectiveStartMs);
        
        const clipStartX = config.timelineX + Math.max(0, clipStartRatio) * effectiveTimelineWidth;
        const clipEndX = config.timelineX + Math.min(1, clipEndRatio) * effectiveTimelineWidth;

        const isSelected = selectedClip?.id === clip.id;
        const isHovered = hoveredClip?.id === clip.id;

        let color = clip.color;
        if (isSelected) {
          color = [255, 255, 0, 220] as [number, number, number, number];
        } else if (isHovered) {
          color = [clip.color[0], clip.color[1], clip.color[2], 255] as [
            number,
            number,
            number,
            number
          ];
        }

        return {
          id: clip.id,
          clip,
          polygon: [
            [clipStartX, trackY + 5],
            [clipEndX, trackY + 5],
            [clipEndX, trackY + config.trackHeight - 5],
            [clipStartX, trackY + config.trackHeight - 5]
          ],
          color,
          label: clip.label,
          labelPosition: [
            clipStartX + (clipEndX - clipStartX) / 2,
            trackY + config.trackHeight / 2,
            0
          ]
        };
      });
  }, [clips, config, effectiveTimelineWidth, effectiveStartMs, effectiveEndMs, selectedClip, hoveredClip]);

  // Generate clip labels (performance optimized)
  const clipLabels = useMemo(() => {
    if (config.zoomLevel < showLabelsMinZoom) return [];

    return clipPolygons
      .filter((clip) => {
        const [x1] = clip.polygon[0];
        const [x2] = clip.polygon[1];
        return x2 - x1 > 60;
      })
      .slice(0, maxLabelsToShow)
      .map((clip) => ({
        id: `${clip.id}-label`,
        text: clip.label,
        position: clip.labelPosition,
        size: 10,
        color: [255, 255, 255, 255],
        textAnchor: 'middle',
        alignmentBaseline: 'center'
      }));
  }, [clipPolygons, config.zoomLevel, showLabelsMinZoom, maxLabelsToShow]);

  // Generate timeline ticks for custom axes
  const timelineTicks = useMemo(() => {
    // Keep tick count reasonable regardless of zoom level
    // Base it on the timeline width in pixels, not zoom level
    const idealTickSpacing = 80; // pixels between ticks
    const maxTicks = Math.floor(effectiveTimelineWidth / idealTickSpacing);
    const tickCount = Math.max(4, Math.min(10, maxTicks)); // Between 4-10 ticks max
    
    return generateTimelineTicks(
      effectiveStartMs,
      effectiveEndMs,
      config.timelineX,
      effectiveTimelineWidth,
      tickCount,
      labelFormatter
    );
  }, [
    effectiveStartMs,
    effectiveEndMs,
    config.timelineX,
    effectiveTimelineWidth,
    config.zoomLevel,
    labelFormatter
  ]);

  // Generate axis lines and labels
  const topAxisLines = useMemo(() => {
    const axisY = config.timelineY - 30;
    const tickLines = timelineTicks.map((tick) => ({
      sourcePosition: [tick.position, axisY - 5],
      targetPosition: [tick.position, axisY + 5]
    }));

    tickLines.push({
      sourcePosition: [config.timelineX, axisY],
      targetPosition: [config.timelineX + effectiveTimelineWidth, axisY]
    });

    return tickLines;
  }, [timelineTicks, config.timelineY, config.timelineX, effectiveTimelineWidth]);

  const bottomAxisLines = useMemo(() => {
    const axisY = config.timelineY + totalTimelineHeight + 20;
    const tickLines = timelineTicks.map((tick) => ({
      sourcePosition: [tick.position, axisY - 5],
      targetPosition: [tick.position, axisY + 5]
    }));

    tickLines.push({
      sourcePosition: [config.timelineX, axisY],
      targetPosition: [config.timelineX + effectiveTimelineWidth, axisY]
    });

    return tickLines;
  }, [
    timelineTicks,
    config.timelineY,
    totalTimelineHeight,
    config.timelineX,
    effectiveTimelineWidth
  ]);

  const topAxisLabels = useMemo(() => {
    const axisY = config.timelineY - 30;
    return timelineTicks.map((tick) => ({
      text: tick.label,
      position: [tick.position, axisY - 15, 0],
      size: 11,
      color: [50, 50, 50, 255],
      textAnchor: 'middle',
      alignmentBaseline: 'center'
    }));
  }, [timelineTicks, config.timelineY]);

  const bottomAxisLabels = useMemo(() => {
    const axisY = config.timelineY + totalTimelineHeight + 20;
    return timelineTicks.map((tick) => ({
      text: tick.label,
      position: [tick.position, axisY + 15, 0],
      size: 11,
      color: [50, 50, 50, 255],
      textAnchor: 'middle',
      alignmentBaseline: 'center'
    }));
  }, [timelineTicks, config.timelineY, totalTimelineHeight]);

  const verticalGridLines = useMemo(() => {
    return timelineTicks.map((tick) => ({
      sourcePosition: [tick.position, config.timelineY - 40],
      targetPosition: [tick.position, config.timelineY + totalTimelineHeight + 30]
    }));
  }, [timelineTicks, config.timelineY, totalTimelineHeight]);

  // Generate scrubber/playhead position and elements
  const scrubberPosition = useMemo(() => {
    const timeRatio = (currentTimeMs - effectiveStartMs) / (effectiveEndMs - effectiveStartMs);
    const clampedRatio = Math.max(0, Math.min(1, timeRatio));
    return config.timelineX + clampedRatio * effectiveTimelineWidth;
  }, [
    currentTimeMs,
    effectiveStartMs,
    effectiveEndMs,
    config.timelineX,
    effectiveTimelineWidth
  ]);

  const scrubberLine = useMemo(() => {
    return [
      {
        sourcePosition: [scrubberPosition, config.timelineY - 40],
        targetPosition: [scrubberPosition, config.timelineY + totalTimelineHeight + 30]
      }
    ];
  }, [scrubberPosition, config.timelineY, totalTimelineHeight]);

  const scrubberHandle = useMemo(() => {
    return [
      {
        id: 'scrubber-handle',
        polygon: [
          [scrubberPosition - 8, config.timelineY - 45],
          [scrubberPosition + 8, config.timelineY - 45],
          [scrubberPosition + 8, config.timelineY - 25],
          [scrubberPosition - 8, config.timelineY - 25]
        ],
        color: [255, 69, 0, 255] as [number, number, number, number]
      }
    ];
  }, [scrubberPosition, config.timelineY]);

  const scrubberTimeLabel = useMemo(() => {
    return [
      {
        text: labelFormatter(currentTimeMs),
        position: [scrubberPosition, config.timelineY - 50, 0],
        size: 10,
        color: [255, 69, 0, 255],
        textAnchor: 'middle',
        alignmentBaseline: 'bottom'
      }
    ];
  }, [scrubberPosition, config.timelineY, currentTimeMs, labelFormatter]);

  // Helper function to convert mouse position to time
  const positionToTime = (x: number): number => {
    const ratio = (x - config.timelineX) / effectiveTimelineWidth;
    const clampedRatio = Math.max(0, Math.min(1, ratio));
    return effectiveStartMs + clampedRatio * (effectiveEndMs - effectiveStartMs);
  };

  return {
    // Interaction state
    selectedClip,
    setSelectedClip,
    hoveredClip,
    setHoveredClip,
    isDraggingScrubber,
    setIsDraggingScrubber,

    // Computed values
    totalTimelineHeight,
    effectiveTimelineWidth,
    currentTimeMs,
    scrubberPosition,

    // Render data
    trackBackgrounds,
    trackLabels,
    clipPolygons,
    clipLabels,

    // Axis data
    topAxisLines,
    bottomAxisLines,
    topAxisLabels,
    bottomAxisLabels,
    verticalGridLines,

    // Scrubber data
    scrubberLine,
    scrubberHandle,
    scrubberTimeLabel,

    // Helper functions
    positionToTime,

    // Raw data for custom usage
    timelineTicks
  };
}

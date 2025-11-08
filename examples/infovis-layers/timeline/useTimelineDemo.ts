// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {useState, useMemo} from 'react';
import {
  TimelineClip,
  TimelineConfig,
  timeAxisFormatters,
  TimeAxisLabelFormatter
} from './useTimeline';

// Timeline constants for demo
const TIMELINE_START_MS = 0;
const TIMELINE_END_MS = 60000; // 60 seconds
const TRACK_HEIGHT = 60;
const TRACK_SPACING = 10;

// Generate random clips for demo purposes
const generateRandomClips = (
  trackCount: number,
  clipCount: number,
  timelineStart: number,
  timelineEnd: number
): TimelineClip[] => {
  const clips: TimelineClip[] = [];
  const colors = [
    [255, 99, 132, 200],
    [54, 162, 235, 200],
    [255, 205, 86, 200],
    [75, 192, 192, 200],
    [153, 102, 255, 200],
    [255, 159, 64, 200],
    [199, 199, 199, 200],
    [83, 102, 255, 200]
  ] as [number, number, number, number][];

  for (let i = 0; i < clipCount; i++) {
    const trackId = Math.floor(Math.random() * trackCount);
    const duration = Math.random() * (timelineEnd - timelineStart) * 0.1; // Max 10% of timeline
    const startMs = Math.random() * (timelineEnd - timelineStart - duration) + timelineStart;
    const endMs = startMs + duration;

    clips.push({
      id: `clip-${i}`,
      trackId,
      startMs,
      endMs,
      label: `Clip ${i + 1}`,
      color: colors[i % colors.length]
    });
  }

  return clips;
};

// Demo hook with all the controls and demo-specific logic
export function useTimelineDemo() {
  // Demo control state
  const [trackCount, setTrackCount] = useState(4);
  const [clipCount, setClipCount] = useState(12);
  const [timelineStart, setTimelineStart] = useState(TIMELINE_START_MS);
  const [timelineEnd, setTimelineEnd] = useState(TIMELINE_END_MS);

  // Timeline appearance
  const [trackHeight, setTrackHeight] = useState(TRACK_HEIGHT);
  const [trackSpacing, setTrackSpacing] = useState(TRACK_SPACING);

  // Timeline positioning - use full canvas size (accounting for 320px sidebar)
  // Calculate canvas dimensions: assuming 1280px total width - 320px sidebar = 960px available
  const canvasWidth = window.innerWidth - 320; // Full width minus sidebar
  const canvasHeight = window.innerHeight;
  
  const [timelineX, setTimelineX] = useState(50); // Small margin from left edge
  const [timelineY, setTimelineY] = useState(100); // Small margin from top
  const [timelineWidth, setTimelineWidth] = useState(canvasWidth - 100); // Full width minus margins

  // Zoom level
  const [zoomLevel, setZoomLevel] = useState(1);
  
  // Viewport range - what time range is currently visible within the fixed timeline width
  const [viewportStartMs, setViewportStartMs] = useState<number | undefined>(undefined);
  const [viewportEndMs, setViewportEndMs] = useState<number | undefined>(undefined);
  
  // Pan functionality
  const [isPanning, setIsPanning] = useState(false);
  const [panStartX, setPanStartX] = useState(0);
  const [panStartViewport, setPanStartViewport] = useState<{start: number, end: number} | null>(null);

  // Current time / scrubber position
  const [currentTimeMs, setCurrentTimeMs] = useState(timelineStart);
  

  // Label formatter selection
  const [labelFormatterType, setLabelFormatterType] =
    useState<keyof typeof timeAxisFormatters>('seconds');
  const labelFormatter: TimeAxisLabelFormatter = timeAxisFormatters[labelFormatterType];

  // Performance tracking
  const [renderTime, setRenderTime] = useState(0);

  // Generate clips data with performance timing
  const clips = useMemo(() => {
    const startTime = performance.now();
    const result = generateRandomClips(trackCount, clipCount, timelineStart, timelineEnd);
    const endTime = performance.now();
    setRenderTime(endTime - startTime);
    return result;
  }, [trackCount, clipCount, timelineStart, timelineEnd]);

  // Create timeline configuration
  const timelineConfig: TimelineConfig = useMemo(
    () => ({
      trackCount,
      trackHeight,
      trackSpacing,
      timelineX,
      timelineY,
      timelineWidth,
      timelineStart,
      timelineEnd,
      zoomLevel,
      viewportStartMs,
      viewportEndMs
    }),
    [
      trackCount,
      trackHeight,
      trackSpacing,
      timelineX,
      timelineY,
      timelineWidth,
      timelineStart,
      timelineEnd,
      zoomLevel,
      viewportStartMs,
      viewportEndMs
    ]
  );

  // Handle currentTime changes to keep it within timeline bounds (not viewport bounds)
  const handleCurrentTimeChange = (newTimeMs: number) => {
    const clampedTime = Math.max(timelineStart, Math.min(timelineEnd, newTimeMs));
    setCurrentTimeMs(clampedTime);
  };

  // Zoom to point function that maintains fixed timeline width but changes viewport range
  const zoomToPoint = (zoomFactor: number, mouseX?: number) => {
    // Calculate new zoom level with proper limits
    // Minimum zoom (1.0) shows the full timeline, maximum zoom allows extreme granularity
    const newZoomLevel = Math.max(1.0, Math.min(100, zoomLevel * zoomFactor));
    
    if (mouseX !== undefined) {
      // Convert DOM mouseX to timeline-relative position
      // mouseX is in DOM coordinates, we need to map it to timeline coordinates
      // Since timeline spans from timelineX to timelineX+timelineWidth in world coords,
      // but mouseX is in DOM coords, we need to calculate the relative position differently
      
      
      // Simple approach: use mouseX directly relative to the timeline configuration
      // The timeline is configured with timelineX and timelineWidth
      // We'll assume mouseX is in the same coordinate space and map it directly
      let mouseRatio = (mouseX - timelineX) / timelineWidth;
      mouseRatio = Math.max(0, Math.min(1, mouseRatio)); // Clamp to 0-1
      
      // Current viewport or full timeline range
      const currentStartMs = viewportStartMs ?? timelineStart;
      const currentEndMs = viewportEndMs ?? timelineEnd;
      
      // Time at mouse position in current viewport
      const mouseTimeMs = currentStartMs + mouseRatio * (currentEndMs - currentStartMs);
      
      // Calculate new viewport range based on zoom level
      const fullTimeRange = timelineEnd - timelineStart;
      const newViewportRange = fullTimeRange / newZoomLevel;
      
      // Center the new viewport around the mouse time, maintaining the mouse position
      // The key insight: mouseTimeMs should remain at the same relative position (mouseRatio) in the new viewport
      const newStartMs = mouseTimeMs - mouseRatio * newViewportRange;
      const newEndMs = newStartMs + newViewportRange;
      
      // Clamp viewport to timeline bounds
      let clampedStartMs = newStartMs;
      let clampedEndMs = newEndMs;
      
      if (newStartMs < timelineStart) {
        clampedStartMs = timelineStart;
        clampedEndMs = timelineStart + newViewportRange;
      } else if (newEndMs > timelineEnd) {
        clampedEndMs = timelineEnd;
        clampedStartMs = timelineEnd - newViewportRange;
      }
      
      // Only set viewport if we're zoomed in (zoom > 1)
      if (newZoomLevel > 1.0) {
        setViewportStartMs(clampedStartMs);
        setViewportEndMs(clampedEndMs);
      } else {
        // At zoom level 1.0, reset to show full timeline
        setViewportStartMs(undefined);
        setViewportEndMs(undefined);
      }
    } else {
      // No mouse position provided or mouse outside timeline - zoom from center
      if (newZoomLevel <= 1.0) {
        // Reset to full timeline view
        setViewportStartMs(undefined);
        setViewportEndMs(undefined);
      } else {
        // Zoom from center of current viewport
        const currentStartMs = viewportStartMs ?? timelineStart;
        const currentEndMs = viewportEndMs ?? timelineEnd;
        const currentCenterMs = (currentStartMs + currentEndMs) / 2;
        
        const fullTimeRange = timelineEnd - timelineStart;
        const newViewportRange = fullTimeRange / newZoomLevel;
        
        const newStartMs = currentCenterMs - newViewportRange / 2;
        const newEndMs = currentCenterMs + newViewportRange / 2;
        
        // Clamp to timeline bounds
        let clampedStartMs = Math.max(timelineStart, newStartMs);
        let clampedEndMs = Math.min(timelineEnd, newEndMs);
        
        // Ensure we maintain the viewport range
        if (clampedEndMs - clampedStartMs < newViewportRange) {
          if (clampedStartMs === timelineStart) {
            clampedEndMs = Math.min(timelineEnd, clampedStartMs + newViewportRange);
          } else {
            clampedStartMs = Math.max(timelineStart, clampedEndMs - newViewportRange);
          }
        }
        
        setViewportStartMs(clampedStartMs);
        setViewportEndMs(clampedEndMs);
      }
    }
    
    setZoomLevel(newZoomLevel);
  };

  // Pan functions for horizontal dragging
  const startPan = (mouseX: number) => {
    if (zoomLevel > 1.0) { // Only allow panning when zoomed in
      setIsPanning(true);
      setPanStartX(mouseX);
      const currentStart = viewportStartMs ?? timelineStart;
      const currentEnd = viewportEndMs ?? timelineEnd;
      setPanStartViewport({ start: currentStart, end: currentEnd });
    }
  };

  const updatePan = (mouseX: number) => {
    if (isPanning && panStartViewport && zoomLevel > 1.0) {
      const deltaX = mouseX - panStartX;
      const currentRange = panStartViewport.end - panStartViewport.start;
      
      // Convert pixel movement to time movement
      const timePerPixel = currentRange / timelineWidth;
      const timeDelta = -deltaX * timePerPixel; // Negative for intuitive drag direction
      
      let newStart = panStartViewport.start + timeDelta;
      let newEnd = panStartViewport.end + timeDelta;
      
      // Clamp to timeline bounds
      if (newStart < timelineStart) {
        newStart = timelineStart;
        newEnd = timelineStart + currentRange;
      } else if (newEnd > timelineEnd) {
        newEnd = timelineEnd;
        newStart = timelineEnd - currentRange;
      }
      
      setViewportStartMs(newStart);
      setViewportEndMs(newEnd);
    }
  };

  const endPan = () => {
    setIsPanning(false);
    setPanStartViewport(null);
  };

  return {
    // Generated data
    clips,
    timelineConfig,
    labelFormatter,
    renderTime,

    // State and setters for controls
    trackCount,
    setTrackCount,
    clipCount,
    setClipCount,
    timelineStart,
    setTimelineStart,
    timelineEnd,
    setTimelineEnd,
    trackHeight,
    setTrackHeight,
    trackSpacing,
    setTrackSpacing,
    timelineX,
    setTimelineX,
    timelineY,
    setTimelineY,
    timelineWidth,
    setTimelineWidth,
    zoomLevel,
    setZoomLevel,
    currentTimeMs,
    setCurrentTimeMs: handleCurrentTimeChange,
    labelFormatterType,
    setLabelFormatterType,
    zoomToPoint,
    
    // Pan functionality
    isPanning,
    startPan,
    updatePan,
    endPan,

    // Available formatters for UI
    availableFormatters: Object.keys(timeAxisFormatters) as (keyof typeof timeAxisFormatters)[]
  };
}

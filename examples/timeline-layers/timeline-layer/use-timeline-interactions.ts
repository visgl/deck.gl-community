// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {useCallback} from 'react';
import {positionToTime} from '@deck.gl-community/timeline-layers';
import type {TimelineControlsState} from './demo-controls';

export type TimelineInteractions = {
  getTimeFromPosition: (x: number) => number;
  zoomToPoint: (zoomFactor: number, mouseX?: number) => void;
  startPan: (mouseX: number) => void;
  updatePan: (mouseX: number) => void;
  endPan: () => void;
  handleMouseDown: (e: React.MouseEvent) => void;
  handleMouseMove: (e: React.MouseEvent) => void;
  handleWheel: (e: React.WheelEvent) => void;
}

export function useTimelineInteractions(
  state: TimelineControlsState,
  controls: any,
  isDraggingScrubber: boolean,
  isPanning: boolean,
  panStartX: number,
  panStartViewport: {start: number; end: number} | null,
  setIsDraggingScrubber: (v: boolean) => void,
  setIsPanning: (v: boolean) => void,
  setPanStartX: (v: number) => void,
  setPanStartViewport: (v: {start: number; end: number} | null) => void,
  isHoveringClip?: boolean
): TimelineInteractions {
  const getTimeFromPosition = useCallback(
    (x: number) => {
      const effectiveStartMs = state.viewportStartMs ?? state.timelineStart;
      const effectiveEndMs = state.viewportEndMs ?? state.timelineEnd;
      return positionToTime(
        x,
        state.timelineX,
        state.timelineWidth,
        effectiveStartMs,
        effectiveEndMs
      );
    },
    [state]
  );

  const zoomToPoint = useCallback(
    (zoomFactor: number, mouseX?: number) => {
      const newZoomLevel = Math.max(1.0, Math.min(100, state.zoomLevel * zoomFactor));

      if (mouseX !== undefined) {
        const mouseRatio = Math.max(
          0,
          Math.min(1, (mouseX - state.timelineX) / state.timelineWidth)
        );
        const currentStartMs = state.viewportStartMs ?? state.timelineStart;
        const currentEndMs = state.viewportEndMs ?? state.timelineEnd;
        const mouseTimeMs = currentStartMs + mouseRatio * (currentEndMs - currentStartMs);

        const fullTimeRange = state.timelineEnd - state.timelineStart;
        const newViewportRange = fullTimeRange / newZoomLevel;

        let newStartMs = mouseTimeMs - mouseRatio * newViewportRange;
        let newEndMs = newStartMs + newViewportRange;

        if (newStartMs < state.timelineStart) {
          newStartMs = state.timelineStart;
          newEndMs = state.timelineStart + newViewportRange;
        } else if (newEndMs > state.timelineEnd) {
          newEndMs = state.timelineEnd;
          newStartMs = state.timelineEnd - newViewportRange;
        }

        if (newZoomLevel > 1.0) {
          controls.setViewportStartMs(newStartMs);
          controls.setViewportEndMs(newEndMs);
        } else {
          controls.setViewportStartMs(undefined);
          controls.setViewportEndMs(undefined);
        }
      } else if (newZoomLevel <= 1.0) {
        controls.setViewportStartMs(undefined);
        controls.setViewportEndMs(undefined);
      }

      controls.setZoomLevel(newZoomLevel);
    },
    [state, controls]
  );

  const startPan = useCallback(
    (mouseX: number) => {
      if (state.zoomLevel > 1.0) {
        setIsPanning(true);
        setPanStartX(mouseX);
        const currentStart = state.viewportStartMs ?? state.timelineStart;
        const currentEnd = state.viewportEndMs ?? state.timelineEnd;
        setPanStartViewport({start: currentStart, end: currentEnd});
      }
    },
    [state, setIsPanning, setPanStartX, setPanStartViewport]
  );

  const updatePan = useCallback(
    (mouseX: number) => {
      if (isPanning && panStartViewport && state.zoomLevel > 1.0) {
        const deltaX = mouseX - panStartX;
        const currentRange = panStartViewport.end - panStartViewport.start;
        const timePerPixel = currentRange / state.timelineWidth;
        const timeDelta = -deltaX * timePerPixel;

        let newStart = panStartViewport.start + timeDelta;
        let newEnd = panStartViewport.end + timeDelta;

        if (newStart < state.timelineStart) {
          newStart = state.timelineStart;
          newEnd = state.timelineStart + currentRange;
        } else if (newEnd > state.timelineEnd) {
          newEnd = state.timelineEnd;
          newStart = state.timelineEnd - currentRange;
        }

        controls.setViewportStartMs(newStart);
        controls.setViewportEndMs(newEnd);
      }
    },
    [isPanning, panStartViewport, panStartX, state, controls]
  );

  const endPan = useCallback(() => {
    setIsPanning(false);
    setPanStartViewport(null);
  }, [setIsPanning, setPanStartViewport]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Skip timeline interactions if hovering over a clip
      if (isHoveringClip) {
        return;
      }

      const rect = e.currentTarget.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Calculate scrubber position
      const effectiveStartMs = state.viewportStartMs ?? state.timelineStart;
      const effectiveEndMs = state.viewportEndMs ?? state.timelineEnd;
      const timeRatio =
        (state.currentTimeMs - effectiveStartMs) / (effectiveEndMs - effectiveStartMs);
      const scrubberPosition =
        state.timelineX + Math.max(0, Math.min(1, timeRatio)) * state.timelineWidth;

      // Check if clicking on scrubber handle
      const scrubberHandleLeft = scrubberPosition - 8;
      const scrubberHandleRight = scrubberPosition + 8;
      const scrubberHandleTop = state.timelineY - 45;
      const scrubberHandleBottom = state.timelineY - 25;

      if (
        mouseX >= scrubberHandleLeft &&
        mouseX <= scrubberHandleRight &&
        mouseY >= scrubberHandleTop &&
        mouseY <= scrubberHandleBottom
      ) {
        e.preventDefault();
        setIsDraggingScrubber(true);
        return;
      }

      // Check if in timeline area
      const isInTimeline =
        mouseX >= state.timelineX && mouseX <= state.timelineX + state.timelineWidth;

      if (isInTimeline) {
        if (state.zoomLevel > 1.0) {
          startPan(mouseX);
        } else {
          controls.setCurrentTimeMs(getTimeFromPosition(mouseX));
        }
      }
    },
    [state, startPan, getTimeFromPosition, controls, setIsDraggingScrubber, isHoveringClip]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;

      if (isDraggingScrubber) {
        e.preventDefault();
        controls.setCurrentTimeMs(getTimeFromPosition(mouseX));
      } else if (isPanning) {
        e.preventDefault();
        updatePan(mouseX);
      }
    },
    [isDraggingScrubber, isPanning, getTimeFromPosition, updatePan, controls]
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const zoomFactor = e.deltaY > 0 ? 0.8 : 1.2;
      zoomToPoint(zoomFactor, mouseX);
    },
    [zoomToPoint]
  );

  return {
    getTimeFromPosition,
    zoomToPoint,
    startPan,
    updatePan,
    endPan,
    handleMouseDown,
    handleMouseMove,
    handleWheel
  };
}

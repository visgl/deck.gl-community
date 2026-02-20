// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {useState, useRef, useEffect, useCallback, useMemo} from 'react';
import type {TimelineLayer, TimelineClipInfo, TimelineTrackInfo} from '@deck.gl-community/timeline-layers';
import {positionToTime} from '@deck.gl-community/timeline-layers';
import type {TimelineControlsState} from './demo-controls';

const DRAG_THRESHOLD = 5;

interface TimelineInteractionState {
  isDraggingScrubber: boolean;
  isPanning: boolean;
  panStartX: number;
  panStartViewport: {start: number; end: number} | null;
  mouseDownPos: {x: number; y: number} | null;
  hoveredObjectId: string | null;
}

interface TimelineRefs {
  timelineLayerRef: React.RefObject<TimelineLayer | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

interface TimelineControls {
  setSelectedClip: (clip: unknown) => void;
  setHoveredClip: (clip: unknown) => void;
  setSelectedTrack: (track: unknown) => void;
  setHoveredTrack: (track: unknown) => void;
  setCurrentTimeMs: (timeMs: number) => void;
  setViewportStartMs: (startMs: number | undefined) => void;
  setViewportEndMs: (endMs: number | undefined) => void;
  setZoomLevel: (zoomLevel: number) => void;
}

/** Hook for managing timeline interaction state */
export function useTimelineInteractionState(): {
  state: TimelineInteractionState;
  setState: {
    setIsDraggingScrubber: (value: boolean) => void;
    setIsPanning: (value: boolean) => void;
    setPanStartX: (value: number) => void;
    setPanStartViewport: (value: {start: number; end: number} | null) => void;
    setMouseDownPos: (value: {x: number; y: number} | null) => void;
    setHoveredObjectId: (value: string | null) => void;
  };
} {
  const [isDraggingScrubber, setIsDraggingScrubber] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [panStartX, setPanStartX] = useState(0);
  const [panStartViewport, setPanStartViewport] = useState<{start: number; end: number} | null>(
    null
  );
  const [mouseDownPos, setMouseDownPos] = useState<{x: number; y: number} | null>(null);
  const [hoveredObjectId, setHoveredObjectId] = useState<string | null>(null);

  const state = useMemo(
    () => ({isDraggingScrubber, isPanning, panStartX, panStartViewport, mouseDownPos, hoveredObjectId}),
    [isDraggingScrubber, isPanning, panStartX, panStartViewport, mouseDownPos, hoveredObjectId]
  );

  const setState = useMemo(
    () => ({
      setIsDraggingScrubber,
      setIsPanning,
      setPanStartX,
      setPanStartViewport,
      setMouseDownPos,
      setHoveredObjectId
    }),
    []
  );

  return {state, setState};
}

/** Hook for creating timeline refs */
export function useTimelineRefs(): TimelineRefs {
  const timelineLayerRef = useRef<TimelineLayer | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  return useMemo(() => ({timelineLayerRef, containerRef}), []);
}

/** Hook for global mouse-up cleanup */
export function useGlobalMouseUpCleanup(
  setIsDraggingScrubber: (value: boolean) => void,
  setIsPanning: (value: boolean) => void,
  setPanStartViewport: (value: {start: number; end: number} | null) => void
): void {
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      setIsDraggingScrubber(false);
      setIsPanning(false);
      setPanStartViewport(null);
    };
    document.addEventListener('mouseup', handleGlobalMouseUp);
    return () => document.removeEventListener('mouseup', handleGlobalMouseUp);
  }, [setIsDraggingScrubber, setIsPanning, setPanStartViewport]);
}

/** Hook for mouse-wheel zoom */
export function useWheelZoom(
  containerRef: React.RefObject<HTMLDivElement | null>,
  timelineLayerRef: React.RefObject<TimelineLayer | null>,
  zoomLevel: number
): void {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const handleWheel = (e: WheelEvent) => {
      if (!timelineLayerRef.current) return;
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const zoomFactor = e.deltaY > 0 ? 0.8 : 1.2;
      timelineLayerRef.current.zoomToPoint(zoomFactor, mouseX, zoomLevel);
    };

    container.addEventListener('wheel', handleWheel, {passive: false});
    return () => container.removeEventListener('wheel', handleWheel);
  }, [containerRef, timelineLayerRef, zoomLevel]);
}

/** Hook for timeline layer event callbacks */
export function useTimelineCallbacks(controls: TimelineControls): {
  handleClipClick: (info: TimelineClipInfo) => void;
  handleClipHover: (info: TimelineClipInfo | null) => void;
  handleTrackClick: (info: TimelineTrackInfo) => void;
  handleTrackHover: (info: TimelineTrackInfo | null) => void;
  handleScrubberDrag: (timeMs: number) => void;
  handleTimelineClick: (timeMs: number) => void;
  handleViewportChange: (startMs: number, endMs: number) => void;
  handleZoomChange: (zoomLevel: number) => void;
} {
  const {
    setSelectedClip,
    setHoveredClip,
    setSelectedTrack,
    setHoveredTrack,
    setCurrentTimeMs,
    setViewportStartMs,
    setViewportEndMs,
    setZoomLevel
  } = controls;

  const handleClipClick = useCallback((info: TimelineClipInfo) => setSelectedClip(info.clip), [setSelectedClip]);
  const handleClipHover = useCallback((info: TimelineClipInfo | null) => setHoveredClip(info?.clip ?? null), [setHoveredClip]);
  const handleTrackClick = useCallback((info: TimelineTrackInfo) => setSelectedTrack(info.track), [setSelectedTrack]);
  const handleTrackHover = useCallback((info: TimelineTrackInfo | null) => setHoveredTrack(info?.track ?? null), [setHoveredTrack]);
  const handleScrubberDrag = useCallback((timeMs: number) => setCurrentTimeMs(timeMs), [setCurrentTimeMs]);
  const handleTimelineClick = useCallback((timeMs: number) => setCurrentTimeMs(timeMs), [setCurrentTimeMs]);

  const handleViewportChange = useCallback(
    (startMs: number, endMs: number) => {
      setViewportStartMs(startMs);
      setViewportEndMs(endMs);
    },
    [setViewportStartMs, setViewportEndMs]
  );

  const handleZoomChange = useCallback((zoomLevel: number) => setZoomLevel(zoomLevel), [setZoomLevel]);

  return useMemo(
    () => ({
      handleClipClick,
      handleClipHover,
      handleTrackClick,
      handleTrackHover,
      handleScrubberDrag,
      handleTimelineClick,
      handleViewportChange,
      handleZoomChange
    }),
    [
      handleClipClick,
      handleClipHover,
      handleTrackClick,
      handleTrackHover,
      handleScrubberDrag,
      handleTimelineClick,
      handleViewportChange,
      handleZoomChange
    ]
  );
}

/** Hook for container mouse event handlers (scrubber drag + pan) */
export function useContainerHandlers(
  interactionState: TimelineInteractionState,
  setState: ReturnType<typeof useTimelineInteractionState>['setState'],
  _timelineLayerRef: React.RefObject<TimelineLayer | null>,
  controls: TimelineControls,
  state: TimelineControlsState
): {
  handleContainerMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
  handleContainerMouseMove: (e: React.MouseEvent<HTMLDivElement>) => void;
  handleContainerMouseUp: () => void;
} {
  const {setCurrentTimeMs, setViewportStartMs, setViewportEndMs} = controls;
  const {setIsDraggingScrubber, setMouseDownPos, setIsPanning, setPanStartX, setPanStartViewport} =
    setState;

  const handleContainerMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if ((e.target as HTMLElement).tagName !== 'CANVAS') return;

      if (interactionState.hoveredObjectId === 'scrubber-handle') {
        setIsDraggingScrubber(true);
        return;
      }

      if (state.zoomLevel > 1.0) {
        const rect = e.currentTarget.getBoundingClientRect();
        setMouseDownPos({x: e.clientX - rect.left, y: e.clientY - rect.top});
      }
    },
    [interactionState.hoveredObjectId, state.zoomLevel, setIsDraggingScrubber, setMouseDownPos]
  );

  const handleContainerMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Scrubber dragging
      if (interactionState.isDraggingScrubber) {
        const effectiveStartMs = state.viewportStartMs ?? state.timelineStart;
        const effectiveEndMs = state.viewportEndMs ?? state.timelineEnd;
        const timeMs = positionToTime(
          mouseX,
          state.timelineX,
          state.timelineWidth,
          effectiveStartMs,
          effectiveEndMs
        );
        setCurrentTimeMs(timeMs);
        return;
      }

      // Pan start detection
      if (
        interactionState.mouseDownPos &&
        !interactionState.isPanning &&
        !interactionState.isDraggingScrubber
      ) {
        const dx = mouseX - interactionState.mouseDownPos.x;
        const dy = mouseY - interactionState.mouseDownPos.y;
        if (Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD && state.zoomLevel > 1.0) {
          setIsPanning(true);
          setPanStartX(interactionState.mouseDownPos.x);
          setPanStartViewport({
            start: state.viewportStartMs ?? state.timelineStart,
            end: state.viewportEndMs ?? state.timelineEnd
          });
          setMouseDownPos(null);
        }
      }

      // Pan update
      if (interactionState.isPanning && interactionState.panStartViewport) {
        e.preventDefault();
        const deltaX = mouseX - interactionState.panStartX;
        const currentRange = interactionState.panStartViewport.end - interactionState.panStartViewport.start;
        const timeDelta = -(deltaX / state.timelineWidth) * currentRange;

        let newStart = interactionState.panStartViewport.start + timeDelta;
        let newEnd = interactionState.panStartViewport.end + timeDelta;

        if (newStart < state.timelineStart) {
          newStart = state.timelineStart;
          newEnd = state.timelineStart + currentRange;
        } else if (newEnd > state.timelineEnd) {
          newEnd = state.timelineEnd;
          newStart = state.timelineEnd - currentRange;
        }

        setViewportStartMs(newStart);
        setViewportEndMs(newEnd);
      }
    },
    [
      interactionState,
      state.zoomLevel,
      state.timelineStart,
      state.timelineEnd,
      state.timelineWidth,
      state.timelineX,
      state.viewportStartMs,
      state.viewportEndMs,
      setCurrentTimeMs,
      setIsPanning,
      setPanStartX,
      setPanStartViewport,
      setMouseDownPos,
      setViewportStartMs,
      setViewportEndMs
    ]
  );

  const handleContainerMouseUp = useCallback(() => {
    setMouseDownPos(null);
    if (interactionState.isDraggingScrubber) setIsDraggingScrubber(false);
    if (interactionState.isPanning) {
      setIsPanning(false);
      setPanStartViewport(null);
    }
  }, [
    interactionState.isDraggingScrubber,
    interactionState.isPanning,
    setMouseDownPos,
    setIsDraggingScrubber,
    setIsPanning,
    setPanStartViewport
  ]);

  return useMemo(
    () => ({handleContainerMouseDown, handleContainerMouseMove, handleContainerMouseUp}),
    [handleContainerMouseDown, handleContainerMouseMove, handleContainerMouseUp]
  );
}

/** Hook for DeckGL hover/click handlers */
export function useDeckGLHandlers(
  setState: ReturnType<typeof useTimelineInteractionState>['setState'],
  _timelineLayerRef: React.RefObject<TimelineLayer | null>,
  controls: TimelineControls,
  state: TimelineControlsState
): {
  handleDeckGLHover: (info: any) => void;
  handleDeckGLClick: (info: any) => void;
} {
  const {setCurrentTimeMs, setSelectedClip, setSelectedTrack, setHoveredClip, setHoveredTrack} =
    controls;
  const {setHoveredObjectId, setIsDraggingScrubber, setMouseDownPos} = setState;

  const handleDeckGLHover = useCallback(
    (info: any) => {
      if (!info.object) {
        setHoveredObjectId(null);
        setHoveredClip(null);
        setHoveredTrack(null);
        return;
      }

      const objectId = String(info.object.id);
      setHoveredObjectId(objectId);

      if (objectId.startsWith('track-') && objectId.includes('-clip-')) {
        if (info.object.clip) setHoveredClip(info.object.clip);
        setHoveredTrack(null);
      } else if (objectId.startsWith('track-bg-')) {
        setHoveredClip(null);
        if (info.object.track) setHoveredTrack(info.object.track);
      } else {
        setHoveredClip(null);
        setHoveredTrack(null);
      }
    },
    [setHoveredObjectId, setHoveredClip, setHoveredTrack]
  );

  const handleDeckGLClick = useCallback(
    (info: any) => {
      if (!info.object) {
        if (info.coordinate) {
          const effectiveStartMs = state.viewportStartMs ?? state.timelineStart;
          const effectiveEndMs = state.viewportEndMs ?? state.timelineEnd;
          const timeMs = positionToTime(
            info.coordinate[0] || 0,
            state.timelineX,
            state.timelineWidth,
            effectiveStartMs,
            effectiveEndMs
          );
          setCurrentTimeMs(timeMs);
        }
        setSelectedClip(null);
        setSelectedTrack(null);
        return;
      }

      const objectId = String(info.object.id);

      if (objectId.startsWith('track-') && objectId.includes('-clip-')) {
        if (info.object.clip) setSelectedClip(info.object.clip);
        setSelectedTrack(null);
      } else if (objectId === 'scrubber-handle') {
        setIsDraggingScrubber(true);
        setMouseDownPos(null);
        setSelectedClip(null);
        setSelectedTrack(null);
      } else if (objectId.startsWith('track-bg-')) {
        if (info.coordinate) {
          const effectiveStartMs = state.viewportStartMs ?? state.timelineStart;
          const effectiveEndMs = state.viewportEndMs ?? state.timelineEnd;
          const timeMs = positionToTime(
            info.coordinate[0] || 0,
            state.timelineX,
            state.timelineWidth,
            effectiveStartMs,
            effectiveEndMs
          );
          setCurrentTimeMs(timeMs);
        }
        setSelectedClip(null);
        if (info.object.track) setSelectedTrack(info.object.track);
      } else {
        setSelectedClip(null);
        setSelectedTrack(null);
      }
    },
    [
      state.timelineX,
      state.timelineWidth,
      state.viewportStartMs,
      state.viewportEndMs,
      state.timelineStart,
      state.timelineEnd,
      setCurrentTimeMs,
      setSelectedClip,
      setSelectedTrack,
      setIsDraggingScrubber,
      setMouseDownPos
    ]
  );

  return useMemo(
    () => ({handleDeckGLHover, handleDeckGLClick}),
    [handleDeckGLHover, handleDeckGLClick]
  );
}

/** Hook for cursor style */
export function useCursorGetter(
  interactionState: TimelineInteractionState,
  zoomLevel: number
): ({isHovering}: {isHovering: boolean}) => string {
  return useCallback(
    ({isHovering}: {isHovering: boolean}) => {
      if (interactionState.isDraggingScrubber || interactionState.isPanning) return 'grabbing';
      if (interactionState.hoveredObjectId === 'scrubber-handle') return 'grab';
      if (isHovering) return 'pointer';
      if (zoomLevel > 1.0) return 'grab';
      return 'default';
    },
    [
      interactionState.isDraggingScrubber,
      interactionState.isPanning,
      interactionState.hoveredObjectId,
      zoomLevel
    ]
  );
}

/** Hook to update timeline width on window resize */
export function useTimelineResize(setTimelineWidth: (width: number) => void): void {
  useEffect(() => {
    const handleResize = () => {
      setTimelineWidth(window.innerWidth - 320 - 200);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [setTimelineWidth]);
}

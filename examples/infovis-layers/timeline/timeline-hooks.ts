// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {useState, useRef, useEffect, useCallback, useMemo} from 'react';
import type {TimelineLayer, TimelineClipInfo, TimelineTrackInfo} from './timeline-layer';
import type {TimelineControlsState} from './demo-controls';
import {positionToTime} from './timeline-utils';

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
  setViewportStartMs: (startMs: number) => void;
  setViewportEndMs: (endMs: number) => void;
  setZoomLevel: (zoomLevel: number) => void;
}

/**
 * Hook for managing timeline interaction state
 */
export function useTimelineInteractionState(): {
  state: TimelineInteractionState;
  setState: {
    setIsDraggingScrubber: (value: boolean) => void;
    setIsPanning: (value: boolean) => void;
    setPanStartX: (value: number | null) => void;
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

  // Memoize state object
  const state = useMemo(
    () => ({
      isDraggingScrubber,
      isPanning,
      panStartX,
      panStartViewport,
      mouseDownPos,
      hoveredObjectId
    }),
    [isDraggingScrubber, isPanning, panStartX, panStartViewport, mouseDownPos, hoveredObjectId]
  );

  // Memoize setState object
  const setState = useMemo(
    () => ({
      setIsDraggingScrubber,
      setIsPanning,
      setPanStartX,
      setPanStartViewport,
      setMouseDownPos,
      setHoveredObjectId
    }),
    [
      setIsDraggingScrubber,
      setIsPanning,
      setPanStartX,
      setPanStartViewport,
      setMouseDownPos,
      setHoveredObjectId
    ]
  );

  return {state, setState};
}

/**
 * Hook for creating timeline refs
 */
export function useTimelineRefs(): TimelineRefs {
  const timelineLayerRef = useRef<TimelineLayer | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Memoize refs object (refs themselves never change)
  return useMemo(() => ({timelineLayerRef, containerRef}), []);
}

/**
 * Hook for global mouse up cleanup effect
 */
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

/**
 * Hook for wheel zoom handler
 */
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

/**
 * Hook for timeline layer callbacks
 */
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
  // Destructure controls to get stable setter references
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

  const handleClipClick = useCallback(
    (info: TimelineClipInfo) => setSelectedClip(info.clip),
    [setSelectedClip]
  );

  const handleClipHover = useCallback(
    (info: TimelineClipInfo | null) => setHoveredClip(info?.clip || null),
    [setHoveredClip]
  );

  const handleTrackClick = useCallback(
    (info: TimelineTrackInfo) => setSelectedTrack(info.track),
    [setSelectedTrack]
  );

  const handleTrackHover = useCallback(
    (info: TimelineTrackInfo | null) => setHoveredTrack(info?.track || null),
    [setHoveredTrack]
  );

  const handleScrubberDrag = useCallback(
    (timeMs: number) => setCurrentTimeMs(timeMs),
    [setCurrentTimeMs]
  );

  const handleTimelineClick = useCallback(
    (timeMs: number) => setCurrentTimeMs(timeMs),
    [setCurrentTimeMs]
  );

  const handleViewportChange = useCallback(
    (startMs: number, endMs: number) => {
      setViewportStartMs(startMs);
      setViewportEndMs(endMs);
    },
    [setViewportStartMs, setViewportEndMs]
  );

  const handleZoomChange = useCallback(
    (zoomLevel: number) => setZoomLevel(zoomLevel),
    [setZoomLevel]
  );

  // Memoize return object
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

// Helper: Handle pan start detection
function handlePanStartDetection(params: {
  mouseX: number;
  mouseY: number;
  mouseDownPos: {x: number; y: number};
  zoomLevel: number;
  viewportStartMs: number | undefined;
  viewportEndMs: number | undefined;
  timelineStart: number;
  timelineEnd: number;
  setIsPanning: (value: boolean) => void;
  setPanStartX: (value: number | null) => void;
  setPanStartViewport: (value: {start: number; end: number} | null) => void;
  setMouseDownPos: (value: {x: number; y: number} | null) => void;
}): void {
  if (params.zoomLevel <= 1.0) return;

  const dragDistance = Math.sqrt(
    Math.pow(params.mouseX - params.mouseDownPos.x, 2) +
      Math.pow(params.mouseY - params.mouseDownPos.y, 2)
  );

  if (dragDistance > DRAG_THRESHOLD) {
    params.setIsPanning(true);
    params.setPanStartX(params.mouseDownPos.x);
    params.setPanStartViewport({
      start: params.viewportStartMs ?? params.timelineStart,
      end: params.viewportEndMs ?? params.timelineEnd
    });
    params.setMouseDownPos(null);
  }
}

// Helper: Handle pan viewport update
function handlePanUpdate(params: {
  e: React.MouseEvent<HTMLDivElement>;
  mouseX: number;
  panStartX: number;
  panStartViewport: {start: number; end: number};
  timelineWidth: number;
  timelineStart: number;
  timelineEnd: number;
  setViewportStartMs: (startMs: number) => void;
  setViewportEndMs: (endMs: number) => void;
}): void {
  params.e.preventDefault();
  const deltaX = params.mouseX - params.panStartX;
  const currentRange = params.panStartViewport.end - params.panStartViewport.start;
  const timePerPixel = currentRange / params.timelineWidth;
  const timeDelta = -deltaX * timePerPixel;

  let newStart = params.panStartViewport.start + timeDelta;
  let newEnd = params.panStartViewport.end + timeDelta;

  if (newStart < params.timelineStart) {
    newStart = params.timelineStart;
    newEnd = params.timelineStart + currentRange;
  } else if (newEnd > params.timelineEnd) {
    newEnd = params.timelineEnd;
    newStart = params.timelineEnd - currentRange;
  }

  params.setViewportStartMs(newStart);
  params.setViewportEndMs(newEnd);
}

/**
 * Hook for container mouse event handlers
 */
export function useContainerHandlers(
  interactionState: TimelineInteractionState,
  setState: ReturnType<typeof useTimelineInteractionState>['setState'],
  timelineLayerRef: React.RefObject<TimelineLayer | null>,
  controls: TimelineControls,
  state: TimelineControlsState
): {
  handleContainerMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
  handleContainerMouseMove: (e: React.MouseEvent<HTMLDivElement>) => void;
  handleContainerMouseUp: () => void;
} {
  // Destructure controls and setState to get stable setter references
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
        // Account for container border (3px)
        const borderWidth = 3;
        setMouseDownPos({
          x: e.clientX - rect.left - borderWidth,
          y: e.clientY - rect.top - borderWidth
        });
      }
    },
    [interactionState.hoveredObjectId, state.zoomLevel, setIsDraggingScrubber, setMouseDownPos]
  );

  const handleContainerMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      // Account for container border (3px) - canvas is inside the border
      const borderWidth = 3;
      const mouseX = e.clientX - rect.left - borderWidth;
      const mouseY = e.clientY - rect.top - borderWidth;

      // Handle scrubber dragging
      if (interactionState.isDraggingScrubber) {
        // Calculate time directly using current state values (always up-to-date after resize)
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

      // Handle pan start detection
      if (
        interactionState.mouseDownPos &&
        !interactionState.isPanning &&
        !interactionState.isDraggingScrubber
      ) {
        handlePanStartDetection({
          mouseX,
          mouseY,
          mouseDownPos: interactionState.mouseDownPos,
          zoomLevel: state.zoomLevel,
          viewportStartMs: state.viewportStartMs,
          viewportEndMs: state.viewportEndMs,
          timelineStart: state.timelineStart,
          timelineEnd: state.timelineEnd,
          setIsPanning,
          setPanStartX,
          setPanStartViewport,
          setMouseDownPos
        });
      }

      // Handle pan update
      if (interactionState.isPanning && interactionState.panStartViewport) {
        handlePanUpdate({
          e,
          mouseX,
          panStartX: interactionState.panStartX,
          panStartViewport: interactionState.panStartViewport,
          timelineWidth: state.timelineWidth,
          timelineStart: state.timelineStart,
          timelineEnd: state.timelineEnd,
          setViewportStartMs,
          setViewportEndMs
        });
      }
    },
    [
      interactionState.isDraggingScrubber,
      interactionState.isPanning,
      interactionState.mouseDownPos,
      interactionState.panStartX,
      interactionState.panStartViewport,
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

  // Memoize return object
  return useMemo(
    () => ({
      handleContainerMouseDown,
      handleContainerMouseMove,
      handleContainerMouseUp
    }),
    [handleContainerMouseDown, handleContainerMouseMove, handleContainerMouseUp]
  );
}

// Helper: Update timeline position from click coordinate
function updateTimeFromClick(
  coordinate: number[] | undefined,
  timelineX: number,
  timelineWidth: number,
  viewportStartMs: number | undefined,
  viewportEndMs: number | undefined,
  timelineStart: number,
  timelineEnd: number,
  setCurrentTimeMs: (time: number) => void
): void {
  if (coordinate) {
    const clickX = coordinate[0] || 0;
    const effectiveStartMs = viewportStartMs ?? timelineStart;
    const effectiveEndMs = viewportEndMs ?? timelineEnd;
    const timeMs = positionToTime(clickX, timelineX, timelineWidth, effectiveStartMs, effectiveEndMs);
    setCurrentTimeMs(timeMs);
  }
}

/**
 * Hook for DeckGL event handlers
 */
export function useDeckGLHandlers(
  setState: ReturnType<typeof useTimelineInteractionState>['setState'],
  timelineLayerRef: React.RefObject<TimelineLayer | null>,
  controls: TimelineControls,
  state: TimelineControlsState
): {
  handleDeckGLHover: (info: any) => void;
  handleDeckGLClick: (info: any) => void;
} {
  // Destructure controls and setState to get stable setter references
  const {setCurrentTimeMs, setSelectedClip, setSelectedTrack, setHoveredClip, setHoveredTrack} =
    controls;
  const {setHoveredObjectId, setIsDraggingScrubber, setMouseDownPos} = setState;

  const handleDeckGLHover = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (info: any) => {
      if (!info.object) {
        setHoveredObjectId(null);
        setHoveredClip(null);
        setHoveredTrack(null);
        return;
      }

      const objectId = String(info.object.id);
      const obj = info.object;

      setHoveredObjectId(objectId);

      // Set hovered clip or track based on object type
      if (objectId.startsWith('track-') && objectId.includes('-clip-')) {
        // Hovering clip
        if (obj.clip) setHoveredClip(obj.clip);
        setHoveredTrack(null);
      } else if (objectId.startsWith('track-bg-')) {
        // Hovering track background
        setHoveredClip(null);
        if (obj.track) setHoveredTrack(obj.track);
      } else {
        // Hovering something else (scrubber, axis, etc)
        setHoveredClip(null);
        setHoveredTrack(null);
      }
    },
    [setHoveredObjectId, setHoveredClip, setHoveredTrack]
  );

  const handleDeckGLClick = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (info: any) => {
      if (!info.object) {
        // Clicked empty space
        updateTimeFromClick(
          info.coordinate,
          state.timelineX,
          state.timelineWidth,
          state.viewportStartMs,
          state.viewportEndMs,
          state.timelineStart,
          state.timelineEnd,
          setCurrentTimeMs
        );
        setSelectedClip(null);
        setSelectedTrack(null);
        return;
      }

      const objectId = String(info.object.id);
      const obj = info.object;

      if (objectId.startsWith('track-') && objectId.includes('-clip-')) {
        // Clicked clip
        if (obj.clip) setSelectedClip(obj.clip);
        setSelectedTrack(null);
      } else if (objectId === 'scrubber-handle') {
        // Clicked scrubber
        setIsDraggingScrubber(true);
        setMouseDownPos(null);
        setSelectedClip(null);
        setSelectedTrack(null);
      } else if (objectId.startsWith('track-bg-')) {
        // Clicked track background
        updateTimeFromClick(
          info.coordinate,
          state.timelineX,
          state.timelineWidth,
          state.viewportStartMs,
          state.viewportEndMs,
          state.timelineStart,
          state.timelineEnd,
          setCurrentTimeMs
        );
        setSelectedClip(null);
        if (obj.track) setSelectedTrack(obj.track);
      } else {
        // Clicked something else
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

  // Memoize return object
  return useMemo(
    () => ({
      handleDeckGLHover,
      handleDeckGLClick
    }),
    [handleDeckGLHover, handleDeckGLClick]
  );
}

/**
 * Hook for cursor getter
 */
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

/**
 * Hook to handle timeline dimension updates on window resize
 * Note: This could be consolidated into a more generic useTimelineEffects hook
 * that handles all lifecycle side effects (resize, initialization, cleanup, etc.)
 */
export function useTimelineResize(setTimelineWidth: (width: number) => void): void {
  useEffect(() => {
    const handleResize = () => {
      const newCanvasWidth = window.innerWidth - 320;
      const newTimelineWidth = newCanvasWidth - 200;
      setTimelineWidth(newTimelineWidth);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [setTimelineWidth]);
}

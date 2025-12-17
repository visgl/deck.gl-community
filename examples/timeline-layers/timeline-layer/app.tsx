// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors


import React, {ReactElement, useMemo} from 'react';
import {createRoot} from 'react-dom/client';


import DeckGL from '@deck.gl/react';
import {OrthographicView} from '@deck.gl/core';
import {TimelineLayer} from '@deck.gl-community/timeline-layers';
import {useTimelineControls, TimelineControls} from './demo-controls';

import {
  useTimelineInteractionState,
  useTimelineRefs,
  useGlobalMouseUpCleanup,
  useWheelZoom,
  useTimelineCallbacks,
  useContainerHandlers,
  useDeckGLHandlers,
  useCursorGetter,
  useTimelineResize
} from './timeline-hooks';

const canvasWidth = (typeof window !== 'undefined' ? window.innerWidth : 1280) - 320;
const canvasHeight = typeof window !== 'undefined' ? window.innerHeight : 720;

const INITIAL_VIEW_STATE: OrthographicViewState = {
  target: [canvasWidth / 2, canvasHeight / 2, 0],
  zoom: 0
};

// Memoized constants
const ORTHOGRAPHIC_VIEW = new OrthographicView();
const CONTROLLER_CONFIG = {
  scrollZoom: false,
  doubleClickZoom: false,
  touchZoom: false,
  dragPan: false,
  dragRotate: false,
  keyboard: false
} as const;

const CONTAINER_OUTER_STYLE = {
  display: 'flex',
  width: '100vw',
  height: '100vh',
  overflow: 'hidden'
} as const;

const CONTAINER_INNER_STYLE = {
  flex: 1,
  height: '100vh',
  position: 'relative' as const,
  overflow: 'hidden',
  border: '3px solid black'
} as const;

export default function App(): ReactElement {
  const {state, controls, trackCount, clipsPerTrack, labelFormatterType} = useTimelineControls();

  const {state: interactionState, setState} = useTimelineInteractionState();
  const {timelineLayerRef, containerRef} = useTimelineRefs();

  useGlobalMouseUpCleanup(
    setState.setIsDraggingScrubber,
    setState.setIsPanning,
    setState.setPanStartViewport
  );

  useWheelZoom(containerRef, timelineLayerRef, state.zoomLevel);
  useTimelineResize(controls.setTimelineWidth);

  const timelineCallbacks = useTimelineCallbacks(controls);

  const containerHandlers = useContainerHandlers(
    interactionState,
    setState,
    timelineLayerRef,
    controls,
    state
  );

  const deckGLHandlers = useDeckGLHandlers(setState, timelineLayerRef, controls, state);

  const getCursor = useCursorGetter(interactionState, state.zoomLevel);

  // Memoize viewport object
  const viewport = useMemo(
    () => ({startMs: state.viewportStartMs, endMs: state.viewportEndMs}),
    [state.viewportStartMs, state.viewportEndMs]
  );

  // Memoize selectionStyle object
  const selectionStyle = useMemo(
    () => ({
      selectedClipColor: [255, 200, 0, 255] as [number, number, number, number],
      hoveredClipColor: [200, 200, 200, 255] as [number, number, number, number],
      selectedTrackColor: [80, 80, 80, 255] as [number, number, number, number],
      hoveredTrackColor: [70, 70, 70, 255] as [number, number, number, number],
      selectedLineWidth: state.selectedLineWidth,
      hoveredLineWidth: state.hoveredLineWidth
    }),
    [state.selectedLineWidth, state.hoveredLineWidth]
  );

  const timelineLayerProps = useMemo(
    () => ({
      id: 'timeline',
      data: state.tracks,
      timelineStart: state.timelineStart,
      timelineEnd: state.timelineEnd,
      x: state.timelineX,
      y: state.timelineY,
      width: state.timelineWidth,
      trackHeight: state.trackHeight,
      trackSpacing: state.trackSpacing,
      currentTimeMs: state.currentTimeMs,
      viewport,
      timeFormatter: state.labelFormatter,
      selectedClipId: state.selectedClip?.id,
      hoveredClipId: state.hoveredClip?.id,
      selectedTrackId: state.selectedTrack?.id,
      hoveredTrackId: state.hoveredTrack?.id,
      showTrackLabels: true,
      showClipLabels: true,
      showScrubber: true,
      showAxis: true,
      showSubtrackSeparators: state.showSubtrackSeparators,
      selectionStyle,
      onClipClick: timelineCallbacks.handleClipClick,
      onClipHover: timelineCallbacks.handleClipHover,
      onTrackClick: timelineCallbacks.handleTrackClick,
      onTrackHover: timelineCallbacks.handleTrackHover,
      onScrubberDrag: timelineCallbacks.handleScrubberDrag,
      onTimelineClick: timelineCallbacks.handleTimelineClick,
      onViewportChange: timelineCallbacks.handleViewportChange,
      onZoomChange: timelineCallbacks.handleZoomChange
    }),
    [
      state.tracks,
      state.timelineStart,
      state.timelineEnd,
      state.timelineX,
      state.timelineY,
      state.timelineWidth,
      state.trackHeight,
      state.trackSpacing,
      state.currentTimeMs,
      viewport,
      state.labelFormatter,
      state.selectedClip?.id,
      state.hoveredClip?.id,
      state.selectedTrack?.id,
      state.hoveredTrack?.id,
      state.showSubtrackSeparators,
      selectionStyle,
      timelineCallbacks
    ]
  );

  const timelineLayer = useMemo(
    () => new TimelineLayer(timelineLayerProps),
    [timelineLayerProps]
  );

  // Update ref when layer changes
  React.useEffect(() => {
    timelineLayerRef.current = timelineLayer;
  }, [timelineLayer]);

  const layers = useMemo(() => [timelineLayer], [timelineLayer]);

  return (
    <div style={CONTAINER_OUTER_STYLE}>
      <TimelineControls
        state={state}
        controls={controls}
        trackCount={trackCount}
        clipsPerTrack={clipsPerTrack}
        labelFormatterType={labelFormatterType}
      />

      <div
        ref={containerRef}
        data-timeline-container="true"
        style={CONTAINER_INNER_STYLE}
        onMouseDown={containerHandlers.handleContainerMouseDown}
        onMouseMove={containerHandlers.handleContainerMouseMove}
        onMouseUp={containerHandlers.handleContainerMouseUp}
      >
        <DeckGL
          views={ORTHOGRAPHIC_VIEW}
          initialViewState={INITIAL_VIEW_STATE}
          controller={CONTROLLER_CONFIG}
          layers={layers}
          pickingRadius={10}
          useDevicePixels={false}
          onHover={deckGLHandlers.handleDeckGLHover}
          onClick={deckGLHandlers.handleDeckGLClick}
          getCursor={getCursor}
        />
      </div>
    </div>
  );
}


const root = createRoot(document.getElementById('app')!);
root.render(<App />);


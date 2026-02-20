// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import React, {ReactElement, useMemo, useEffect} from 'react';
import DeckGL from '@deck.gl/react';
import {OrthographicView, type OrthographicViewState} from '@deck.gl/core';
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

const ORTHOGRAPHIC_VIEW = new OrthographicView();

const CONTROLLER_CONFIG = {
  scrollZoom: false,
  doubleClickZoom: false,
  touchZoom: false,
  dragPan: false,
  dragRotate: false,
  keyboard: false
} as const;

export default function App(): ReactElement {
  const {state, controls, trackCount, clipsPerTrack, labelFormatterType} = useTimelineControls();
  const {state: interactionState, setState} = useTimelineInteractionState();
  const {timelineLayerRef, containerRef} = useTimelineRefs();

  const initialViewState = useMemo((): OrthographicViewState => {
    const w = (typeof window !== 'undefined' ? window.innerWidth : 1280) - 320;
    const h = typeof window !== 'undefined' ? window.innerHeight : 720;
    return {target: [w / 2, h / 2, 0], zoom: 0};
  }, []);

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

  const viewport = useMemo(
    () => ({startMs: state.viewportStartMs, endMs: state.viewportEndMs}),
    [state.viewportStartMs, state.viewportEndMs]
  );

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

  const timelineLayer = useMemo(
    () =>
      new TimelineLayer({
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  useEffect(() => {
    timelineLayerRef.current = timelineLayer;
  }, [timelineLayer, timelineLayerRef]);

  return (
    <div style={{display: 'flex', width: '100vw', height: '100vh', overflow: 'hidden'}}>
      <TimelineControls
        state={state}
        controls={controls}
        trackCount={trackCount}
        clipsPerTrack={clipsPerTrack}
        labelFormatterType={labelFormatterType}
      />

      <div
        ref={containerRef}
        style={{flex: 1, height: '100vh', position: 'relative', overflow: 'hidden'}}
        onMouseDown={containerHandlers.handleContainerMouseDown}
        onMouseMove={containerHandlers.handleContainerMouseMove}
        onMouseUp={containerHandlers.handleContainerMouseUp}
      >
        <DeckGL
          views={ORTHOGRAPHIC_VIEW}
          initialViewState={initialViewState}
          controller={CONTROLLER_CONFIG}
          layers={[timelineLayer]}
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

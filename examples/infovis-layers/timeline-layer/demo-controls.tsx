// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import React, {ReactElement, useMemo, useState} from 'react';
import {timeAxisFormatters, TimelineTrack, TimelineClip} from './timeline-layer/timeline-utils';
import {generateRandomTracks} from './demo-utils';
import type {SelectionStyle} from './timeline-layer';

const canvasWidth = (typeof window !== 'undefined' ? window.innerWidth : 1280) - 320;

export interface TimelineControlsState {
  // Data
  tracks: TimelineTrack[];

  // Timeline config
  timelineStart: number;
  timelineEnd: number;
  currentTimeMs: number;
  zoomLevel: number;

  // Layout
  trackHeight: number;
  trackSpacing: number;
  timelineX: number;
  timelineY: number;
  timelineWidth: number;

  // Viewport
  viewportStartMs?: number;
  viewportEndMs?: number;

  // Formatter
  labelFormatter: (timeMs: number) => string;

  // Selection
  selectedClip: TimelineClip | null;
  hoveredClip: TimelineClip | null;
  selectedTrack: TimelineTrack | null;
  hoveredTrack: TimelineTrack | null;

  // Advanced configuration
  selectedLineWidth: number;
  hoveredLineWidth: number;
  showSubtrackSeparators: boolean;
  trackLabelFontSize: number;
  clipLabelFontSize: number;

  // Performance
  renderTime: number;
  visibleClipsCount: number;
  visibleLabelsCount: number;
}

export function useTimelineControls() {
  // Timeline configuration
  const [trackCount, setTrackCount] = useState(4);
  const [clipsPerTrack, setClipsPerTrack] = useState(3);
  const [timelineStart] = useState(0);
  const [timelineEnd, setTimelineEnd] = useState(60000);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(1);

  // Layout configuration
  const [trackHeight, setTrackHeight] = useState(40);
  const [trackSpacing, setTrackSpacing] = useState(8);
  const [timelineX, setTimelineX] = useState(150);
  const [timelineY, setTimelineY] = useState(80);
  const [timelineWidth, setTimelineWidth] = useState(canvasWidth - 200);

  // Viewport for zoom/pan
  const [viewportStartMs, setViewportStartMs] = useState<number | undefined>(undefined);
  const [viewportEndMs, setViewportEndMs] = useState<number | undefined>(undefined);

  // Interaction state
  const [selectedClip, setSelectedClip] = useState<TimelineClip | null>(null);
  const [hoveredClip, setHoveredClip] = useState<TimelineClip | null>(null);
  const [selectedTrack, setSelectedTrack] = useState<TimelineTrack | null>(null);
  const [hoveredTrack, setHoveredTrack] = useState<TimelineTrack | null>(null);

  // Label formatter
  const [labelFormatterType, setLabelFormatterType] = useState<keyof typeof timeAxisFormatters>('seconds');
  const labelFormatter = timeAxisFormatters[labelFormatterType];

  // Advanced configuration
  const [selectedLineWidth, setSelectedLineWidth] = useState(3);
  const [hoveredLineWidth, setHoveredLineWidth] = useState(2);
  const [showSubtrackSeparators, setShowSubtrackSeparators] = useState(true);
  const [trackLabelFontSize, setTrackLabelFontSize] = useState(12);
  const [clipLabelFontSize, setClipLabelFontSize] = useState(10);

  // Generate data
  const [renderTime, setRenderTime] = useState(0);
  const tracks = useMemo(() => {
    const startTime = performance.now();
    const result = generateRandomTracks(trackCount, clipsPerTrack, timelineStart, timelineEnd);
    const endTime = performance.now();
    setRenderTime(endTime - startTime);
    return result;
  }, [trackCount, clipsPerTrack, timelineStart, timelineEnd]);

  // Memoize visible clips calculation
  const {visibleClipsCount, visibleLabelsCount} = useMemo(() => {
    const effectiveStartMs = viewportStartMs ?? timelineStart;
    const effectiveEndMs = viewportEndMs ?? timelineEnd;

    let count = 0;
    tracks.forEach((track) => {
      track.clips.forEach((clip) => {
        if (clip.endMs > effectiveStartMs && clip.startMs < effectiveEndMs) {
          count++;
        }
      });
    });

    const labels = zoomLevel >= 1.5 ? Math.min(1000, count) : 0;
    return {visibleClipsCount: count, visibleLabelsCount: labels};
  }, [tracks, viewportStartMs, viewportEndMs, timelineStart, timelineEnd, zoomLevel]);

  // Memoize state object
  const state: TimelineControlsState = useMemo(
    () => ({
      tracks,
      timelineStart,
      timelineEnd,
      currentTimeMs,
      zoomLevel,
      trackHeight,
      trackSpacing,
      timelineX,
      timelineY,
      timelineWidth,
      viewportStartMs,
      viewportEndMs,
      labelFormatter,
      selectedClip,
      hoveredClip,
      selectedTrack,
      hoveredTrack,
      selectedLineWidth,
      hoveredLineWidth,
      showSubtrackSeparators,
      trackLabelFontSize,
      clipLabelFontSize,
      renderTime,
      visibleClipsCount,
      visibleLabelsCount
    }),
    [
      tracks,
      timelineStart,
      timelineEnd,
      currentTimeMs,
      zoomLevel,
      trackHeight,
      trackSpacing,
      timelineX,
      timelineY,
      timelineWidth,
      viewportStartMs,
      viewportEndMs,
      labelFormatter,
      selectedClip,
      hoveredClip,
      selectedTrack,
      hoveredTrack,
      selectedLineWidth,
      hoveredLineWidth,
      showSubtrackSeparators,
      trackLabelFontSize,
      clipLabelFontSize,
      renderTime,
      visibleClipsCount,
      visibleLabelsCount
    ]
  );

  // Memoize controls object
  const controls = useMemo(
    () => ({
      setTrackCount,
      setClipsPerTrack,
      setTimelineEnd,
      setCurrentTimeMs,
      setZoomLevel,
      setTrackHeight,
      setTrackSpacing,
      setTimelineX,
      setTimelineY,
      setTimelineWidth,
      setViewportStartMs,
      setViewportEndMs,
      setLabelFormatterType,
      setSelectedClip,
      setHoveredClip,
      setSelectedTrack,
      setHoveredTrack,
      setSelectedLineWidth,
      setHoveredLineWidth,
      setShowSubtrackSeparators,
      setTrackLabelFontSize,
      setClipLabelFontSize
    }),
    [
      setTrackCount,
      setClipsPerTrack,
      setTimelineEnd,
      setCurrentTimeMs,
      setZoomLevel,
      setTrackHeight,
      setTrackSpacing,
      setTimelineX,
      setTimelineY,
      setTimelineWidth,
      setViewportStartMs,
      setViewportEndMs,
      setLabelFormatterType,
      setSelectedClip,
      setHoveredClip,
      setSelectedTrack,
      setHoveredTrack,
      setSelectedLineWidth,
      setHoveredLineWidth,
      setShowSubtrackSeparators,
      setTrackLabelFontSize,
      setClipLabelFontSize
    ]
  );

  return {state, controls, trackCount, clipsPerTrack, labelFormatterType};
}

export function TimelineControls({
  state,
  controls,
  trackCount,
  clipsPerTrack,
  labelFormatterType
}: {
  state: TimelineControlsState;
  controls: ReturnType<typeof useTimelineControls>['controls'];
  trackCount: number;
  clipsPerTrack: number;
  labelFormatterType: string;
}): ReactElement {
  return (
    <div
      style={{
        width: '320px',
        maxHeight: '100vh',
        overflowY: 'auto',
        background: 'rgba(255, 255, 255, 0.95)',
        padding: '0',
        fontFamily: 'Arial, sans-serif',
        boxShadow: '2px 0 10px rgba(0,0,0,0.1)',
        borderRight: '1px solid #ddd',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      <div
        style={{
          position: 'sticky',
          top: 0,
          background: 'rgba(255, 255, 255, 0.95)',
          zIndex: 10,
          padding: '15px 15px 10px 15px',
          borderBottom: '1px solid #eee'
        }}
      >
        <h2 style={{margin: '0', fontSize: '18px', color: '#333'}}>Timeline Controls</h2>
      </div>

      <div style={{flex: 1, overflowY: 'auto', padding: '0 15px 15px 15px', minHeight: 0}}>
        <div style={{marginBottom: '20px', marginTop: '15px'}}>
          <h3 style={{margin: '0 0 10px 0', fontSize: '14px', fontWeight: 'bold'}}>
            Performance Stats
          </h3>
          <div
            style={{
              padding: '10px',
              background: '#e8f5e8',
              border: '1px solid #4caf50',
              borderRadius: '4px',
              fontSize: '11px',
              marginBottom: '15px'
            }}
          >
            <div>
              <strong>Clips Rendered:</strong> {state.visibleClipsCount.toLocaleString()}
            </div>
            <div>
              <strong>Labels Shown:</strong> {state.visibleLabelsCount.toLocaleString()}
            </div>
            <div>
              <strong>Data Generation:</strong> {state.renderTime.toFixed(2)}ms
            </div>
            <div>
              <strong>Zoom Level:</strong> {state.zoomLevel.toFixed(2)}x
            </div>
          </div>
        </div>

        <div style={{marginBottom: '20px'}}>
          <h3 style={{margin: '0 0 10px 0', fontSize: '14px', fontWeight: 'bold'}}>
            Timeline Configuration
          </h3>

          <div style={{marginBottom: '12px'}}>
            <label style={{display: 'block', fontSize: '12px', marginBottom: '4px'}}>
              Number of Tracks: {trackCount}
            </label>
            <input
              type="range"
              min="1"
              max="10"
              value={trackCount}
              onChange={(e) => controls.setTrackCount(Number(e.target.value))}
              style={{width: '100%'}}
            />
          </div>

          <div style={{marginBottom: '12px'}}>
            <label style={{display: 'block', fontSize: '12px', marginBottom: '4px'}}>
              Clips per Track: {clipsPerTrack}
            </label>
            <select
              value={clipsPerTrack}
              onChange={(e) => controls.setClipsPerTrack(Number(e.target.value))}
              style={{width: '100%', padding: '5px'}}
            >
              <option value={3}>3 (Demo)</option>
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>

          <div style={{marginBottom: '12px'}}>
            <label style={{display: 'block', fontSize: '12px', marginBottom: '4px'}}>
              Timeline Duration (seconds): {(state.timelineEnd - state.timelineStart) / 1000}
            </label>
            <input
              type="range"
              min="10000"
              max="300000"
              step="1000"
              value={state.timelineEnd - state.timelineStart}
              onChange={(e) => controls.setTimelineEnd(state.timelineStart + Number(e.target.value))}
              style={{width: '100%'}}
            />
          </div>
        </div>

        <div style={{marginBottom: '20px'}}>
          <h3 style={{margin: '0 0 10px 0', fontSize: '14px', fontWeight: 'bold'}}>
            Timeline Axis Labels
          </h3>

          <div style={{marginBottom: '12px'}}>
            <label style={{display: 'block', fontSize: '12px', marginBottom: '4px'}}>
              Label Format:
            </label>
            <select
              value={labelFormatterType}
              onChange={(e) => controls.setLabelFormatterType(e.target.value as keyof typeof timeAxisFormatters)}
              style={{width: '100%', padding: '5px'}}
            >
              <option value="seconds">Seconds (5.2s)</option>
              <option value="minutesSeconds">Minutes:Seconds (1:23)</option>
              <option value="hoursMinutesSeconds">Hours:Minutes:Seconds (0:01:23)</option>
              <option value="timestamp">Real Timestamp</option>
            </select>
          </div>
        </div>

        <div style={{marginBottom: '20px'}}>
          <h3 style={{margin: '0 0 10px 0', fontSize: '14px', fontWeight: 'bold'}}>
            Track Appearance
          </h3>

          <div style={{marginBottom: '12px'}}>
            <label style={{display: 'block', fontSize: '12px', marginBottom: '4px'}}>
              Track Height: {state.trackHeight}px
            </label>
            <input
              type="range"
              min="30"
              max="120"
              value={state.trackHeight}
              onChange={(e) => controls.setTrackHeight(Number(e.target.value))}
              style={{width: '100%'}}
            />
          </div>

          <div style={{marginBottom: '12px'}}>
            <label style={{display: 'block', fontSize: '12px', marginBottom: '4px'}}>
              Track Spacing: {state.trackSpacing}px
            </label>
            <input
              type="range"
              min="5"
              max="30"
              value={state.trackSpacing}
              onChange={(e) => controls.setTrackSpacing(Number(e.target.value))}
              style={{width: '100%'}}
            />
          </div>
        </div>

        <AdvancedSettings state={state} controls={controls} />

        {state.selectedClip && (
          <div style={{marginBottom: '20px'}}>
            <h3
              style={{margin: '0 0 10px 0', fontSize: '14px', fontWeight: 'bold', color: '#d4af37'}}
            >
              Selected Clip
            </h3>
            <div
              style={{
                padding: '12px',
                background: '#fff3cd',
                border: '1px solid #d4af37',
                borderRadius: '4px',
                fontSize: '12px'
              }}
            >
              <div style={{marginBottom: '8px'}}>
                <strong>Label:</strong> {state.selectedClip.label}
              </div>
              <div style={{marginBottom: '8px'}}>
                <strong>Start:</strong> {(state.selectedClip.startMs / 1000).toFixed(2)}s
              </div>
              <div style={{marginBottom: '8px'}}>
                <strong>End:</strong> {(state.selectedClip.endMs / 1000).toFixed(2)}s
              </div>
              <div style={{marginBottom: '8px'}}>
                <strong>Duration:</strong>{' '}
                {((state.selectedClip.endMs - state.selectedClip.startMs) / 1000).toFixed(2)}s
              </div>
              <button
                onClick={() => controls.setSelectedClip(null)}
                style={{
                  marginTop: '10px',
                  padding: '4px 8px',
                  fontSize: '11px',
                  border: 'none',
                  background: '#d4af37',
                  color: 'white',
                  borderRadius: '3px',
                  cursor: 'pointer'
                }}
              >
                Clear Selection
              </button>
            </div>
          </div>
        )}

        {state.selectedTrack && (
          <div style={{marginBottom: '20px'}}>
            <h3
              style={{margin: '0 0 10px 0', fontSize: '14px', fontWeight: 'bold', color: '#4a90e2'}}
            >
              Selected Track
            </h3>
            <div
              style={{
                padding: '12px',
                background: '#e3f2fd',
                border: '1px solid #4a90e2',
                borderRadius: '4px',
                fontSize: '12px'
              }}
            >
              <div style={{marginBottom: '8px'}}>
                <strong>Name:</strong> {state.selectedTrack.name}
              </div>
              <div style={{marginBottom: '8px'}}>
                <strong>ID:</strong> {state.selectedTrack.id}
              </div>
              <div style={{marginBottom: '8px'}}>
                <strong>Clips:</strong> {state.selectedTrack.clips.length}
              </div>
              <button
                onClick={() => controls.setSelectedTrack(null)}
                style={{
                  marginTop: '10px',
                  padding: '4px 8px',
                  fontSize: '11px',
                  border: 'none',
                  background: '#4a90e2',
                  color: 'white',
                  borderRadius: '3px',
                  cursor: 'pointer'
                }}
              >
                Clear Selection
              </button>
            </div>
          </div>
        )}

        <div style={{marginBottom: '20px'}}>
          <h3 style={{margin: '0 0 10px 0', fontSize: '14px', fontWeight: 'bold'}}>
            Timeline Scrubber
          </h3>

          <div style={{marginBottom: '12px'}}>
            <label style={{display: 'block', fontSize: '12px', marginBottom: '4px'}}>
              Current Time: {state.labelFormatter(state.currentTimeMs)}
            </label>
            <input
              type="range"
              min={state.timelineStart}
              max={state.timelineEnd}
              step="100"
              value={state.currentTimeMs}
              onChange={(e) => controls.setCurrentTimeMs(Number(e.target.value))}
              style={{width: '100%'}}
            />
          </div>
        </div>

        <div style={{marginBottom: '20px'}}>
          <h3 style={{margin: '0 0 10px 0', fontSize: '14px', fontWeight: 'bold'}}>
            Timeline Zoom
          </h3>

          <div style={{marginBottom: '12px'}}>
            <label style={{display: 'block', fontSize: '12px', marginBottom: '4px'}}>
              Zoom Level: {state.zoomLevel.toFixed(2)}x
            </label>
            <input
              type="range"
              min="1.0"
              max="100"
              step="0.1"
              value={state.zoomLevel}
              onChange={(e) => controls.setZoomLevel(Number(e.target.value))}
              style={{width: '100%'}}
            />
          </div>
        </div>

        <div
          style={{
            fontSize: '11px',
            color: '#666',
            padding: '10px',
            background: '#f5f5f5',
            borderRadius: '4px',
            marginBottom: '20px'
          }}
        >
          <strong>Features:</strong>
          <br />
          • Clips nested in tracks
          <br />
          • Click clips/tracks to select
          <br />
          • Hover for highlighting
          <br />
          • Zoom and pan support
          <br />• Clean data structure
        </div>
      </div>
    </div>
  );
}

function AdvancedSettings({
  state,
  controls
}: {
  state: TimelineControlsState;
  controls: ReturnType<typeof useTimelineControls>['controls'];
}): ReactElement {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div style={{marginBottom: '20px'}}>
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          cursor: 'pointer',
          padding: '10px',
          background: '#f5f5f5',
          border: '1px solid #ddd',
          borderRadius: '4px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: isExpanded ? '10px' : '0'
        }}
      >
        <h3 style={{margin: 0, fontSize: '14px', fontWeight: 'bold'}}>Advanced Settings</h3>
        <span style={{fontSize: '12px'}}>{isExpanded ? '▼' : '▶'}</span>
      </div>

      {isExpanded && (
        <div
          style={{
            padding: '15px',
            background: '#fafafa',
            border: '1px solid #ddd',
            borderTop: 'none',
            borderRadius: '0 0 4px 4px'
          }}
        >
          <div style={{marginBottom: '15px'}}>
            <h4 style={{margin: '0 0 10px 0', fontSize: '13px', fontWeight: 'bold'}}>
              Selection & Hover
            </h4>

            <div style={{marginBottom: '12px'}}>
              <label style={{display: 'block', fontSize: '12px', marginBottom: '4px'}}>
                Selected Line Width: {state.selectedLineWidth}px
              </label>
              <input
                type="range"
                min="1"
                max="6"
                value={state.selectedLineWidth}
                onChange={(e) => controls.setSelectedLineWidth(Number(e.target.value))}
                style={{width: '100%'}}
              />
            </div>

            <div style={{marginBottom: '12px'}}>
              <label style={{display: 'block', fontSize: '12px', marginBottom: '4px'}}>
                Hovered Line Width: {state.hoveredLineWidth}px
              </label>
              <input
                type="range"
                min="1"
                max="6"
                value={state.hoveredLineWidth}
                onChange={(e) => controls.setHoveredLineWidth(Number(e.target.value))}
                style={{width: '100%'}}
              />
            </div>
          </div>

          <div style={{marginBottom: '15px'}}>
            <h4 style={{margin: '0 0 10px 0', fontSize: '13px', fontWeight: 'bold'}}>
              Subtrack Separators
            </h4>
            <label style={{display: 'flex', alignItems: 'center', fontSize: '12px', cursor: 'pointer'}}>
              <input
                type="checkbox"
                checked={state.showSubtrackSeparators}
                onChange={(e) => controls.setShowSubtrackSeparators(e.target.checked)}
                style={{marginRight: '8px'}}
              />
              Show subtrack separators
            </label>
          </div>

          <div style={{marginBottom: '15px'}}>
            <h4 style={{margin: '0 0 10px 0', fontSize: '13px', fontWeight: 'bold'}}>Track Labels</h4>
            <div style={{marginBottom: '12px'}}>
              <label style={{display: 'block', fontSize: '12px', marginBottom: '4px'}}>
                Font Size: {state.trackLabelFontSize}px
              </label>
              <input
                type="range"
                min="8"
                max="20"
                value={state.trackLabelFontSize}
                onChange={(e) => controls.setTrackLabelFontSize(Number(e.target.value))}
                style={{width: '100%'}}
              />
            </div>
          </div>

          <div style={{marginBottom: 0}}>
            <h4 style={{margin: '0 0 10px 0', fontSize: '13px', fontWeight: 'bold'}}>Clip Labels</h4>
            <div style={{marginBottom: '12px'}}>
              <label style={{display: 'block', fontSize: '12px', marginBottom: '4px'}}>
                Font Size: {state.clipLabelFontSize}px
              </label>
              <input
                type="range"
                min="6"
                max="16"
                value={state.clipLabelFontSize}
                onChange={(e) => controls.setClipLabelFontSize(Number(e.target.value))}
                style={{width: '100%'}}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

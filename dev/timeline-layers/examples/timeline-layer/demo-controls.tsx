// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import React, {ReactElement, useMemo, useState} from 'react';
import {
  timeAxisFormatters,
  type TimelineTrack,
  type TimelineClip
} from '@deck.gl-community/timeline-layers';
import {generateRandomTracks} from './demo-utils';

const PANEL_WIDTH = 320;
const INITIAL_CANVAS_WIDTH = (typeof window !== 'undefined' ? window.innerWidth : 1280) - PANEL_WIDTH;

export type TimelineControlsState = {
  tracks: TimelineTrack[];
  timelineStart: number;
  timelineEnd: number;
  currentTimeMs: number;
  zoomLevel: number;
  trackHeight: number;
  trackSpacing: number;
  timelineX: number;
  timelineY: number;
  timelineWidth: number;
  viewportStartMs?: number;
  viewportEndMs?: number;
  labelFormatter: (timeMs: number) => string;
  selectedClip: TimelineClip | null;
  hoveredClip: TimelineClip | null;
  selectedTrack: TimelineTrack | null;
  hoveredTrack: TimelineTrack | null;
  selectedLineWidth: number;
  hoveredLineWidth: number;
  showSubtrackSeparators: boolean;
};

export function useTimelineControls() {
  const [trackCount, setTrackCount] = useState(4);
  const [clipsPerTrack, setClipsPerTrack] = useState(3);
  const [timelineStart] = useState(0);
  const [timelineEnd, setTimelineEnd] = useState(60000);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(1);

  const [trackHeight, setTrackHeight] = useState(40);
  const [trackSpacing, setTrackSpacing] = useState(8);
  const [timelineX] = useState(150);
  const [timelineY] = useState(80);
  const [timelineWidth, setTimelineWidth] = useState(INITIAL_CANVAS_WIDTH - 200);

  const [viewportStartMs, setViewportStartMs] = useState<number | undefined>(undefined);
  const [viewportEndMs, setViewportEndMs] = useState<number | undefined>(undefined);

  const [selectedClip, setSelectedClip] = useState<TimelineClip | null>(null);
  const [hoveredClip, setHoveredClip] = useState<TimelineClip | null>(null);
  const [selectedTrack, setSelectedTrack] = useState<TimelineTrack | null>(null);
  const [hoveredTrack, setHoveredTrack] = useState<TimelineTrack | null>(null);

  const [labelFormatterType, setLabelFormatterType] =
    useState<keyof typeof timeAxisFormatters>('seconds');
  const labelFormatter = timeAxisFormatters[labelFormatterType];

  const [selectedLineWidth, setSelectedLineWidth] = useState(3);
  const [hoveredLineWidth, setHoveredLineWidth] = useState(2);
  const [showSubtrackSeparators, setShowSubtrackSeparators] = useState(true);

  const tracks = useMemo(
    () => generateRandomTracks(trackCount, clipsPerTrack, timelineStart, timelineEnd),
    [trackCount, clipsPerTrack, timelineStart, timelineEnd]
  );

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
      showSubtrackSeparators
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
      showSubtrackSeparators
    ]
  );

  const controls = useMemo(
    () => ({
      setTrackCount,
      setClipsPerTrack,
      setTimelineEnd,
      setCurrentTimeMs,
      setZoomLevel,
      setTrackHeight,
      setTrackSpacing,
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
      setShowSubtrackSeparators
    }),
    []
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
        width: `${PANEL_WIDTH}px`,
        maxHeight: '100vh',
        overflowY: 'auto',
        background: 'rgba(255, 255, 255, 0.95)',
        fontFamily: 'Arial, sans-serif',
        boxShadow: '2px 0 10px rgba(0,0,0,0.1)',
        borderRight: '1px solid #ddd',
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
          padding: '15px 15px 10px',
          borderBottom: '1px solid #eee'
        }}
      >
        <h2 style={{margin: 0, fontSize: '18px', color: '#333'}}>Timeline Controls</h2>
      </div>

      <div style={{flex: 1, overflowY: 'auto', padding: '15px', minHeight: 0}}>
        <Section title="Timeline Configuration">
          <RangeField
            label={`Tracks: ${trackCount}`}
            min={1}
            max={10}
            value={trackCount}
            onChange={controls.setTrackCount}
          />
          <SelectField
            label="Clips per Track"
            value={clipsPerTrack}
            options={[3, 5, 10, 20, 50, 100]}
            onChange={controls.setClipsPerTrack}
          />
          <RangeField
            label={`Duration: ${(state.timelineEnd - state.timelineStart) / 1000}s`}
            min={10000}
            max={300000}
            step={1000}
            value={state.timelineEnd - state.timelineStart}
            onChange={(v) => controls.setTimelineEnd(state.timelineStart + v)}
          />
        </Section>

        <Section title="Time Axis Labels">
          <div style={{marginBottom: '12px'}}>
            <label style={{display: 'block', fontSize: '12px', marginBottom: '4px'}}>
              Label Format:
            </label>
            <select
              value={labelFormatterType}
              onChange={(e) =>
                controls.setLabelFormatterType(e.target.value as keyof typeof timeAxisFormatters)
              }
              style={{width: '100%', padding: '5px'}}
            >
              <option value="seconds">Seconds (5.2s)</option>
              <option value="minutesSeconds">Minutes:Seconds (1:23)</option>
              <option value="hoursMinutesSeconds">H:MM:SS</option>
              <option value="timestamp">Real Timestamp</option>
            </select>
          </div>
        </Section>

        <Section title="Track Appearance">
          <RangeField
            label={`Track Height: ${state.trackHeight}px`}
            min={20}
            max={120}
            value={state.trackHeight}
            onChange={controls.setTrackHeight}
          />
          <RangeField
            label={`Track Spacing: ${state.trackSpacing}px`}
            min={2}
            max={30}
            value={state.trackSpacing}
            onChange={controls.setTrackSpacing}
          />
        </Section>

        <Section title="Scrubber">
          <RangeField
            label={`Current Time: ${state.labelFormatter(state.currentTimeMs)}`}
            min={state.timelineStart}
            max={state.timelineEnd}
            step={100}
            value={state.currentTimeMs}
            onChange={controls.setCurrentTimeMs}
          />
        </Section>

        <Section title="Zoom">
          <RangeField
            label={`Zoom: ${state.zoomLevel.toFixed(2)}x`}
            min={1}
            max={100}
            step={0.1}
            value={state.zoomLevel}
            onChange={controls.setZoomLevel}
          />
        </Section>

        <AdvancedSettings state={state} controls={controls} />

        {state.selectedClip && (
          <ClipDetails clip={state.selectedClip} formatter={state.labelFormatter} onClear={() => controls.setSelectedClip(null)} />
        )}

        {state.selectedTrack && (
          <TrackDetails track={state.selectedTrack} onClear={() => controls.setSelectedTrack(null)} />
        )}
      </div>
    </div>
  );
}

function Section({title, children}: {title: string; children: React.ReactNode}): ReactElement {
  return (
    <div style={{marginBottom: '20px'}}>
      <h3 style={{margin: '0 0 10px 0', fontSize: '14px', fontWeight: 'bold'}}>{title}</h3>
      {children}
    </div>
  );
}

function RangeField({
  label,
  min,
  max,
  step = 1,
  value,
  onChange
}: {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (v: number) => void;
}): ReactElement {
  return (
    <div style={{marginBottom: '12px'}}>
      <label style={{display: 'block', fontSize: '12px', marginBottom: '4px'}}>{label}</label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{width: '100%'}}
      />
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: number;
  options: number[];
  onChange: (v: number) => void;
}): ReactElement {
  return (
    <div style={{marginBottom: '12px'}}>
      <label style={{display: 'block', fontSize: '12px', marginBottom: '4px'}}>{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{width: '100%', padding: '5px'}}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
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
          <RangeField
            label={`Selected Line Width: ${state.selectedLineWidth}px`}
            min={1}
            max={6}
            value={state.selectedLineWidth}
            onChange={controls.setSelectedLineWidth}
          />
          <RangeField
            label={`Hovered Line Width: ${state.hoveredLineWidth}px`}
            min={1}
            max={6}
            value={state.hoveredLineWidth}
            onChange={controls.setHoveredLineWidth}
          />
          <label
            style={{display: 'flex', alignItems: 'center', fontSize: '12px', cursor: 'pointer'}}
          >
            <input
              type="checkbox"
              checked={state.showSubtrackSeparators}
              onChange={(e) => controls.setShowSubtrackSeparators(e.target.checked)}
              style={{marginRight: '8px'}}
            />
            Show subtrack separators
          </label>
        </div>
      )}
    </div>
  );
}

function ClipDetails({
  clip,
  formatter,
  onClear
}: {
  clip: TimelineClip;
  formatter: (timeMs: number) => string;
  onClear: () => void;
}): ReactElement {
  return (
    <div style={{marginBottom: '20px'}}>
      <h3 style={{margin: '0 0 10px 0', fontSize: '14px', fontWeight: 'bold', color: '#d4af37'}}>
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
        <div style={{marginBottom: '4px'}}>
          <strong>Label:</strong> {clip.label}
        </div>
        <div style={{marginBottom: '4px'}}>
          <strong>Start:</strong> {formatter(clip.startMs)}
        </div>
        <div style={{marginBottom: '8px'}}>
          <strong>Duration:</strong> {formatter(clip.endMs - clip.startMs)}
        </div>
        <button
          onClick={onClear}
          style={{
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
  );
}

function TrackDetails({
  track,
  onClear
}: {
  track: TimelineTrack;
  onClear: () => void;
}): ReactElement {
  return (
    <div style={{marginBottom: '20px'}}>
      <h3 style={{margin: '0 0 10px 0', fontSize: '14px', fontWeight: 'bold', color: '#4a90e2'}}>
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
        <div style={{marginBottom: '4px'}}>
          <strong>Name:</strong> {track.name}
        </div>
        <div style={{marginBottom: '8px'}}>
          <strong>Clips:</strong> {track.clips.length}
        </div>
        <button
          onClick={onClear}
          style={{
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
  );
}

// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {OrthographicViewState} from '@deck.gl/core';

import React, {ReactElement, useCallback, useEffect} from 'react';
import DeckGL from '@deck.gl/react';
import {OrthographicView} from '@deck.gl/core';
import {TextLayer, SolidPolygonLayer, LineLayer} from '@deck.gl/layers';
import {useTimelineCore, timeAxisFormatters} from './useTimeline';
import {useTimelineDemo} from './useTimelineDemo';

// Calculate center dynamically based on available canvas space
const canvasWidth = (typeof window !== 'undefined' ? window.innerWidth : 1280) - 320; // Minus sidebar
const canvasHeight = typeof window !== 'undefined' ? window.innerHeight : 720;

const INITIAL_VIEW_STATE: OrthographicViewState = {
  target: [canvasWidth / 2, canvasHeight / 2, 0], // Center of available canvas
  zoom: 0
};

export default function App(): ReactElement {
  // Use demo hook for all demo-specific logic
  const demo = useTimelineDemo();

  // Use core timeline hook for rendering
  const timeline = useTimelineCore(demo.clips, demo.timelineConfig, {
    labelFormatter: demo.labelFormatter,
    currentTimeMs: demo.currentTimeMs,
    onCurrentTimeChange: demo.setCurrentTimeMs
  });

  const {
    selectedClip,
    setSelectedClip,
    setHoveredClip,
    isDraggingScrubber,
    setIsDraggingScrubber,
    trackBackgrounds,
    trackLabels,
    clipPolygons,
    clipLabels,
    topAxisLines,
    topAxisLabels,
    verticalGridLines,
    scrubberLine,
    scrubberHandle,
    scrubberTimeLabel,
    positionToTime
  } = timeline;

  // Mouse event handlers for scrubber dragging and panning
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      
      if (isDraggingScrubber) {
        e.preventDefault();
        e.stopPropagation();
        const newTime = positionToTime(mouseX);
        demo.setCurrentTimeMs(newTime);
      } else if (demo.isPanning) {
        e.preventDefault();
        e.stopPropagation();
        demo.updatePan(mouseX);
      }
    },
    [isDraggingScrubber, demo.isPanning, positionToTime, demo]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Check if clicking on scrubber handle (priority interaction)
      const scrubberHandleLeft = timeline.scrubberPosition - 8;
      const scrubberHandleRight = timeline.scrubberPosition + 8;
      const scrubberHandleTop = demo.timelineConfig.timelineY - 45;
      const scrubberHandleBottom = demo.timelineConfig.timelineY - 25;

      const isOnScrubberHandle =
        mouseX >= scrubberHandleLeft &&
        mouseX <= scrubberHandleRight &&
        mouseY >= scrubberHandleTop &&
        mouseY <= scrubberHandleBottom;

      if (isOnScrubberHandle) {
        e.preventDefault();
        e.stopPropagation();
        setIsDraggingScrubber(true);
        return;
      }

      // Check if clicking anywhere in the timeline area for seeking (but not on clips)
      const timelineLeft = demo.timelineConfig.timelineX;
      const timelineRight = demo.timelineConfig.timelineX + timeline.effectiveTimelineWidth;
      const timelineTop = demo.timelineConfig.timelineY - 50;
      const timelineBottom = demo.timelineConfig.timelineY + timeline.totalTimelineHeight + 30;

      const isInTimeline =
        mouseX >= timelineLeft &&
        mouseX <= timelineRight &&
        mouseY >= timelineTop &&
        mouseY <= timelineBottom;

      if (isInTimeline) {
        // Check if we're clicking within the timeline area for panning vs seeking
        const timelineLeft = demo.timelineConfig.timelineX;
        const timelineRight = demo.timelineConfig.timelineX + timeline.effectiveTimelineWidth;
        
        if (mouseX >= timelineLeft && mouseX <= timelineRight) {
          // If zoomed in and in timeline area, start panning
          if (demo.zoomLevel > 1.0) {
            demo.startPan(mouseX);
            return;
          }
          // Otherwise, seek to that position
          const newTime = positionToTime(mouseX);
          demo.setCurrentTimeMs(newTime);
        }
        return;
      }
    },
    [demo, timeline, positionToTime, setIsDraggingScrubber]
  );

  // Handle trackpad horizontal scrolling for scrubber
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      // Check if this is horizontal scrolling (trackpad two-finger drag)
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        // Horizontal scroll - move scrubber
        e.preventDefault();
        e.stopPropagation();
        const scrollSpeed = 50; // milliseconds per pixel
        const timeChange = e.deltaX * scrollSpeed;
        const newTime = demo.currentTimeMs + timeChange;
        demo.setCurrentTimeMs(newTime);
      } else {
        // Vertical scroll - zoom timeline with mouse position awareness
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const zoomFactor = e.deltaY > 0 ? 0.8 : 1.2; // Zoom in/out
        demo.zoomToPoint(zoomFactor, mouseX);
      }
    },
    [demo]
  );

  const handleMouseUp = useCallback(() => {
    setIsDraggingScrubber(false);
    demo.endPan();
  }, [setIsDraggingScrubber, demo]);

  // Global mouse event handlers
  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      const timelineContainer = document.querySelector(
        '[data-timeline-container="true"]'
      ) as HTMLElement;
      if (timelineContainer) {
        const rect = timelineContainer.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        
        if (isDraggingScrubber) {
          const newTime = positionToTime(mouseX);
          demo.setCurrentTimeMs(newTime);
        } else if (demo.isPanning) {
          demo.updatePan(mouseX);
        }
      }
    };

    const handleGlobalMouseUp = () => {
      setIsDraggingScrubber(false);
      demo.endPan();
    };

    if (isDraggingScrubber || demo.isPanning) {
      document.addEventListener('mousemove', handleGlobalMouseMove);
      document.addEventListener('mouseup', handleGlobalMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleGlobalMouseMove);
        document.removeEventListener('mouseup', handleGlobalMouseUp);
      };
    }
  }, [isDraggingScrubber, demo.isPanning, setIsDraggingScrubber, positionToTime, demo, timeline]);

  const layers = [
    // Track backgrounds
    new SolidPolygonLayer({
      id: 'track-backgrounds',
      data: trackBackgrounds,
      getPolygon: (d: any) => d.polygon,
      getFillColor: (d: any) => d.color,
      stroked: true,
      getLineColor: [200, 200, 200, 255],
      getLineWidth: 1
    }),

    // Timeline axis lines (top)
    new LineLayer({
      id: 'timeline-axis-lines-top',
      data: topAxisLines,
      getSourcePosition: (d: any) => d.sourcePosition,
      getTargetPosition: (d: any) => d.targetPosition,
      getColor: [50, 50, 50, 255],
      getWidth: 2
    }),

    // Timeline axis labels (top)
    new TextLayer({
      id: 'timeline-axis-labels-top',
      data: topAxisLabels,
      getText: (d: any) => d.text,
      getPosition: (d: any) => d.position,
      getSize: (d: any) => d.size,
      getColor: (d: any) => d.color,
      getTextAnchor: (d: any) => d.textAnchor,
      getAlignmentBaseline: (d: any) => d.alignmentBaseline,
      fontFamily: 'Arial, sans-serif'
    }),

    // Vertical grid lines
    new LineLayer({
      id: 'vertical-grid',
      data: verticalGridLines,
      getSourcePosition: (d: any) => d.sourcePosition,
      getTargetPosition: (d: any) => d.targetPosition,
      getColor: [200, 200, 200, 128],
      getWidth: 1
    }),

    // Track labels
    new TextLayer({
      id: 'track-labels',
      data: trackLabels,
      getText: (d: any) => d.text,
      getPosition: (d: any) => d.position,
      getSize: (d: any) => d.size,
      getColor: (d: any) => d.color,
      getTextAnchor: (d: any) => d.textAnchor,
      getAlignmentBaseline: (d: any) => d.alignmentBaseline,
      fontFamily: 'Arial, sans-serif',
      fontWeight: 'bold'
    }),

    // Clip rectangles
    new SolidPolygonLayer({
      id: 'timeline-clips',
      data: clipPolygons,
      getPolygon: (d: any) => d.polygon,
      getFillColor: (d: any) => d.color,
      stroked: true,
      getLineColor: [255, 255, 255, 200],
      getLineWidth: 2,
      pickable: true, // Re-enable picking for clips
      onClick: (info: any) => {
        if (info.object) {
          setSelectedClip(info.object.clip);
        }
      },
      onHover: (info: any) => {
        if (info.object) {
          setHoveredClip(info.object.clip);
        } else {
          setHoveredClip(null);
        }
      }
    }),

    // Clip labels
    new TextLayer({
      id: 'clip-labels',
      data: clipLabels,
      getText: (d: any) => d.text,
      getPosition: (d: any) => d.position,
      getSize: (d: any) => d.size,
      getColor: (d: any) => d.color,
      getTextAnchor: (d: any) => d.textAnchor,
      getAlignmentBaseline: (d: any) => d.alignmentBaseline,
      fontFamily: 'Arial, sans-serif',
      fontWeight: 'bold'
    }),

    // Scrubber line
    new LineLayer({
      id: 'scrubber-line',
      data: scrubberLine,
      getSourcePosition: (d: any) => d.sourcePosition,
      getTargetPosition: (d: any) => d.targetPosition,
      getColor: [255, 69, 0, 255],
      getWidth: 3
    }),

    // Scrubber handle
    new SolidPolygonLayer({
      id: 'scrubber-handle',
      data: scrubberHandle,
      getPolygon: (d: any) => d.polygon,
      getFillColor: (d: any) => d.color,
      stroked: true,
      getLineColor: [255, 255, 255, 255],
      getLineWidth: 2,
      pickable: false // Handle via container events only
    }),

    // Scrubber time label
    new TextLayer({
      id: 'scrubber-time-label',
      data: scrubberTimeLabel,
      getText: (d: any) => d.text,
      getPosition: (d: any) => d.position,
      getSize: (d: any) => d.size,
      getColor: (d: any) => d.color,
      getTextAnchor: (d: any) => d.textAnchor,
      getAlignmentBaseline: (d: any) => d.alignmentBaseline,
      fontFamily: 'Arial, sans-serif',
      fontWeight: 'bold'
    })
  ];

  return (
    <div style={{display: 'flex', width: '100vw', height: '100vh', overflow: 'hidden'}}>
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

        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '0 15px 15px 15px',
            minHeight: 0
          }}
        >
          <div style={{marginBottom: '20px', marginTop: '15px'}}>
            <h3 style={{margin: '0 0 10px 0', fontSize: '14px', fontWeight: 'bold'}}>
              🚀 Performance Stats
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
                <strong>Clips Rendered:</strong> {clipPolygons.length.toLocaleString()}
              </div>
              <div>
                <strong>Labels Shown:</strong> {clipLabels.length.toLocaleString()}
              </div>
              <div>
                <strong>Data Generation:</strong> {demo.renderTime.toFixed(2)}ms
              </div>
              <div>
                <strong>Zoom Level:</strong> {demo.zoomLevel.toFixed(2)}x
              </div>
            </div>
          </div>

          <div style={{marginBottom: '20px'}}>
            <h3 style={{margin: '0 0 10px 0', fontSize: '14px', fontWeight: 'bold'}}>
              Timeline Configuration
            </h3>

            <div style={{marginBottom: '12px'}}>
              <label style={{display: 'block', fontSize: '12px', marginBottom: '4px'}}>
                Number of Tracks: {demo.trackCount}
              </label>
              <input
                type="range"
                min="1"
                max="10"
                value={demo.trackCount}
                onChange={(e) => demo.setTrackCount(Number(e.target.value))}
                style={{width: '100%'}}
              />
            </div>

            <div style={{marginBottom: '12px'}}>
              <label style={{display: 'block', fontSize: '12px', marginBottom: '4px'}}>
                Number of Clips: {demo.clipCount.toLocaleString()}
              </label>
              <select
                value={demo.clipCount}
                onChange={(e) => demo.setClipCount(Number(e.target.value))}
                style={{width: '100%', padding: '5px'}}
              >
                <option value={12}>12 (Demo)</option>
                <option value={100}>100</option>
                <option value={1000}>1,000</option>
                <option value={10000}>10,000</option>
                <option value={50000}>50,000</option>
                <option value={100000}>100,000</option>
                <option value={500000}>500,000</option>
                <option value={1000000}>1,000,000</option>
              </select>
              <div style={{fontSize: '10px', color: '#888', marginTop: '4px'}}>
                Performance test: Try 100k+ clips!
              </div>
            </div>

            <div style={{marginBottom: '12px'}}>
              <label style={{display: 'block', fontSize: '12px', marginBottom: '4px'}}>
                Timeline Duration (seconds): {(demo.timelineEnd - demo.timelineStart) / 1000}
              </label>
              <input
                type="range"
                min="10000"
                max="300000"
                step="1000"
                value={demo.timelineEnd - demo.timelineStart}
                onChange={(e) => demo.setTimelineEnd(demo.timelineStart + Number(e.target.value))}
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
                value={demo.labelFormatterType}
                onChange={(e) =>
                  demo.setLabelFormatterType(e.target.value as keyof typeof timeAxisFormatters)
                }
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
                Track Height: {demo.trackHeight}px
              </label>
              <input
                type="range"
                min="30"
                max="120"
                value={demo.trackHeight}
                onChange={(e) => demo.setTrackHeight(Number(e.target.value))}
                style={{width: '100%'}}
              />
            </div>

            <div style={{marginBottom: '12px'}}>
              <label style={{display: 'block', fontSize: '12px', marginBottom: '4px'}}>
                Track Spacing: {demo.trackSpacing}px
              </label>
              <input
                type="range"
                min="5"
                max="30"
                value={demo.trackSpacing}
                onChange={(e) => demo.setTrackSpacing(Number(e.target.value))}
                style={{width: '100%'}}
              />
            </div>
          </div>

          <div style={{marginBottom: '20px'}}>
            <h3 style={{margin: '0 0 10px 0', fontSize: '14px', fontWeight: 'bold'}}>
              Position & Size
            </h3>

            <div style={{marginBottom: '12px'}}>
              <label style={{display: 'block', fontSize: '12px', marginBottom: '4px'}}>
                Timeline Width: {Math.max(200, demo.timelineWidth)}px (Full Canvas)
              </label>
              <input
                type="range"
                min="400"
                max="1200"
                value={Math.max(400, demo.timelineWidth)}
                onChange={(e) => demo.setTimelineWidth(Math.max(400, Number(e.target.value)))}
                style={{width: '100%'}}
              />
            </div>

            <div style={{marginBottom: '12px'}}>
              <label style={{display: 'block', fontSize: '12px', marginBottom: '4px'}}>
                X Position: {demo.timelineX} (Canvas Relative)
              </label>
              <input
                type="range"
                min="10"
                max="200"
                value={demo.timelineX}
                onChange={(e) => demo.setTimelineX(Number(e.target.value))}
                style={{width: '100%'}}
              />
            </div>

            <div style={{marginBottom: '12px'}}>
              <label style={{display: 'block', fontSize: '12px', marginBottom: '4px'}}>
                Y Position: {demo.timelineY} (Canvas Relative)
              </label>
              <input
                type="range"
                min="50"
                max="300"
                value={demo.timelineY}
                onChange={(e) => demo.setTimelineY(Number(e.target.value))}
                style={{width: '100%'}}
              />
            </div>
          </div>

          {selectedClip && (
            <div style={{marginBottom: '20px'}}>
              <h3
                style={{
                  margin: '0 0 10px 0',
                  fontSize: '14px',
                  fontWeight: 'bold',
                  color: '#d4af37'
                }}
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
                  <strong>Label:</strong> {selectedClip.label}
                </div>
                <div style={{marginBottom: '8px'}}>
                  <strong>Track:</strong> {selectedClip.trackId + 1}
                </div>
                <div style={{marginBottom: '8px'}}>
                  <strong>Start:</strong> {(selectedClip.startMs / 1000).toFixed(2)}s
                </div>
                <div style={{marginBottom: '8px'}}>
                  <strong>End:</strong> {(selectedClip.endMs / 1000).toFixed(2)}s
                </div>
                <div style={{marginBottom: '8px'}}>
                  <strong>Duration:</strong>{' '}
                  {((selectedClip.endMs - selectedClip.startMs) / 1000).toFixed(2)}s
                </div>
                <div>
                  <strong>Color:</strong>
                  <span
                    style={{
                      display: 'inline-block',
                      width: '20px',
                      height: '12px',
                      backgroundColor: `rgba(${selectedClip.color.join(', ')})`,
                      marginLeft: '8px',
                      border: '1px solid #ccc',
                      borderRadius: '2px'
                    }}
                  />
                </div>
                <button
                  onClick={() => setSelectedClip(null)}
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

          <div style={{marginBottom: '20px'}}>
            <h3 style={{margin: '0 0 10px 0', fontSize: '14px', fontWeight: 'bold'}}>
              Timeline Scrubber
            </h3>

            <div style={{marginBottom: '12px'}}>
              <label style={{display: 'block', fontSize: '12px', marginBottom: '4px'}}>
                Current Time: {demo.labelFormatter(demo.currentTimeMs)}
              </label>
              <input
                type="range"
                min={demo.timelineStart}
                max={demo.timelineEnd}
                step="100"
                value={demo.currentTimeMs}
                onChange={(e) => demo.setCurrentTimeMs(Number(e.target.value))}
                style={{width: '100%'}}
              />
              <div style={{fontSize: '10px', color: '#888', marginTop: '4px'}}>
                Click or drag on timeline to scrub
              </div>
            </div>
          </div>

          <div style={{marginBottom: '20px'}}>
            <h3 style={{margin: '0 0 10px 0', fontSize: '14px', fontWeight: 'bold'}}>
              Timeline Zoom
            </h3>

            <div style={{marginBottom: '12px'}}>
              <label style={{display: 'block', fontSize: '12px', marginBottom: '4px'}}>
                Zoom Level: {demo.zoomLevel.toFixed(2)}x
              </label>
              <input
                type="range"
                min="1.0"
                max="100"
                step="0.1"
                value={demo.zoomLevel}
                onChange={(e) => demo.setZoomLevel(Number(e.target.value))}
                style={{width: '100%'}}
              />
              <div style={{fontSize: '10px', color: '#888', marginTop: '4px'}}>
                Use mouse wheel over timeline for horizontal zoom
              </div>
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
            <strong>Instructions:</strong>
            <br />
            • Use mouse wheel over timeline for horizontal zoom
            <br />
            • Click or drag anywhere on timeline to scrub/seek
            <br />
            • Click clips to select them
            <br />
            • Hover over clips to highlight them
            <br />
            • Pan by dragging the viewport
            <br />• Selected clip info appears above
          </div>
        </div>
      </div>

      <div
        data-timeline-container="true"
        style={{
          flex: 1,
          height: '100vh',
          position: 'relative',
          overflow: 'hidden',
          cursor: isDraggingScrubber ? 'grabbing' : 'default',
          border: '3px solid black' // Add black border to show canvas limits
        }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        <DeckGL
          views={new OrthographicView()}
          initialViewState={INITIAL_VIEW_STATE}
          controller={{
            scrollZoom: false, // Disable default scroll zoom
            doubleClickZoom: false,
            touchZoom: false,
            dragPan: false, // Disable all panning - timeline should stay locked
            dragRotate: false,
            keyboard: false
          }}
          layers={layers}
        />
      </div>
    </div>
  );
}

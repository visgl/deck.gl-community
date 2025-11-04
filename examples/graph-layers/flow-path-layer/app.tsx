// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import React, {useMemo} from 'react';
import DeckGL from '@deck.gl/react';
import type {OrthographicViewState} from '@deck.gl/core';
import {OrthographicView} from '@deck.gl/core';
import {ScatterplotLayer, TextLayer} from '@deck.gl/layers';

import {FlowPathLayer} from '@deck.gl-community/graph-layers';

type CampusNode = {
  name: string;
  position: [number, number, number?];
  color: [number, number, number, number];
};

type CampusConnection = {
  source: [number, number, number?];
  target: [number, number, number?];
  color: [number, number, number, number];
  width: number;
  speed: number;
  tailLength: number;
};

const INITIAL_VIEW_STATE: OrthographicViewState = {
  target: [0, 0, 0],
  zoom: 0,
  minZoom: -2,
  maxZoom: 6
};

const CAMPUS_NODES: CampusNode[] = [
  {name: 'Engineering Quad', position: [-160, 110, 0], color: [114, 204, 255, 255]},
  {name: 'Innovation Hub', position: [-40, 190, 0], color: [152, 244, 137, 255]},
  {name: 'Student Commons', position: [0, 0, 0], color: [255, 214, 102, 255]},
  {name: 'Research Labs', position: [180, 60, 0], color: [255, 153, 204, 255]},
  {name: 'Design Studio', position: [-130, -140, 0], color: [173, 158, 255, 255]},
  {name: 'Library Pavilion', position: [150, -100, 0], color: [120, 235, 242, 255]}
];

const CAMPUS_CONNECTIONS: CampusConnection[] = [
  {
    source: CAMPUS_NODES[0].position,
    target: CAMPUS_NODES[2].position,
    color: [94, 194, 255, 255],
    width: 6,
    speed: 24,
    tailLength: 0.4
  },
  {
    source: CAMPUS_NODES[2].position,
    target: CAMPUS_NODES[1].position,
    color: [122, 236, 142, 255],
    width: 5,
    speed: 18,
    tailLength: 0.35
  },
  {
    source: CAMPUS_NODES[2].position,
    target: CAMPUS_NODES[3].position,
    color: [255, 174, 214, 255],
    width: 7,
    speed: 30,
    tailLength: 0.45
  },
  {
    source: CAMPUS_NODES[4].position,
    target: CAMPUS_NODES[2].position,
    color: [186, 171, 255, 255],
    width: 5,
    speed: 16,
    tailLength: 0.3
  },
  {
    source: CAMPUS_NODES[4].position,
    target: CAMPUS_NODES[5].position,
    color: [134, 228, 240, 255],
    width: 4,
    speed: 12,
    tailLength: 0.25
  },
  {
    source: CAMPUS_NODES[5].position,
    target: CAMPUS_NODES[3].position,
    color: [255, 195, 160, 255],
    width: 4,
    speed: 20,
    tailLength: 0.3
  }
];

export default function App(): React.ReactElement {
  const layers = useMemo(
    () => [
      new FlowPathLayer({
        id: 'flow-paths',
        data: CAMPUS_CONNECTIONS,
        getSourcePosition: (connection) => connection.source,
        getTargetPosition: (connection) => connection.target,
        getColor: (connection) => connection.color,
        getWidth: (connection) => connection.width,
        getSpeed: (connection) => connection.speed,
        getTailLength: (connection) => connection.tailLength,
        widthUnits: 'pixels',
        parameters: {
          depthTest: false
        }
      }),
      new ScatterplotLayer({
        id: 'campus-nodes',
        data: CAMPUS_NODES,
        getPosition: (node) => node.position,
        getRadius: () => 10,
        radiusUnits: 'pixels',
        getFillColor: (node) => node.color,
        getLineColor: [8, 14, 24, 255],
        lineWidthUnits: 'pixels',
        lineWidthMinPixels: 2
      }),
      new TextLayer({
        id: 'campus-labels',
        data: CAMPUS_NODES,
        getPosition: (node) => node.position,
        getText: (node) => node.name,
        getColor: () => [230, 236, 255, 255],
        getSize: () => 16,
        getPixelOffset: () => [16, 0],
        getTextAnchor: () => 'start',
        getAlignmentBaseline: () => 'center'
      })
    ],
    []
  );

  return (
    <DeckGL
      style={{position: 'absolute', inset: 0}}
      layers={layers}
      views={new OrthographicView({id: 'ortho'})}
      initialViewState={INITIAL_VIEW_STATE}
      controller={true}
    >
      <div
        style={{
          position: 'absolute',
          top: 20,
          left: 20,
          padding: '12px 16px',
          background: 'rgba(8, 12, 28, 0.85)',
          borderRadius: 12,
          border: '1px solid rgba(64, 80, 130, 0.6)',
          maxWidth: 260,
          lineHeight: 1.4
        }}
      >
        <h1 style={{margin: '0 0 8px', fontSize: 18}}>FlowPathLayer</h1>
        <p style={{margin: 0, fontSize: 13}}>
          Animated flows travel along the campus shuttle routes. Adjust the view by dragging
          or scrolling to explore how width, speed, and tail length change per connection.
        </p>
      </div>
    </DeckGL>
  );
}

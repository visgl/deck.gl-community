// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

// Run with: yarn vitest bench modules/editable-layers/test/edit-modes/snapping/snapping-utils.bench.ts --project node

import {bench, describe, vi} from 'vitest';
import {
  getSnapTargetHandles,
  getClosestSnapTargetHandle
} from '../../../src/edit-modes/snapping/snapping-utils';
import {ModeProps} from '../../../src/edit-modes/types';
import {FeatureCollection, Feature} from '../../../src/utils/geojson-types';
import {toWebMercatorViewport} from '../../../src/edit-modes/utils';

const BASE_VIEWPORT = {
  bearing: 0,
  height: 600,
  latitude: 37.78,
  longitude: -122.42,
  pitch: 0,
  width: 800,
  zoom: 12
};

const WM_VIEWPORT = toWebMercatorViewport(BASE_VIEWPORT);

/**
 * Generates N polygons in a fixed 1° x 1° grid, lower-left at [-122.5, 37.7]
 */
function makePolygons(featureCount: number, vertexCount = 100): Feature[] {
  const width = 1;
  const height = 1;
  const origin: [number, number] = [-122.5, 37.7];
  const cols = Math.ceil(Math.sqrt(featureCount));
  const rows = Math.ceil(featureCount / cols);
  const stepX = width / Math.max(1, cols - 1);
  const stepY = height / Math.max(1, rows - 1);
  const r = Math.min(stepX, stepY) * 0.4;
  return Array.from({length: featureCount}, (_, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cx = origin[0] + col * stepX;
    const cy = origin[1] + row * stepY;
    const ring: [number, number][] = Array.from({length: vertexCount}, (__, v) => {
      const angle = (2 * Math.PI * v) / vertexCount;
      return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
    });
    ring.push(ring[0]);
    return {
      type: 'Feature',
      properties: {},
      geometry: {type: 'Polygon', coordinates: [ring]}
    };
  });
}

function modeProps(features: Feature[], edgeSnapping = false): ModeProps<FeatureCollection> {
  const screenCoords: [number, number] = [400, 300];
  const mapCoords = WM_VIEWPORT.unproject(screenCoords) as [number, number];
  return {
    data: {type: 'FeatureCollection', features},
    selectedIndexes: [0],
    modeConfig: {viewport: BASE_VIEWPORT, edgeSnapping},
    lastPointerMoveEvent: {
      screenCoords,
      mapCoords,
      picks: [],
      pointerDownPicks: null,
      pointerDownScreenCoords: null,
      pointerDownMapCoords: null,
      cancelPan: vi.fn(),
      sourceEvent: null
    },
    cursor: null,
    onEdit: vi.fn(),
    onUpdateCursor: vi.fn(),
    pickingRadius: 10
  };
}

// Feature index 0 is always the "dragged" feature and excluded from snap targets.
const EXCLUDED = [0];

const FEATURE_COUNTS = [1, 100, 1000] as const;
const VERTEX_COUNTS = [1, 100, 1000] as const;

// ---------------------------------------------------------------------------
// Grid benchmarks: fill all (features, vertices) pairs for each method
// ---------------------------------------------------------------------------

const BENCHMARKS = [
  {fn: getSnapTargetHandles, label: 'getSnapTargetHandles (vertex snapping)', edge: false},
  {fn: getSnapTargetHandles, label: 'getSnapTargetHandles (edge snapping)', edge: true},
  {fn: getClosestSnapTargetHandle, label: 'getClosestSnapTargetHandle'}
];

for (const benchDef of BENCHMARKS) {
  describe(benchDef.label, () => {
    for (const features of FEATURE_COUNTS) {
      for (const vertices of VERTEX_COUNTS) {
        bench(`${features} features × ${vertices} vertices`, () => {
          const props = modeProps(makePolygons(features, vertices), benchDef.edge);
          benchDef.fn(props, EXCLUDED);
        });
      }
    }
  });
}

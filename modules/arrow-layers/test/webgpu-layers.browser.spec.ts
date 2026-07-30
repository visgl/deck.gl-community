// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {COORDINATE_SYSTEM, Deck, OrthographicView} from '@deck.gl/core';
import {luma, type Device} from '@luma.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {webgpuAdapter} from '@luma.gl/webgpu';
import {
  Field,
  FixedSizeList,
  Float32,
  List,
  tableFromArrays,
  vectorFromArray
} from 'apache-arrow';
import {describe, expect, it} from 'vitest';

import {
  GeoArrowColumnLayer,
  GeoArrowHeatmapLayer,
  GeoArrowPathLayer,
  GeoArrowPointCloudLayer,
  GeoArrowPolygonLayer,
  GeoArrowScatterplotLayer,
  GeoArrowSolidPolygonLayer
} from '../src';

type BrowserGpu = {requestAdapter: () => Promise<unknown>};
type NativeGpuError = {error?: {message?: string}};
type NativeGpuDevice = {
  addEventListener: (type: 'uncapturederror', listener: (event: NativeGpuError) => void) => void;
  removeEventListener: (type: 'uncapturederror', listener: (event: NativeGpuError) => void) => void;
  queue: {onSubmittedWorkDone: () => Promise<void>};
};

const pointType = new FixedSizeList(2, new Field('xy', new Float32()));
const point3DType = new FixedSizeList(3, new Field('xyz', new Float32()));
const lineStringType = new List(new Field('vertices', pointType));
const polygonType = new List(new Field('rings', lineStringType));
const table = tableFromArrays({id: [0]});
const points = vectorFromArray([[0, 0]], pointType);
const pointCloudPoints = vectorFromArray([[0, 0, 8]], point3DType);
const lineStrings = vectorFromArray(
  [
    [
      [-24, 16],
      [0, 28],
      [24, 16]
    ]
  ],
  lineStringType
);
const polygons = vectorFromArray(
  [
    [
      [
        [-20, -20],
        [20, -20],
        [20, 4],
        [-20, 4],
        [-20, -20]
      ]
    ]
  ],
  polygonType
);

async function renderGeoArrowLayers(type: 'webgl' | 'webgpu'): Promise<void> {
  const parent = document.createElement('div');
  parent.style.width = '128px';
  parent.style.height = '128px';
  document.body.append(parent);

  const pathLayer = new GeoArrowPathLayer({
    id: `geoarrow-path-${type}`,
    coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
    data: table,
    getPath: lineStrings,
    getColor: [14, 165, 233, 255],
    getWidth: 4,
    widthUnits: 'pixels',
    pickable: true
  });
  const polygonLayer = new GeoArrowSolidPolygonLayer({
    id: `geoarrow-polygon-${type}`,
    coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
    data: table,
    getPolygon: polygons,
    getFillColor: [168, 85, 247, 180],
    getLineColor: [88, 28, 135, 255],
    earcutWorkerUrl: null,
    material: false,
    pickable: true
  });
  const layers = [
    new GeoArrowColumnLayer({
      id: `geoarrow-column-${type}`,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      data: table,
      getPosition: points,
      getFillColor: [16, 185, 129, 180],
      getElevation: 10,
      radius: 5,
      diskResolution: 8,
      material: false,
      pickable: true
    }),
    new GeoArrowHeatmapLayer({
      id: `geoarrow-heatmap-${type}`,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      data: table,
      getPosition: points,
      getWeight: 1,
      radiusPixels: 24,
      pickable: false
    }),
    new GeoArrowPointCloudLayer({
      id: `geoarrow-point-cloud-${type}`,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      data: table,
      getPosition: pointCloudPoints,
      getColor: [244, 63, 94, 255],
      pointSize: 6,
      material: false,
      pickable: true
    }),
    new GeoArrowPolygonLayer({
      id: `geoarrow-composite-polygon-${type}`,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      data: table,
      getPolygon: polygons,
      getFillColor: [168, 85, 247, 90],
      getLineColor: [88, 28, 135, 255],
      getLineWidth: 2,
      lineWidthUnits: 'pixels',
      earcutWorkerUrl: null,
      material: false,
      pickable: true
    }),
    new GeoArrowScatterplotLayer({
      id: `geoarrow-scatterplot-${type}`,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      data: table,
      getPosition: points,
      getRadius: 7,
      radiusUnits: 'common',
      getFillColor: [6, 182, 212, 200],
      getLineColor: [8, 47, 73, 255],
      stroked: true,
      pickable: true
    }),
    polygonLayer,
    pathLayer
  ];

  let device: Device | undefined;
  let deck: Deck<OrthographicView> | undefined;
  let nativeDevice: NativeGpuDevice | undefined;
  const validationErrors: string[] = [];
  const captureValidationError = (event: NativeGpuError): void => {
    validationErrors.push(event.error?.message ?? 'Unknown WebGPU validation error.');
  };

  try {
    device = await luma.createDevice({
      type,
      adapters: [webgl2Adapter, webgpuAdapter],
      createCanvasContext: {container: parent}
    });
    if (type === 'webgpu') {
      nativeDevice = (device as Device & {handle?: NativeGpuDevice}).handle;
      nativeDevice?.addEventListener('uncapturederror', captureValidationError);
    }

    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new Error(`Timed out while rendering GeoArrow layers with ${type}.`));
      }, 10_000);

      deck = new Deck({
        device,
        parent,
        width: 128,
        height: 128,
        views: new OrthographicView({id: 'geoarrow-webgpu-test', flipY: false}),
        initialViewState: {target: [0, 0, 0], zoom: 0},
        layers,
        onAfterRender: () => {
          if (!polygonLayer.state.table || !polygonLayer.state.triangles) {
            return;
          }
          window.clearTimeout(timeout);
          resolve();
        },
        onError: error => {
          window.clearTimeout(timeout);
          reject(error);
        }
      });
    });

    await nativeDevice?.queue.onSubmittedWorkDone();
    expect(device.type).toBe(type);
    expect(polygonLayer.state.triangles?.[0]?.length).toBeGreaterThan(0);
    expect(validationErrors).toEqual([]);
  } finally {
    nativeDevice?.removeEventListener('uncapturederror', captureValidationError);
    deck?.finalize();
    device?.destroy();
    parent.remove();
  }
}

describe('GeoArrow graphics backend compatibility', () => {
  it('renders binary attributes through portable upstream renderers on WebGL2', async () => {
    await renderGeoArrowLayers('webgl');
  }, 20_000);

  it('renders binary attributes through portable upstream renderers on WebGPU', async ({skip}) => {
    const gpu = (navigator as Navigator & {gpu?: BrowserGpu}).gpu;
    if (!gpu || !(await gpu.requestAdapter())) {
      skip('This browser does not expose an available WebGPU adapter.');
    }

    await renderGeoArrowLayers('webgpu');
  }, 20_000);
});

// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {COORDINATE_SYSTEM, Deck, OrthographicView} from '@deck.gl/core';
import {luma, type Device} from '@luma.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {webgpuAdapter} from '@luma.gl/webgpu';
import {describe, expect, it} from 'vitest';

import {
  HorizonGraphLayer,
  MultiHorizonGraphLayer,
  TimelineLayer,
  VerticalGridLayer
} from '../../../dev/timeline-layers/src';
import {BlockLayer, FastTextLayer, TimeDeltaLayer} from '../../infovis-layers/src';
import {EditableGeoJsonLayer, ModifyMode} from '../../editable-layers/src';
import {EdgeArrowLayer} from '../../graph-layers/src/layers/edge-layers/edge-arrow-layer';
import {PathEdgeLayer} from '../../graph-layers/src/layers/edge-layers/path-edge-layer';
import {RoundedRectangleLayer} from '../../graph-layers/src/layers/node-layers/rounded-rectangle-layer';
import {
  DependencyArrowLayer,
  PathDirection,
  PathMarkerLayer,
  PathOutlineLayer,
  SkyboxLayer
} from '../src';
import {GeometryLayer} from '../src/dependency-arrow-layer/geometry-layer';

type BrowserGpu = {
  requestAdapter: () => Promise<unknown>;
};
type NativeGpuError = {error?: {message?: string}};
type NativeGpuDevice = {
  addEventListener: (type: 'uncapturederror', listener: (event: NativeGpuError) => void) => void;
  removeEventListener: (type: 'uncapturederror', listener: (event: NativeGpuError) => void) => void;
  queue: {onSubmittedWorkDone: () => Promise<void>};
};

function createPortableLayers() {
  const nodeStylesheet = {
    getDeckGLAccessor: (name: string) =>
      ({
        getCornerRadius: () => 4,
        getFillColor: () => [34, 197, 94, 255],
        getHeight: () => 12,
        getLineColor: () => [20, 83, 45, 255],
        getLineWidth: () => 1,
        getWidth: () => 24
      })[name],
    getDeckGLAccessors: () => ({
      getFillColor: () => [34, 197, 94, 255],
      getLineColor: () => [20, 83, 45, 255],
      getLineWidth: () => 1
    }),
    getDeckGLAccessorUpdateTrigger: () => 0,
    getDeckGLUpdateTriggers: () => ({})
  };
  const edgeStylesheet = {
    getDeckGLAccessors: () => ({
      getColor: () => [225, 29, 72, 255],
      getOffset: () => [0, 0],
      getSize: () => 5
    }),
    getDeckGLUpdateTriggers: () => ({})
  };

  return [
    new SkyboxLayer({id: 'webgpu-test-skybox', cubemap: null}),
    new BlockLayer({
      id: 'webgpu-test-block',
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      data: [{position: [-20, -20, 0], size: [30, 20]}],
      sizeUnits: 'common',
      getPosition: datum => datum.position,
      getSize: datum => datum.size,
      getFillColor: [37, 99, 235, 255],
      getLineColor: [15, 23, 42, 255],
      pickable: true
    }),
    new FastTextLayer({
      id: 'webgpu-test-fast-text-bitmap',
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      data: [{text: 'GPU', position: [-20, -8]}],
      characterSet: 'GPU',
      fontSettings: {sdf: false, fontSize: 32},
      size: 14,
      getColor: [255, 255, 255, 255]
    }),
    new FastTextLayer({
      id: 'webgpu-test-fast-text-sdf',
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      data: [{text: 'SDF', position: [5, -8]}],
      characterSet: 'SDF',
      fontSettings: {sdf: true, fontSize: 32},
      size: 14,
      getColor: [15, 23, 42, 255]
    }),
    new GeometryLayer({
      id: 'webgpu-test-marker',
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      data: [{source: [-25, 10, 0], target: [25, 10, 0]}],
      getSourcePosition: datum => datum.source,
      getTargetPosition: datum => datum.target,
      getColor: [16, 185, 129, 255],
      getSize: [10, 6],
      pickable: true
    }),
    new TimeDeltaLayer({
      id: 'webgpu-test-time-delta',
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      header: true,
      startTimeMs: -15,
      endTimeMs: 15,
      y: -25,
      color: [15, 23, 42, 255]
    }),
    new VerticalGridLayer({
      id: 'webgpu-test-vertical-grid',
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      xMin: -30,
      xMax: 30,
      yMin: -30,
      yMax: 30,
      tickCount: 4
    }),
    new PathOutlineLayer({
      id: 'webgpu-test-dashed-outline',
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      data: [
        {
          path: [
            [-28, 34],
            [-8, 28],
            [10, 35]
          ]
        }
      ],
      getPath: datum => datum.path,
      getColor: [14, 165, 233, 255],
      getOutlineColor: [15, 23, 42, 255],
      getWidth: 4,
      getDashArray: [3, 2],
      widthUnits: 'pixels',
      outlineWidthScale: 1.6,
      pickable: true
    }),
    new PathMarkerLayer({
      id: 'webgpu-test-path-markers',
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      data: [
        {
          path: [
            [-28, 40],
            [0, 45],
            [28, 38]
          ],
          direction: PathDirection.FORWARD
        }
      ],
      getPath: datum => datum.path,
      getDirection: datum => datum.direction,
      getColor: [124, 58, 237, 255],
      getMarkerColor: [124, 58, 237, 255],
      getMarkerPercentages: () => [0.5],
      getWidth: 3,
      getDashArray: [4, 2],
      widthUnits: 'pixels',
      sizeScale: 8,
      pickable: true
    }),
    new DependencyArrowLayer({
      id: 'webgpu-test-path-dependency',
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      data: [
        {
          path: [
            [-28, 24],
            [0, 18],
            [28, 24]
          ]
        }
      ],
      mode: 'path',
      getPath: datum => datum.path,
      getColor: [239, 68, 68, 255],
      getWidth: 3,
      markerSizeScale: 8,
      outlineWidthScale: 1.5,
      pickable: true
    }),
    new DependencyArrowLayer({
      id: 'webgpu-test-arc-dependency',
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      data: [
        {
          path: [
            [-25, 5],
            [25, 5]
          ]
        }
      ],
      mode: 'arc',
      getPath: datum => datum.path,
      getColor: [245, 158, 11, 255],
      getWidth: 2,
      getArcHeight: 8,
      markerSizeScale: 7,
      pickable: true
    }),
    new RoundedRectangleLayer({
      id: 'webgpu-test-rounded-graph-node',
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      data: [{position: [-12, -36, 0]}],
      getPosition: datum => datum.position,
      stylesheet: nodeStylesheet,
      pickable: true
    }),
    new PathEdgeLayer({
      id: 'webgpu-test-graph-path-edge',
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      data: [
        {
          layout: {
            sourcePosition: [-28, -52, 0],
            controlPoints: [[0, -45, 0]],
            targetPosition: [28, -52, 0]
          }
        }
      ],
      getLayoutInfo: datum => datum.layout,
      getColor: [59, 130, 246, 255],
      getWidth: 3,
      widthUnits: 'pixels',
      pickable: true
    }),
    new EdgeArrowLayer({
      id: 'webgpu-test-graph-edge-arrow',
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      data: [
        {
          directed: true,
          layout: {
            sourcePosition: [-28, -52, 0],
            targetPosition: [28, -52, 0]
          }
        }
      ],
      getLayoutInfo: datum => datum.layout,
      stylesheet: edgeStylesheet,
      pickable: true
    }),
    new TimelineLayer({
      id: 'webgpu-test-timeline',
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      data: [
        {
          id: 'track',
          clips: [
            {
              id: 'clip-a',
              startMs: 0,
              endMs: 450,
              color: [14, 165, 233, 255]
            },
            {
              id: 'clip-b',
              startMs: 520,
              endMs: 900,
              color: [168, 85, 247, 255]
            }
          ]
        }
      ],
      timelineStart: 0,
      timelineEnd: 1000,
      currentTimeMs: 500,
      x: -30,
      y: -12,
      width: 60,
      trackHeight: 10,
      trackSpacing: 2,
      showAxis: false,
      showClipLabels: false,
      showTrackLabels: false,
      showScrubber: true,
      pickable: true
    }),
    new EditableGeoJsonLayer({
      id: 'webgpu-test-editable-geojson',
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      data: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [4, -34],
                  [28, -34],
                  [28, -22],
                  [4, -22],
                  [4, -34]
                ]
              ]
            }
          },
          {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates: [
                [-28, -20],
                [-18, -12],
                [-6, -18]
              ]
            }
          }
        ]
      },
      mode: ModifyMode,
      selectedFeatureIndexes: [0],
      pickingLineWidthExtraPixels: 6,
      getFillColor: [8, 145, 178, 120],
      getLineColor: [14, 116, 144, 255],
      getLineWidth: 2,
      onEdit: () => {},
      pickable: true
    }),
    new HorizonGraphLayer({
      id: 'webgpu-test-horizon',
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      data: new Float32Array([0, 25, -25, 50, -50, 100]),
      x: -30,
      y: 15,
      width: 60,
      height: 15,
      yAxisScale: 100,
      bands: 2
    }),
    new MultiHorizonGraphLayer({
      id: 'webgpu-test-multi-horizon',
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      data: [
        {values: new Float32Array([0, 25, -25, 50]), scale: 100},
        {values: new Float32Array([50, -50, 25, 0]), scale: 100}
      ],
      getSeries: datum => datum.values,
      getScale: datum => datum.scale,
      x: -30,
      y: -5,
      width: 60,
      height: 18,
      dividerWidth: 2,
      bands: 2
    })
  ];
}

async function renderPortableLayers(type: 'webgl' | 'webgpu'): Promise<void> {
  const parent = document.createElement('div');
  parent.style.width = '128px';
  parent.style.height = '128px';
  document.body.append(parent);

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
        reject(new Error(`Timed out while rendering community layers with ${type}.`));
      }, 10_000);

      deck = new Deck({
        device,
        parent,
        width: 128,
        height: 128,
        views: new OrthographicView({id: 'webgpu-layer-test', flipY: false}),
        initialViewState: {target: [0, 0, 0], zoom: 0},
        layers: createPortableLayers(),
        onAfterRender: () => {
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
    expect(validationErrors).toEqual([]);
  } finally {
    nativeDevice?.removeEventListener('uncapturederror', captureValidationError);
    deck?.finalize();
    device?.destroy();
    parent.remove();
  }
}

describe('community graphics backend compatibility', () => {
  it('renders custom shaders, paths, polygons, graph, timeline, and editing on WebGL2', async () => {
    await renderPortableLayers('webgl');
  }, 20_000);

  it('renders custom shaders, paths, polygons, graph, timeline, and editing on WebGPU', async ({
    skip
  }) => {
    const gpu = (navigator as Navigator & {gpu?: BrowserGpu}).gpu;
    if (!gpu || !(await gpu.requestAdapter())) {
      skip('This browser does not expose an available WebGPU adapter.');
    }

    await renderPortableLayers('webgpu');
  }, 20_000);
});

// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  AmbientLight,
  Attribute,
  COORDINATE_SYSTEM,
  Deck,
  DirectionalLight,
  LightingEffect,
  MapView,
  OrthographicView,
  type DeckProps,
  type Layer,
  type View
} from '@deck.gl/core';
import {DataFilterExtension, PathStyleExtension} from '@deck.gl/extensions';
import {
  ArcLayer,
  ColumnLayer,
  GeoJsonLayer,
  IconLayer,
  LineLayer,
  PathLayer,
  PointCloudLayer,
  PolygonLayer,
  ScatterplotLayer,
  SolidPolygonLayer,
  TextLayer
} from '@deck.gl/layers';
import {MapboxOverlay} from '@deck.gl/mapbox';
import {SimpleMeshLayer} from '@deck.gl/mesh-layers';
import {Buffer, Texture, luma, type Device, type Framebuffer} from '@luma.gl/core';
import {CubeGeometry} from '@luma.gl/engine';
import {webgl2Adapter} from '@luma.gl/webgl';
import {webgpuAdapter} from '@luma.gl/webgpu';
import 'maplibre-gl';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {SelectionPulseExtension, TreeLayer, type TreeSpec} from '../../src';
import {requireWebGPUAdapter} from '../webgpu-test-utils';

const maplibre = (globalThis as any).maplibregl;

const SIZE = 128;
// A new mesh resets SimpleMeshLayer's attributes; applications keep one instance.
const CUBE = new CubeGeometry();
// Deep enough for extruded columns; unflipped, so their faces keep their winding.
const ORTHOGRAPHIC = new OrthographicView({id: 'ortho', flipY: false, near: -1000, far: 1000});

type Item = {position: [number, number, number]; selected: boolean; hidden?: boolean};
/** The selected item draws in the left half of the canvas, the other one in the right half. */
const ITEMS: Item[] = [
  {position: [-30, 0, 0], selected: true},
  {position: [30, 0, 0], selected: false}
];
const square = ([x, y]: number[], half = 20) => [
  [x - half, y - half],
  [x + half, y - half],
  [x + half, y + half],
  [x - half, y + half]
];

function mount(
  view: View,
  viewState: Record<string, unknown>,
  layers: Layer[],
  props: Partial<DeckProps> = {}
) {
  const parent = document.createElement('div');
  parent.style.cssText = `width:${SIZE}px;height:${SIZE}px`;
  document.body.append(parent);
  let pixels = new Uint8Array();
  let frames = 0;
  const errors: string[] = [];
  const deck = new Deck({
    parent,
    width: SIZE,
    height: SIZE,
    useDevicePixels: false,
    deviceProps: {type: 'webgl', adapters: [webgl2Adapter]},
    views: view,
    initialViewState: viewState,
    layers,
    _animate: true,
    onError: error => errors.push(error.message),
    onAfterRender({gl}) {
      pixels = new Uint8Array(SIZE * SIZE * 4);
      gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      frames++;
    },
    ...props
  });
  const scene = {
    deck,
    errors,
    frames: () => frames,
    /** Renders `layers` and returns the frame once three consecutive animation frames agree. */
    async render(next?: Layer[], nextProps: Partial<DeckProps> = {}) {
      // deck.gl applies new layers at the start of its next animation frame.
      if (next) deck.setProps({layers: next, ...nextProps});
      let previous: Uint8Array | null = null;
      let stable = 0;
      for (let attempt = 0; attempt < 600; attempt++) {
        const start = frames;
        await expect
          .poll(() => frames, {timeout: 30000})
          .toBeGreaterThan(start + (attempt ? 0 : 2));
        stable = previous && pixels.every((value, i) => value === previous![i]) ? stable + 1 : 0;
        if (stable === 2) return pixels;
        previous = pixels;
      }
      throw new Error('The frame did not settle.');
    },
    cleanup() {
      deck.finalize();
      parent.remove();
    }
  };
  scenes.push(scene);
  return scene;
}

/** Summed RGB and coverage of one canvas half. */
function measure(pixels: Uint8Array, half: 'left' | 'right') {
  let rgb = 0;
  let covered = 0;
  for (let y = 0; y < SIZE; y++)
    for (let x = half === 'left' ? 0 : SIZE / 2; x < (half === 'left' ? SIZE / 2 : SIZE); x++) {
      const i = (y * SIZE + x) * 4;
      if (pixels[i + 3] === 0) continue;
      covered++;
      rgb += pixels[i] + pixels[i + 1] + pixels[i + 2];
    }
  return {rgb, covered};
}

function getHalf(pixels: Uint8Array, half: 'left' | 'right'): number[] {
  const result: number[] = [];
  for (let y = 0; y < SIZE; y++) {
    const start = (y * SIZE + (half === 'left' ? 0 : SIZE / 2)) * 4;
    result.push(...pixels.subarray(start, start + (SIZE / 2) * 4));
  }
  return result;
}

type PulseProps = {extensions: SelectionPulseExtension[]; [prop: string]: unknown};
const pulse = (pulseTime: number | null): PulseProps => ({
  extensions: [new SelectionPulseExtension()],
  pulseTime,
  pulsePeriod: 1000,
  pulseStrength: 0.4
});

let iconAtlas: HTMLCanvasElement | null = null;
function getIconAtlas(): HTMLCanvasElement {
  if (!iconAtlas) {
    iconAtlas = document.createElement('canvas');
    iconAtlas.width = iconAtlas.height = 64;
    const context = iconAtlas.getContext('2d')!;
    context.fillStyle = '#fff';
    context.beginPath();
    context.arc(32, 32, 30, 0, 2 * Math.PI);
    context.fill();
  }
  return iconAtlas;
}

const cartesian = {coordinateSystem: COORDINATE_SYSTEM.CARTESIAN};
const BLUE = [40, 160, 240];
const YELLOW = [250, 220, 60];

/** Each scene draws `ITEMS`-like objects: the selected one left of center, the other right. */
const LAYERS: Record<string, (props: PulseProps) => Layer> = {
  ScatterplotLayer: props =>
    new ScatterplotLayer<Item>({
      ...cartesian,
      id: 'scatterplot',
      data: ITEMS,
      getPosition: d => d.position,
      getRadius: 20,
      stroked: true,
      getLineWidth: 3,
      getFillColor: BLUE,
      getLineColor: YELLOW,
      ...props
    }),
  ColumnLayer: props =>
    new ColumnLayer<Item>({
      ...cartesian,
      id: 'column',
      data: ITEMS,
      getPosition: d => d.position,
      radius: 20,
      extruded: true,
      getElevation: 10,
      getFillColor: BLUE,
      ...props
    }),
  PolygonLayer: props =>
    new PolygonLayer<Item>({
      ...cartesian,
      id: 'polygon',
      data: ITEMS,
      getPolygon: d => square(d.position),
      stroked: true,
      getLineWidth: 3,
      getFillColor: BLUE,
      getLineColor: YELLOW,
      ...props
    }),
  'SolidPolygonLayer (extruded)': props =>
    new SolidPolygonLayer<Item>({
      ...cartesian,
      id: 'solid-polygon',
      data: ITEMS,
      getPolygon: d => square(d.position),
      extruded: true,
      getElevation: 10,
      getFillColor: BLUE,
      ...props
    }),
  PathLayer: props =>
    new PathLayer<Item>({
      ...cartesian,
      id: 'path',
      data: ITEMS,
      getPath: ({position: [x]}) => [
        [x - 20, -15],
        [x, 15],
        [x + 20, -15]
      ],
      getWidth: 8,
      widthUnits: 'pixels',
      getColor: BLUE,
      ...props
    }),
  LineLayer: props =>
    new LineLayer<Item>({
      ...cartesian,
      id: 'line',
      data: ITEMS,
      getSourcePosition: ({position: [x]}) => [x - 20, -15],
      getTargetPosition: ({position: [x]}) => [x + 20, 15],
      getWidth: 8,
      getColor: BLUE,
      ...props
    }),
  ArcLayer: props =>
    new ArcLayer<Item>({
      ...cartesian,
      id: 'arc',
      data: ITEMS,
      getSourcePosition: ({position: [x]}) => [x - 20, -15],
      getTargetPosition: ({position: [x]}) => [x + 20, 15],
      getWidth: 8,
      getSourceColor: BLUE,
      getTargetColor: YELLOW,
      ...props
    }),
  PointCloudLayer: props =>
    new PointCloudLayer<Item>({
      ...cartesian,
      id: 'point-cloud',
      data: ITEMS,
      getPosition: d => d.position,
      getNormal: [0, 0, 1],
      pointSize: 24,
      getColor: BLUE,
      ...props
    }),
  IconLayer: props =>
    new IconLayer<Item>({
      ...cartesian,
      id: 'icon',
      data: ITEMS,
      iconAtlas: getIconAtlas(),
      iconMapping: {dot: {x: 0, y: 0, width: 64, height: 64, mask: true}},
      getIcon: () => 'dot',
      getPosition: d => d.position,
      getSize: 40,
      getColor: BLUE,
      ...props
    }),
  TextLayer: props =>
    new TextLayer<Item>({
      ...cartesian,
      id: 'text',
      data: ITEMS,
      getText: () => 'AB',
      getPosition: d => d.position,
      getSize: 32,
      getColor: BLUE,
      ...props
    }),
  SimpleMeshLayer: props =>
    new SimpleMeshLayer<Item>({
      ...cartesian,
      id: 'mesh',
      data: ITEMS,
      mesh: CUBE,
      getPosition: d => d.position,
      getScale: [18, 18, 18],
      getColor: BLUE,
      ...props
    }),
  GeoJsonLayer: props =>
    new GeoJsonLayer({
      ...cartesian,
      id: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: ITEMS.map(item => ({
          type: 'Feature',
          properties: item,
          geometry: {
            type: 'Polygon',
            coordinates: [[...square(item.position), square(item.position)[0]]]
          }
        }))
      },
      stroked: true,
      getLineWidth: 3,
      lineWidthUnits: 'pixels',
      getFillColor: BLUE,
      getLineColor: YELLOW,
      ...props,
      getSelected: (feature: {properties: Item}) =>
        (props.getSelected as (d: Item) => boolean)(feature.properties)
    } as any),
  'ScatterplotLayer + DataFilterExtension': props =>
    new ScatterplotLayer<Item>({
      ...cartesian,
      id: 'filtered',
      // A filtered-out object in the left half would keep its color and fail the ratio check.
      data: [...ITEMS, {position: [-30, 45, 0], selected: false, hidden: true}],
      getPosition: d => d.position,
      getRadius: 15,
      getFillColor: BLUE,
      getFilterValue: d => (d.hidden ? 1 : 0),
      filterRange: [0, 0.5],
      ...props,
      extensions: [new DataFilterExtension({filterSize: 1}), ...props.extensions]
    }),
  'PathLayer + PathStyleExtension': props =>
    new PathLayer<Item>({
      ...cartesian,
      id: 'dashed-path',
      data: ITEMS,
      getPath: ({position: [x]}) => [
        [x - 20, -15],
        [x + 20, 15]
      ],
      getWidth: 8,
      widthUnits: 'pixels',
      getDashArray: [3, 1],
      getColor: BLUE,
      ...props,
      extensions: [new PathStyleExtension({dash: true}), ...props.extensions]
    } as any)
};

const scenes: {cleanup: () => void}[] = [];
afterEach(() => {
  for (const scene of scenes.splice(0)) scene.cleanup();
  vi.restoreAllMocks();
});

/**
 * Renders the pulse trough (time 0), its peak (half a period) and the next trough, and returns the
 * frames with the accessor calls and attribute uploads made after the first one. The `timeline`
 * clock advances deck.gl's animation timeline, as in an application; `pulseTime` sets the prop,
 * which also re-renders composite layers.
 */
async function renderPulse(
  scene: ReturnType<typeof mount>,
  makeLayers: (props: PulseProps) => Layer[],
  accessors: Record<string, ReturnType<typeof vi.fn>>,
  clock: 'timeline' | 'pulseTime' = 'timeline'
) {
  // The layer manager exists once deck.gl has created its device.
  await expect.poll(() => scene.deck.layerManager, {timeout: 30000}).toBeTruthy();
  const timeline = scene.deck.layerManager!.context.timeline;
  const at = (time: number) => {
    if (clock === 'pulseTime') return scene.render(makeLayers(pulse(time)));
    timeline.setTime(time);
    return scene.render();
  };
  if (clock === 'timeline') {
    timeline.pause();
    timeline.setTime(0);
    await scene.render(makeLayers(pulse(null)));
  }
  const trough = await at(0);
  const calls = Object.fromEntries(
    Object.entries(accessors).map(([name, spy]) => [name, spy.mock.calls.length])
  );
  const updateBuffer = vi.spyOn(Attribute.prototype, 'updateBuffer');
  const peak = await at(500);
  const again = await at(1000);
  updateBuffer.mockRestore();
  return {
    trough,
    peak,
    again,
    accessorCalls: Object.fromEntries(
      Object.entries(accessors).map(([name, spy]) => [name, spy.mock.calls.length - calls[name]])
    ),
    uploads: updateBuffer.mock.results.filter(result => result.value).length
  };
}

describe('SelectionPulseExtension on deck.gl layers', () => {
  it.each(
    Object.keys(LAYERS)
  )('%s pulses the selected object only, without recomputing attributes', async name => {
    const getSelected = vi.fn((d: Item) => d.selected);
    const make = (props: PulseProps) => [LAYERS[name]({...props, getSelected})];
    const scene = mount(ORTHOGRAPHIC, {target: [0, 0, 0], zoom: 0}, make(pulse(0)));
    const result = await renderPulse(scene, make, {getSelected});
    expect(scene.errors).toEqual([]);

    const trough = measure(result.trough, 'left');
    const peak = measure(result.peak, 'left');
    expect(trough.covered).toBeGreaterThan(100);
    expect(peak.covered).toBe(trough.covered);
    // A peak of 0.4 toward black leaves 60% of each channel.
    expect(peak.rgb / trough.rgb).toBeGreaterThan(0.55);
    expect(peak.rgb / trough.rgb).toBeLessThan(0.65);
    expect(measure(result.trough, 'right').covered).toBeGreaterThan(100);
    expect(getHalf(result.peak, 'right')).toEqual(getHalf(result.trough, 'right'));
    // A full period later the frame is back to the trough.
    expect(getHalf(result.again, 'left')).toEqual(getHalf(result.trough, 'left'));
    expect(result.accessorCalls).toEqual({getSelected: 0});
    expect(result.uploads).toBe(0);
  }, 60000);

  it('keeps redrawing on the deck.gl timeline only while something is selected', async () => {
    const make = (selected: boolean) =>
      new ScatterplotLayer<Item>({
        ...cartesian,
        id: 'timeline',
        data: ITEMS,
        getPosition: d => d.position,
        getRadius: 20,
        getFillColor: BLUE,
        extensions: [new SelectionPulseExtension()],
        getSelected: d => selected && d.selected,
        pulsePeriod: 400,
        updateTriggers: {getSelected: selected}
      } as any);
    const scene = mount(ORTHOGRAPHIC, {target: [0, 0, 0], zoom: 0}, [make(true)], {
      _animate: false
    });
    await expect.poll(() => scene.frames(), {timeout: 30000}).toBeGreaterThan(20);
    scene.deck.setProps({layers: [make(false)]});
    await new Promise(resolve => setTimeout(resolve, 300));
    const idle = scene.frames();
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(scene.frames()).toBe(idle);
    expect(scene.errors).toEqual([]);
  }, 60000);
});

describe('SelectionPulseExtension with picking and highlighting', () => {
  it('picks pulsing objects and draws the highlight over the pulse', async () => {
    const make = (props: PulseProps) => [
      new ScatterplotLayer<Item>({
        ...cartesian,
        id: 'highlighted',
        data: ITEMS,
        getPosition: d => d.position,
        getRadius: 20,
        getFillColor: BLUE,
        pickable: true,
        highlightedObjectIndex: 0,
        highlightColor: [255, 0, 0, 255],
        ...props,
        getSelected: (d: Item) => d.selected
      })
    ];
    const scene = mount(ORTHOGRAPHIC, {target: [0, 0, 0], zoom: 0}, make(pulse(0)));
    const result = await renderPulse(scene, make, {});
    expect(scene.errors).toEqual([]);
    // The opaque highlight replaces the selected object's color at every point of the pulse.
    const center = (pixels: Uint8Array) => {
      const i = ((SIZE / 2) * SIZE + SIZE / 2 - 30) * 4;
      return Array.from(pixels.subarray(i, i + 4));
    };
    expect(center(result.trough)).toEqual([255, 0, 0, 255]);
    expect(center(result.peak)).toEqual([255, 0, 0, 255]);
    expect(scene.deck.pickObject({x: SIZE / 2 - 30, y: SIZE / 2})?.object).toBe(ITEMS[0]);
    expect(scene.deck.pickObject({x: SIZE / 2 + 30, y: SIZE / 2})?.object).toBe(ITEMS[1]);
  }, 60000);
});

describe('SelectionPulseExtension with lighting and shadows', () => {
  it('pulses lit, shadow-casting columns and leaves their shadows unchanged', async () => {
    // About 30 m either side of the view center at zoom 18.
    const columns = [
      {position: [-0.00008, 0], selected: true},
      {position: [0.00008, 0], selected: false}
    ];
    const lighting = (shadow: boolean) =>
      new LightingEffect({
        ambient: new AmbientLight({intensity: 0.6}),
        sun: new DirectionalLight({direction: [-1, 2, -3], intensity: 1.5, _shadow: shadow})
      });
    const getSelected = vi.fn((d: (typeof columns)[number]) => d.selected);
    const make = (props: PulseProps) => [
      new SolidPolygonLayer({
        id: 'ground',
        data: [{polygon: square([0, 0], 0.001)}],
        getPolygon: (d: {polygon: number[][]}) => d.polygon,
        getFillColor: [220, 220, 220]
      }),
      new ColumnLayer({
        id: 'columns',
        data: columns,
        getPosition: (d: (typeof columns)[number]) => d.position,
        radius: 4,
        extruded: true,
        getElevation: 25,
        getFillColor: BLUE,
        ...props,
        getSelected
      } as any)
    ];
    const scene = mount(
      new MapView({id: 'map'}),
      {longitude: 0, latitude: 0, zoom: 18, pitch: 40, bearing: 0},
      make(pulse(0)),
      {effects: [lighting(true)]}
    );
    const result = await renderPulse(scene, make, {getSelected});
    expect(scene.errors).toEqual([]);
    const unshadowed = await scene.render(make(pulse(0)), {effects: [lighting(false)]});
    // The light casts shadows onto the ground, and the pulse leaves them alone.
    expect(getHalf(unshadowed, 'right')).not.toEqual(getHalf(result.trough, 'right'));
    expect(getHalf(result.peak, 'right')).toEqual(getHalf(result.trough, 'right'));
    let darker = 0;
    for (let i = 0; i < result.trough.length; i++) {
      expect(result.peak[i], `byte ${i}`).toBeLessThanOrEqual(result.trough[i]);
      if (result.peak[i] < result.trough[i]) darker++;
    }
    expect(darker).toBeGreaterThan(100);
    expect(result.accessorCalls).toEqual({getSelected: 0});
    expect(result.uploads).toBe(0);
  }, 60000);
});

describe('SelectionPulseExtension in an interleaved MapboxOverlay', () => {
  it('repaints the map only while something is selected', async () => {
    const container = document.createElement('div');
    container.style.cssText = `width:${SIZE}px;height:${SIZE}px;position:relative`;
    document.body.append(container);
    const map = new maplibre.Map({
      container,
      style: {version: 8, sources: {}, layers: []},
      center: [0, 0],
      zoom: 18,
      pixelRatio: 1
    });
    const overlay = new MapboxOverlay({interleaved: true});
    const points = [
      {position: [-0.00008, 0], selected: true},
      {position: [0.00008, 0], selected: false}
    ];
    const make = (selected: boolean) =>
      new ScatterplotLayer({
        id: 'interleaved-pulse',
        data: points,
        getPosition: (d: (typeof points)[number]) => d.position,
        getRadius: 6,
        getFillColor: BLUE,
        extensions: [new SelectionPulseExtension()],
        getSelected: (d: (typeof points)[number]) => selected && d.selected,
        pulsePeriod: 400,
        updateTriggers: {getSelected: selected}
      } as any);
    // Sample the selected point on every map frame.
    const samples: number[] = [];
    let renders = 0;
    try {
      await new Promise<void>((resolve, reject) => {
        map.once('load', () => resolve());
        map.once('error', event => reject(event.error));
      });
      map.addControl(overlay);
      map.on('render', () => {
        renders++;
        const gl = map.getCanvas().getContext('webgl2') as WebGL2RenderingContext;
        const {x, y} = map.project(points[0].position);
        const pixel = new Uint8Array(4);
        gl.readPixels(Math.round(x), SIZE - Math.round(y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        if (pixel[3]) samples.push(pixel[2]);
      });
      overlay.setProps({layers: [make(true)]});
      await expect.poll(() => samples.length, {timeout: 30000}).toBeGreaterThan(30);
      // The map keeps repainting and the selected point changes color between frames.
      expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(40);
      overlay.setProps({layers: [make(false)]});
      await new Promise(resolve => setTimeout(resolve, 300));
      const idle = renders;
      await new Promise(resolve => setTimeout(resolve, 500));
      expect(renders - idle).toBeLessThanOrEqual(1);
    } finally {
      map.removeControl(overlay);
      map.remove();
      container.remove();
    }
  }, 60000);
});

describe('SelectionPulseExtension on TreeLayer', () => {
  it('pulses the selected tree in TreeLayer wood, crops and canopy without recomputing attributes', async () => {
    // About 2.8 m either side of the view center: each crown stays in its half of the canvas.
    const trees: (TreeSpec & {selected: boolean})[] = [
      {species: 'oak', position: [-0.000025, 0, 0], height: 5, crownRadius: 1.5, selected: true},
      {species: 'oak', position: [0.000025, 0, 0], height: 5, crownRadius: 1.5, selected: false}
    ];
    const getSelected = vi.fn((d: (typeof trees)[number]) => d.selected);
    const getCanopyColor = vi.fn(() => [60, 170, 60, 255]);
    const make = (props: Record<string, unknown>) => [
      new TreeLayer<(typeof trees)[number]>({
        id: 'trees',
        data: trees,
        getTree: d => d,
        windEnabled: false,
        getCrop: () => ({count: 6, droppedCount: 4, radius: 0.1, color: [230, 120, 20, 255]}),
        // Coarse crowns keep software adapters fast and the frame stable.
        maxCanopySplats: 0,
        getCanopyColor,
        getSelected,
        ...props
      } as any)
    ];
    const scene = mount(
      new MapView({id: 'map'}),
      {longitude: 0, latitude: 0, zoom: 20, pitch: 30, bearing: 0},
      make(pulse(0))
    );
    // Prop-driven frames re-render the TreeLayer each time; its sub-layers must not recompute.
    const result = await renderPulse(scene, make, {getSelected, getCanopyColor}, 'pulseTime');
    expect(scene.errors).toEqual([]);

    const trough = measure(result.trough, 'left');
    const peak = measure(result.peak, 'left');
    expect(trough.covered).toBeGreaterThan(300);
    expect(peak.rgb / trough.rgb).toBeLessThan(0.75);
    expect(measure(result.trough, 'right').covered).toBeGreaterThan(300);
    expect(getHalf(result.peak, 'right')).toEqual(getHalf(result.trough, 'right'));
    expect(result.accessorCalls).toEqual({getSelected: 0, getCanopyColor: 0});
    expect(result.uploads).toBe(0);

    // Every primitive layer that holds the selected tree carries its weight.
    const primitives = scene.deck.layerManager!.getLayers().filter(layer => !layer.isComposite);
    const weighted = primitives.filter(layer => {
      const attribute = layer.getAttributeManager()?.attributes.selectionWeights;
      const values = attribute?.value as Float32Array | undefined;
      return values && Array.from(values.subarray(0, attribute!.numInstances)).includes(1);
    });
    expect(weighted.map(layer => layer.constructor.layerName)).toEqual(
      expect.arrayContaining(['SplatPrimitiveLayer', 'TreeMeshLayer'])
    );
    expect(weighted.some(layer => layer.id.includes('wood'))).toBe(true);
    expect(weighted.some(layer => layer.id.includes('crops'))).toBe(true);
  }, 90000);
});

class TestDeck extends Deck {
  pause() {
    this.animationLoop?.stop();
  }
  resume() {
    this.animationLoop?.start();
  }
}

type NativeGpuDevice = {
  addEventListener: (type: 'uncapturederror', listener: (event: any) => void) => void;
  queue: {onSubmittedWorkDone: () => Promise<void>};
};

/** Reads a WebGPU render target bottom row first, like WebGL `readPixels`. */
async function readTexture(device: Device, texture: Texture): Promise<Uint8Array> {
  const buffer = device.createBuffer({
    byteLength: SIZE * SIZE * 4,
    usage: Buffer.COPY_DST | Buffer.MAP_READ
  });
  try {
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer({
      sourceTexture: texture,
      destinationBuffer: buffer,
      bytesPerRow: SIZE * 4,
      width: SIZE,
      height: SIZE
    });
    device.submit(encoder.finish());
    const data = await buffer.readAsync();
    const pixels = new Uint8Array(data.length);
    for (let y = 0; y < SIZE; y++)
      pixels.set(data.subarray(y * SIZE * 4, (y + 1) * SIZE * 4), (SIZE - 1 - y) * SIZE * 4);
    return pixels;
  } finally {
    buffer.destroy();
  }
}

describe('SelectionPulseExtension on WebGPU', () => {
  it('pulses the selected tree in TreeLayer on WebGPU', async ({skip}) => {
    await requireWebGPUAdapter(skip);
    const parent = document.createElement('div');
    parent.style.cssText = `width:${SIZE}px;height:${SIZE}px`;
    document.body.append(parent);
    const device = await luma.createDevice({
      type: 'webgpu',
      adapters: [webgpuAdapter],
      createCanvasContext: {container: parent, width: SIZE, height: SIZE, useDevicePixels: false}
    });
    const errors: string[] = [];
    (device as Device & {handle: NativeGpuDevice}).handle.addEventListener(
      'uncapturederror',
      event => errors.push(event.error?.message ?? 'WebGPU validation error')
    );
    const colorTexture = device.createTexture({
      width: SIZE,
      height: SIZE,
      format: 'rgba8unorm',
      usage: Texture.RENDER_ATTACHMENT | Texture.COPY_SRC
    });
    const framebuffer: Framebuffer = device.createFramebuffer({
      width: SIZE,
      height: SIZE,
      colorAttachments: [colorTexture],
      depthStencilAttachment: 'depth24plus'
    });
    const trees: (TreeSpec & {selected: boolean})[] = [
      {species: 'oak', position: [-0.000025, 0, 0], height: 5, crownRadius: 1.5, selected: true},
      {species: 'oak', position: [0.000025, 0, 0], height: 5, crownRadius: 1.5, selected: false}
    ];
    const make = (pulseTime: number) => [
      new TreeLayer<(typeof trees)[number]>({
        id: 'webgpu-trees',
        data: trees,
        getTree: d => d,
        windEnabled: false,
        maxCanopySplats: 0,
        getCanopyColor: [60, 170, 60, 255],
        getSelected: d => d.selected,
        ...pulse(pulseTime)
      } as any)
    ];
    let frames = 0;
    const deck = new TestDeck({
      device,
      parent,
      width: SIZE,
      height: SIZE,
      useDevicePixels: false,
      _framebuffer: framebuffer,
      _animate: true,
      views: new MapView({id: 'map'}),
      initialViewState: {longitude: 0, latitude: 0, zoom: 20, pitch: 30, bearing: 0},
      layers: make(0),
      onError: error => errors.push(error.message),
      onAfterRender: () => {
        frames++;
      }
    });
    /** Draws `layers` for a while, then reads the frame. */
    const render = async (layers: Layer[]) => {
      deck.setProps({layers});
      const start = frames;
      // Cold software WGSL compilation can take many seconds.
      await expect.poll(() => frames, {timeout: 60000}).toBeGreaterThan(start + 12);
      deck.pause();
      const pixels = await readTexture(device, colorTexture);
      deck.resume();
      return pixels;
    };
    try {
      await render(make(0));
      const trough = await render(make(0));
      const peak = await render(make(500));
      await (device as Device & {handle: NativeGpuDevice}).handle.queue.onSubmittedWorkDone();
      expect(errors).toEqual([]);
      const before = measure(trough, 'left');
      expect(before.covered).toBeGreaterThan(300);
      expect(measure(peak, 'left').rgb / before.rgb).toBeLessThan(0.75);
      expect(measure(trough, 'right').covered).toBeGreaterThan(300);
      expect(getHalf(peak, 'right')).toEqual(getHalf(trough, 'right'));
    } finally {
      deck.finalize();
      framebuffer.destroy();
      colorTexture.destroy();
      device.destroy();
      parent.remove();
    }
  }, 120000);
});

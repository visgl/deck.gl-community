// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {afterEach, describe, expect, it, vi} from 'vitest';
import {Attribute, LayerManager, WebMercatorViewport, type Layer} from '@deck.gl/core';
import {ScatterplotLayer, SolidPolygonLayer} from '@deck.gl/layers';
import {device} from '@deck.gl/test-utils/vitest';
import {SelectionPulseExtension, TreeLayer} from '../../src';
import {getSelectionPulseAmount} from '../../src/selection-pulse-extension/selection-pulse-extension';
import {WGSL_FILTER_COLOR_ANCHOR} from '../../src/selection-pulse-extension/selection-pulse-shaders';
import {
  SPLAT_ACCUMULATION_WGSL,
  SPLAT_TRANSMISSION_WGSL,
  SPLAT_WGSL
} from '../../src/splat-layer/splat.wgsl';
import {SplatPrimitiveLayer} from '../../src/splat-layer/splat-primitive-layer';
import {TreeMeshLayer} from '../../src/tree-layer/tree-mesh-layer';

type Point = {id: number; position: [number, number]; selected: boolean};
const POINTS: Point[] = [
  {id: 0, position: [0, 0], selected: true},
  {id: 1, position: [0.001, 0], selected: false},
  {id: 2, position: [0, 0.001], selected: true}
];
const viewport = new WebMercatorViewport({width: 100, height: 100, zoom: 14});
const managers: LayerManager[] = [];

function mount(layer: Layer) {
  const layerManager = new LayerManager(device, {viewport});
  managers.push(layerManager);
  layerManager.setLayers([layer]);
  return {
    layerManager,
    get layer() {
      return layerManager.getLayers()[0];
    },
    update(next: Layer) {
      layerManager.setLayers([next]);
    }
  };
}

function weights(layer: Layer): number[] {
  const attribute = layer.getAttributeManager()!.attributes.selectionWeights;
  const value = attribute.value as Float32Array;
  return attribute.isConstant ? [value[0]] : Array.from(value.subarray(0, attribute.numInstances));
}

/** Draw hooks of every extension, as deck.gl calls them before the layer draws. */
function drawExtensions(layer: Layer) {
  for (const extension of layer.props.extensions) extension.draw.call(layer, {}, extension);
}

afterEach(() => {
  for (const layerManager of managers.splice(0)) layerManager.finalize();
  vi.restoreAllMocks();
});

describe('getSelectionPulseAmount', () => {
  const props = {pulseStrength: 0.4, pulsePeriod: 1500, pulsePhase: 0};
  it('rises to pulseStrength at half a period and returns', () => {
    expect(getSelectionPulseAmount(0, props)).toBeCloseTo(0);
    expect(getSelectionPulseAmount(375, props)).toBeCloseTo(0.2);
    expect(getSelectionPulseAmount(750, props)).toBeCloseTo(0.4);
    expect(getSelectionPulseAmount(1500, props)).toBeCloseTo(0);
    expect(getSelectionPulseAmount(2250, props)).toBeCloseTo(0.4);
  });
  it('offsets by pulsePhase cycles and clamps pulseStrength', () => {
    expect(getSelectionPulseAmount(0, {...props, pulsePhase: 0.5})).toBeCloseTo(0.4);
    expect(getSelectionPulseAmount(750, {...props, pulseStrength: 3})).toBeCloseTo(1);
    expect(getSelectionPulseAmount(750, {...props, pulseStrength: -1})).toBe(0);
  });
  it('holds a steady tint without a finite positive period', () => {
    for (const pulsePeriod of [0, -1, Infinity, Number.NaN])
      expect(getSelectionPulseAmount(123, {...props, pulsePeriod})).toBe(0.4);
  });
});

describe('SelectionPulseExtension on deck.gl layers', () => {
  const scatterplot = (props = {}) =>
    new ScatterplotLayer<Point>({
      id: 'points',
      data: POINTS,
      getPosition: d => d.position,
      getFillColor: [0, 128, 255],
      extensions: [new SelectionPulseExtension()],
      getSelected: d => d.selected,
      ...props
    } as any);

  it('injects at the vertex DECKGL_FILTER_COLOR hook', () => {
    const {layer} = mount(scatterplot());
    const shaders = layer.getShaders({});
    expect(shaders.modules.map(module => module.name)).toContain('selectionPulse');
    expect(shaders.inject['vs:DECKGL_FILTER_COLOR']).toContain('selectionPulse_filterColor');
  });

  it('writes one weight per object from getSelected', () => {
    const scene = mount(scatterplot());
    expect(weights(scene.layer)).toEqual([1, 0, 1]);
    scene.update(
      scatterplot({getSelected: (d: Point) => (d.id === 1 ? 0.25 : d.id === 2 ? 4 : -1)})
    );
    // Accessor identity is not a change; the trigger is.
    expect(weights(scene.layer)).toEqual([1, 0, 1]);
    scene.update(
      scatterplot({
        getSelected: (d: Point) => (d.id === 1 ? 0.25 : d.id === 2 ? 4 : -1),
        updateTriggers: {getSelected: 1}
      })
    );
    expect(weights(scene.layer)).toEqual([0, 0.25, 1]);
    scene.update(scatterplot({getSelected: true, updateTriggers: {getSelected: 2}}));
    expect(weights(scene.layer)).toEqual([1]);
  });

  it('animates with uniforms only: no accessor reruns and no attribute updates across pulse frames', () => {
    const getSelected = vi.fn((d: Point) => d.selected);
    const getFillColor = vi.fn(() => [0, 128, 255, 255]);
    const props = {getSelected, getFillColor, pulseTime: 0};
    const scene = mount(scatterplot(props));
    expect(getSelected).toHaveBeenCalledTimes(POINTS.length);
    expect(getFillColor).toHaveBeenCalledTimes(POINTS.length);
    const setShaderModuleProps = vi.spyOn(
      Object.getPrototypeOf(scene.layer),
      'setShaderModuleProps'
    );
    const updateBuffer = vi.spyOn(Attribute.prototype, 'updateBuffer');
    const amounts: number[] = [];
    for (const pulseTime of [0, 375, 750, 1125]) {
      scene.update(scatterplot({...props, pulseTime}));
      drawExtensions(scene.layer);
      amounts.push(setShaderModuleProps.mock.lastCall![0].selectionPulse.amount);
    }
    expect(getSelected).toHaveBeenCalledTimes(POINTS.length);
    expect(getFillColor).toHaveBeenCalledTimes(POINTS.length);
    const attributes = scene.layer.getAttributeManager()!.attributes;
    expect(Object.values(attributes).some(attribute => attribute.needsUpdate())).toBe(false);
    expect(updateBuffer.mock.results.filter(result => result.value)).toEqual([]);
    expect(amounts[0]).toBeCloseTo(0);
    expect(amounts[1]).toBeCloseTo(0.2);
    expect(amounts[2]).toBeCloseTo(0.4);
    expect(amounts[3]).toBeCloseTo(0.2);
  });

  it('requests redraws only while something is selected and the timeline drives the pulse', () => {
    const scene = mount(scatterplot());
    const redraw = vi.spyOn(scene.layer, 'setNeedsRedraw');
    drawExtensions(scene.layer);
    expect(redraw).toHaveBeenCalledTimes(1);

    for (const props of [
      {getSelected: false, updateTriggers: {getSelected: 'constant'}},
      {pulseTime: 100},
      {pulsePeriod: 0},
      {getSelected: () => 0, updateTriggers: {getSelected: 'none'}}
    ]) {
      scene.update(scatterplot(props));
      const idle = vi.spyOn(scene.layer, 'setNeedsRedraw');
      drawExtensions(scene.layer);
      expect(idle, JSON.stringify(props)).not.toHaveBeenCalled();
    }
  });

  it('applies a selection changed in the same update as a partial data change', () => {
    // SplatLayer and TreeLayer children diff their rows with _dataDiff while the camera moves;
    // deck.gl then skips update triggers.
    const rows = POINTS.map(point => ({...point}));
    const props = (selected: Set<number>, data: Point[]) => ({
      data,
      _dataDiff: () => [{startRow: 1, endRow: 2}],
      getSelected: (d: Point) => selected.has(d.id),
      updateTriggers: {getSelected: [...selected].join()}
    });
    const scene = mount(scatterplot(props(new Set([0]), rows)));
    expect(weights(scene.layer)).toEqual([1, 0, 0]);
    scene.update(scatterplot(props(new Set([2]), [...rows])));
    expect(weights(scene.layer)).toEqual([0, 0, 1]);
  });

  it('initializes when it is added to an existing layer', () => {
    // deck.gl initializes extensions only when it creates a layer.
    const scene = mount(scatterplot({extensions: []}));
    expect(scene.layer.getAttributeManager()!.attributes.selectionWeights).toBeUndefined();
    scene.update(scatterplot());
    expect(weights(scene.layer)).toEqual([1, 0, 1]);
    const [model] = scene.layer.getModels();
    expect(model.bufferLayout.map(layout => layout.name)).toContain('selectionWeights');
    expect(model.shaderInputs.getModules().map(module => module.name)).toContain('selectionPulse');
  });

  it('writes per-vertex weights for SolidPolygonLayer', () => {
    const square = (x: number) => [
      [x, 0],
      [x + 0.001, 0],
      [x + 0.001, 0.001],
      [x, 0.001]
    ];
    const scene = mount(
      new SolidPolygonLayer({
        id: 'polygons',
        data: [{polygon: square(0)}, {polygon: square(0.002), selected: true}],
        getPolygon: (d: any) => d.polygon,
        extensions: [new SelectionPulseExtension()],
        getSelected: (d: any) => Boolean(d.selected)
      } as any)
    );
    const values = weights(scene.layer);
    const starts = (scene.layer.state as any).polygonTesselator.vertexStarts as number[];
    expect(values.slice(0, starts[1]).every(value => value === 0)).toBe(true);
    expect(values.slice(starts[1]).every(value => value === 1)).toBe(true);
  });
});

describe('SelectionPulseExtension WebGPU support', () => {
  it('marks the splat and tree mesh WGSL vertex colors with the filter anchor', () => {
    for (const source of [SPLAT_WGSL, SPLAT_ACCUMULATION_WGSL, SPLAT_TRANSMISSION_WGSL])
      expect(source.split(WGSL_FILTER_COLOR_ANCHOR)).toHaveLength(2);
    const mesh = Object.create(TreeMeshLayer.prototype);
    Object.assign(mesh, {
      context: {device: {type: 'webgpu'}, defaultShaderModules: []},
      props: {extensions: []}
    });
    const {source} = mesh.getShaders();
    expect(source.split(WGSL_FILTER_COLOR_ANCHOR)).toHaveLength(2);
    expect(source).toMatch(
      /var vertexColor = varyings\.color;[\s\S]*varyings\.color = vertexColor;/
    );
  });

  it('reads weights by instance index in the splat and tree mesh layers on both backends', () => {
    const extension = new SelectionPulseExtension();
    const make = (Type: any, type: string) => {
      const layer = Object.create(Type.prototype);
      return Object.assign(layer, {
        id: Type.layerName,
        state: {},
        context: {device: {type}},
        props: {extensions: [extension]},
        setState: (state: object) => Object.assign(layer.state, state),
        getAttributeManager: () => ({add: () => {}})
      });
    };
    for (const Type of [SplatPrimitiveLayer, TreeMeshLayer]) {
      const webgl = extension.getShaders.call(make(Type, 'webgl'), extension);
      expect(webgl.defines).toEqual({SELECTION_PULSE_INSTANCES: 1});
      expect(webgl.inject['vs:DECKGL_FILTER_COLOR']).toContain('selectionPulse_filterColor');
      const webgpu = extension.getShaders.call(make(Type, 'webgpu'), extension);
      expect(webgpu.inject[WGSL_FILTER_COLOR_ANCHOR]).toMatch(/^\n\s*vertexColor = /);
    }
    const attribute = extension.getShaders.call(make(ScatterplotLayer, 'webgl'), extension);
    expect(attribute.defines).toBeUndefined();
    expect(extension.isEnabled(make(ScatterplotLayer, 'webgpu'))).toBe(false);
  });
});

describe('TreeLayer with SelectionPulseExtension', () => {
  type Tree = {id: string; position: [number, number]; species: 'oak' | 'citrus'};
  const TREES: Tree[] = [
    {id: 'a', position: [0, 0], species: 'oak'},
    {id: 'b', position: [10, 0], species: 'citrus'},
    {id: 'c', position: [20, 0], species: 'oak'}
  ];

  function render(selected: Set<string>, trigger: unknown) {
    const layer = new TreeLayer<Tree>({
      id: 'trees',
      data: TREES,
      getTree: d => d,
      getCrop: () => ({count: 2, radius: 0.04, color: [200, 140, 40]}),
      extensions: [new SelectionPulseExtension()],
      getSelected: (d: Tree) => selected.has(d.id),
      updateTriggers: {getSelected: trigger}
    } as any);
    layer.initializeState();
    vi.spyOn(layer, 'setState').mockImplementation(state => Object.assign(layer.state, state));
    layer.updateState({
      props: layer.props,
      oldProps: {},
      changeFlags: {dataChanged: true}
    } as any);
    return layer.renderLayers() as Layer[];
  }

  it('passes the extension, the selection and its trigger to every sub-layer', () => {
    const children = render(new Set(['b']), 'b');
    const ids = children.map(child => child.id);
    expect(ids.some(id => id.includes('canopy'))).toBe(true);
    expect(ids.some(id => id.includes('wood'))).toBe(true);
    expect(ids.some(id => id.includes('crops'))).toBe(true);
    for (const child of children) {
      expect(child.props.extensions[0]).toBeInstanceOf(SelectionPulseExtension);
      expect(child.props.updateTriggers.getSelected, child.id).toBe('b');
      const rows = child.props.data as {__source: {index: number}}[];
      const getSelected = child.props.getSelected as (row: unknown, info: unknown) => boolean;
      // Each partition holds a subset of trees in its own order; rows map back to their tree.
      for (const row of rows)
        expect(getSelected(row, {index: -1})).toBe(TREES[row.__source.index].id === 'b');
    }
  });

  it('reruns no sub-layer accessor when an unrelated prop changes', () => {
    // Pulse frames driven by `pulseTime` re-render the TreeLayer: wood, crop and canopy data and
    // triggers must keep their identity, or every visible tree would be rewritten per frame.
    // (The browser test checks attribute uploads with a full Deck.)
    const view = new WebMercatorViewport({width: 128, height: 128, zoom: 20});
    const layerManager = new LayerManager(device, {
      viewport: view,
      deck: {getViewports: () => [view]}
    } as any);
    managers.push(layerManager);
    const getSelected = vi.fn((d: Tree) => d.id === 'b');
    const getCanopyColor = vi.fn(() => [60, 170, 60, 255]);
    const trees = TREES.map(tree => ({...tree, position: [tree.position[0] * 1e-6, 0]}));
    const render = (pulseTime: number) =>
      layerManager.setLayers([
        new TreeLayer<Tree>({
          id: 'trees',
          data: trees as Tree[],
          getTree: d => d,
          getCrop: () => ({count: 2, droppedCount: 2, radius: 0.04, color: [200, 140, 40]}),
          maxCanopySplats: 0,
          getCanopyColor,
          extensions: [new SelectionPulseExtension()],
          getSelected,
          pulseTime
        } as any)
      ]);
    for (let frame = 0; frame < 4; frame++) render(0);
    const primitives = layerManager.getLayers().filter(layer => !layer.isComposite);
    expect(primitives.map(layer => layer.id).join()).toMatch(/canopy.*refinement/);
    expect(primitives.some(layer => layer.id.includes('crops'))).toBe(true);
    const calls = [getSelected.mock.calls.length, getCanopyColor.mock.calls.length];
    for (const pulseTime of [250, 500, 750]) render(pulseTime);
    expect([getSelected.mock.calls.length, getCanopyColor.mock.calls.length]).toEqual(calls);
  });
});

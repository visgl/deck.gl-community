// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {WebMercatorViewport, _GlobeViewport as GlobeViewport} from '@deck.gl/core';
import {expect, it, vi} from 'vitest';
import {SplatLayer} from '../../src/splat-layer/splat-layer';
import {SplatRuntime} from '../../src/splat-layer/splat-runtime';
import {SplatEffect} from '../../src/splat-layer/splat-effect';
const SOURCE = {
  positions: new Float32Array([0, 0, 0]),
  scales: new Float32Array([1, 1, 1]),
  rotations: new Float32Array([1, 0, 0, 0]),
  colors: new Uint8Array([30, 120, 40, 255]),
  opacities: new Float32Array([0.8])
};
function make(data: {position: [number, number, number]}[], flex = 1, extra = {}) {
  const layer = new SplatLayer({
    data,
    source: SOURCE,
    deformationStrength: 0.1,
    getDeformation: [10, 0, flex],
    ...extra
  });
  layer.initializeState();
  vi.spyOn(layer, 'setState').mockImplementation(state => Object.assign(layer.state, state));
  const viewport = new WebMercatorViewport({width: 256, height: 256, zoom: 18});
  Object.assign(layer, {
    context: {
      viewport,
      device: {canvasContext: {cssToDeviceRatio: () => 1}},
      deck: {getViewports: () => [viewport]}
    }
  });
  vi.spyOn(layer, 'projectPosition').mockImplementation(point => Array.from(point));
  layer.updateState({
    props: layer.props,
    oldProps: layer.props,
    changeFlags: {dataChanged: true}
  } as any);
  return layer;
}
it('includes absolute flex in both wind allowances for camera and light bounds', () => {
  const data = [{position: [0, 0, 0] as [number, number, number]}];
  const rigid = make(data, 0),
    normal = make(data, 1),
    flexible = make(data, -4);
  const base = rigid.state.owners[0].radius;
  expect(flexible.state.owners[0].radius - base).toBeCloseTo(
    (normal.state.owners[0].radius - base) * 4,
    10
  );
});

it('starts shared capped registrations at coverage before their first joint grant', () => {
  const fine = Object.fromEntries(
    Object.entries(SOURCE).map(([key, array]) => [
      key,
      new (array.constructor as typeof Float32Array)([...array, ...array, ...array])
    ])
  );
  const layer = make([{position: [256, 256, 0]}], 0, {
    source: fine,
    hierarchy: [
      {source: fine, error: 0},
      {source: SOURCE, error: 1}
    ],
    pixelError: 0.001,
    _splatBudgetGroup: {maxSplats: 100, maxShadowSplats: 100}
  });
  expect(layer.state.candidates[0].level).toBe(0);
  expect(layer.splatStats.renderedSplats).toBe(1);
  expect(layer.splatStats.coverageFloor).toBe(1);
});
it('reconciles fallback shadow membership on replacement without retaining removed owners', () => {
  const a = {position: [0, 0, 0] as [number, number, number]},
    b = {position: [1, 0, 0] as [number, number, number]};
  const layer = make([a, b]);
  const next = [b];
  // updateState reads the current layer props, matching deck's state-transfer lifecycle.
  Object.assign(layer, {props: layer.clone({data: next}).props});
  layer.updateState({
    props: layer.props,
    oldProps: layer.props,
    changeFlags: {dataChanged: true}
  } as any);
  expect(
    [...layer.state.shadowRefinement.entries.values()].map(entry => entry.owner.row.object)
  ).toEqual([b]);
  expect(layer.state.shadowGroups.flat().map(row => row.object)).toEqual([b]);
});

it('refreshes light-space owner offsets before regrouping replaced or cleared assets', () => {
  const first = {position: [0, 0, 0] as [number, number, number], splats: SOURCE};
  const second = {
    position: [0.1, 0, 0] as [number, number, number],
    splats: {...SOURCE, colors: new Uint8Array([200, 20, 50, 255])}
  };
  const layer = make([first, second], 0, {source: undefined, getSource: row => row.splats});
  layer.prepareShadow(
    [
      {
        matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        center: [0, 0, 0, 0],
        width: 256,
        height: 256
      }
    ],
    layer.context.viewport
  );
  expect(layer.state.shadowGroups.flat().map(row => row.object)).toEqual([first, second]);
  const retained = [...layer.state.shadowRefinement.entries.values()][1];
  for (const data of [[second], []]) {
    const oldProps = layer.props;
    Object.assign(layer, {props: layer.clone({data}).props});
    layer.updateState({props: layer.props, oldProps, changeFlags: {dataChanged: true}} as any);
    expect(layer.state.shadowGroups.flat().map(row => row.object)).toEqual(data);
    if (data.length) {
      expect([...layer.state.shadowRefinement.entries.values()]).toEqual([retained]);
      expect(retained.owner.offset).toBe(0);
    }
  }
  expect(layer.state.shadowRefinement.entries.size).toBe(0);
  expect(layer.renderLayers()).toEqual([]);
});

it('restores shifted-origin shadow casters immediately after an empty inventory', () => {
  const layer = make([{position: [0, 0, 0]}], 0);
  const projections = [
    {
      matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      center: [0, 0, 0, 0],
      width: 256,
      height: 256
    }
  ];
  layer.prepareShadow(projections, layer.context.viewport);
  for (const data of [[], [{position: [100, 0, 0] as [number, number, number]}]]) {
    const oldProps = layer.props;
    Object.assign(layer, {props: layer.clone({data}).props});
    // A precision-preserving host origin shifts with the replacement owner's pose.
    vi.mocked(layer.projectPosition).mockImplementation(() => [0, 0, 0]);
    layer.updateState({props: layer.props, oldProps, changeFlags: {dataChanged: true}} as any);
    expect(layer.state.shadowGroups.flat().map(row => row.object)).toEqual(data);
  }
});

it('retains light-space selections on camera-only changes and invalidates changed source geometry', () => {
  const layer = make([{position: [0, 0, 0]}], 0);
  const viewport = layer.context.viewport;
  const projections = [
    {
      matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      center: [0, 0, 0, 0],
      width: 256,
      height: 256
    }
  ];
  layer.prepareShadow(projections, viewport);
  const recull = vi.spyOn(layer.state.shadowRefinement, 'reconcile');
  layer.updateState({
    props: layer.props,
    oldProps: layer.props,
    changeFlags: {viewportChanged: true}
  } as any);
  layer.prepareShadow(projections, viewport);
  expect(recull).not.toHaveBeenCalled();
  layer.updateState({
    props: layer.props,
    oldProps: layer.props,
    changeFlags: {dataChanged: true}
  } as any);
  expect(recull).toHaveBeenCalledOnce();
  // Identical input light matrices in a different precision origin still select a new volume.
  vi.mocked(layer.projectPosition).mockImplementation(point => [
    point[0] + 0.5,
    point[1],
    point[2] ?? 0
  ]);
  layer.prepareShadow(projections, viewport);
  expect(recull).toHaveBeenCalledTimes(2);
});

it('includes translated source centers in prepared camera and light wind bounds', () => {
  const data = [{position: [0, 0, 0] as [number, number, number]}];
  const layer = make(data, 1);
  const rigidRadius = make(data, 0).state.owners[0].radius;
  const oldProps = layer.props;
  Object.assign(layer, {
    props: layer.clone({
      source: {...SOURCE, scales: new Float32Array([0.1, 0.1, 0.1])},
      getTranslation: [100, 0, 1],
      getDeformation: [1, 0, 1]
    }).props
  });
  layer.updateState({props: layer.props, oldProps, changeFlags: {dataChanged: true}} as any);
  // Compare in the same owner's common-space metre scale: the old allowance was only 0.465m.
  expect(layer.state.owners[0].radius).toBeGreaterThan((rigidRadius * 2) / 3);
  expect(layer.state.owners[0].center[0]).toBeGreaterThan(0);
});

it('keeps heterogeneous source identity and original accessor contexts through refinement', () => {
  const layer = make([{position: [0, 0, 0]}, {position: [1, 0, 0]}], 0);
  const data = layer.props.data;
  const second = {...SOURCE, colors: new Uint8Array([200, 20, 50, 255])};
  const oldProps = layer.props;
  const getSource = vi.fn((_row, info) => {
    expect(info.data).toBe(data);
    return info.index ? second : SOURCE;
  });
  Object.assign(layer, {props: layer.clone({source: undefined, getSource}).props});
  layer.updateState({props: layer.props, oldProps, changeFlags: {dataChanged: true}} as any);
  expect(layer.state.owners.map(owner => owner.row.object)).toEqual(data);
  expect(layer.state.owners.map(owner => owner.asset.source)).toEqual([SOURCE, second]);
  expect(layer.state.hierarchy).toHaveLength(2);
  expect(getSource).toHaveBeenCalledTimes(2);
  layer.updateState({
    props: layer.props,
    oldProps: layer.props,
    changeFlags: {viewportChanged: true}
  } as any);
  expect(getSource).toHaveBeenCalledTimes(2);
});

it('preserves a moving owner when other assets enter or leave and safely clears all owners', () => {
  const fine = Object.fromEntries(
    Object.entries(SOURCE).map(([key, array]) => [
      key,
      new (array.constructor as typeof Float32Array)([...array, ...array, ...array])
    ])
  );
  const firstAsset = {
    type: 'prepared-splats' as const,
    source: fine,
    hierarchy: [
      {source: fine, error: 0},
      {source: SOURCE, error: 1}
    ]
  };
  const secondAsset = {...SOURCE, colors: new Uint8Array([200, 20, 50, 255])};
  const first = {position: [256, 256, 0] as [number, number, number], splats: firstAsset};
  const second = {position: [257, 256, 0] as [number, number, number], splats: secondAsset};
  const layer = make([first], 0, {
    source: undefined,
    getSource: row => row.splats,
    pixelError: 0.001
  });
  const transition = layer.state.refinement;
  const owner = layer.state.owners[0];
  transition.reconcile([{owner, pixels: 1, level: 1, blend: 0}], [3, 1], Infinity, row => row.key);
  transition.sample(1);
  transition.sample(17);
  const entry = transition.entries.get(owner.key)!;
  const weights = [...entry.weights];
  expect(weights[0]).toBeGreaterThan(0);
  expect(weights[1]).toBeGreaterThan(0);
  for (const data of [[first, second], [first], []]) {
    const oldProps = layer.props;
    Object.assign(layer, {props: layer.clone({data}).props});
    layer.updateState({props: layer.props, oldProps, changeFlags: {dataChanged: true}} as any);
    expect(layer.state.refinement).toBe(transition);
    if (data.length) {
      expect(transition.entries.get(owner.key)).toBe(entry);
      expect(entry.weights).toEqual(weights);
    }
  }
  expect(layer.state.hierarchy).toEqual([]);
  expect(layer.state.groups.flat()).toEqual([]);
  expect(layer.state.shadowGroups.flat()).toEqual([]);
  expect(layer.renderLayers()).toEqual([]);
});

it('retains light-volume selection across layer state transfer and invalidates changed maps', () => {
  const layer = make([{position: [256, 256, 0]}], 0);
  const projections = [
    {
      matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      center: [0, 0, 0, 0],
      width: 256,
      height: 256
    }
  ];
  layer.prepareShadow(projections, layer.context.viewport);
  const candidates = layer.state.shadowCandidates;
  const reconcile = vi.spyOn(layer.state.shadowRefinement, 'reconcile');
  const replacement = layer.clone();
  Object.assign(replacement, {state: layer.state, context: layer.context});
  vi.spyOn(replacement, 'projectPosition').mockImplementation(point => Array.from(point));
  replacement.prepareShadow(projections, layer.context.viewport);
  expect(reconcile).not.toHaveBeenCalled();
  expect(replacement.state.shadowCandidates).toBe(candidates);
  replacement.prepareShadow([{...projections[0], width: 512}], layer.context.viewport);
  expect(reconcile).toHaveBeenCalledTimes(1);
});

it('moves camera and shadow demand to the current device runtime even without prop changes', () => {
  const layer = make([{position: [256, 256, 0]}], 0);
  const previous = layer.state.runtime;
  const remove = vi.spyOn(previous, 'delete');
  const tick = vi.spyOn(layer, 'updateRefinement');
  vi.spyOn(layer, 'getCurrentLayer').mockReturnValue(layer);
  Object.assign(layer, {
    context: {
      ...layer.context,
      device: {canvasContext: {cssToDeviceRatio: () => 1}}
    }
  });
  expect(layer.shouldUpdateState({changeFlags: {somethingChanged: false}})).toBe(true);
  layer.updateState({props: layer.props, oldProps: layer.props, changeFlags: {}} as any);
  const current = SplatRuntime.get(layer.context.deck, layer.context.device);
  expect(current).not.toBe(previous);
  expect(layer.state.runtime).toBe(current);
  expect(remove).toHaveBeenCalledExactlyOnceWith(layer.id);
  const ids = new Set([layer.id]);
  current.sample(ids, 123);
  expect(tick).toHaveBeenCalledExactlyOnceWith(123);
  previous.sample(ids, 456);
  expect(tick).toHaveBeenCalledTimes(1);
  const allocations = vi.spyOn(layer as any, 'applyAllocation');
  current.reconcile(ids);
  expect(allocations.mock.calls.map(call => call[0])).toEqual([false, true]);
  expect(layer.shouldUpdateState({changeFlags: {somethingChanged: false}})).toBe(false);
});

it.each([
  {limit: 'parent', budget: 100},
  {limit: 'total', budget: 100},
  {limit: 'parent', budget: 2},
  {limit: 'total', budget: 2}
])('starts light-space demand at coverage and retains shared $limit allocations of $budget', ({
  limit,
  budget
}) => {
  const fine = Object.fromEntries(
    Object.entries(SOURCE).map(([key, array]) => [
      key,
      new (array.constructor as typeof Float32Array)([...array, ...array, ...array])
    ])
  );
  const layer = make([{position: [0, 0, 0]}], 0, {
    source: fine,
    hierarchy: [
      {source: fine, error: 0},
      {source: SOURCE, error: 1}
    ],
    pixelError: 0.001,
    ...(limit === 'parent'
      ? {_splatBudgetGroup: {maxSplats: budget, maxShadowSplats: budget}}
      : {maxTotalSplats: budget})
  });
  vi.spyOn(layer, 'getCurrentLayer').mockReturnValue(layer);
  layer.prepareShadow(
    [
      {
        matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        center: [0, 0, 0, 0],
        width: 256,
        height: 256
      }
    ],
    layer.context.viewport
  );
  expect(layer.state.shadowCandidates[0].level).toBe(0);
  expect(layer.splatStats.shadowSplats).toBe(1);
  expect(layer.splatStats.shadowCoverageFloor).toBe(1);
  const ids = new Set([layer.id]);
  layer.state.runtime.reconcile(ids);
  expect(layer.state.shadowRefinement.active).toBe(budget === 100);
  for (let now = 16; now <= 6400; now += 16) layer.state.runtime.sample(ids, now);
  expect(layer.state.shadowRefinement.active).toBe(false);
  expect(layer.splatStats.shadowSplats).toBe(budget === 100 ? 3 : 1);
  const entry = [...layer.state.shadowRefinement.entries.values()][0];
  const weights = [...entry.weights];
  // Moving a light volume must not demote settled owners before the next joint grant.
  const projections = layer.state.shadowProjections!;
  layer.prepareShadow([{...projections[0], width: 512}], layer.context.viewport);
  expect(layer.state.shadowRefinement.active).toBe(false);
  expect(entry.weights).toEqual(weights);
  // Inventory rebuilds retain the same settled light selection.
  const oldProps = layer.props;
  Object.assign(layer, {props: layer.clone({data: [...layer.state.input.data]}).props});
  layer.updateState({props: layer.props, oldProps, changeFlags: {dataChanged: true}} as any);
  expect(layer.state.shadowRefinement.active).toBe(false);
  expect(entry.weights).toEqual(weights);
  // A new owner waits at coverage without changing the existing owner's allocation.
  const previous = layer.props;
  Object.assign(layer, {
    props: layer.clone({data: [...layer.state.input.data, {position: [0.1, 0, 0]}]}).props
  });
  layer.updateState({
    props: layer.props,
    oldProps: previous,
    changeFlags: {dataChanged: true}
  } as any);
  const added = [...layer.state.shadowRefinement.entries.values()][1];
  expect(entry.weights).toEqual(weights);
  expect(added.weights).toEqual([0, 1]);
  expect(layer.state.shadowRefinement.active).toBe(false);
});

it('refreshes mutated owner attributes on new data without discarding camera-only stability', () => {
  const row = {position: [256, 256, 0] as [number, number, number]};
  const layer = make([row], 0);
  const initial = layer.state.groups[0];
  expect(initial).toHaveLength(1);
  const initialShadow = layer.state.shadowGroups[0];
  const update = (data = layer.props.data, dataChanged = false) => {
    const oldProps = layer.props;
    Object.assign(layer, {props: layer.clone({data}).props});
    layer.updateState({
      props: layer.props,
      oldProps,
      changeFlags: {dataChanged, viewportChanged: true}
    } as any);
  };
  update();
  expect(layer.state.groups[0]).toBe(initial);
  expect(layer.state.shadowGroups[0]).toBe(initialShadow);
  row.position[0] += 0.00001;
  update([row], true);
  expect(layer.state.groups[0][0].object).toBe(row);
  expect(layer.state.groups[0][0]).not.toBe(initial[0]);
  expect(layer.state.shadowGroups[0][0]).not.toBe(initialShadow[0]);
  const moved = layer.state.groups[0];
  // A non-pose attribute may change even though the retained selection key does not.
  update([row], true);
  expect(layer.state.groups[0]).toHaveLength(1);
  expect(layer.state.groups[0][0]).not.toBe(moved[0]);
});

it('rejects globe projections before applying planar prepared bounds', () => {
  const layer = make([{position: [0, 0, 0]}], 0);
  const globe = new GlobeViewport({width: 256, height: 256, longitude: 0, latitude: 0, zoom: 2});
  layer.context.deck.getViewports = () => [layer.context.viewport, globe];
  expect(() =>
    layer.updateState({
      props: layer.props,
      oldProps: layer.props,
      changeFlags: {viewportChanged: true}
    } as any)
  ).toThrow('GlobeView');
});

it('rejects WebGPU view clears before deck opens a nested render pass', () => {
  const effect = new SplatEffect();
  Object.assign(effect, {device: {type: 'webgpu'}});
  expect(() =>
    effect.preRender({
      layers: [
        {constructor: {layerName: 'SplatPrimitiveLayer'}, props: {visible: true, operation: 'draw'}}
      ],
      viewports: [{id: 'overlay'}],
      views: {overlay: {props: {clear: true}}}
    } as any)
  ).toThrow('View.clear');
});

it.each([
  {width: 2048, height: 256, zoom: 0, longitude: 0},
  {width: 256, height: 256, zoom: 18, longitude: 200}
])('rejects wrapped world copies before selecting one parent frustum: %o', options => {
  const layer = make([{position: [0, 0, 0]}], 0);
  const repeated = new WebMercatorViewport({...options, repeat: true});
  expect(repeated.subViewports!.some(view => view !== repeated)).toBe(true);
  layer.context.deck.getViewports = () => [repeated];
  expect(() =>
    layer.updateState({
      props: layer.props,
      oldProps: layer.props,
      changeFlags: {viewportChanged: true}
    } as any)
  ).toThrow('wrapped world');
});

it('requeries visibility at a requested raster density without rebuilding owners', () => {
  const layer = make([{position: [0, 0, 0]}], 0);
  const owners = layer.state.owners;
  const index = layer.state.spatialIndex;
  const update = vi.spyOn(layer, 'setNeedsUpdate').mockImplementation(() => {});
  const queried = layer.state.renderPixelRatio;
  expect(layer.requestSplatRenderPixelRatio(0.25)).toBe(queried);
  expect(update).toHaveBeenCalledOnce();
  layer.updateState({props: layer.props, oldProps: layer.props, changeFlags: {}} as any);
  expect(layer.state.renderPixelRatio).toBe(0.25);
  expect(layer.state.owners).toBe(owners);
  expect(layer.state.spatialIndex).toBe(index);
  expect(layer.requestSplatRenderPixelRatio(0.25)).toBe(0.25);
  expect(update).toHaveBeenCalledOnce();
});

it('synchronizes shared multi-view raster density before tightening the pixel cap', () => {
  const effect = new SplatEffect();
  let queriedDensity = 2;
  const request = vi.fn(() => queriedDensity);
  const parent = {
    props: {visible: true, operation: 'draw', maxRenderPixels: 2500},
    requestSplatRenderPixelRatio: request
  };
  const primitive = {
    constructor: {layerName: 'SplatPrimitiveLayer'},
    props: {visible: true, operation: 'draw', maxRenderPixels: Infinity}
  };
  const render = vi.fn();
  const resize = vi.fn(() => Object.assign(effect, {targets: [{}, {}]}));
  Object.assign(effect, {
    device: {
      type: 'webgl',
      canvasContext: {getDrawingBufferSize: () => [200, 100], cssToDeviceRatio: () => 2},
      beginRenderPass: () => ({end() {}})
    },
    model: {shaderInputs: {setProps() {}}},
    passes: [{render}, {render}, {render}],
    resize
  });
  const options = {layers: [parent, primitive], viewports: [{id: 'a'}, {id: 'b'}]};
  effect.preRender(options as any);
  expect(request).toHaveBeenCalledWith(0.5);
  expect(resize).toHaveBeenCalledWith(200, 100, 'a');
  expect(render.mock.calls[0][0].shaderModuleProps.project.devicePixelRatio).toBe(2);
  queriedDensity = 0.5;
  effect.preRender(options as any);
  expect(resize).toHaveBeenLastCalledWith(50, 25, 'b');
  expect(render.mock.lastCall![0].shaderModuleProps.project.devicePixelRatio).toBe(0.5);
});

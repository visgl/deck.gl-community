// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {WebMercatorViewport, _GlobeViewport as GlobeViewport, type Viewport} from '@deck.gl/core';
import {Matrix4} from '@math.gl/core';
import {expect, it, vi} from 'vitest';
import {SplatLayer} from '../../src/splat-layer/splat-layer';
import {SplatRuntime} from '../../src/splat-layer/splat-runtime';
import {SplatEffect} from '../../src/splat-layer/splat-effect';
import {
  getSplatBoundedPixelsPerMeter,
  getSplatPixelsPerMeter,
  getSplatViewportLodWeight
} from '../../src/splat-layer/splat-culling';
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

type PerspectiveRow = {id: string; position: [number, number, number]; scale: number};
function makePerspective(
  data: PerspectiveRow[],
  extra = {},
  getViewports?: (viewport: Viewport) => Viewport[]
) {
  const coarse = {...SOURCE, scales: new Float32Array([0.1, 0.1, 0.1])};
  const fine = Object.fromEntries(
    Object.entries(coarse).map(([key, array]) => [
      key,
      new (array.constructor as typeof Float32Array)([...array, ...array, ...array, ...array])
    ])
  );
  const layer = new SplatLayer<PerspectiveRow>({
    data,
    source: fine,
    hierarchy: [
      {source: fine, error: 0},
      {source: coarse, error: 0.02}
    ],
    getPosition: row => row.position,
    getScale: row => [row.scale, row.scale, row.scale],
    pixelError: 0.9,
    foveationStrength: 1,
    ...extra
  });
  layer.initializeState();
  vi.spyOn(layer, 'setState').mockImplementation(state => Object.assign(layer.state, state));
  const viewport = {
    viewProjectionMatrix: new Matrix4().perspective({
      fovy: Math.PI / 2,
      aspect: 1,
      near: 0.1,
      far: 100
    }),
    width: 100,
    height: 100,
    distanceScales: {unitsPerMeter: [1, 1, 1]}
  } as unknown as Viewport;
  Object.assign(layer, {
    context: {
      viewport,
      device: {canvasContext: {cssToDeviceRatio: () => 1}},
      deck: {getViewports: () => getViewports?.(viewport) ?? [viewport]}
    }
  });
  vi.spyOn(layer, 'projectPosition').mockImplementation(point => Array.from(point));
  layer.updateState({
    props: layer.props,
    oldProps: layer.props,
    changeFlags: {dataChanged: true}
  } as any);
  return {layer, viewport};
}
it('includes absolute flex in the camera wind allowance', () => {
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
    _splatBudgetGroup: {maxSplats: 100}
  });
  expect(layer.state.candidates[0].level).toBe(0);
  expect(layer.splatStats.renderedSplats).toBe(1);
  expect(layer.splatStats.coverageFloor).toBe(1);
});

it("spends a shared same-source canopy cap by each owner's projected error", () => {
  const data: PerspectiveRow[] = [
    {id: 'near', position: [0, 0, -3], scale: 10},
    ...Array.from({length: 9}, (_, index) => ({
      id: `far-${index}`,
      position: [0, 0, -10] as [number, number, number],
      scale: 10
    }))
  ];
  const {layer} = makePerspective(data, {
    pixelError: 0.001,
    foveationStrength: 0,
    maxSplats: 20,
    _splatBudgetGroup: {maxSplats: 20}
  });
  vi.spyOn(layer, 'getCurrentLayer').mockReturnValue(layer);
  layer.state.runtime.reconcile(new Set([layer.id]));
  // The runtime has every participating demand at this point, so its first globally budgeted
  // allocation must be present immediately. A 10k canopy cannot wait for a per-frame fade to
  // leave its all-coarse coverage floor before nearby crowns gain their selected detail.
  expect(layer.state.refinement.active).toBe(false);
  const level = (id: string) => {
    const owner = layer.state.owners.find(row => row.row.object.id === id)!;
    return layer.state.refinement.entries.get(owner.key)!.dominant;
  };
  const farLevels = data.slice(1).map(row => level(row.id));

  expect(level('near')).toBe(0);
  expect(Math.max(...farLevels)).toBe(1);
  expect(level('near')).toBeLessThan(Math.max(...farLevels));
});

it('fades a broad runtime retarget instead of snapping the rendered canopy', () => {
  const data: PerspectiveRow[] = Array.from({length: 64}, (_, index) => ({
    id: `tree-${index}`,
    position: [(index % 8) * 0.2 - 0.7, Math.floor(index / 8) * 0.2 - 0.7, -10],
    scale: 1
  }));
  const {layer} = makePerspective(data, {maxSplats: 256});
  const refinement = layer.state.refinement;
  const counts = (owner: (typeof layer.state.owners)[number]) =>
    owner.asset.hierarchy.map(level => level.source.positions.length / 3);
  const coarseRows = layer.state.candidates.map(row => ({...row, level: 1, blend: 0}));
  refinement.reconcile(coarseRows, counts, Infinity, owner => owner.key);
  refinement.sample(1);
  layer.state.awaitingInitialAllocation = false;
  vi.spyOn(layer, 'setNeedsRedraw').mockImplementation(() => {});

  (layer as any).applyAllocation(
    layer.state.candidates.map(row => ({...row, level: 0, blend: 0})),
    Infinity
  );

  expect(refinement.active).toBe(true);
  expect([...refinement.entries.values()]).toHaveLength(64);
  expect(
    [...refinement.entries.values()].every(
      entry => entry.weights[1] === 1 && entry.weights[0] === 0 && entry.target[0] === 1
    )
  ).toBe(true);
  refinement.sample(17);
  expect([...refinement.entries.values()].every(entry => entry.weights[0] > 0)).toBe(true);
});

it('uses visible support for requested detail and foveation only for allocation priority', () => {
  const {layer, viewport} = makePerspective([
    {id: 'center', position: [0, 0, -10], scale: 10},
    {id: 'peripheral', position: [3, 0, -10], scale: 10},
    {id: 'corner', position: [8, 8, -7], scale: 5}
  ]);
  const candidate = new Map(
    layer.state.candidates.map(row => [(row.owner.row.object as PerspectiveRow).id, row])
  );
  const center = candidate.get('center')!;
  const peripheral = candidate.get('peripheral')!;
  const corner = candidate.get('corner')!;
  const centerOwner = layer.state.owners.find(owner => owner.row.object.id === 'center')!;
  const peripheralOwner = layer.state.owners.find(owner => owner.row.object.id === 'peripheral')!;
  const cornerOwner = layer.state.owners.find(owner => owner.row.object.id === 'corner')!;
  const rawCenter = getSplatPixelsPerMeter(centerOwner.center, viewport) * centerOwner.scale;
  const rawCorner = getSplatPixelsPerMeter(cornerOwner.center, viewport) * cornerOwner.scale;

  // Both fully visible crowns request the same level even though one is peripheral.
  expect(peripheral.pixels).toBeCloseTo(
    getSplatBoundedPixelsPerMeter(peripheralOwner.center, peripheralOwner.radius, viewport) *
      peripheralOwner.scale
  );
  expect(peripheral.level).toBe(center.level);
  expect(peripheral.focus).toBeLessThan(center.focus!);
  // The corner crown has the larger raw projected scale, but only a sliver reaches the viewport.
  expect(rawCorner).toBeGreaterThan(rawCenter);
  expect(corner.pixels).toBeLessThan(center.pixels);
  expect(corner.focus).toBeLessThan(peripheral.focus!);
  expect(corner.level).toBeGreaterThanOrEqual(center.level);
});

it('uses full requested detail when an owner is centered in any active viewport', () => {
  const secondary = {
    viewProjectionMatrix: new Matrix4()
      .perspective({fovy: Math.PI / 2, aspect: 1, near: 0.1, far: 100})
      .translate([-12, 0, 0]),
    width: 100,
    height: 100,
    distanceScales: {unitsPerMeter: [1, 1, 1]}
  } as unknown as Viewport;
  const {layer, viewport} = makePerspective(
    [{id: 'secondary', position: [12, 0, -10], scale: 10}],
    {},
    primary => [primary, secondary]
  );
  const candidate = layer.state.candidates[0];
  const owner = layer.state.owners[0];
  expect(candidate.pixels).toBeCloseTo(
    Math.max(
      getSplatBoundedPixelsPerMeter(owner.center, owner.radius, viewport) *
        getSplatViewportLodWeight(owner.center, owner.radius, viewport),
      getSplatBoundedPixelsPerMeter(owner.center, owner.radius, secondary) *
        getSplatViewportLodWeight(owner.center, owner.radius, secondary)
    ) * owner.scale
  );
  expect(candidate.focus).toBe(1);
  expect(candidate.level).toBe(0);
});

it('includes translated source centers in prepared camera wind bounds', () => {
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
  expect(layer.renderLayers()).toEqual([]);
});

it('moves selection to the current device runtime even without prop changes', () => {
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
  expect(allocations).toHaveBeenCalledOnce();
  expect(layer.shouldUpdateState({changeFlags: {somethingChanged: false}})).toBe(false);
});

it('refreshes mutated owner attributes on new data without discarding camera-only stability', () => {
  const row = {position: [256, 256, 0] as [number, number, number]};
  const layer = make([row], 0);
  const initial = layer.state.groups[0];
  expect(initial).toHaveLength(1);
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
  row.position[0] += 0.00001;
  update([row], true);
  expect(layer.state.groups[0][0].object).toBe(row);
  expect(layer.state.groups[0][0]).not.toBe(initial[0]);
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
  const resize = vi.fn(() => Object.assign(effect, {targets: [{}, {}, {}]}));
  Object.assign(effect, {
    device: {
      type: 'webgl',
      canvasContext: {getDrawingBufferSize: () => [200, 100], cssToDeviceRatio: () => 2},
      beginRenderPass: () => ({end() {}})
    },
    model: {shaderInputs: {setProps() {}}},
    passes: [{render}, {render}, {render}, {render}],
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

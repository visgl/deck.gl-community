// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {
  COORDINATE_SYSTEM,
  type CoordinateSystem,
  type Viewport,
  OrthographicViewport,
  WebMercatorViewport,
  _GlobeViewport as GlobeViewport
} from '@deck.gl/core';
import {Matrix4} from '@math.gl/core';
import {expect, it, vi} from 'vitest';
import {SplatLayer} from '../../src/splat-layer/splat-layer';
import {SplatRuntime} from '../../src/splat-layer/splat-runtime';
import {SplatEffect} from '../../src/splat-layer/splat-effect';
import {
  getSplatBoundedPixelsPerMeter,
  getSplatCommonUnits,
  getSplatPixelsPerMeter,
  getSplatViewportLodWeight
} from '../../src/splat-layer/splat-culling';
import {SplatPrimitiveLayer} from '../../src/splat-layer/splat-primitive-layer';
import {getSplatChangedRanges} from '../../src/splat-layer/splat-row-diff';
const SOURCE = {
  positions: new Float32Array([0, 0, 0]),
  scales: new Float32Array([1, 1, 1]),
  rotations: new Float32Array([1, 0, 0, 0]),
  colors: new Uint8Array([30, 120, 40, 255]),
  opacities: new Float32Array([0.8])
};
function make(
  data: {position: [number, number, number]}[],
  flex = 1,
  extra = {},
  viewport: Viewport = new WebMercatorViewport({width: 256, height: 256, zoom: 18})
) {
  const layer = new SplatLayer({
    data,
    source: SOURCE,
    deformationStrength: 0.1,
    getDeformation: [10, 0, flex],
    ...extra
  });
  layer.initializeState();
  vi.spyOn(layer, 'setState').mockImplementation(state => Object.assign(layer.state, state));
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

it('applies maxActiveSplats to prepared selection and shared demand', () => {
  const fine = Object.fromEntries(
    Object.entries(SOURCE).map(([key, array]) => [
      key,
      new (array.constructor as typeof Float32Array)([...array, ...array, ...array, ...array])
    ])
  );
  const row = {
    position: [256, 256, 0] as [number, number, number],
    splats: {
      type: 'prepared-splats' as const,
      source: fine,
      hierarchy: [
        {source: fine, error: 0},
        {source: SOURCE, error: 1}
      ]
    }
  };
  const layer = make([row], 0, {
    source: undefined,
    getSource: item => item.splats,
    maxActiveSplats: 8,
    pixelError: 0.001
  });
  const owner = layer.state.owners[0];
  expect(layer.state.refinement.entries.get(owner.key)?.level).toBe(0);
  expect(layer.state.runtime['demands'].get(layer.id)?.maxSplats).toBe(8);

  const oldProps = layer.props;
  Object.assign(layer, {props: layer.clone({maxActiveSplats: 1}).props});
  layer.updateState({
    props: layer.props,
    oldProps,
    changeFlags: {propsChanged: true}
  } as any);

  expect(layer.state.refinement.entries.get(owner.key)?.level).toBe(1);
  expect(layer.state.runtime['demands'].get(layer.id)?.maxSplats).toBe(1);
  expect(layer.renderLayers()[0].props.maxSplats).toBe(1);
});

it('rejects conflicting maxActiveSplats and maxSplats on prepared inputs', () => {
  expect(() => make([{position: [0, 0, 0]}], 0, {maxActiveSplats: 1, maxSplats: 2})).toThrow(
    'maxActiveSplats and maxSplats must agree when both are specified.'
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
])('selects owners in the primary frustum of wrapped world copies: %o', options => {
  const layer = make([{position: [0, 0, 0]}], 0);
  const repeated = new WebMercatorViewport({...options, repeat: true});
  expect(repeated.subViewports!.some(view => view !== repeated)).toBe(true);
  layer.context.viewport = repeated;
  layer.context.deck.getViewports = () => [repeated];
  expect(() =>
    layer.updateState({
      props: layer.props,
      oldProps: layer.props,
      changeFlags: {viewportChanged: true}
    } as any)
  ).not.toThrow();
});

it('draws and composites Gaussians in the primary world copy only', () => {
  const repeated = new WebMercatorViewport({width: 2048, height: 256, zoom: 0, repeat: true});
  const [primary, copy] = [
    repeated.subViewports!.find(view => view === repeated)!,
    repeated.subViewports!.find(view => view !== repeated)!
  ];
  const layer = new SplatPrimitiveLayer({data: [{}], source: SOURCE});
  const model = {shaderInputs: {setProps: vi.fn()}, setInstanceCount: vi.fn(), draw: vi.fn()};
  const resolve = vi.fn();
  Object.assign(layer, {
    state: {model, effect: {resolve}},
    context: {viewport: repeated, timeline: {getTime: () => 0}}
  });
  const draw = (viewport: Viewport, mode: number, isActive = false) =>
    layer.draw({
      shaderModuleProps: {
        project: {viewport},
        picking: {isActive},
        splat: {mode, resolve: true}
      },
      renderPass: {}
    } as any);
  for (const viewport of [primary, copy]) {
    draw(viewport, 1);
    draw(viewport, 0);
    draw(viewport, 0, true);
  }
  // One accumulation draw and one picking draw for the primary copy; a single resolve.
  expect(model.draw).toHaveBeenCalledTimes(2);
  expect(resolve).toHaveBeenCalledTimes(1);
  expect(resolve).toHaveBeenCalledWith({}, repeated.id);
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

it('clears its private opaque depth when an interleaved basemap preserves the host canvas', () => {
  const effect = new SplatEffect();
  const passes = [0, 1, 2, 4].map(() => ({render: vi.fn()}));
  Object.assign(effect, {
    device: {
      type: 'webgl',
      canvasContext: {getDrawingBufferSize: () => [64, 64], cssToDeviceRatio: () => 1},
      beginRenderPass: () => ({end() {}})
    },
    model: {shaderInputs: {setProps() {}}},
    passes,
    resize: () => Object.assign(effect, {targets: [{}, {}, {}, {}]})
  });
  const primitive = {
    constructor: {layerName: 'SplatPrimitiveLayer'},
    props: {visible: true, operation: 'draw', maxRenderPixels: Infinity}
  };
  // MapboxOverlay/MapLibreOverlay interleave deck into the basemap with clearCanvas: false.
  effect.preRender({layers: [primitive], viewports: [{id: 'mapbox'}], clearCanvas: false} as any);
  const opaque = passes[0].render.mock.lastCall![0];
  expect(opaque.pass).toBe('splat-opaque-depth');
  expect(opaque.clearCanvas).toBe(true);
  expect(opaque.clearColor).toEqual([0, 0, 0, 0]);
  // Accumulation targets are cleared by their own passes and must still blend onto them.
  expect(passes[1].render.mock.lastCall![0].clearCanvas).toBe(false);
});

it('keeps the shared runtime grant while camera motion retains quantized demand', () => {
  const data: PerspectiveRow[] = [
    {id: 'near', position: [0, 0, -3], scale: 10},
    ...Array.from({length: 9}, (_, index) => ({
      id: `far-${index}`,
      position: [0, 0, -10] as [number, number, number],
      scale: 10
    }))
  ];
  // TreeLayer canopies leave maxSplats unbounded and spend only the shared group cap.
  const {layer} = makePerspective(data, {
    pixelError: 0.001,
    foveationStrength: 0,
    _splatBudgetGroup: {maxSplats: 20}
  });
  vi.spyOn(layer, 'getCurrentLayer').mockReturnValue(layer);
  vi.spyOn(layer, 'setNeedsRedraw').mockImplementation(() => {});
  const ids = new Set([layer.id]);
  const frame = (now: number) => {
    layer.updateState({
      props: layer.props,
      oldProps: layer.props,
      changeFlags: {viewportChanged: true}
    } as any);
    layer.state.runtime.reconcile(ids);
    layer.state.runtime.sample(ids, now);
  };
  layer.state.runtime.reconcile(ids);
  // The first viewport update observes the granted levels; the next one retains its demand.
  frame(1);
  const granted = new Map(
    [...layer.state.refinement.entries].map(([key, entry]) => [key, [...entry.target]])
  );
  for (let now = 2; now < 400; now += 16) frame(now);
  for (const [key, entry] of layer.state.refinement.entries)
    expect(entry.target).toEqual(granted.get(key));
  expect(layer.splatStats.renderedSplats).toBeLessThanOrEqual(20);
});

const moveCamera = (layer: SplatLayer<PerspectiveRow>, viewport: Viewport, offset: number[]) => {
  const moved = {
    ...viewport,
    viewProjectionMatrix: new Matrix4(viewport.viewProjectionMatrix as number[]).translate(offset)
  } as unknown as Viewport;
  Object.assign(layer.context, {viewport: moved});
  layer.context.deck!.getViewports = () => [moved];
  layer.updateState({
    props: layer.props,
    oldProps: layer.props,
    changeFlags: {viewportChanged: true}
  } as any);
  return moved;
};

it('keeps refinement-level instance slots when owners cross the view edge', () => {
  const data: PerspectiveRow[] = [-14, -10, -6, -2, 2, 6, 10, 14].map((x, index) => ({
    id: `${index}`,
    position: [x, 0, -10],
    scale: 1
  }));
  const {layer, viewport} = makePerspective(data, {pixelError: 1e6});
  const coarse = layer.state.groups.length - 1;
  const ids = (rows: {object: PerspectiveRow}[]) => rows.map(row => row.object.id);
  const before = layer.state.groups[coarse];
  expect(new Set(ids(before))).toEqual(new Set(['1', '2', '3', '4', '5', '6']));

  // Owner 1 leaves the left edge as owner 7 enters on the right.
  moveCamera(layer, viewport, [-4, 0, 0]);
  const after = layer.state.groups[coarse];
  expect(new Set(ids(after))).toEqual(new Set(['2', '3', '4', '5', '6', '7']));
  for (const [slot, row] of before.entries())
    if (row.object.id !== '1') expect(after[slot]).toBe(row);
  const departed = ids(before).indexOf('1');
  expect(after[departed].object.id).toBe('7');
  expect(getSplatChangedRanges(after, before)).toEqual([
    {startRow: departed, endRow: departed + 1}
  ]);
});

it('leaves retained targets to the joint grant when the selection effect drives allocation', () => {
  const data: PerspectiveRow[] = Array.from({length: 6}, (_, index) => ({
    id: `${index}`,
    position: [(index - 2.5) * 0.2, 0, -10],
    scale: 2
  }));
  const {layer, viewport} = makePerspective(data, {foveationStrength: 0});
  vi.spyOn(layer, 'getCurrentLayer').mockReturnValue(layer);
  vi.spyOn(layer, 'setNeedsRedraw').mockImplementation(() => {});
  const ids = new Set([layer.id]);
  layer.state.runtime.reconcile(ids);
  // deck.gl hosts install the selection effect, which grants changed demand before sampling.
  Object.assign(layer.context.deck!, {_addDefaultEffect: vi.fn()});
  const targets = () =>
    new Map([...layer.state.refinement.entries].map(([key, entry]) => [key, entry.level]));
  const granted = targets();

  moveCamera(layer, viewport, [0, 0, 8.5]);
  const requested = new Map(
    layer.state.candidates.map(candidate => [candidate.owner.key, candidate.level])
  );
  expect([...requested].some(([key, level]) => granted.get(key) !== level)).toBe(true);
  expect(targets()).toEqual(granted);
  expect(layer.state.refinement.activeCount).toBe(0);

  layer.state.runtime.reconcile(ids);
  expect(targets()).toEqual(requested);
});

it('reuses cached owner metre scales for a newer camera with the same projection', () => {
  const data = Array.from({length: 5}, (_, index) => ({
    position: [256 + (index - 2) * 0.0001, 256 - (index - 2) * 0.00005, 0] as [
      number,
      number,
      number
    ]
  }));
  const layer = make(data);
  // deck.gl updates a composite with its last drawn viewport while reporting the newer camera.
  const next = new WebMercatorViewport({
    width: 256,
    height: 256,
    zoom: 18.4,
    pitch: 40,
    bearing: 15
  });
  layer.context.deck!.getViewports = () => [next];
  // Viewports are frozen; observe the per-owner geographic scale lookups on the prototype.
  const scales = vi.spyOn(WebMercatorViewport.prototype, 'getDistanceScales');
  layer.updateState({
    props: layer.props,
    oldProps: layer.props,
    changeFlags: {viewportChanged: true}
  } as any);
  expect(scales).not.toHaveBeenCalled();
  scales.mockRestore();
  expect(layer.state.candidates.length).toBeGreaterThan(0);
  for (const owner of layer.state.owners)
    getSplatCommonUnits(owner.center, next).forEach((value, axis) =>
      expect(owner.units[axis]).toBeCloseTo(value, 12)
    );
});

it('rewrites only the coverage of slots whose optical weight changed', () => {
  const data: PerspectiveRow[] = Array.from({length: 4}, (_, index) => ({
    id: `${index}`,
    position: [(index - 1.5) * 0.5, 0, -10],
    scale: 1
  }));
  const {layer} = makePerspective(data, {pixelError: 1e6});
  const coarse = layer.state.groups.length - 1;
  const render = () => layer.renderLayers().find(child => child.id.endsWith(`-${coarse}`))!;
  const first = render();
  expect(first.props._coverageRanges).toEqual([{startRow: 0, endRow: 4}]);
  expect(render().props._coverageRanges).toBe(first.props._coverageRanges);

  const rows = [...layer.state.groups[coarse]];
  rows[2] = {...rows[2], weight: 0.5};
  layer.state.groups[coarse] = rows;
  const faded = render();
  // Membership is unchanged; only slot 2's coverage is invalidated, not every row's.
  expect(faded.props.data).toBe(first.props.data);
  expect(faded.props._coverageRanges).toEqual([{startRow: 2, endRow: 3}]);
  expect(faded.props.updateTriggers.getCoverageWeight).not.toContain(rows);
  expect(faded.props.getCoverageWeight(rows[2], {index: 2})).toBe(0.5);
});

it('maps a controlled highlightedObjectIndex onto each refinement level', () => {
  const data: PerspectiveRow[] = [
    {id: 'near', position: [0, 0, -3], scale: 10},
    ...Array.from({length: 5}, (_, index) => ({
      id: `far-${index}`,
      position: [(index - 2) * 0.5, 0, -10] as [number, number, number],
      scale: 1
    }))
  ];
  for (const highlighted of [0, 3]) {
    const {layer} = makePerspective(data, {highlightedObjectIndex: highlighted});
    const children = layer.renderLayers();
    expect(children.length).toBeGreaterThan(1);
    let found = 0;
    for (const child of children) {
      const row = child.props.highlightedObjectIndex;
      const rows = child.props.data as {index: number}[];
      if (row >= 0) {
        expect(rows[row].index).toBe(highlighted);
        found++;
      } else expect(rows.every(entry => entry.index !== highlighted)).toBe(true);
    }
    expect(found).toBeGreaterThan(0);
  }
  const {layer} = makePerspective(data);
  for (const child of layer.renderLayers()) expect(child.props.highlightedObjectIndex).toBeNull();
});

it('casts deck.gl shadows from every refinement level unless shadowEnabled is false', () => {
  const data: PerspectiveRow[] = [
    {id: 'near', position: [0, 0, -3], scale: 10},
    {id: 'far', position: [0.5, 0, -10], scale: 1}
  ];
  for (const [extra, expected] of [
    [{}, true],
    [{shadowEnabled: false}, false]
  ] as const) {
    const {layer} = makePerspective(data, extra);
    const children = layer.renderLayers();
    expect(children.length).toBeGreaterThan(0);
    for (const child of children) expect(child.props.shadowEnabled).toBe(expected);
  }
});

it('invalidates coverage only for the supplied changed rows', () => {
  const invalidate = vi.fn();
  const layer = Object.assign(Object.create(SplatPrimitiveLayer.prototype), {
    internalState: {hasPickingBuffer: false},
    state: {windRows: new WeakMap()},
    getAttributeManager: () => ({invalidate, invalidateAll: vi.fn()})
  });
  const base = {extensions: [], pickable: false, source: SOURCE, _coverageRanges: null};
  const ranges = [
    {startRow: 2, endRow: 3},
    {startRow: 9, endRow: 12}
  ];
  layer.updateState({props: {...base, _coverageRanges: ranges}, oldProps: base, changeFlags: {}});
  expect(invalidate.mock.calls).toEqual(ranges.map(range => ['getCoverageWeight', range]));
  invalidate.mockClear();
  layer.updateState({
    props: {...base, _coverageRanges: ranges},
    oldProps: {...base, _coverageRanges: ranges},
    changeFlags: {}
  });
  expect(invalidate).not.toHaveBeenCalled();
});

it('replaces scene owner rows with a direct prepared asset without retaining scene sources', () => {
  const row = {position: [256, 256, 0] as [number, number, number], splats: '/scene.rad'};
  const layer = make(
    [row],
    0,
    {source: undefined},
    new OrthographicViewport({width: 256, height: 256, target: [256, 256, 0]})
  );
  expect(layer.state.scene).toBe(true);
  const oldProps = layer.props;
  Object.assign(layer, {props: layer.clone({data: SOURCE}).props});
  layer.updateState({props: layer.props, oldProps, changeFlags: {dataChanged: true}} as any);
  expect(layer.state.scene).toBe(false);
  expect(layer.state.rowSources).toBeNull();
  expect(layer.state.input.assets[0].source).toBe(SOURCE);
});

it('keeps sibling prepared grants cached after a layer enters scene mode', () => {
  const layer = make([{position: [256, 256, 0]}], 0);
  const runtime = layer.state.runtime;
  const apply = vi.fn();
  runtime.set('prepared-sibling', {
    rows: [{owner: {}, pixels: 1, level: 0, blend: 0}],
    hierarchy: () => layer.state.hierarchy,
    maxSplats: Infinity,
    maxTotalSplats: Infinity,
    apply
  });
  runtime.reconcile(new Set([layer.id, 'prepared-sibling']));
  const oldProps = layer.props;
  Object.assign(layer.context, {viewport: new OrthographicViewport({width: 256, height: 256})});
  layer.context.deck.getViewports = () => [layer.context.viewport];
  Object.assign(layer, {props: layer.clone({data: '/scene.rad', source: undefined}).props});
  layer.updateState({props: layer.props, oldProps, changeFlags: {dataChanged: true}} as any);
  runtime.reconcile(new Set(['prepared-sibling']));
  const grants = apply.mock.calls.length;
  expect(grants).toBeGreaterThan(0);
  for (const changeFlags of [{viewportChanged: true}, {propsChanged: true}]) {
    layer.updateState({props: layer.props, oldProps: layer.props, changeFlags} as any);
    runtime.reconcile(new Set(['prepared-sibling']));
    expect(apply).toHaveBeenCalledTimes(grants);
  }
});

it('keeps sorted prepared rows on the prepared backend when blending mode changes', () => {
  const layer = make(
    [{position: [256, 256, 0]}],
    0,
    {
      source: undefined,
      getSource: SOURCE,
      transparency: 'sorted'
    },
    new OrthographicViewport({width: 256, height: 256, target: [256, 256, 0]})
  );
  expect(layer.state.scene).toBe(false);
  expect(layer.state.runtime).toBeDefined();
  const oldProps = layer.props;
  Object.assign(layer, {props: layer.clone({transparency: 'weighted'}).props});
  layer.updateState({props: layer.props, oldProps, changeFlags: {propsChanged: true}} as any);
  expect(layer.state.scene).toBe(false);
  expect(layer.splatStats.renderedSplats).toBe(1);
  expect(layer.renderLayers().some(child => child.id.includes('refinement'))).toBe(true);
});

it('routes sorted Cartesian prepared owner rows through the shared scene renderer', () => {
  const layer = make(
    [{position: [0, 0, 0]}],
    0,
    {
      source: undefined,
      getSource: SOURCE,
      transparency: 'sorted',
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN
    },
    new OrthographicViewport({width: 256, height: 256})
  );
  expect(layer.state.scene).toBe(true);
  expect(layer.renderLayers().some(child => child.id.endsWith('-scene'))).toBe(true);

  const directAssetLayer = make(
    SOURCE as never,
    0,
    {
      source: undefined,
      transparency: 'sorted',
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN
    },
    new OrthographicViewport({width: 256, height: 256})
  );
  expect(directAssetLayer.state.scene).toBe(false);
  expect(directAssetLayer.renderLayers().some(child => child.id.includes('refinement'))).toBe(true);

  const opticalDepthLayer = make(
    [{position: [0, 0, 0]}],
    0,
    {
      source: undefined,
      getSource: {...SOURCE, opticalDepths: new Float32Array([1])},
      transparency: 'sorted',
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN
    },
    new OrthographicViewport({width: 256, height: 256})
  );
  expect(opticalDepthLayer.state.scene).toBe(false);
});

it.each([
  'auto',
  'sorted',
  'weighted'
] as const)('rejects conflicting source inputs before routing %s rendering or calling accessors', transparency => {
  const getSource = vi.fn(() => SOURCE);
  expect(() => make([{position: [0, 0, 0]}], 0, {transparency, getSource})).toThrow(
    'SplatLayer source cannot be combined with direct asset data or an explicit getSource.'
  );
  expect(getSource).not.toHaveBeenCalled();
  expect(() => make(SOURCE as never, 0, {transparency, source: undefined, getSource})).toThrow(
    'SplatLayer getSource applies to instance rows, not direct asset data.'
  );
  expect(getSource).not.toHaveBeenCalled();
});

it.each([
  'weighted',
  'sorted'
] as const)('retains %s accessor assets until data or getSource triggers change', transparency => {
  const first = vi.fn(() => SOURCE);
  const layer = make(
    [{position: [0, 0, 0]}],
    0,
    {
      source: undefined,
      getSource: first,
      transparency
    },
    new OrthographicViewport({width: 256, height: 256})
  );
  expect(layer.state.scene).toBe(false);
  const cached = layer.state.rowSources;
  const secondSource = {...SOURCE};
  const replacement = vi.fn(() => secondSource);
  const oldProps = layer.props;
  Object.assign(layer, {props: layer.clone({getSource: replacement, opacity: 0.5}).props});
  layer.updateState({
    props: layer.props,
    oldProps,
    changeFlags: {propsChanged: true, viewportChanged: true}
  } as any);
  expect(replacement).not.toHaveBeenCalled();
  expect(layer.state.rowSources).toBe(cached);
  layer.updateState({
    props: layer.props,
    oldProps: layer.props,
    changeFlags: {updateTriggersChanged: {getSource: true}}
  } as any);
  expect(replacement).toHaveBeenCalledOnce();
  expect(layer.state.rowSources).toEqual([secondSource]);
  if (transparency === 'weighted') expect(layer.state.input.assets[0].source).toBe(secondSource);
  const previous = layer.props;
  Object.assign(layer, {props: layer.clone({getSource: SOURCE}).props});
  layer.updateState({
    props: layer.props,
    oldProps: previous,
    changeFlags: {propsChanged: true}
  } as any);
  expect(layer.state.rowSources).toEqual([SOURCE]);
  const constant = layer.props;
  Object.assign(layer, {props: layer.clone({getSource: replacement}).props});
  layer.updateState({
    props: layer.props,
    oldProps: constant,
    changeFlags: {propsChanged: true}
  } as any);
  expect(replacement).toHaveBeenCalledTimes(2);
  expect(layer.state.rowSources).toEqual([secondSource]);
  if (transparency === 'weighted') expect(layer.state.input.assets[0].source).toBe(secondSource);
});

it('retires scene children for unsupported coordinate systems and recovers on valid props', () => {
  const row = {position: [0, 0, 0] as [number, number, number]};
  const layer = make(
    [row],
    0,
    {source: undefined, getSource: () => '/scene.rad', transparency: 'sorted'},
    new OrthographicViewport({width: 256, height: 256})
  );
  const raise = vi.spyOn(layer, 'raiseError').mockImplementation(() => {});
  const update = (coordinateSystem: CoordinateSystem) => {
    const oldProps = layer.props;
    Object.assign(layer, {props: layer.clone({coordinateSystem}).props});
    layer.updateState({props: layer.props, oldProps, changeFlags: {propsChanged: true}} as any);
  };
  update(COORDINATE_SYSTEM.LNGLAT);
  expect(layer.state.sceneProjectionError).toContain('Cartesian');
  expect(layer.renderLayers()).toEqual([]);
  update(COORDINATE_SYSTEM.LNGLAT);
  expect(raise).toHaveBeenCalledOnce();
  update(COORDINATE_SYSTEM.CARTESIAN);
  expect(layer.state.sceneProjectionError).toBeNull();
  expect(layer.renderLayers()).toHaveLength(1);
});

it.each([
  'globe',
  'repeat'
] as const)('routes sorted scenes before unrelated %s prepared checks', type => {
  const layer = make(
    [{position: [0, 0, 0]}],
    0,
    {source: undefined, getSource: () => '/scene.rad', transparency: 'sorted'},
    new OrthographicViewport({width: 256, height: 256})
  );
  const unrelated =
    type === 'globe'
      ? new GlobeViewport({width: 256, height: 256, longitude: 0, latitude: 0, zoom: 2})
      : new WebMercatorViewport({width: 2048, height: 256, zoom: 0, longitude: 0, repeat: true});
  layer.context.deck.getViewports = () => [layer.context.viewport, unrelated];
  expect(() =>
    layer.updateState({
      props: layer.props,
      oldProps: layer.props,
      changeFlags: {viewportChanged: true}
    } as any)
  ).not.toThrow();
  expect(layer.renderLayers()).toHaveLength(1);
});

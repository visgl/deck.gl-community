// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {
  COORDINATE_SYSTEM,
  FirstPersonViewport,
  OrbitViewport,
  OrthographicViewport,
  WebMercatorViewport,
  type Deck,
  type PreRenderOptions
} from '@deck.gl/core';
import {Matrix4} from '@math.gl/core';
import {NullDevice} from '@luma.gl/test-utils';
import {expect, it, vi} from 'vitest';
import {SplatSceneLayer} from '../../../src/splat-layer/scene/splat-scene-layer';
import {SplatSceneRuntime} from '../../../src/splat-layer/scene/splat-scene-runtime';

it('publishes loading and error statuses to shared static source users', async () => {
  const device = new NullDevice({});
  const runtime = new SplatSceneRuntime({} as Deck, device);
  const worker = {postMessage: vi.fn(), terminate: vi.fn(), onmessage: undefined as any};
  const onStatusChange = vi.fn();
  const layer = new SplatSceneLayer({
    id: 'broken',
    data: '/broken.splat',
    workerFactory: () => worker as never,
    onStatusChange
  });
  runtime.register(layer);
  const raise = vi.spyOn(layer, 'raiseError').mockImplementation(() => {});
  runtime['acquireAsset']('/broken.splat', layer, 10, 10, 2);
  expect(onStatusChange).toHaveBeenCalledWith(
    expect.objectContaining({phase: 'loading', pendingPages: 1})
  );
  const secondStatus = vi.fn();
  const second = new SplatSceneLayer({
    id: 'second',
    data: '/broken.splat',
    onStatusChange: secondStatus
  });
  vi.spyOn(second, 'raiseError').mockImplementation(() => {});
  runtime.register(second);
  expect(secondStatus).toHaveBeenCalledWith(expect.objectContaining({phase: 'loading'}));
  worker.onmessage({data: {error: 'Malformed source'}});
  await vi.waitFor(() =>
    expect(onStatusChange).toHaveBeenCalledWith(
      expect.objectContaining({phase: 'error', pendingPages: 0, message: 'Malformed source'})
    )
  );
  expect(raise).toHaveBeenCalled();
  expect(secondStatus.mock.calls.map(([status]) => status.phase)).toEqual(['loading', 'error']);
  runtime.cleanup();
  device.destroy();
});

it('cleans up only the exact layer when layer ids contain separators', () => {
  const device = new NullDevice({});
  const runtime = new SplatSceneRuntime({redraw: vi.fn()} as unknown as Deck, device);
  const source = {
    positions: new Float32Array([0, 0, 0]),
    scales: new Float32Array([1, 1, 1]),
    rotations: new Float32Array([1, 0, 0, 0]),
    colors: new Uint8Array([255, 255, 255, 255]),
    opacities: new Float32Array([1])
  };
  const short = new SplatSceneLayer({id: 'tree', data: source});
  const nested = new SplatSceneLayer({id: 'canopy/tree', data: source});
  const shortKey = JSON.stringify(['view', 'tree']);
  const nestedKey = JSON.stringify(['view', 'canopy/tree']);
  const shortPicker = {destroy: vi.fn()};
  const nestedPicker = {destroy: vi.fn()};
  try {
    runtime.register(short);
    runtime.register(nested);
    runtime['pickingEntries'].set(shortKey, [{}] as never);
    runtime['pickingEntries'].set(nestedKey, [{}] as never);
    runtime.register(new SplatSceneLayer({id: 'tree', data: source}));
    expect([...runtime['pickingEntries'].keys()]).toEqual([nestedKey]);

    runtime['pickingEntries'].set(shortKey, [{}] as never);
    runtime['pickers'].set(shortKey, shortPicker as never);
    runtime['pickers'].set(nestedKey, nestedPicker as never);
    runtime['projectionErrors'].set(shortKey, 'old');
    runtime['projectionErrors'].set(nestedKey, 'nested');
    runtime.unregister('tree');

    expect([...runtime['pickingEntries'].keys()]).toEqual([nestedKey]);
    expect([...runtime['pickers'].keys()]).toEqual([nestedKey]);
    expect([...runtime['projectionErrors'].entries()]).toEqual([[nestedKey, 'nested']]);
    expect(shortPicker.destroy).toHaveBeenCalledOnce();
    expect(nestedPicker.destroy).not.toHaveBeenCalled();
  } finally {
    runtime.cleanup();
    device.destroy();
  }
});

it('reuses RAD scene residency when callers recreate equivalent descriptors', () => {
  const device = new NullDevice({});
  const runtime = new SplatSceneRuntime({redraw: vi.fn()} as unknown as Deck, device);
  const workers: {postMessage: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn>}[] =
    [];
  const workerFactory = () => {
    const worker = {postMessage: vi.fn(), terminate: vi.fn(), onmessage: undefined as any};
    workers.push(worker);
    return worker as never;
  };
  const original = {type: 'rad' as const, url: '/capture.rad'};
  const first = new SplatSceneLayer({id: 'scene', data: original, workerFactory});
  runtime.register(first);
  const asset = runtime['acquireAsset'](original, first, 100, 200, 2);
  const destroyScene = vi.spyOn(asset.scene!, 'destroy');
  const replacement = {type: 'rad' as const, url: '/capture.rad'};
  const second = first.clone({data: replacement});
  runtime.register(second);

  try {
    expect(runtime['acquireAsset'](replacement, second, 100, 200, 2)).toBe(asset);
    expect(destroyScene).not.toHaveBeenCalled();
    expect(workers).toHaveLength(1);
    expect(workers[0].terminate).not.toHaveBeenCalled();
  } finally {
    runtime.cleanup();
    device.destroy();
  }
});

it.each([
  1, 2
])('reserves decoded static coverage before granting detail to %i RAD assets', radCount => {
  const device = new NullDevice({});
  const runtime = new SplatSceneRuntime({} as Deck, device);
  const staticAsset = {type: 'splats' as const, url: '/capture.splat', format: 'splat' as const};
  const radAssets = Array.from({length: radCount}, (_, index) => `/capture-${index}.rad`);
  const layer = new SplatSceneLayer({
    id: 'mixed',
    data: [staticAsset, ...radAssets].map(splats => ({splats, position: [0, 0, 0]})),
    coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
    maxSplats: 1_000_000,
    maxTotalSplats: 1_000_000
  });
  runtime.register(layer);
  const decoded = {
    id: 1,
    data: {length: 800_000, destroy: vi.fn()},
    users: new Set(['mixed']),
    budgetKey: ''
  };
  runtime['assets'].set(runtime['getAssetKey'](staticAsset), decoded as never);
  const stopped = new Error('grant captured before GPU preparation');
  const acquire = vi
    .spyOn(runtime as any, 'acquireAsset')
    .mockImplementation((input, _layer, active) => {
      if (input === staticAsset) return decoded;
      expect(active).toBe((1_000_000 - 800_000) / radCount);
      throw stopped;
    });
  expect(() =>
    runtime.preRender({
      layers: [layer],
      viewports: [new FirstPersonViewport({width: 128, height: 128})],
      isPicking: false
    } as PreRenderOptions)
  ).toThrow(stopped);
  expect(acquire).toHaveBeenCalledTimes(2);
  runtime.cleanup();
  device.destroy();
});

it('budgets and limits equivalent RAD descriptors as one shared source', () => {
  const device = new NullDevice({});
  const runtime = new SplatSceneRuntime({} as Deck, device);
  const viewport = new FirstPersonViewport({id: 'view', width: 128, height: 128});
  const renderer = {
    setProps: vi.fn(),
    setFrontier: vi.fn(),
    prepare: vi.fn(),
    destroy: vi.fn(),
    draw: vi.fn()
  };
  runtime['domains'].set(JSON.stringify([viewport.id, 'default']), {
    renderer,
    leader: '',
    layers: new Set<string>(),
    owners: [],
    pages: []
  } as never);
  // Each row recreates an equivalent descriptor, within one layer and across two layers.
  const capture = () => ({type: 'rad' as const, url: '/capture.rad'});
  const layers = [
    new SplatSceneLayer({
      id: 'a',
      data: [capture(), capture()].map(splats => ({splats, position: [0, 0, 0]})),
      maxSplats: 1_000_000,
      maxConcurrentLoads: 8
    }),
    new SplatSceneLayer({
      id: 'b',
      data: [{splats: capture(), position: [0, 0, 0]}],
      maxSplats: 1_000_000,
      maxConcurrentLoads: 2
    })
  ];
  for (const layer of layers) {
    vi.spyOn(layer, 'getOwnerMatrix').mockReturnValue(new Matrix4());
    runtime.register(layer);
  }
  const acquire = vi.spyOn(runtime as any, 'acquireAsset').mockReturnValue({id: 0});
  try {
    runtime.preRender({layers, viewports: [viewport], isPicking: false} as PreRenderOptions);
    expect(acquire).toHaveBeenCalledTimes(3);
    for (const [, , active, resident, concurrency] of acquire.mock.calls) {
      // One source receives the whole per-layer grant and resident cap, not a share per descriptor.
      expect(active).toBe(1_000_000);
      expect(resident).toBe(8_000_000);
      // Every owner applies the strictest download limit, so no layer overwrites another.
      expect(concurrency).toBe(2);
    }
    expect(runtime.getStats('a').sourceCount).toBe(1);
  } finally {
    runtime.cleanup();
    device.destroy();
  }
});

it('classifies unmarked Blob assets as RAD for budgets and projection checks', () => {
  const device = new NullDevice({});
  const runtime = new SplatSceneRuntime({} as Deck, device);
  const blob = new Blob(['rad'], {type: 'application/octet-stream'});
  const layer = new SplatSceneLayer({id: 'blob', data: blob});
  try {
    runtime.register(layer);
    expect(runtime['radLayers'].has('blob')).toBe(true);
    expect(runtime['getAssetKey'](blob)).toBe(runtime['getAssetKey']({type: 'rad', url: blob}));
    expect(runtime['getAssetKey'](blob)).not.toBe(
      runtime['getAssetKey']({type: 'splats', url: blob})
    );
  } finally {
    runtime.cleanup();
    device.destroy();
  }
});

it('keeps a covered RAD asset loaded while camera refinement continues', () => {
  const device = new NullDevice({});
  const runtime = new SplatSceneRuntime({} as Deck, device);
  const layer = new SplatSceneLayer({id: 'rad', data: '/capture.rad'});
  runtime.register(layer);
  runtime['assets'].set(runtime['getAssetKey']('/capture.rad'), {
    id: 1,
    scene: {frontier: [{id: 'rad:0'}], destroy: vi.fn()},
    status: {phase: 'refining'},
    users: new Set(['rad']),
    budgetKey: ''
  } as never);
  expect(runtime.isLoaded('rad')).toBe(true);
  runtime.cleanup();
  device.destroy();
});

it('shares a nested parent allowance across two independent RAD scene layers', () => {
  const device = new NullDevice({});
  const runtime = new SplatSceneRuntime({} as Deck, device);
  const parent = {maxSplats: 1_000_000};
  const layers = ['a', 'b'].map(
    id =>
      new SplatSceneLayer({
        id,
        data: `/${id}.rad`,
        maxSplats: 1_000_000,
        maxTotalSplats: Infinity,
        _splatBudgetGroup: {maxSplats: 2_000_000, parent}
      })
  );
  layers.forEach(layer => runtime.register(layer));
  const stopped = new Error('grant captured before GPU preparation');
  vi.spyOn(runtime as any, 'acquireAsset').mockImplementation((_input, _layer, active) => {
    expect(active).toBe(500_000);
    throw stopped;
  });
  expect(() =>
    runtime.preRender({
      layers,
      viewports: [new FirstPersonViewport({width: 128, height: 128})],
      isPicking: false
    } as PreRenderOptions)
  ).toThrow(stopped);
  runtime.cleanup();
  device.destroy();
});

it('honors an explicit RAD detail allowance above the fallback estimate', () => {
  const device = new NullDevice({});
  const runtime = new SplatSceneRuntime({} as Deck, device);
  const layer = new SplatSceneLayer({
    id: 'rad',
    data: '/capture.rad',
    maxSplats: 3_000_000,
    maxTotalSplats: Infinity
  });
  runtime.register(layer);
  const stopped = new Error('grant captured before GPU preparation');
  vi.spyOn(runtime as any, 'acquireAsset').mockImplementation((_input, _layer, active) => {
    expect(active).toBe(3_000_000);
    throw stopped;
  });
  expect(() =>
    runtime.preRender({
      layers: [layer],
      viewports: [new FirstPersonViewport({width: 128, height: 128})],
      isPicking: false
    } as PreRenderOptions)
  ).toThrow(stopped);
  runtime.cleanup();
  device.destroy();
});

it.each([
  'direct',
  'descriptor',
  'row',
  'legacy'
] as const)('rejects %s optical-density sources before sorted registration or GPU allocation', channel => {
  const device = new NullDevice({});
  const runtime = new SplatSceneRuntime({} as Deck, device);
  const source = {
    positions: new Float32Array([0, 0, 0]),
    scales: new Float32Array([1, 1, 1]),
    rotations: new Float32Array([1, 0, 0, 0]),
    colors: new Uint8Array([255, 255, 255, 255]),
    opacities: new Float32Array([0]),
    opticalDepths: new Float32Array([2])
  };
  const descriptor = {type: 'prepared-splats' as const, source};
  const props =
    channel === 'direct'
      ? {data: source}
      : channel === 'descriptor'
        ? {data: descriptor}
        : channel === 'row'
          ? {data: [{splats: descriptor, position: [0, 0, 0]}]}
          : {data: [{position: [0, 0, 0]}], source};
  try {
    expect(() => runtime.register(new SplatSceneLayer({id: channel, ...props}))).toThrow(
      'Use weighted transparency'
    );
    expect(runtime['layers'].size).toBe(0);
    expect(runtime['assets'].size).toBe(0);
  } finally {
    runtime.cleanup();
    device.destroy();
  }
});

it.each([
  'viewport',
  'hidden',
  'filtered',
  'unpickable'
] as const)('releases abandoned picking resources after %s changes without discarding active views', change => {
  const device = new NullDevice({});
  const runtime = new SplatSceneRuntime({} as Deck, device);
  const source = {
    positions: new Float32Array([0, 0, 0]),
    scales: new Float32Array([1, 1, 1]),
    rotations: new Float32Array([1, 0, 0, 0]),
    colors: new Uint8Array([255, 255, 255, 255]),
    opacities: new Float32Array([0.8])
  };
  const layer = new SplatSceneLayer({id: 'picker', data: source, pickable: true});
  vi.spyOn(layer, 'getOwnerMatrix').mockReturnValue(new Matrix4());
  runtime.register(layer);
  vi.spyOn(runtime as any, 'acquireAsset').mockReturnValue({id: 0});
  const picker = {destroy: vi.fn()};
  runtime['pickers'].set(JSON.stringify(['active', 'picker']), picker as never);
  const viewport = new OrthographicViewport({id: 'active', width: 128, height: 128});
  const options = {
    layers: [layer],
    viewports: [viewport],
    isPicking: false,
    layerFilter: ({isPicking}) => isPicking
  } as PreRenderOptions;
  try {
    runtime.preRender(options);
    expect(picker.destroy).not.toHaveBeenCalled();
    if (change === 'viewport') options.viewports = [];
    else if (change === 'filtered') {
      options.layerFilter = () => false;
      options.isPicking = true;
      options.pass = 'picking:query';
    } else {
      const replacement = layer.clone(change === 'hidden' ? {visible: false} : {pickable: false});
      vi.spyOn(replacement, 'getOwnerMatrix').mockReturnValue(new Matrix4());
      runtime.register(replacement);
      options.layers = [replacement];
    }
    runtime.preRender(options);
    expect(picker.destroy).toHaveBeenCalledOnce();
    expect(runtime['pickers'].size).toBe(0);
  } finally {
    runtime.cleanup();
    device.destroy();
  }
});

it.each([
  'root-id',
  'viewport'
])('selects drawable leaders and applies %s and ancestor filters per viewport and pass', filter => {
  const device = new NullDevice({});
  const runtime = new SplatSceneRuntime({} as Deck, device);
  const source = {
    positions: new Float32Array([0, 0, 0]),
    scales: new Float32Array([1, 1, 1]),
    rotations: new Float32Array([1, 0, 0, 0]),
    colors: new Uint8Array([255, 255, 255, 255]),
    opacities: new Float32Array([0.8])
  };
  const root = {
    id: 'public-root',
    props: {visible: true},
    parent: null,
    filterSubLayer: vi.fn(({layer}) => layer.id !== 'blocked')
  };
  const layers = ['mask', 'blocked', 'draw'].map(id => {
    const layer = new SplatSceneLayer({
      id,
      data: source,
      operation: id === 'mask' ? 'mask' : 'draw',
      pickable: id !== 'mask'
    });
    Object.assign(layer, {parent: root});
    vi.spyOn(layer, 'getOwnerMatrix').mockReturnValue(new Matrix4());
    runtime.register(layer);
    return layer;
  });
  vi.spyOn(runtime as any, 'acquireAsset').mockReturnValue({id: 0});
  const renderer = {
    setProps: vi.fn(),
    setFrontier: vi.fn(),
    prepare: vi.fn(),
    destroy: vi.fn(),
    draw: vi.fn()
  };
  runtime['domains'].set(JSON.stringify(['allowed', 'default']), {
    renderer,
    leader: '',
    layers: new Set(),
    owners: [],
    pages: []
  } as never);
  const layerFilter = vi.fn(
    ({layer, viewport}) =>
      (filter !== 'root-id' || layer.id === root.id) && viewport.id === 'allowed'
  );
  try {
    runtime.preRender({
      layers,
      viewports: ['allowed', 'denied'].map(
        id => new OrthographicViewport({id, width: 128, height: 128})
      ),
      isPicking: false,
      layerFilter
    } as PreRenderOptions);
    expect(runtime['domains'].get(JSON.stringify(['allowed', 'default']))?.leader).toBe('draw');
    expect(runtime['domains'].get(JSON.stringify(['allowed', 'default']))?.layers).toEqual(
      new Set(['draw'])
    );
    expect(runtime['domains'].has(JSON.stringify(['denied', 'default']))).toBe(false);
    for (const key of runtime['pickingEntries'].keys())
      runtime['pickers'].set(key, {
        setProps: vi.fn(),
        setFrontier: vi.fn(),
        prepare: vi.fn(),
        destroy: vi.fn()
      } as never);
    runtime.preRender({
      layers,
      viewports: ['allowed', 'denied'].map(
        id => new OrthographicViewport({id, width: 128, height: 128})
      ),
      isPicking: true,
      pass: 'picking:query',
      layerFilter
    } as PreRenderOptions);
    expect([...runtime['pickers'].keys()]).toEqual([JSON.stringify(['allowed', 'draw'])]);
    expect(layerFilter).toHaveBeenCalledTimes(4);
    expect(layerFilter.mock.calls.every(([context]) => context.layer === root)).toBe(true);
    root.props.visible = false;
    runtime.preRender({
      layers,
      viewports: [new OrthographicViewport({id: 'allowed', width: 128, height: 128})],
      isPicking: false,
      layerFilter
    } as PreRenderOptions);
    expect(runtime['domains'].size).toBe(0);
    expect(runtime['pickingEntries'].size).toBe(0);
  } finally {
    runtime.cleanup();
    device.destroy();
  }
});

it('keeps viewport and sort-domain tuples distinct when ids contain separators', () => {
  const device = new NullDevice({});
  const runtime = new SplatSceneRuntime({} as Deck, device);
  const source = {
    positions: new Float32Array([0, 0, 0]),
    scales: new Float32Array([1, 1, 1]),
    rotations: new Float32Array([1, 0, 0, 0]),
    colors: new Uint8Array([255, 255, 255, 255]),
    opacities: new Float32Array([0.8])
  };
  const first = new SplatSceneLayer({id: 'first', data: source, sortDomain: 'main'});
  const second = new SplatSceneLayer({id: 'second', data: source, sortDomain: 'detail:main'});
  const firstViewport = new OrthographicViewport({id: 'left:detail', width: 128, height: 128});
  const secondViewport = new OrthographicViewport({id: 'left', width: 128, height: 128});
  const firstKey = JSON.stringify([firstViewport.id, first.props.sortDomain]);
  const secondKey = JSON.stringify([secondViewport.id, second.props.sortDomain]);
  const makeDomain = () => {
    const renderer = {
      setProps: vi.fn(),
      setFrontier: vi.fn(),
      prepare: vi.fn(),
      destroy: vi.fn(),
      draw: vi.fn()
    };
    return {
      renderer,
      leader: '',
      layers: new Set<string>(),
      owners: [],
      pages: []
    };
  };
  const firstDomain = makeDomain();
  const secondDomain = makeDomain();
  runtime['domains'].set(firstKey, firstDomain as never);
  runtime['domains'].set(secondKey, secondDomain as never);
  for (const layer of [first, second]) {
    vi.spyOn(layer, 'getOwnerMatrix').mockReturnValue(new Matrix4());
    runtime.register(layer);
  }
  vi.spyOn(runtime as any, 'acquireAsset').mockReturnValue({id: 0});
  try {
    runtime.preRender({
      layers: [first, second],
      viewports: [firstViewport, secondViewport],
      isPicking: false,
      layerFilter: ({layer, viewport}) =>
        (viewport.id === firstViewport.id && layer.id === first.id) ||
        (viewport.id === secondViewport.id && layer.id === second.id)
    } as PreRenderOptions);

    expect([...runtime['domains'].keys()]).toEqual([firstKey, secondKey]);
    expect(firstDomain.layers).toEqual(new Set(['first']));
    expect(secondDomain.layers).toEqual(new Set(['second']));
    runtime.draw(first, {} as never, firstViewport);
    runtime.draw(second, {} as never, secondViewport);
    expect(firstDomain.renderer.draw).toHaveBeenCalledOnce();
    expect(secondDomain.renderer.draw).toHaveBeenCalledOnce();
  } finally {
    runtime.cleanup();
    device.destroy();
  }
});

it('stages query-only picking and forwards the actual pass and cull rectangle', () => {
  const device = new NullDevice({});
  const runtime = new SplatSceneRuntime({} as Deck, device);
  const source = {
    positions: new Float32Array([0, 0, 0]),
    scales: new Float32Array([1, 1, 1]),
    rotations: new Float32Array([1, 0, 0, 0]),
    colors: new Uint8Array([255, 255, 255, 255]),
    opacities: new Float32Array([0.8])
  };
  const layer = new SplatSceneLayer({id: 'query', data: source, pickable: true});
  vi.spyOn(layer, 'getOwnerMatrix').mockReturnValue(new Matrix4());
  runtime.register(layer);
  vi.spyOn(runtime as any, 'acquireAsset').mockReturnValue({id: 0});
  const viewport = new OrthographicViewport({id: 'view', width: 128, height: 128});
  const rect = {x: 60, y: 60, width: 8, height: 8};
  const filter = vi.fn(
    ({isPicking, renderPass, cullRect}) =>
      isPicking && renderPass === 'picking:query' && cullRect === rect
  );
  const picker = {setProps: vi.fn(), setFrontier: vi.fn(), prepare: vi.fn(), destroy: vi.fn()};
  try {
    runtime.preRender({
      layers: [layer],
      viewports: [viewport],
      isPicking: false,
      pass: 'screen',
      layerFilter: filter
    } as PreRenderOptions);
    expect(runtime['pickingEntries'].get(JSON.stringify(['view', 'query']))).toHaveLength(1);
    runtime['pickers'].set(JSON.stringify(['view', 'query']), picker as never);
    runtime.preRender({
      layers: [layer],
      viewports: [viewport],
      isPicking: true,
      pass: 'picking:query',
      cullRect: rect,
      layerFilter: filter
    } as PreRenderOptions);
    expect(picker.prepare).toHaveBeenCalledOnce();
    expect(filter.mock.calls.at(-1)?.[0]).toMatchObject({
      renderPass: 'picking:query',
      cullRect: rect
    });
    runtime.preRender({
      layers: [layer],
      viewports: [viewport],
      isPicking: true,
      pass: 'picking:hover',
      cullRect: rect,
      layerFilter: filter
    } as PreRenderOptions);
    expect(picker.destroy).toHaveBeenCalledOnce();
  } finally {
    runtime.cleanup();
    device.destroy();
  }
});

it.each([
  'geospatial',
  'orthographic',
  'orbit orthographic'
] as const)('isolates unsupported RAD %s projections, clears stale picking and recovers without error spam', projection => {
  const device = new NullDevice({});
  const runtime = new SplatSceneRuntime({redraw() {}} as Deck, device);
  const layer = new SplatSceneLayer({id: 'transitioning', data: '/capture.rad', pickable: true});
  runtime.register(layer);
  const raise = vi.spyOn(layer, 'raiseError').mockImplementation(() => {});
  const acquire = vi.spyOn(runtime as any, 'acquireAsset').mockReturnValue({id: 0});
  const stale = {destroy: vi.fn()};
  runtime['pickers'].set(JSON.stringify(['view', 'transitioning']), stale as never);
  runtime['pickingEntries'].set(JSON.stringify(['view', 'transitioning']), [{}] as never);
  const unsupported =
    projection === 'geospatial'
      ? new WebMercatorViewport({id: 'view', width: 128, height: 128})
      : projection === 'orthographic'
        ? new OrthographicViewport({id: 'view', width: 128, height: 128})
        : new OrbitViewport({id: 'view', width: 128, height: 128, orthographic: true});
  const draw = (viewport, isPicking = false) =>
    runtime.preRender({
      layers: [layer],
      viewports: [viewport],
      isPicking,
      pass: isPicking ? 'picking:query' : 'screen'
    } as PreRenderOptions);
  try {
    expect(() => draw(unsupported, true)).not.toThrow();
    expect(stale.destroy).toHaveBeenCalledOnce();
    expect(runtime['pickers'].size).toBe(0);
    expect(runtime['pickingEntries'].size).toBe(0);
    expect(() => draw(unsupported)).not.toThrow();
    expect(() => draw(unsupported)).not.toThrow();
    expect(raise).toHaveBeenCalledOnce();
    expect(acquire).not.toHaveBeenCalled();
    expect(runtime['domains'].size).toBe(0);
    draw(new FirstPersonViewport({id: 'view', width: 128, height: 128}));
    expect(acquire).toHaveBeenCalledOnce();
    draw(unsupported);
    expect(raise).toHaveBeenCalledTimes(2);
  } finally {
    runtime.cleanup();
    device.destroy();
  }
});

it.each([
  undefined,
  1.5
])('uses the drawing pixel ratio for picking with canvas override %s', override => {
  const device = new NullDevice({});
  Object.defineProperty(device, 'canvasContext', {
    value: {cssToDeviceRatio: () => 2},
    configurable: true
  });
  const runtime = new SplatSceneRuntime({} as Deck, device);
  const source = {
    positions: new Float32Array([0, 0, 0]),
    scales: new Float32Array([1, 1, 1]),
    rotations: new Float32Array([1, 0, 0, 0]),
    colors: new Uint8Array([255, 255, 255, 255]),
    opacities: new Float32Array([0.8])
  };
  const layer = new SplatSceneLayer({id: 'density', data: source, pickable: true});
  vi.spyOn(layer, 'getOwnerMatrix').mockReturnValue(new Matrix4());
  runtime.register(layer);
  vi.spyOn(runtime as any, 'acquireAsset').mockReturnValue({id: 0});
  const viewport = new OrthographicViewport({id: 'view', width: 128, height: 64});
  const options = {
    layers: [layer],
    viewports: [viewport],
    isPicking: false,
    layerFilter: ({isPicking}) => isPicking,
    ...(override === undefined ? {} : {canvasContext: {cssToDeviceRatio: () => override}})
  } as PreRenderOptions;
  const picker = {setProps: vi.fn(), setFrontier: vi.fn(), prepare: vi.fn(), destroy: vi.fn()};
  try {
    runtime.preRender(options);
    const expected = [128 * (override ?? 2), 64 * (override ?? 2)];
    expect(
      runtime['pickingEntries'].get(JSON.stringify(['view', 'density']))?.[0].view.viewportSize
    ).toEqual(expected);
    runtime['pickers'].set(JSON.stringify(['view', 'density']), picker as never);
    runtime.preRender({...options, isPicking: true, pass: 'picking:query'});
    expect(picker.setProps).toHaveBeenCalledWith(expect.objectContaining({viewportSize: expected}));
  } finally {
    runtime.cleanup();
    Object.defineProperty(device, 'canvasContext', {value: undefined, configurable: true});
    device.destroy();
  }
});

it('preserves static orthographic and RAD perspective siblings and recovers when RAD data is replaced', () => {
  const device = new NullDevice({});
  const runtime = new SplatSceneRuntime({redraw() {}} as Deck, device);
  const source = {
    positions: new Float32Array([0, 0, 0]),
    scales: new Float32Array([1, 1, 1]),
    rotations: new Float32Array([1, 0, 0, 0]),
    colors: new Uint8Array([255, 255, 255, 255]),
    opacities: new Float32Array([0.8])
  };
  const rad = new SplatSceneLayer({id: 'rad', data: '/capture.rad', pickable: true});
  const stat = new SplatSceneLayer({id: 'static', data: source, pickable: true});
  const layers = [rad, stat];
  layers.forEach(layer => {
    vi.spyOn(layer, 'getOwnerMatrix').mockReturnValue(new Matrix4());
    runtime.register(layer);
  });
  const raise = vi.spyOn(rad, 'raiseError').mockImplementation(() => {});
  vi.spyOn(runtime as any, 'acquireAsset').mockReturnValue({id: 0});
  const viewports = [
    new OrthographicViewport({id: 'ortho', width: 128, height: 128}),
    new FirstPersonViewport({id: 'perspective', width: 128, height: 128})
  ];
  for (const viewport of viewports)
    runtime['domains'].set(JSON.stringify([viewport.id, 'default']), {
      renderer: {setProps: vi.fn(), setFrontier: vi.fn(), prepare: vi.fn(), destroy: vi.fn()},
      leader: '',
      layers: new Set(),
      owners: [],
      pages: []
    } as never);
  try {
    runtime.preRender({layers, viewports, isPicking: false} as PreRenderOptions);
    expect(raise).toHaveBeenCalledOnce();
    expect(runtime['domains'].get(JSON.stringify(['ortho', 'default']))?.layers).toEqual(
      new Set(['static'])
    );
    expect(runtime['domains'].get(JSON.stringify(['perspective', 'default']))?.layers).toEqual(
      new Set(['rad', 'static'])
    );
    expect(runtime['pickingEntries'].has(JSON.stringify(['ortho', 'rad']))).toBe(false);
    expect(runtime['pickingEntries'].has(JSON.stringify(['perspective', 'rad']))).toBe(true);
    const replacement = rad.clone({data: source});
    vi.spyOn(replacement, 'getOwnerMatrix').mockReturnValue(new Matrix4());
    runtime.register(replacement);
    runtime.preRender({
      layers: [replacement, stat],
      viewports,
      isPicking: false
    } as PreRenderOptions);
    expect(runtime['domains'].get(JSON.stringify(['ortho', 'default']))?.layers).toEqual(
      new Set(['rad', 'static'])
    );
    expect(runtime['pickingEntries'].has(JSON.stringify(['ortho', 'rad']))).toBe(true);
  } finally {
    runtime.cleanup();
    device.destroy();
  }
});

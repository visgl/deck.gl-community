// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it, vi} from 'vitest';
import {NullDevice} from '@luma.gl/test-utils';
import {makeGPUSplatData} from '@luma.gl/splats';
import {RADScene} from '../../../src/splat-layer/scene/rad-scene';
import type {RADSelection} from '../../../src/splat-layer/scene/rad-selection';

vi.mock('../../../src/splat-layer/scene/rad-source-client', () => ({
  RADSourceClient: class {
    getMetadata = () => new Promise(() => {});
    configure = vi.fn(async () => {});
    select = vi.fn(() => new Promise<RADSelection>(() => {}));
    retain = vi.fn(async () => {});
    remove = vi.fn(async () => {});
    getPage = vi.fn();
    admit = vi.fn(async () => {});
    discard = vi.fn(async () => {});
    destroy = vi.fn();
  }
}));

const view = {
  cameraPosition: [0, 0, 2] as [number, number, number],
  viewportSize: [1000, 1000] as [number, number],
  modelViewProjectionMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
};

function makeScene() {
  const device = new NullDevice({});
  Object.defineProperty(device, 'type', {value: 'webgpu'});
  const onChange = vi.fn();
  const onStatus = vi.fn();
  const onError = vi.fn();
  const scene = new RADScene(device, {
    data: 'scene.rad',
    maxActiveSplats: 2_000_000,
    maxResidentSplats: 8_000_000,
    maxConcurrentLoads: 8,
    onChange,
    onStatus,
    onError
  });
  scene['rootReady'] = true;
  const select = vi.spyOn(scene['source'], 'select');
  const schedule = vi.spyOn(scene.scheduler, 'update').mockImplementation(() => {});
  return {device, scene, select, schedule, onChange, onStatus, onError};
}

function makeSelection(version: number, viewVersion: number): RADSelection {
  return {
    version,
    viewVersion,
    protectedPageIds: [],
    requests: [],
    hasPendingTraversal: false,
    duration: 1
  };
}

describe('SplatLayer off-thread refinement', () => {
  it('updates download concurrency without replacing the worker or presented frontier', () => {
    const {device, scene, onChange} = makeScene();
    const source = scene['source'];
    const frontier = scene.frontier;
    const concurrency = vi.spyOn(scene.scheduler, 'setConcurrency');
    scene.setBudget(2_000_000, 8_000_000, 2);
    expect(concurrency).toHaveBeenCalledExactlyOnceWith(2);
    expect(scene['source']).toBe(source);
    expect(scene.frontier).toBe(frontier);
    expect(onChange).toHaveBeenCalled();
    scene.setBudget(2_000_000, 8_000_000, 2);
    expect(concurrency).toHaveBeenCalledTimes(1);
    scene.destroy();
    device.destroy();
  });

  it('retains a coherent frontier and retries a stale reply that names an evicted page', () => {
    const {device, scene, onError} = makeScene();
    const source = {
      positions: new Float32Array([0, 0, 0]),
      scales: new Float32Array([1, 1, 1]),
      rotations: new Float32Array([1, 0, 0, 0]),
      colors: new Uint8Array([255, 255, 255, 255]),
      opacities: new Float32Array([1])
    };
    const data = makeGPUSplatData(device, source);
    scene.residency.add(data, {id: 'rad:0'});
    scene.residency.pin('rad:0');
    const frontier = [{id: 'rad:0', data, activeRows: new Uint32Array([0])}];
    scene['presentedFrontier'] = frontier;
    scene['frontiers'].set('camera', frontier);
    scene['pendingSelection'] = {
      result: {...makeSelection(1, 1), frontier: [{id: 'rad:1', activeRows: new Uint32Array([0])}]},
      leasedIds: new Set(['rad:0']),
      frontiers: new Map([['camera', [{id: 'rad:1', activeRows: new Uint32Array([0])}]]])
    };
    expect(() => scene['applySelection']()).not.toThrow();
    expect(scene.frontier).toBe(frontier);
    expect(scene.getFrontier('camera')).toBe(frontier);
    expect(scene.residency.getChunk('rad:0')?.pinned).toBe(true);
    expect(scene['selectionNeeded']).toBe(true);
    expect(onError).not.toHaveBeenCalled();
    scene.destroy();
    device.destroy();
  });

  it('waits for worker eviction acknowledgements before traversing again', async () => {
    const {device, scene, select} = makeScene();
    let complete: () => void = () => {};
    scene['pendingRemovals'].add(
      new Promise<void>(resolve => {
        complete = resolve;
      })
    );
    scene.update(view, 1, 0);
    expect(select).not.toHaveBeenCalled();
    complete();
    await vi.waitFor(() => expect(select).toHaveBeenCalledTimes(1));
    scene.destroy();
    device.destroy();
  });
  it('configures selection from metadata and admits the root before becoming ready', async () => {
    const {device, scene, onChange} = makeScene();
    scene['rootReady'] = false;
    const source = scene['source'];
    const metadata = {count: 40_000_000, chunkSize: 262_144, lodTree: {}};
    vi.spyOn(source, 'getMetadata').mockResolvedValue(metadata as never);
    const configure = vi.spyOn(source, 'configure').mockResolvedValue();
    const loadPage = vi
      .spyOn(
        scene as unknown as {
          loadPage: (pageIndex: number, priority: number, signal: AbortSignal) => Promise<boolean>;
        },
        'loadPage'
      )
      .mockResolvedValue(true);
    onChange.mockClear();

    await scene['initialize']();

    expect(configure).toHaveBeenCalledWith({
      pageSize: 262_144,
      maxActiveSplats: 2_000_000,
      maxResidentSplats: 8_000_000
    });
    expect(loadPage).toHaveBeenCalledWith(0, Number.MAX_SAFE_INTEGER, expect.any(AbortSignal));
    expect(scene['rootReady']).toBe(true);
    expect(scene['sourceSplats']).toBe(40_000_000);
    expect(onChange).toHaveBeenCalledTimes(1);
    scene.destroy();
    device.destroy();
  });

  it('rejects sources without hierarchy metadata before requesting the root page', async () => {
    const {device, scene} = makeScene();
    scene['rootReady'] = false;
    const source = scene['source'];
    vi.spyOn(source, 'getMetadata').mockResolvedValue({count: 1} as never);
    const configure = vi.spyOn(source, 'configure');
    const loadPage = vi.spyOn(
      scene as unknown as {
        loadPage: (pageIndex: number, priority: number, signal: AbortSignal) => Promise<boolean>;
      },
      'loadPage'
    );

    await expect(scene['initialize']()).rejects.toThrow(
      'SplatLayer requires a RAD hierarchy with a declared chunkSize.'
    );
    expect(configure).not.toHaveBeenCalled();
    expect(loadPage).not.toHaveBeenCalled();
    scene.destroy();
    device.destroy();
  });

  it('rejects a root page that cannot fit the configured resident budget', async () => {
    const {device, scene} = makeScene();
    scene['rootReady'] = false;
    const source = scene['source'];
    vi.spyOn(source, 'getMetadata').mockResolvedValue({
      count: 4,
      chunkSize: 4,
      lodTree: {}
    } as never);
    vi.spyOn(source, 'configure').mockResolvedValue();
    vi.spyOn(
      scene as unknown as {
        loadPage: (pageIndex: number, priority: number, signal: AbortSignal) => Promise<boolean>;
      },
      'loadPage'
    ).mockResolvedValue(false);

    await expect(scene['initialize']()).rejects.toThrow(
      'The RAD root page exceeds maxResidentSplats.'
    );
    expect(scene['rootReady']).toBe(false);
    scene.destroy();
    device.destroy();
  });

  it('admits queued GPU uploads between traversal leases without evicting the visible root', async () => {
    const {device, scene, select} = makeScene();
    const source = {
      positions: new Float32Array([0, 0, 0]),
      scales: new Float32Array([0.1, 0.1, 0.1]),
      rotations: new Float32Array([1, 0, 0, 0]),
      colors: new Uint8Array([255, 255, 255, 255]),
      opacities: new Float32Array([1])
    };
    const root = makeGPUSplatData(device, source);
    const unused = makeGPUSplatData(device, {...source, rowIndexBase: 1});
    scene.residency.setBudget({maxResidentSplats: 2});
    scene.residency.add(root, {id: 'rad:0'});
    scene.residency.add(unused, {id: 'rad:1'});
    let complete: (selection: RADSelection) => void = () => {};
    select.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          complete = resolve;
        })
    );
    scene.update(view, 1, 0);
    vi.spyOn(scene['source'], 'getPage').mockResolvedValue({
      requestId: 12,
      colors: new Float32Array([1, 1, 1, 1]),
      splats: {...source, format: 'rad', splatCount: 1, loaderData: {base: 2}}
    });
    const loaded = scene['loadPage'](2, 10, new AbortController().signal);
    await new Promise(resolve => setTimeout(resolve, 0));
    scene.update(view, 1, 16);
    expect(scene.residency.has('rad:2')).toBe(false);
    expect(unused.destroyed).toBe(false);
    complete(makeSelection(1, 1));
    await new Promise(resolve => setTimeout(resolve, 0));
    scene.update(view, 1, 32);
    expect(await loaded).toBe(true);
    expect(unused.destroyed).toBe(true);
    expect(root.destroyed).toBe(false);
    expect(scene.residency.getChunk('rad:2')?.pinned).toBe(true);
    scene.destroy();
    device.destroy();
  });

  it('coalesces motion to one worker request while updating the camera immediately', async () => {
    const {device, scene, select} = makeScene();
    let complete: (selection: RADSelection) => void = () => {};
    select.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          complete = resolve;
        })
    );
    scene.update(view, 1, 0);
    const cameraUpdates = vi.spyOn(scene.renderer, 'setProps');
    const latest = {...view, modelViewProjectionMatrix: [...view.modelViewProjectionMatrix]};
    for (let index = 1; index <= 30; index++) {
      latest.modelViewProjectionMatrix = [...view.modelViewProjectionMatrix];
      latest.modelViewProjectionMatrix[12] = index / 100;
      scene.update({...latest}, 1, index * 16);
    }
    expect(select).toHaveBeenCalledTimes(1);
    expect(cameraUpdates).toHaveBeenCalledWith(latest);
    complete(makeSelection(1, 1));
    await new Promise(resolve => setTimeout(resolve, 0));
    scene.update(latest, 1, 500);
    expect(select).toHaveBeenCalledTimes(2);
    expect(select).toHaveBeenLastCalledWith(latest, 31, 'default', 2_000_000, 8_000_000);
    scene.destroy();
    device.destroy();
  });

  it('atomically promotes coherent replies during motion and protects borrowed GPU pages', async () => {
    const {device, scene, select} = makeScene();
    const data = makeGPUSplatData(device, {
      positions: new Float32Array([0, 0, 0]),
      scales: new Float32Array([0.1, 0.1, 0.1]),
      rotations: new Float32Array([1, 0, 0, 0]),
      colors: new Uint8Array([255, 255, 255, 255]),
      opacities: new Float32Array([1])
    });
    scene.residency.add(data, {id: 'rad:0'});
    let complete: (selection: RADSelection) => void = () => {};
    select.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          complete = resolve;
        })
    );
    const frontier = vi.spyOn(scene.renderer, 'setFrontier');
    scene.update(view, 1, 0);
    expect(scene.residency.getChunk('rad:0')?.pinned).toBe(true);
    const moved = {...view, viewportSize: [900, 900] as [number, number]};
    scene.update(moved, 1, 16);
    expect(frontier).not.toHaveBeenCalled();
    complete({...makeSelection(1, 1), frontier: [{id: 'rad:0', activeRows: new Uint32Array([0])}]});
    await new Promise(resolve => setTimeout(resolve, 0));
    scene.update(moved, 1, 32);
    expect(frontier).toHaveBeenCalledTimes(1);
    expect(scene.renderer.pages[0].data).toBe(data);
    expect(scene.residency.getChunk('rad:0')?.pinned).toBe(true);
    expect(select).toHaveBeenLastCalledWith(moved, 2, 'default', 2_000_000, 8_000_000);
    scene.destroy();
    expect(data.destroyed).toBe(true);
    device.destroy();
  });

  it('ignores worker completion after destruction', async () => {
    const {device, scene, select, onChange} = makeScene();
    let complete: (selection: RADSelection) => void = () => {};
    select.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          complete = resolve;
        })
    );
    scene.update(view, 1, 0);
    scene.destroy();
    onChange.mockClear();
    complete(makeSelection(1, 1));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(onChange).not.toHaveBeenCalled();
    expect(scene['pendingSelection']).toBeUndefined();
    device.destroy();
  });

  it('discards decoded geometry when residency rejects a page', async () => {
    const {device, scene} = makeScene();
    scene['rootReady'] = false;
    const source = {
      positions: new Float32Array([0, 0, 0]),
      scales: new Float32Array([0.1, 0.1, 0.1]),
      rotations: new Float32Array([1, 0, 0, 0]),
      colors: new Uint8Array([255, 255, 255, 255]),
      opacities: new Float32Array([1])
    };
    vi.spyOn(scene['source'], 'getPage').mockResolvedValue({
      requestId: 20,
      colors: new Float32Array([1, 1, 1, 1]),
      splats: {...source, format: 'rad', splatCount: 1, loaderData: {base: 2}}
    });
    vi.spyOn(scene.residency, 'load').mockResolvedValue(undefined as never);
    const discard = vi.spyOn(scene['source'], 'discard').mockResolvedValue();

    await expect(scene['loadPage'](2, 10, new AbortController().signal)).resolves.toBe(false);
    expect(discard).toHaveBeenCalledWith(20);
    expect(scene.residency.has('rad:2')).toBe(false);
    scene.destroy();
    device.destroy();
  });

  it('discards a decoded page if its view request is cancelled before GPU upload', async () => {
    const {device, scene} = makeScene();
    const source = {
      positions: new Float32Array([0, 0, 0]),
      scales: new Float32Array([0.1, 0.1, 0.1]),
      rotations: new Float32Array([1, 0, 0, 0]),
      colors: new Uint8Array([255, 255, 255, 255]),
      opacities: new Float32Array([1])
    };
    vi.spyOn(scene['source'], 'getPage').mockResolvedValue({
      requestId: 22,
      colors: new Float32Array([1, 1, 1, 1]),
      splats: {...source, format: 'rad', splatCount: 1, loaderData: {base: 2}}
    });
    const discard = vi.spyOn(scene['source'], 'discard').mockResolvedValue();
    const controller = new AbortController();
    const loaded = scene['loadPage'](2, 10, controller.signal);
    await new Promise(resolve => setTimeout(resolve, 0));
    controller.abort();
    scene.update(view, 1, 0);

    await expect(loaded).resolves.toBe(false);
    expect(discard).toHaveBeenCalledWith(22);
    expect(scene.residency.has('rad:2')).toBe(false);
    scene.destroy();
    device.destroy();
  });

  it('removes an uploaded page and discards worker geometry if admission fails', async () => {
    const {device, scene} = makeScene();
    scene['rootReady'] = false;
    const source = {
      positions: new Float32Array([0, 0, 0]),
      scales: new Float32Array([0.1, 0.1, 0.1]),
      rotations: new Float32Array([1, 0, 0, 0]),
      colors: new Uint8Array([255, 255, 255, 255]),
      opacities: new Float32Array([1])
    };
    vi.spyOn(scene['source'], 'getPage').mockResolvedValue({
      requestId: 21,
      colors: new Float32Array([1, 1, 1, 1]),
      splats: {...source, format: 'rad', splatCount: 1, loaderData: {base: 2}}
    });
    const error = new Error('worker admission failed');
    vi.spyOn(scene['source'], 'admit').mockRejectedValue(error);
    const discard = vi.spyOn(scene['source'], 'discard').mockResolvedValue();

    await expect(scene['loadPage'](2, 10, new AbortController().signal)).rejects.toBe(error);
    expect(discard).toHaveBeenCalledWith(21);
    expect(scene.residency.has('rad:2')).toBe(false);
    scene.destroy();
    device.destroy();
  });

  it('reports ready, budget-limited, refining, and error states without duplicate status events', () => {
    const {device, scene, onStatus, onError} = makeScene();
    scene['currentView'] = view;
    scene['selectionNeeded'] = false;
    onStatus.mockClear();

    scene.update(view, 1, 0);
    scene.update(view, 1, 1);
    expect(onStatus).toHaveBeenCalledTimes(1);
    expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({phase: 'ready'}));

    scene['requests'] = [{pageIndex: 4, priority: 1}];
    scene.scheduler.rejected.add(4);
    scene.update(view, 1, 2);
    expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({phase: 'budget-limited'}));

    scene['selecting'] = true;
    scene.update(view, 1, 3);
    expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({phase: 'refining'}));

    const error = new Error('decoder unavailable');
    scene['fail'](error);
    expect(onStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({phase: 'error', message: 'decoder unavailable'})
    );
    expect(onError).toHaveBeenCalledWith(error);
    scene.destroy();
    device.destroy();
  });
});

it('shares residency across view selections and splits the active grant without restarting the worker', async () => {
  const {device, scene, select} = makeScene();
  select.mockResolvedValue(makeSelection(1, 1));
  const retain = vi.spyOn(scene['source'], 'retain');
  scene.updateViews(
    new Map([
      ['left', view],
      ['right', {...view, cameraPosition: [1, 0, 2]}]
    ]),
    0
  );
  expect(retain).toHaveBeenCalledWith(['left', 'right']);
  expect(select).toHaveBeenCalledWith(view, expect.any(Number), 'left', 1_000_000, 8_000_000);
  expect(select).toHaveBeenCalledWith(
    expect.objectContaining({cameraPosition: [1, 0, 2]}),
    expect.any(Number),
    'right',
    1_000_000,
    8_000_000
  );
  await new Promise(resolve => setTimeout(resolve, 0));
  const source = scene['source'];
  scene.setBudget(1000, 2000);
  scene.updateViews(new Map([['left', view]]), 16);
  expect(scene['source']).toBe(source);
  expect(retain).toHaveBeenLastCalledWith(['left']);
  expect(select).toHaveBeenLastCalledWith(view, expect.any(Number), 'left', 1000, 2000);
  scene.destroy();
  device.destroy();
});

it('retargets foveation with a fixed camera instead of retaining the old selection controls', async () => {
  const {device, scene, select} = makeScene();
  select.mockResolvedValue(makeSelection(1, 1));
  const first = {
    ...view,
    foveation: {center: [0.5, 0.5] as [number, number], radius: 0.5, strength: 0}
  };
  scene.updateViews(new Map([['camera', first]]), 0);
  for (let index = 0; index < 12; index++) await Promise.resolve();
  scene.updateViews(
    new Map([['camera', {...first, foveation: {...first.foveation, strength: 12}}]]),
    16
  );
  for (let index = 0; index < 12; index++) await Promise.resolve();
  scene.updateViews(
    new Map([['camera', {...first, foveation: {...first.foveation, strength: 12}}]]),
    32
  );
  expect(select.mock.calls.at(-1)![0].foveation?.strength).toBe(12);
  scene.destroy();
  device.destroy();
});

it.each([
  false,
  true
])('releases failed selection leases after all sibling requests finish: %s', async sibling => {
  const {device, scene, select, onError} = makeScene();
  const source = {
    positions: new Float32Array([0, 0, 0]),
    scales: new Float32Array([1, 1, 1]),
    rotations: new Float32Array([1, 0, 0, 0]),
    colors: new Uint8Array([255, 255, 255, 255]),
    opacities: new Float32Array([1])
  };
  const data = [0, 1, 2].map(index => {
    const page = makeGPUSplatData(device, source);
    scene.residency.add(page, {id: `rad:${index}`});
    return page;
  });
  const frontier = [{id: 'rad:0', data: data[0], activeRows: new Uint32Array([0])}];
  scene['presentedFrontier'] = frontier;
  scene['frontiers'].set('a', [{id: 'rad:1', data: data[1], activeRows: new Uint32Array([0])}]);
  let finish = (_selection: RADSelection) => {};
  const error = new Error('selection worker rejected');
  select.mockRejectedValueOnce(error);
  if (sibling) {
    scene['views'] = new Map([
      ['a', view],
      ['b', {...view, cameraPosition: [1, 0, 2]}]
    ]);
    select.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
  }
  try {
    scene.update(view, 1, 0);
    if (sibling) {
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(onError).not.toHaveBeenCalled();
      expect(scene.residency.getChunk('rad:2')?.pinned).toBe(true);
      finish(makeSelection(1, 1));
    }
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(error));
    expect(scene['selecting']).toBe(false);
    expect(scene.residency.getChunk('rad:0')?.pinned).toBe(true);
    expect(scene.residency.getChunk('rad:1')?.pinned).toBe(true);
    expect(scene.residency.getChunk('rad:2')?.pinned).toBe(false);
    scene.residency.setBudget({maxResidentSplats: 2});
    expect(data[2].destroyed).toBe(true);
    expect(data[0].destroyed).toBe(false);
    expect(data[1].destroyed).toBe(false);
    expect(scene.frontier).toBe(frontier);
  } finally {
    finish(makeSelection(1, 1));
    scene.destroy();
    device.destroy();
  }
});

it.each([
  false,
  true
])('settles pending uploads on terminal failure without retaining admission pins: %s', async started => {
  const {device, scene, onError} = makeScene();
  vi.spyOn(scene['source'], 'getPage').mockResolvedValue({
    requestId: 25,
    colors: new Float32Array([1, 1, 1, 1]),
    splats: {
      positions: new Float32Array([0, 0, 0]),
      scales: new Float32Array([1, 1, 1]),
      rotations: new Float32Array([1, 0, 0, 0]),
      opacities: new Float32Array([1]),
      format: 'rad',
      splatCount: 1,
      loaderData: {base: 2}
    }
  });
  const admit = vi.spyOn(scene['source'], 'admit');
  const discard = vi.spyOn(scene['source'], 'discard');
  const originalLoad = scene.residency.load.bind(scene.residency);
  let finish = () => {};
  if (started) {
    vi.spyOn(scene.residency, 'load').mockImplementation((id, loader, options) =>
      originalLoad(
        id,
        async () => {
          const data = await loader();
          await new Promise<void>(resolve => {
            finish = resolve;
          });
          return data;
        },
        options
      )
    );
  }
  try {
    const loading = scene['loadPage'](2, 10, new AbortController().signal);
    await vi.waitFor(() => expect(scene['pendingUploads']).toHaveLength(1));
    if (started) {
      scene['pendingUploads'].shift()!();
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    const error = new Error('terminal worker failure');
    scene['fail'](error);
    finish();
    await expect(loading).resolves.toBe(false);
    expect(scene['pendingUploads']).toHaveLength(0);
    expect(admit).not.toHaveBeenCalled();
    expect(discard).toHaveBeenCalledWith(25);
    expect(onError).toHaveBeenCalledExactlyOnceWith(error);
    scene.residency.setBudget({maxResidentSplats: 0});
    expect(scene.residency.has('rad:2')).toBe(false);
  } finally {
    finish();
    scene.destroy();
    device.destroy();
  }
});

it('retains an active traversal lease when another source transaction fails', async () => {
  const {device, scene, select} = makeScene();
  const data = makeGPUSplatData(device, {
    positions: new Float32Array([0, 0, 0]),
    scales: new Float32Array([1, 1, 1]),
    rotations: new Float32Array([1, 0, 0, 0]),
    colors: new Uint8Array([255, 255, 255, 255]),
    opacities: new Float32Array([1])
  });
  scene.residency.add(data, {id: 'rad:2'});
  let finish = (_selection: RADSelection) => {};
  select.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      })
  );
  try {
    scene.update(view, 1, 0);
    scene['fail'](new Error('another transaction failed'));
    expect(scene.residency.getChunk('rad:2')?.pinned).toBe(true);
    expect(scene['selecting']).toBe(true);
    finish(makeSelection(1, 1));
    await vi.waitFor(() => expect(scene['selecting']).toBe(false));
    expect(scene.residency.getChunk('rad:2')?.pinned).toBe(false);
    expect(scene['pendingSelection']).toBeUndefined();
    scene.residency.setBudget({maxResidentSplats: 0});
    expect(data.destroyed).toBe(true);
  } finally {
    finish(makeSelection(1, 1));
    scene.destroy();
    device.destroy();
  }
});

it.each([
  false,
  true
])('settles a hidden view selection and releases only transient pins: %s', async completed => {
  const {device, scene, select} = makeScene();
  const source = {
    positions: new Float32Array([0, 0, 0]),
    scales: new Float32Array([1, 1, 1]),
    rotations: new Float32Array([1, 0, 0, 0]),
    colors: new Uint8Array([255, 255, 255, 255]),
    opacities: new Float32Array([1])
  };
  const data = [0, 1, 2].map(index => {
    const page = makeGPUSplatData(device, source);
    scene.residency.add(page, {id: `rad:${index}`});
    return page;
  });
  const frontier = [{id: 'rad:0', data: data[0], activeRows: new Uint32Array([0])}];
  scene['presentedFrontier'] = frontier;
  scene['frontiers'].set('camera', [
    {id: 'rad:1', data: data[1], activeRows: new Uint32Array([0])}
  ]);
  let finish = (_selection: RADSelection) => {};
  select.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      })
  );
  try {
    scene.updateViews(new Map([['camera', view]]), 0);
    if (completed) {
      finish(makeSelection(1, 1));
      await vi.waitFor(() => expect(scene['pendingSelection']).toBeDefined());
    }
    scene.updateViews(new Map(), 16);
    if (!completed) {
      expect(scene.residency.getChunk('rad:2')?.pinned).toBe(true);
      finish(makeSelection(1, 1));
    }
    await vi.waitFor(() => expect(scene['selecting']).toBe(false));
    expect(scene['pendingSelection']).toBeUndefined();
    expect(scene.residency.getChunk('rad:0')?.pinned).toBe(true);
    expect(scene.residency.getChunk('rad:1')?.pinned).toBe(true);
    expect(scene.residency.getChunk('rad:2')?.pinned).toBe(false);
    scene.residency.setBudget({maxResidentSplats: 2});
    expect(data[2].destroyed).toBe(true);
    expect(scene.frontier).toBe(frontier);
    scene.updateViews(new Map([['camera', view]]), 32);
    await vi.waitFor(() => expect(select).toHaveBeenCalledTimes(2));
  } finally {
    finish(makeSelection(1, 1));
    scene.destroy();
    device.destroy();
  }
});

it('discards decoded queued pages when all views hide', async () => {
  const {device, scene} = makeScene();
  vi.spyOn(scene['source'], 'getPage').mockResolvedValue({
    requestId: 31,
    colors: new Float32Array([1, 1, 1, 1]),
    splats: {
      positions: new Float32Array([0, 0, 0]),
      scales: new Float32Array([1, 1, 1]),
      rotations: new Float32Array([1, 0, 0, 0]),
      opacities: new Float32Array([1]),
      format: 'rad',
      splatCount: 1,
      loaderData: {base: 2}
    }
  });
  const discard = vi.spyOn(scene['source'], 'discard');
  const admit = vi.spyOn(scene['source'], 'admit');
  try {
    const loading = scene['loadPage'](2, 10, new AbortController().signal);
    await vi.waitFor(() => expect(scene['pendingUploads']).toHaveLength(1));
    scene.updateViews(new Map(), 16);
    await vi.waitFor(() => expect(scene['pendingUploads']).toHaveLength(0));
    await expect(loading).resolves.toBe(false);
    expect(discard).toHaveBeenCalledWith(31);
    expect(admit).not.toHaveBeenCalled();
    expect(scene.residency.has('rad:2')).toBe(false);
  } finally {
    scene.destroy();
    device.destroy();
  }
});

it.each([
  'decode',
  'residency',
  'admit'
] as const)('settles a page that hides while awaiting %s', async boundary => {
  const {device, scene, onChange} = makeScene();
  const page = {
    requestId: 41,
    colors: new Float32Array([1, 1, 1, 1]),
    splats: {
      positions: new Float32Array([0, 0, 0]),
      scales: new Float32Array([1, 1, 1]),
      rotations: new Float32Array([1, 0, 0, 0]),
      opacities: new Float32Array([1]),
      format: 'rad',
      splatCount: 1,
      loaderData: {base: 2}
    }
  };
  let finish = () => {};
  const pause = () =>
    new Promise<void>(resolve => {
      finish = resolve;
    });
  const getPage = vi.spyOn(scene['source'], 'getPage').mockImplementation(async () => {
    if (boundary === 'decode') await pause();
    return page;
  });
  const admit = vi.spyOn(scene['source'], 'admit').mockImplementation(async () => {
    if (boundary === 'admit') await pause();
  });
  const discard = vi.spyOn(scene['source'], 'discard');
  if (boundary === 'residency') {
    const load = scene.residency.load.bind(scene.residency);
    vi.spyOn(scene.residency, 'load').mockImplementation((id, loader, options) =>
      load(
        id,
        async () => {
          const data = await loader();
          await pause();
          return data;
        },
        options
      )
    );
  }
  try {
    const loading = scene['loadPage'](2, 10, new AbortController().signal);
    if (boundary !== 'decode') {
      await vi.waitFor(() => expect(scene['pendingUploads']).toHaveLength(1));
      scene['pendingUploads'].shift()!();
      if (boundary === 'admit') await vi.waitFor(() => expect(admit).toHaveBeenCalled());
      else await new Promise(resolve => setTimeout(resolve, 0));
    } else expect(getPage).toHaveBeenCalled();
    scene.updateViews(new Map(), 16);
    onChange.mockClear();
    finish();
    await expect(loading).resolves.toBe(false);
    expect(scene['pendingUploads']).toHaveLength(0);
    expect(discard).toHaveBeenCalledWith(41);
    expect(admit).toHaveBeenCalledTimes(boundary === 'admit' ? 1 : 0);
    expect(onChange).not.toHaveBeenCalled();
    scene.residency.setBudget({maxResidentSplats: 0});
    expect(scene.residency.has('rad:2')).toBe(false);
  } finally {
    finish();
    scene.destroy();
    device.destroy();
  }
});

it('finishes initial root loading while every view is hidden', async () => {
  const {device, scene, onError} = makeScene();
  scene['rootReady'] = false;
  vi.spyOn(scene['source'], 'getMetadata').mockResolvedValue({
    count: 1,
    chunkSize: 1,
    lodTree: {}
  } as never);
  vi.spyOn(scene['source'], 'getPage').mockResolvedValue({
    requestId: 51,
    colors: new Float32Array([1, 1, 1, 1]),
    splats: {
      positions: new Float32Array([0, 0, 0]),
      scales: new Float32Array([1, 1, 1]),
      rotations: new Float32Array([1, 0, 0, 0]),
      opacities: new Float32Array([1]),
      format: 'rad',
      splatCount: 1,
      loaderData: {base: 0}
    }
  });
  const admit = vi.spyOn(scene['source'], 'admit');
  try {
    scene.updateViews(new Map(), 0);
    await scene['initialize']();
    expect(scene['rootReady']).toBe(true);
    expect(scene.residency.has('rad:0')).toBe(true);
    expect(admit).toHaveBeenCalledExactlyOnceWith(51);
    expect(scene['pendingUploads']).toHaveLength(0);
    expect(onError).not.toHaveBeenCalled();
  } finally {
    scene.destroy();
    device.destroy();
  }
});

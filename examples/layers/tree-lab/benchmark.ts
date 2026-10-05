// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {Deck} from '@deck.gl/core';
import type {Device} from '@luma.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {webgpuAdapter} from '@luma.gl/webgpu';
import {
  VIEW,
  DEFAULT_OPTIONS,
  SPECIES,
  createSpecimens,
  createSceneLayers,
  createLighting,
  createViews,
  type SceneOptions,
  type TreeLayerConstructor
} from './scene';
import './style.css';

/** Identical single-renderer workloads; frame intervals describe browser delivery, not GPU time. */
export function mountTreeBenchmark(
  LayerClass: TreeLayerConstructor,
  renderer: 'baseline' | 'native'
) {
  const query = new URLSearchParams(location.search);
  const count = Math.max(1, Math.min(10000, Number(query.get('count') ?? 1000)));
  const species = SPECIES.find(value => value === query.get('species')) ?? 'oak';
  const options: SceneOptions = {
    ...DEFAULT_OPTIONS,
    crops: query.get('crops') === '1',
    dropped: query.get('crops') === '1',
    shadows: query.get('shadows') === '1',
    wind: query.get('wind') === '1',
    windTime: null,
    detail:
      (['low', 'medium', 'high'] as const).find(detail => detail === query.get('detail')) ??
      DEFAULT_OPTIONS.detail,
    backend: query.get('backend') === 'webgpu' ? 'webgpu' : 'webgl'
  };
  if (options.backend === 'webgpu') options.shadows = false;
  const parent = document.querySelector('#app')!;
  parent.innerHTML = `<main class="tree-lab benchmark"><div class="eyebrow">Tree Lab / Performance</div><h1></h1><p></p><div class="canvas"></div><button id="measure" disabled>Measure 5-second camera orbit</button> <button id="repeat" disabled>Run three samples</button> <a href="./index.html">Visual comparison</a><pre id="result">Ready for measurement.</pre></main>`;
  parent.querySelector('h1')!.textContent =
    `${renderer === 'native' ? 'Native vis.gl' : 'Original Three.js'} · ${count.toLocaleString()} ${species} trees`;
  parent.querySelector('p')!.textContent =
    `${options.backend} · ${options.detail} detail · crops ${options.crops ? 'on' : 'off'} · shadows ${options.shadows ? 'on' : 'off'} · wind ${options.wind ? (renderer === 'native' ? 'on' : 'unsupported / static') : 'off'}`;
  let frame = 0;
  let ready = false;
  const errors: string[] = [];
  const firstStart = performance.now();
  let firstFrameMs: number | null = null;
  let device: Device;
  const data = createSpecimens(species, count);
  const zoom = count === 1 ? VIEW.zoom : Math.max(13, 20.5 - Math.log2(Math.sqrt(count)));
  const deck = new Deck({
    parent: parent.querySelector('.canvas')!,
    width: '100%',
    height: '100%',
    useDevicePixels: 1,
    deviceProps: {type: options.backend, adapters: [webgl2Adapter, webgpuAdapter]},
    views: createViews(),
    viewState: {...VIEW, zoom},
    layers: createSceneLayers(LayerClass, renderer, data, options),
    effects: [createLighting(options.shadows)],
    onDeviceInitialized: initializedDevice => {
      device = initializedDevice;
    },
    onAfterRender: () => {
      frame++;
      if (!ready) {
        ready = true;
        firstFrameMs = performance.now() - firstStart;
        if (!errors.length)
          for (const button of parent.querySelectorAll<HTMLButtonElement>('button'))
            button.disabled = false;
      }
    },
    onError: error => {
      errors.push(error.message);
      parent.querySelector('#result')!.textContent = errors.join('\n');
      for (const button of parent.querySelectorAll<HTMLButtonElement>('button'))
        button.disabled = true;
    }
  });
  let measuring = false;
  const measure = async (durationMs = 5000) => {
    if (!ready || measuring)
      throw new Error('Renderer is not ready or another measurement is running.');
    measuring = true;
    const idleStartFrame = frame;
    const idleStart = performance.now();
    await new Promise(resolve => setTimeout(resolve, 500));
    const idleRenderedFrames = frame - idleStartFrame;
    const idleDurationMs = performance.now() - idleStart;
    const gaps: number[] = [];
    const longTasks: {duration: number; startTime: number}[] = [];
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries())
        longTasks.push({duration: entry.duration, startTime: entry.startTime});
    });
    if (PerformanceObserver.supportedEntryTypes.includes('longtask'))
      observer.observe({type: 'longtask'});
    const start = performance.now();
    const startFrame = frame;
    let previous = start;
    await new Promise<void>(resolve => {
      const tick = (now: number) => {
        gaps.push(now - previous);
        previous = now;
        const elapsed = now - start;
        deck.setProps({viewState: {...VIEW, zoom, bearing: 22 + (elapsed / durationMs) * 90}});
        if (elapsed < durationMs) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    observer.disconnect();
    measuring = false;
    const sorted = [...gaps].sort((a, b) => a - b);
    const result = {
      renderer,
      species,
      count,
      options,
      backend: device.type,
      device: device.info,
      firstFrameMs,
      renderedFrames: frame - startFrame,
      idleRenderedFrames,
      idleDurationMs,
      viewport: {width: deck.width, height: deck.height, devicePixelRatio: 1},
      durationMs: performance.now() - start,
      medianFrameMs: sorted[Math.floor(sorted.length * 0.5)],
      p95FrameMs: sorted[Math.floor(sorted.length * 0.95)],
      maxFrameMs: sorted.at(-1),
      over33ms: gaps.filter(gap => gap > 33.3).length,
      longTaskCount: longTasks.length,
      longTaskMs: longTasks.reduce((sum, entry) => sum + entry.duration, 0),
      heapBytes:
        (performance as Performance & {memory?: {usedJSHeapSize: number}}).memory?.usedJSHeapSize ??
        null,
      userAgent: navigator.userAgent,
      navigation: performance.getEntriesByType('navigation')[0]?.toJSON(),
      resources: performance.getEntriesByType('resource').map(entry => entry.toJSON()),
      errors: [...errors]
    };
    parent.querySelector('#result')!.textContent = JSON.stringify(result, null, 2);
    return result;
  };
  parent.querySelector('#measure')!.addEventListener('click', () => {
    parent.querySelector('#result')!.textContent = 'Measuring…';
    void measure();
  });
  parent.querySelector('#repeat')!.addEventListener('click', async () => {
    const samples = [];
    for (const button of parent.querySelectorAll<HTMLButtonElement>('button'))
      button.disabled = true;
    for (let index = 0; index < 3; index++) {
      parent.querySelector('#result')!.textContent = `Measuring sample ${index + 1}/3…`;
      samples.push(await measure());
    }
    parent.querySelector('#result')!.textContent = JSON.stringify({samples}, null, 2);
    for (const button of parent.querySelectorAll<HTMLButtonElement>('button'))
      button.disabled = false;
  });
  Object.assign(window, {
    treeBenchmark: {
      get ready() {
        return ready;
      },
      get errors() {
        return [...errors];
      },
      measure,
      deck
    }
  });
}

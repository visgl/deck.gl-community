// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {Deck, CompositeLayer, type Layer} from '@deck.gl/core';
import type {Device} from '@luma.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {webgpuAdapter} from '@luma.gl/webgpu';
import {
  VIEW,
  DEFAULT_OPTIONS,
  SPECIES,
  SEASONS,
  createSpecimens,
  createSceneLayers,
  createLighting,
  createViews,
  type SceneOptions,
  type TreeLayerConstructor
} from './scene';
import {createForestSpecimens, getTreeCount} from './forest-data';
import {createForestSceneLayers, getForestViewState} from './forest-scene';
import './style.css';

/** Identical single-renderer workloads; frame intervals describe browser delivery, not GPU time. */
export function mountTreeBenchmark(
  LayerClass: TreeLayerConstructor,
  renderer: 'baseline' | 'native' | 'mesh'
) {
  const query = new URLSearchParams(location.search);
  const count = getTreeCount(query.get('count'));
  const availableSpecies = renderer === 'baseline' ? SPECIES.slice(0, 5) : SPECIES;
  const species =
    query.get('species') === 'mixed'
      ? 'mixed'
      : (availableSpecies.find(value => value === query.get('species')) ?? 'oak');
  const options: SceneOptions = {
    ...DEFAULT_OPTIONS,
    season: SEASONS.find(value => value === query.get('season')) ?? DEFAULT_OPTIONS.season,
    crops: query.get('crops') === '1',
    dropped: query.get('crops') === '1',
    shadows: query.get('shadows') === '1',
    wind: query.get('wind') === '1',
    windTime: null,
    backend: query.get('backend') === 'webgpu' ? 'webgpu' : 'webgl'
  };
  if (options.backend === 'webgpu') options.shadows = false;
  const parent = document.querySelector('#app')!;
  parent.innerHTML = `<main class="tree-lab benchmark"><div class="eyebrow">Tree Lab / Performance</div><h1></h1><p></p><div class="canvas"></div><button id="measure" disabled>Measure 5-second camera orbit</button> <button id="repeat" disabled>Run three samples</button> <a href="./index.html">Visual comparison</a> · <a href="./forest.html">10K / 20K forest</a><div id="summary" aria-live="polite">Ready for measurement.</div><details><summary>Raw measurements</summary><pre id="result">Ready for measurement.</pre></details></main>`;
  parent.querySelector('h1')!.textContent =
    `${renderer === 'native' ? 'Gaussian vis.gl' : renderer === 'mesh' ? 'Mesh vis.gl' : 'Original Three.js'} · ${count.toLocaleString()} ${species} trees`;
  parent.querySelector('p')!.textContent =
    `${options.backend} · ${options.season} · highest geometry detail · crops ${options.crops ? 'on' : 'off'} · shadows ${options.shadows ? 'on' : 'off'} · wind ${options.wind ? (renderer !== 'baseline' ? 'on' : 'unsupported / static') : 'off'}`;
  const summary = parent.querySelector<HTMLElement>('#summary')!;
  const showSamples = (
    samples: {
      medianFrameMs: number;
      p95FrameMs: number;
      deliveredFramesPerSecond: number;
      longTaskCount: number;
      renderCallP95Ms: number | null;
    }[]
  ) => {
    summary.replaceChildren();
    const table = document.createElement('table');
    table.innerHTML =
      '<thead><tr><th>Sample</th><th>Median frame</th><th>p95 frame</th><th>Draws/s</th><th>Draw call p95</th><th>Long tasks</th></tr></thead>';
    const body = document.createElement('tbody');
    for (const [index, sample] of samples.entries()) {
      const row = document.createElement('tr');
      for (const value of [
        index + 1,
        `${sample.medianFrameMs.toFixed(1)} ms`,
        `${sample.p95FrameMs.toFixed(1)} ms`,
        sample.deliveredFramesPerSecond.toFixed(1),
        sample.renderCallP95Ms === null ? '—' : `${sample.renderCallP95Ms.toFixed(1)} ms`,
        sample.longTaskCount
      ]) {
        const cell = document.createElement('td');
        cell.textContent = String(value);
        row.append(cell);
      }
      body.append(row);
    }
    table.append(body);
    summary.append(table);
  };
  let frame = 0;
  let ready = false;
  const errors: string[] = [];
  const firstStart = performance.now();
  let firstFrameMs: number | null = null;
  let device: Device;
  const data =
    species === 'mixed'
      ? createForestSpecimens(count, availableSpecies)
      : createSpecimens(species, count);
  const zoom = count === 1 ? VIEW.zoom : Math.max(13, 20.5 - Math.log2(Math.sqrt(count)));
  const view =
    species === 'mixed' ? (query.get('view') === 'overview' ? 'overview' : 'canopy') : 'grid';
  const {width, height} = parent.querySelector('.canvas')!.getBoundingClientRect();
  let camera =
    species === 'mixed'
      ? getForestViewState(count, width, height, view === 'overview')
      : {...VIEW, zoom};
  parent.querySelector('p')!.textContent += ` · ${view} view`;
  let measuring = false;
  let resizeRevision = 0;
  let drawStart = 0;
  const renderCalls: number[] = [];
  const deck = new Deck({
    parent: parent.querySelector('.canvas')!,
    width: '100%',
    height: '100%',
    useDevicePixels: 1,
    deviceProps: {type: options.backend, adapters: [webgl2Adapter, webgpuAdapter]},
    views: createViews(),
    viewState: camera,
    layers:
      species === 'mixed'
        ? createForestSceneLayers(
            LayerClass,
            renderer,
            data as ReturnType<typeof createForestSpecimens>,
            options
          )
        : createSceneLayers(LayerClass, renderer, data, options),
    effects: [createLighting(options.shadows)],
    onDeviceInitialized: initializedDevice => {
      device = initializedDevice;
    },
    onResize: ({width, height}) => {
      resizeRevision++;
      if (view === 'overview') {
        camera = getForestViewState(count, width, height, true);
        deck.setProps({viewState: camera});
      }
    },
    onBeforeRender: () => {
      if (measuring) drawStart = performance.now();
    },
    onAfterRender: () => {
      frame++;
      if (measuring) renderCalls.push(performance.now() - drawStart);
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
  const measure = async (durationMs = 5000) => {
    if (!ready || measuring || document.hidden)
      throw new Error(
        'Keep this benchmark visible; wait for readiness and any running measurement.'
      );
    measuring = true;
    const resizeAtStart = resizeRevision;
    const visibilityAtStart = document.visibilityState;
    const focusedAtStart = document.hasFocus();
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
    renderCalls.length = 0;
    const start = performance.now();
    const startFrame = frame;
    let previous = start;
    await new Promise<void>(resolve => {
      const tick = (now: number) => {
        gaps.push(now - previous);
        previous = now;
        const elapsed = now - start;
        deck.setProps({
          viewState: {...camera, bearing: (camera.bearing ?? 22) + (elapsed / durationMs) * 90}
        });
        if (elapsed < durationMs) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    observer.disconnect();
    measuring = false;
    if (resizeRevision !== resizeAtStart)
      throw new Error('Viewport resized during measurement. Rerun at one viewport size.');
    const sorted = [...gaps].sort((a, b) => a - b);
    const sortedRenderCalls = [...renderCalls].sort((a, b) => a - b);
    const result = {
      renderer,
      visibilityAtStart,
      focusedAtStart,
      visibilityAtEnd: document.visibilityState,
      camera,
      view,
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
      deliveredFramesPerSecond: ((frame - startFrame) * 1000) / (performance.now() - start),
      treeInstances: data.length,
      geometry: (() => {
        const leaves = (layer: Layer): Layer[] =>
          layer instanceof CompositeLayer ? layer.getSubLayers().flatMap(leaves) : [layer];
        return (deck.props.layers as Layer[]).flatMap(leaves).map(layer => ({
          id: layer.id,
          operation: layer.props.operation,
          owners: layer.getNumInstances(),
          gaussians: (layer.props as any).source?.opacities.length ?? 0,
          triangles: ((layer.getModels()[0]?.vertexCount ?? 0) / 3) * layer.getNumInstances()
        }));
      })(),
      renderCallMedianMs: sortedRenderCalls[Math.floor(sortedRenderCalls.length * 0.5)] ?? null,
      renderCallP95Ms: sortedRenderCalls[Math.floor(sortedRenderCalls.length * 0.95)] ?? null,
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
  const runSamples = async (count: number) => {
    const buttons = parent.querySelectorAll<HTMLButtonElement>('button');
    for (const button of buttons) button.disabled = true;
    try {
      const samples = [];
      let warmup;
      if (count > 1) {
        summary.textContent = 'Warming up…';
        warmup = await measure(2000);
      }
      for (let index = 0; index < count; index++) {
        summary.textContent = `Measuring sample ${index + 1}/${count}…`;
        parent.querySelector('#result')!.textContent = summary.textContent;
        samples.push(await measure());
      }
      parent.querySelector('#result')!.textContent = JSON.stringify({warmup, samples}, null, 2);
      showSamples(samples);
    } catch (error) {
      summary.textContent = error instanceof Error ? error.message : String(error);
      parent.querySelector('#result')!.textContent = summary.textContent;
    } finally {
      for (const button of buttons) button.disabled = !ready || errors.length > 0;
    }
  };
  parent.querySelector('#measure')!.addEventListener('click', () => void runSamples(1));
  parent.querySelector('#repeat')!.addEventListener('click', () => void runSamples(3));
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

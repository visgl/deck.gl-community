// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {Deck, type MapViewState} from '@deck.gl/core';
import {TreeLayer} from '@deck.gl-community/layers';
import {webgl2Adapter} from '@luma.gl/webgl';
import {createForestSpecimens, getTreeCount} from './forest-data';
import {DEFAULT_OPTIONS, SEASONS, createViews, createLighting, type SceneOptions} from './scene';
import {getTourFrame} from './tour';
import {createForestSceneLayers, getForestViewState} from './forest-scene';
import './style.css';

/** One native renderer with a procedural mixed forest, controllable quality and shared sunlight. */
export function mountTreeForestExample(container: HTMLElement, standalone = false): () => void {
  const query = new URLSearchParams(location.search);
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let count = getTreeCount(query.get('count'), 20000);
  let data = createForestSpecimens(count);
  const options: SceneOptions = {
    ...DEFAULT_OPTIONS,
    crops: false,
    dropped: false,
    shadows: query.get('shadows') !== '0',
    wind: query.get('wind') === '1' || (query.get('wind') !== '0' && !reducedMotion),
    windTime: null,
    detail:
      (['high', 'medium', 'low'] as const).find(value => value === query.get('detail')) ?? 'medium',
    season: SEASONS.find(value => value === query.get('season')) ?? 'summer'
  };
  let flyover = !reducedMotion && query.get('fly') !== '0';
  let sunlight = query.get('sun') !== '0' && !reducedMotion;
  let overview = query.get('view') === 'overview';
  let showStats = query.get('stats') !== '0';
  let request = 0;
  let ready = false;
  let disposed = false;
  const errors: string[] = [];
  const root = document.createElement('div');
  root.className = 'tree-lab tree-forest';
  root.innerHTML = `<header><div class="eyebrow">Native vis.gl / Forest scale</div><h1></h1><p>Five species. One shared forest. Explore the crowns, wind and seasonal shadows.</p></header>
    <div class="toolbar"><div class="seasons" role="group" aria-label="Tree count"><button data-count="10000">10K trees</button><button data-count="20000">20K trees</button></div>
    <label class="control">Detail <select aria-label="Detail"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
    <label class="control">Pitch <input type="range" aria-label="Pitch" min="0" max="80" step="1"><output id="forest-pitch"></output></label>
    <label class="control">Season <select aria-label="Season">${SEASONS.map(season => `<option value="${season}">${season}</option>`).join('')}</select></label>
    <label class="toggle"><input type="checkbox" aria-label="Wind">Wind</label><label class="toggle"><input type="checkbox" aria-label="Shadows">Shadows</label>
    <label class="toggle"><input type="checkbox" aria-label="Moving sunlight">Sun &amp; seasons</label><label class="toggle"><input type="checkbox" aria-label="Flyover">Flyover</label>
    <label class="toggle"><input type="checkbox" aria-label="Show performance">Stats</label><button id="forest-view">Show entire forest</button></div>
    <div class="forest-stage"><div class="canvas"></div><div class="forest-caption"><strong>20,000 trees in memory</strong><span>Procedural scene · drag to explore · 1× pixels</span><span id="forest-performance" title="Rolling draw count and draw intervals; not GPU execution time.">Measuring draws…</span></div></div>
    <div class="status" aria-live="polite">Preparing forest…</div><footer class="footer">${standalone ? '<a id="forest-benchmark" href="./native.html">Measure this workload</a> · <a href="./index.html">Compare every tree</a> · ' : ''}Overview fits the entire forest; flyover inspects individual crowns. WebGL shadows and GPU wind are independently controlled. This is illustrative data.</footer>`;
  container.replaceChildren(root);
  const heading = root.querySelector('h1')!;
  const status = root.querySelector('.status')!;
  const badge = root.querySelector('.forest-caption strong')!;
  const detailControl = root.querySelector<HTMLSelectElement>('[aria-label="Detail"]')!;
  const pitchControl = root.querySelector<HTMLInputElement>('[aria-label="Pitch"]')!;
  const pitchLabel = root.querySelector<HTMLOutputElement>('#forest-pitch')!;
  const seasonControl = root.querySelector<HTMLSelectElement>('[aria-label="Season"]')!;
  const windControl = root.querySelector<HTMLInputElement>('[aria-label="Wind"]')!;
  const shadowControl = root.querySelector<HTMLInputElement>('[aria-label="Shadows"]')!;
  const sunControl = root.querySelector<HTMLInputElement>('[aria-label="Moving sunlight"]')!;
  const flyControl = root.querySelector<HTMLInputElement>('[aria-label="Flyover"]')!;
  const viewControl = root.querySelector<HTMLButtonElement>('#forest-view')!;
  const statsControl = root.querySelector<HTMLInputElement>('[aria-label="Show performance"]')!;
  const performanceLabel = root.querySelector<HTMLElement>('#forest-performance')!;
  const drawTimes = new Float64Array(512);
  let drawIndex = 0;
  let drawCount = 0;
  let lastStats = 0;
  const lighting = createLighting(options.shadows);
  const getCamera = (fitOverview = overview): MapViewState => {
    const {width, height} = root.querySelector('.canvas')!.getBoundingClientRect();
    return getForestViewState(count, width, height, fitOverview);
  };
  let camera = getCamera();
  const getLayers = () =>
    createForestSceneLayers(TreeLayer, 'forest', data, {
      ...options,
      windTime: options.wind && !document.hidden ? null : 0
    });
  const refreshLabels = () => {
    heading.textContent = `${count.toLocaleString()} trees`;
    badge.textContent = `${data.length.toLocaleString()} trees · five species`;
    detailControl.value = options.detail;
    pitchControl.value = String(camera.pitch ?? 0);
    pitchLabel.value = `${Math.round(camera.pitch ?? 0)}°`;
    seasonControl.value = options.season;
    windControl.checked = options.wind;
    shadowControl.checked = options.shadows;
    sunControl.checked = sunlight;
    flyControl.checked = flyover;
    statsControl.checked = showStats;
    performanceLabel.hidden = !showStats;
    // The caption stylesheet sets display:block on spans, overriding HTML hidden.
    performanceLabel.style.display = showStats ? '' : 'none';
    viewControl.textContent = overview ? 'Inspect the canopy' : 'Show entire forest';
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-count]'))
      button.setAttribute('aria-pressed', String(Number(button.dataset.count) === count));
    status.textContent = `${ready ? 'Ready' : 'Preparing'} · ${count.toLocaleString()} trees · ${options.detail} · ${options.season} · wind ${options.wind ? 'on' : 'off'} · shadows ${options.shadows ? 'on' : 'off'}${errors.length ? ` · ${errors.join('; ')}` : ''}`;
    const benchmark = root.querySelector<HTMLAnchorElement>('#forest-benchmark');
    if (benchmark)
      benchmark.href = `./native.html?count=${count}&species=mixed&detail=${options.detail}&wind=${Number(options.wind)}&shadows=${Number(options.shadows)}&season=${options.season}&view=${overview ? 'overview' : 'canopy'}`;
  };
  const deck = new Deck({
    parent: root.querySelector('.canvas')!,
    width: '100%',
    height: '100%',
    useDevicePixels: 1,
    deviceProps: {type: 'webgl', adapters: [webgl2Adapter]},
    views: createViews(),
    viewState: camera,
    layers: getLayers(),
    effects: [lighting],
    onViewStateChange: ({viewState, interactionState}) => {
      camera = viewState as MapViewState;
      if (
        interactionState.isDragging ||
        interactionState.isPanning ||
        interactionState.isRotating ||
        interactionState.isZooming
      )
        flyover = false;
      deck.setProps({viewState: camera});
      refreshLabels();
    },
    onResize: () => {
      if (overview) {
        camera = getCamera();
        deck.setProps({viewState: camera});
      }
    },
    onAfterRender: () => {
      if (showStats) {
        drawTimes[drawIndex] = performance.now();
        drawIndex = (drawIndex + 1) % drawTimes.length;
        drawCount = Math.min(drawCount + 1, drawTimes.length);
      }
      if (!ready) {
        ready = true;
        refreshLabels();
      }
    },
    onError: error => {
      errors.push(error.message);
      refreshLabels();
    }
  });
  const refresh = () => {
    deck.setProps({layers: getLayers()});
    refreshLabels();
  };
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-count]'))
    button.addEventListener('click', () => {
      count = Number(button.dataset.count);
      data = createForestSpecimens(count);
      if (overview) {
        camera = getCamera();
        deck.setProps({viewState: camera});
      }
      refresh();
    });
  detailControl.addEventListener('change', () => {
    options.detail = detailControl.value as SceneOptions['detail'];
    refresh();
  });
  pitchControl.addEventListener('input', () => {
    flyover = false;
    camera = {...camera, pitch: Number(pitchControl.value)};
    deck.setProps({viewState: camera});
    refreshLabels();
  });
  seasonControl.addEventListener('change', () => {
    sunlight = false;
    options.season = seasonControl.value as SceneOptions['season'];
    refresh();
  });
  windControl.addEventListener('change', () => {
    options.wind = windControl.checked;
    refresh();
  });
  shadowControl.addEventListener('change', () => {
    options.shadows = shadowControl.checked;
    lighting.setProps(createLighting(options.shadows).props);
    deck.setProps({effects: [lighting]});
    deck.redraw('forest shadows');
    refreshLabels();
  });
  sunControl.addEventListener('change', () => {
    sunlight = sunControl.checked;
    refreshLabels();
  });
  flyControl.addEventListener('change', () => {
    flyover = flyControl.checked;
    refreshLabels();
  });
  viewControl.addEventListener('click', () => {
    overview = !overview;
    camera = getCamera();
    deck.setProps({viewState: camera});
    refreshLabels();
  });
  statsControl.addEventListener('change', () => {
    showStats = statsControl.checked;
    drawCount = 0;
    lastStats = 0;
    refreshLabels();
  });
  document.addEventListener('visibilitychange', refresh);
  const start = performance.now();
  const tick = (now: number) => {
    if (disposed) return;
    if (!document.hidden) {
      const seconds = (now - start) / 1000;
      if (showStats && now - lastStats >= 1000) {
        lastStats = now;
        const sampleTime = performance.now();
        const gaps: number[] = [];
        let previous = 0;
        let recentDraws = 0;
        for (let index = 0; index < drawCount; index++) {
          const time =
            drawTimes[(drawIndex - drawCount + index + drawTimes.length) % drawTimes.length];
          if (sampleTime - time > 1000) continue;
          if (previous) gaps.push(time - previous);
          previous = time;
          recentDraws++;
        }
        gaps.sort((a, b) => a - b);
        performanceLabel.textContent = gaps.length
          ? `${recentDraws} draws/s · p95 ${gaps[Math.floor(gaps.length * 0.95)].toFixed(1)} ms`
          : 'Idle';
      }
      if (sunlight) {
        const frame = getTourFrame(seconds);
        if (options.season !== frame.season) {
          options.season = frame.season;
          refresh();
        }
        lighting.setSunDirection(frame.direction);
        deck.redraw('forest sunlight');
      }
      if (flyover) {
        const phase = seconds / 35;
        const next = {
          ...camera,
          bearing: (overview ? 0 : 22) + Math.sin(phase) * (overview ? 8 : 24)
        };
        if (!overview) {
          next.longitude = Math.sin(phase * 0.7) * 0.00065;
          next.latitude = Math.cos(phase * 0.7) * 0.00065;
        }
        deck.setProps({viewState: next});
      }
    }
    request = requestAnimationFrame(tick);
  };
  request = requestAnimationFrame(tick);
  refreshLabels();
  const api = {
    get ready() {
      return ready;
    },
    get errors() {
      return [...errors];
    },
    get count() {
      return data.length;
    },
    deck
  };
  Object.assign(window, {treeForest: api});
  return () => {
    disposed = true;
    cancelAnimationFrame(request);
    document.removeEventListener('visibilitychange', refresh);
    deck.finalize();
    root.remove();
    const reviewWindow = window as Window & {treeForest?: typeof api};
    if (reviewWindow.treeForest === api) delete reviewWindow.treeForest;
  };
}

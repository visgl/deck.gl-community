// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {Deck, MapView, type MapViewState} from '@deck.gl/core';
import {TreeLayer} from '@deck.gl-community/layers';
import {webgl2Adapter} from '@luma.gl/webgl';
import {createLighting, DEFAULT_OPTIONS, SEASONS, type SceneOptions} from './scene';
import {
  getSyntheticWorldTile,
  getWorldSourceSettings,
  WORLD_LEAF_ZOOM,
  WORLD_TREE_COUNT,
  type WorldSourceOptions,
  type WorldSpecimen
} from './world-source';
import {createTreeProfiler} from './tree-profiler';
import './style.css';

/** Synthetic global address space, bounded tile residency and batched native tree rendering. */
export function mountTreeWorldExample(
  container: HTMLElement,
  {forestHref = './forest.html', comparisonHref = './index.html', scroll = false} = {}
): () => void {
  const query = new URLSearchParams(location.search);
  const getQueryNumber = (key: string, fallback: number) => {
    const value = Number(query.get(key) ?? fallback);
    return Number.isFinite(value) ? value : fallback;
  };
  const profiler = query.get('profileCpu') === '1' ? createTreeProfiler() : null;
  let drawStart = 0;
  const renderCalls: number[] = [];
  const sourceOptions: WorldSourceOptions = {
    count: Math.round(
      Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, getQueryNumber('count', WORLD_TREE_COUNT)))
    ),
    density: Math.max(0, Math.min(800, getQueryNumber('density', 400))),
    profile: query.get('profile') === 'mixed' ? 'mixed' : 'rainforest'
  };
  let sourceRevision = 0,
    densityTimer = 0;
  const options: SceneOptions = {
    ...DEFAULT_OPTIONS,
    crops: false,
    dropped: false,
    windTime: null,
    wind: query.get('wind') !== '0',
    shadows: query.get('shadows') !== '0',
    season: SEASONS.find(season => season === query.get('season')) ?? 'summer'
  };
  let camera: MapViewState = {
    longitude: getQueryNumber('longitude', 0.00055),
    latitude: getQueryNumber('latitude', 0.00055),
    zoom: getQueryNumber('zoom', 18),
    position: [0, 0, getQueryNumber('target', sourceOptions.profile === 'rainforest' ? 42 : 12)],
    pitch: getQueryNumber('pitch', 70),
    bearing: getQueryNumber('bearing', 20),
    minZoom: 0,
    maxZoom: 23,
    maxPitch: 80
  };
  let ready = false,
    disposed = false,
    request = 0,
    lastStats = 0;
  let lastFrame = 0;
  let lastLoaded = false;
  const intervals: number[] = [],
    measured: number[] = [];
  let measuring = false,
    measuredDraws = 0,
    measureStart = 0,
    measureCamera = camera;
  let measureSourceRevision = 0,
    measureWidth = 0,
    measureHeight = 0;
  const root = document.createElement('div');
  root.className = 'tree-lab tree-forest tree-world';
  if (scroll) Object.assign(root.style, {height: '100%', overflow: 'auto'});
  root.innerHTML = `<header><div class="eyebrow">Native vis.gl / Streaming world</div><h1>A forest without an edge</h1><p><span id="world-capacity">3.04 trillion</span> synthetic tree positions. Individual crowns refine continuously through the forest.</p></header>
    <div class="toolbar"><div class="seasons" role="group" aria-label="World scale"><button data-zoom="1">World</button><button data-zoom="10">Region</button><button data-zoom="19">Forest</button><button data-zoom="21">Crowns</button></div>
    <label class="control">Count <input type="number" aria-label="Global tree count in trillions" min="0.1" max="10" step="0.01" value="${(sourceOptions.count ?? WORLD_TREE_COUNT) / 1e12}" style="width:72px"> trillion</label>
    <label class="control">Density <input type="range" aria-label="Forest density" min="20" max="800" step="10" value="${sourceOptions.density}"><output id="density-value">${sourceOptions.density} trees/ha</output></label>
    <label class="control">Forest <select aria-label="Forest structure"><option value="rainforest">Rainforest</option><option value="mixed">Mixed suite</option></select></label>
    <label class="control">Pitch <input type="range" aria-label="Pitch" min="0" max="80" value="${camera.pitch}"><output>${camera.pitch}°</output></label>
    <label class="control">Season <select aria-label="Season">${SEASONS.map(season => `<option value="${season}">${season}</option>`).join('')}</select></label>
    <label class="toggle"><input type="checkbox" aria-label="Wind">Wind</label><label class="toggle"><input type="checkbox" aria-label="Shadows">Shadows</label><button id="world-measure">Measure moving view</button></div>
    <div class="forest-stage"><div class="canvas"></div><div class="forest-caption"><strong id="world-residency">Loading the forest…</strong><span id="world-work">Waiting for crowns…</span><span id="world-frame">Measuring draws…</span></div></div>
    <div class="status" aria-live="polite">Preparing source…</div><details><summary>Measurements</summary><pre id="world-results">Measure the current scale to capture raw frame intervals and residency.</pre></details>
    <footer class="footer"><a data-world-link="forest">20K forest</a> · <a data-world-link="comparison">Species comparison</a> · Synthetic capacity of <span id="world-total-count">${(sourceOptions.count ?? WORLD_TREE_COUNT).toLocaleString()}</span> records; this is not a real global inventory. Rainforest structure uses synthetic broadleaf forms, inspired by closed tropical canopies; it is not Jaú inventory or species data. Web Mercator does not cover the poles.</footer>`;
  container.replaceChildren(root);
  root.querySelector<HTMLAnchorElement>('[data-world-link="forest"]')!.href = forestHref;
  root.querySelector<HTMLAnchorElement>('[data-world-link="comparison"]')!.href = comparisonHref;
  const stage = root.querySelector<HTMLDivElement>('.canvas')!;
  stage.style.background = '#f3f4f2';
  const status = root.querySelector('.status')!;
  const pitch = root.querySelector<HTMLInputElement>('[aria-label="Pitch"]')!;
  const season = root.querySelector<HTMLSelectElement>('[aria-label="Season"]')!;
  const wind = root.querySelector<HTMLInputElement>('[aria-label="Wind"]')!;
  const shadows = root.querySelector<HTMLInputElement>('[aria-label="Shadows"]')!;
  const button = root.querySelector<HTMLButtonElement>('#world-measure')!;
  let lighting = createLighting(options.shadows);
  const getLayers = () => {
    return [
      new TreeLayer<WorldSpecimen>({
        id: 'world-trees',
        getTileData: tile => getSyntheticWorldTile(tile, sourceOptions),
        getTreeKey: tree => tree.key,
        transitionDuration: 1000,
        zoomOffset: 1,
        minZoom: 0,
        maxZoom: WORLD_LEAF_ZOOM,
        maxVisibleTiles: 32,
        maxCacheSize: 64,
        maxCacheByteSize: 32 * 1024 * 1024,
        maxTileRecords: 1024,
        maxTileByteLength: 1024 * 1024,
        maxCanopySplats: 400000,
        maxCanopyPixels: 4194304,
        foveationStrength: 1,
        maxShadowSplats: 100000,
        pickable: true,
        getDistantCanopyColor: canopy => {
          const tint =
            sourceOptions.profile === 'rainforest'
              ? [1, 1, 1]
              : options.season === 'spring'
                ? [1.18, 1.2, 1.08]
                : options.season === 'autumn'
                  ? [1.75, 0.95, 0.65]
                  : options.season === 'winter'
                    ? [0.85, 0.78, 0.77]
                    : [1, 1, 1];
          return [
            canopy.color[0] * tint[0],
            canopy.color[1] * tint[1],
            canopy.color[2] * tint[2],
            canopy.color[3] ?? 255
          ];
        },
        characteristics:
          sourceOptions.profile === 'rainforest'
            ? {leafDensity: 2, leafSize: 1.5, crownAsymmetry: 1.4, crownDepth: 0.85}
            : {},
        getTree: tree => ({
          position: tree.position,
          species: tree.species,
          height: tree.height,
          crownRadius:
            tree.canopyRadius / (tree.species === 'pine' || tree.species === 'palm' ? 1 : 2),
          trunkRadius: tree.trunkRadius,
          trunkHeightFraction: tree.trunkFraction,
          branchLevels: 4
        }),
        getCanopyColor: tree => (sourceOptions.profile === 'rainforest' ? tree.shade : null),
        getSeason: () => (sourceOptions.profile === 'rainforest' ? 'summer' : options.season),
        shadowEnabled: options.shadows,
        windStrength: options.wind ? 0.025 : 0,
        windTime: null,
        updateTriggers: {
          getDistantCanopyColor: options.season,
          getTileData: sourceRevision,
          getSeason: [options.season, sourceOptions.profile],
          getCanopyColor: [options.season, sourceOptions.profile]
        }
      })
    ];
  };
  let currentStats: Record<string, number> = {};
  let lastCameraUrl = 0,
    cameraUrlTimer = 0;
  const writeCamera = () => {
    cameraUrlTimer = 0;
    lastCameraUrl = performance.now();
    const params = new URLSearchParams(location.search);
    for (const key of ['longitude', 'latitude', 'zoom', 'pitch', 'bearing'] as const)
      params.set(key, String(camera[key]));
    params.set('target', String(camera.position?.[2] ?? 0));
    params.set('wind', options.wind ? '1' : '0');
    params.set('shadows', options.shadows ? '1' : '0');
    params.set('season', options.season);
    history.replaceState(null, '', `${location.pathname}?${params}`);
  };
  const saveCamera = () => {
    clearTimeout(cameraUrlTimer);
    const delay = Math.max(0, 250 - (performance.now() - lastCameraUrl));
    if (delay) cameraUrlTimer = window.setTimeout(writeCamera, delay);
    else writeCamera();
  };
  const interruptMeasurement = (message: string) => {
    if (!measuring) return;
    measuring = false;
    button.disabled = false;
    root.querySelector('#world-results')!.textContent = message;
  };
  const deck = new Deck({
    parent: stage,
    width: '100%',
    height: '100%',
    useDevicePixels: 1,
    deviceProps: {type: 'webgl', adapters: [webgl2Adapter]},
    views: new MapView({controller: true, farZMultiplier: 10}),
    viewState: camera,
    layers: getLayers(),
    effects: [lighting],
    onViewStateChange: ({viewState}) => {
      interruptMeasurement('Camera changed during measurement. Rerun at one configuration.');
      camera = viewState as MapViewState;
      saveCamera();
      deck.setProps({viewState: camera});
    },
    onBeforeRender: () => {
      if (measuring) drawStart = performance.now();
    },
    onAfterRender: () => {
      if (measuring) renderCalls.push(performance.now() - drawStart);
      ready = true;
      const now = performance.now();
      if (lastFrame && document.visibilityState === 'visible') {
        intervals.push(now - lastFrame);
        if (intervals.length > 180) intervals.shift();
      }
      if (measuring) {
        measuredDraws++;
        if (lastFrame) measured.push(now - lastFrame);
      }
      lastFrame = now;
      const world = deck.props.layers[0] as TreeLayer<WorldSpecimen>;
      if (now - lastStats < 250 && world.isLoaded === lastLoaded) return;
      lastStats = now;
      lastLoaded = world.isLoaded;
      currentStats = world.streamingStats as unknown as Record<string, number>;
      const canopy = currentStats.canopySplats,
        shadow = currentStats.shadowSplats;
      root.querySelector('#world-residency')!.textContent =
        `${currentStats.residentTrees.toLocaleString()} individual rows · ${(currentStats.decodedBytes / 1048576).toFixed(2)} MiB decoded`;
      root.querySelector('#world-work')!.textContent =
        `${currentStats.visibleTrees} visible trees · ${currentStats.distantCrowns} distant crown groups · ${canopy.toLocaleString()} canopy / ${shadow.toLocaleString()} shadow splats`;
      const sorted = [...intervals].sort((a, b) => a - b);
      root.querySelector('#world-frame')!.textContent = sorted.length
        ? `${(1000 / sorted[Math.floor(sorted.length / 2)]).toFixed(1)} draws/s · p95 ${sorted[Math.floor(sorted.length * 0.95)].toFixed(1)} ms · zoom ${camera.zoom.toFixed(1)}`
        : 'Warming up…';
      status.textContent = `${world?.isLoaded ? 'Ready' : 'Streaming'} · foveated trees · ${options.season} · ${options.wind ? 'wind on' : 'wind off'} · ${options.shadows ? 'shadows on' : 'shadows off'}`;
    },
    onError: error => {
      status.textContent = error.message;
    }
  });
  const refresh = () => {
    interruptMeasurement('Render settings changed during measurement. Rerun at one configuration.');
    deck.setProps({layers: getLayers()});
    saveCamera();
  };
  const density = root.querySelector<HTMLInputElement>('[aria-label="Forest density"]')!;
  const count = root.querySelector<HTMLInputElement>(
    '[aria-label="Global tree count in trillions"]'
  )!;
  const structure = root.querySelector<HTMLSelectElement>('[aria-label="Forest structure"]')!;
  structure.value = sourceOptions.profile!;
  root.querySelector('#world-capacity')!.textContent =
    `${((sourceOptions.count ?? WORLD_TREE_COUNT) / 1e12).toFixed(2)} trillion`;
  const updateSource = () => {
    sourceOptions.count = Math.round(
      Math.max(0.1, Math.min(10, Number(count.value) || 3.04)) * 1e12
    );
    sourceOptions.density = Number(density.value);
    sourceOptions.profile = structure.value as 'mixed' | 'rainforest';
    sourceRevision++;
    const params = new URLSearchParams(location.search);
    params.set('count', String(sourceOptions.count));
    params.set('density', String(sourceOptions.density));
    params.set('profile', sourceOptions.profile);
    history.replaceState(null, '', `${location.pathname}?${params}`);
    root.querySelector('#world-total-count')!.textContent = sourceOptions.count.toLocaleString();
    root.querySelector('#world-capacity')!.textContent =
      `${(sourceOptions.count / 1e12).toFixed(2)} trillion`;
    refresh();
  };
  density.oninput = () => {
    root.querySelector<HTMLOutputElement>('#density-value')!.value = `${density.value} trees/ha`;
    clearTimeout(densityTimer);
    densityTimer = window.setTimeout(updateSource, 180);
  };
  count.onchange = updateSource;
  structure.onchange = updateSource;
  wind.checked = options.wind;
  shadows.checked = options.shadows;
  season.value = options.season;
  wind.onchange = () => {
    options.wind = wind.checked;
    refresh();
  };
  shadows.onchange = () => {
    options.shadows = shadows.checked;
    lighting = createLighting(options.shadows);
    deck.setProps({effects: [lighting]});
    refresh();
  };
  season.onchange = () => {
    options.season = season.value as SceneOptions['season'];
    refresh();
  };
  pitch.oninput = () => {
    interruptMeasurement('Camera changed during measurement. Rerun at one configuration.');
    camera = {...camera, pitch: Number(pitch.value)};
    root
      .querySelector<HTMLLabelElement>('[aria-label="Pitch"]')!
      .parentElement!.querySelector('output')!.value = `${pitch.value}°`;
    deck.setProps({viewState: camera});
    saveCamera();
  };
  for (const zoom of root.querySelectorAll<HTMLButtonElement>('[data-zoom]'))
    zoom.onclick = () => {
      interruptMeasurement('Camera changed during measurement. Rerun at one configuration.');
      camera = {
        ...camera,
        zoom: Number(zoom.dataset.zoom),
        pitch: Number(zoom.dataset.zoom) < 10 ? 0 : 60
      };
      pitch.value = String(camera.pitch);
      root
        .querySelector<HTMLLabelElement>('[aria-label="Pitch"]')!
        .parentElement!.querySelector('output')!.value = `${camera.pitch}°`;
      deck.setProps({viewState: camera});
      saveCamera();
    };
  button.onclick = () => {
    if (!ready || measuring || document.visibilityState !== 'visible') return;
    measuring = true;
    lastFrame = 0;
    measured.length = 0;
    measuredDraws = 0;
    renderCalls.length = 0;
    profiler?.reset();
    measureStart = performance.now();
    measureCamera = {...camera};
    measureSourceRevision = sourceRevision;
    measureWidth = stage.clientWidth;
    measureHeight = stage.clientHeight;
    button.disabled = true;
  };
  const onVisibilityChange = () => {
    lastFrame = 0;
    intervals.length = 0;
    if (measuring && document.visibilityState !== 'visible') {
      interruptMeasurement(
        'Visibility changed during measurement. Keep the page visible and rerun.'
      );
    }
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  const tick = (now: number) => {
    if (disposed) return;
    if (measuring) {
      const t = (now - measureStart) / 5000;
      const radius = 0.00036 * 2 ** (18 - measureCamera.zoom);
      camera = {
        ...measureCamera,
        longitude: measureCamera.longitude + (Math.cos(t * Math.PI * 2) - 1) * radius,
        latitude: measureCamera.latitude + Math.sin(t * Math.PI * 2) * radius,
        bearing: (measureCamera.bearing ?? 0) + t * 90
      };
      deck.setProps({viewState: camera});
      if (t >= 1) {
        measuring = false;
        button.disabled = false;
        saveCamera();
        const sorted = [...measured].sort((a, b) => a - b);
        if (
          sourceRevision !== measureSourceRevision ||
          stage.clientWidth !== measureWidth ||
          stage.clientHeight !== measureHeight
        ) {
          root.querySelector('#world-results')!.textContent =
            'Source or viewport changed during measurement. Rerun at one configuration.';
        } else
          root.querySelector('#world-results')!.textContent = JSON.stringify(
            {
              source: 'synthetic',
              renderSettings: {
                wind: options.wind,
                shadows: options.shadows,
                season: options.season
              },
              cpuProfile: profiler?.read(),
              renderCallMedianMs: [...renderCalls].sort((a, b) => a - b)[
                Math.floor(renderCalls.length * 0.5)
              ],
              renderCallP95Ms: [...renderCalls].sort((a, b) => a - b)[
                Math.floor(renderCalls.length * 0.95)
              ],
              sourceCapacity: getWorldSourceSettings(sourceOptions).count,
              sourceSettings: getWorldSourceSettings(sourceOptions),
              camera: measureCamera,
              viewport: {width: stage.clientWidth, height: stage.clientHeight, pixelRatio: 1},
              durationMs: now - measureStart,
              draws: measuredDraws,
              drawsPerSecond: measuredDraws / ((now - measureStart) / 1000),
              medianMs: sorted[Math.floor(sorted.length / 2)],
              p95Ms: sorted[Math.floor(sorted.length * 0.95)],
              maxMs: sorted.at(-1),
              framesOver33ms: measured.filter(ms => ms > 33).length,
              stats: currentStats,
              intervals: measured
            },
            null,
            2
          );
      }
    }
    request = requestAnimationFrame(tick);
  };
  request = requestAnimationFrame(tick);
  return () => {
    disposed = true;
    cancelAnimationFrame(request);
    clearTimeout(densityTimer);
    clearTimeout(cameraUrlTimer);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    profiler?.dispose();
    deck.finalize();
    container.replaceChildren();
  };
}

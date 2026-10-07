// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {Deck, type MapViewState, type MapView} from '@deck.gl/core';
import {TreeLayer} from '@deck.gl-community/layers';
import {ReferenceMeshTreeLayer} from './baseline/reference-mesh-tree-layer';
import {webgl2Adapter} from '@luma.gl/webgl';
import {webgpuAdapter} from '@luma.gl/webgpu';
import {
  SPECIES,
  SEASONS,
  VIEW,
  DEFAULT_OPTIONS,
  createSpecimens,
  createSceneLayers,
  createLighting,
  createViews,
  type SceneOptions,
  type TreeLayerConstructor
} from './scene';
import {getTourFrame} from './tour';
import './style.css';

const DESCRIPTIONS = {
  pine: 'Layered evergreen crown · tier shading',
  oak: 'Lobed crown · exposed winter branches',
  palm: 'Feathered fronds · ribbed shaft · hanging crop clusters',
  birch: 'Narrow crown · pale trunk · branching winter silhouette',
  cherry: 'Blossom color · space-grown crown · winter branches',
  banyan: 'Spreading evergreen crown · connected aerial root pillars',
  mangrove: 'Large elliptical leaves · connected stilt roots',
  citrus: 'Rounded evergreen crown · shoot-attached citrus fruit'
};

/** Interactive visual review of every species with shared controls and synchronized cameras. */
export function mountTreeLabExample(
  container: HTMLElement,
  hostOptions: {scroll?: boolean; benchmarkLinks?: boolean; species?: typeof SPECIES} = {}
): () => void {
  const speciesList = hostOptions.species ?? SPECIES;
  let options: SceneOptions = {...DEFAULT_OPTIONS, pixelRatio: 2};
  const query = new URLSearchParams(location.search);
  options.season = SEASONS.find(season => season === query.get('season')) ?? DEFAULT_OPTIONS.season;
  if (query.get('shadows') === '1') options.shadows = true;
  if (query.get('backend') === 'webgpu') {
    options.backend = 'webgpu';
    options.shadows = false;
  }
  let autoTour =
    query.get('auto') !== '0' && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  let sunAngle = 0;
  let tourStart = performance.now();
  let tourRequest = 0;
  if (autoTour) {
    options.wind = true;
    options.windTime = null;
    options.shadows = options.backend === 'webgl';
  }
  const root = document.createElement('div');
  root.className = 'tree-lab';
  if (hostOptions.scroll) {
    root.style.height = '100%';
    root.style.overflow = 'auto';
  }
  root.innerHTML = `
    <header><div class="eyebrow">vis.gl / Tree Lab</div><h1>A forest, one tree at a time.</h1><p>${speciesList.length === SPECIES.length ? 'Eight species.' : 'Matched specimens.'} Organic branching, native wood and Gaussian foliage. Same tree dimensions, camera, light, and supplied crops.</p></header>
    <div class="toolbar"><div class="seasons" role="group" aria-label="Season">${SEASONS.map(season => `<button data-season="${season}" aria-pressed="false">${season[0].toUpperCase() + season.slice(1)}</button>`).join('')}</div>
    ${[
      ['crops', 'Attached crops'],
      ['dropped', 'Dropped crops'],
      ['shadows', 'Shadows'],
      ['wind', 'Wind']
    ]
      .map(
        ([key, label]) =>
          `<label class="toggle"><input type="checkbox" data-option="${key}">${label}</label>`
      )
      .join('')}
    <label class="toggle"><input id="auto-tour" type="checkbox">Auto tour</label><label class="control">Sun angle <input id="sun-angle" type="range" min="0" max="360" step="1" value="0"></label>${hostOptions.benchmarkLinks !== false ? '<a class="film-link" href="./citrus.html">Citrus characteristics lab</a> · <a class="film-link" href="./film.html">Watch / record the film</a> · <a class="film-link" href="./forest.html">Explore 10K / 20K trees</a>' : ''}
    <button id="wind-clock" disabled>Pause wind</button><label class="control">Wind time <input id="wind-time" type="range" min="0" max="10" step="0.1" value="0" disabled></label>
    <label class="control">Resolution <select data-option="pixelRatio"><option value="1">1× / fast</option><option value="2">2× / sharp</option></select></label>
    <label class="control">View <select id="camera"><option value="58">Three-quarter</option><option value="0">Aerial</option><option value="75">Low angle</option></select></label></div>
    <div class="status" aria-live="polite"></div><main class="board">${speciesList.map(species => `<section class="row" data-species="${species}"><div class="row-title"><h2>${species[0].toUpperCase() + species.slice(1)}</h2><span class="caption">${DESCRIPTIONS[species]}</span></div><div class="pair">${['baseline', 'native'].map(renderer => `<div class="specimen ${renderer}"><div class="canvas" data-renderer="${renderer}" data-species="${species}"><div class="loading">Preparing specimen…</div></div><span class="label">${renderer === 'baseline' ? 'Mesh / vis.gl' : 'Gaussian / vis.gl'}</span><span class="badge">${renderer === 'baseline' ? (species === 'banyan' || species === 'mangrove' || species === 'citrus' ? 'Leaf-card mesh · shared growth' : 'Frozen mesh reference') : 'Anisotropic leaves · GPU wind'}</span></div>`).join('')}</div></section>`).join('')}</main>
    <footer class="footer">Drag either specimen to inspect both cameras. Crops are illustrative and explicitly supplied; seasons do not invent yield.<br>The frozen mesh reference and Gaussian renderer share wind, crop inputs and dimensions. Gaussian foliage bends its centres and covariance together. Shadows use deck.gl’s WebGL shadow maps.<br>${hostOptions.benchmarkLinks !== false ? 'Performance runs use one renderer at a time: <a href="./baseline.html">Original Three.js benchmark</a> · <a href="./native.html">Native benchmark</a>.' : 'Run the standalone Tree Lab workspace for isolated performance measurements.'}</footer>`;
  container.replaceChildren(root);
  const decks: {
    deck: Deck<MapView>;
    lighting: ReturnType<typeof createLighting>;
    renderer: string;
    species: (typeof SPECIES)[number];
    element: HTMLDivElement;
    LayerClass: TreeLayerConstructor;
    rendered: number;
    onScreen: boolean;
    data: ReturnType<typeof createSpecimens>;
  }[] = [];
  let disposed = false;
  let camera: MapViewState = {...VIEW};
  let ready = 0;
  const errors: string[] = [];
  const refreshStatus = () => {
    root.querySelector('.status')!.textContent =
      `${options.backend.toUpperCase()} · ${options.season} · ${options.shadows ? 'shadows on' : 'shadows off'} · ${options.wind ? 'matched GPU wind on' : 'wind off'} · ${ready}/${speciesList.length * 2} specimens ready${errors.length ? ` · ${errors.length} rendering errors` : ''}`;
  };
  const syncCamera = (view: MapViewState) => {
    camera = view;
    for (const item of decks) item.deck.setProps({viewState: camera});
  };
  const getSpecimenOptions = (item: (typeof decks)[number]): SceneOptions => ({
    ...options,
    windTime: options.windTime ?? (item.onScreen && !document.hidden ? null : 0)
  });
  const refreshSpecimen = (item: (typeof decks)[number]) => {
    item.lighting.setProps(createLighting(options.shadows).props);
    item.lighting.setSunDirection(getTourFrame((sunAngle / 360) * 32).direction);
    item.deck.setProps({
      useDevicePixels: options.pixelRatio,
      layers: createSceneLayers(
        item.LayerClass,
        item.renderer,
        item.data,
        getSpecimenOptions(item)
      ),
      effects: [item.lighting]
    });
  };
  const visibilityObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const item = decks.find(value => value.element === entry.target);
      if (item && item.onScreen !== entry.isIntersecting) {
        item.onScreen = entry.isIntersecting;
        if (options.wind && options.windTime === null) refreshSpecimen(item);
      }
    }
  });
  const refreshVisibility = () => {
    if (options.wind && options.windTime === null) for (const item of decks) refreshSpecimen(item);
  };
  document.addEventListener('visibilitychange', refreshVisibility);
  const refresh = () => {
    root.querySelector<HTMLInputElement>('#auto-tour')!.checked = autoTour;
    root.querySelector<HTMLInputElement>('#sun-angle')!.value = String(Math.round(sunAngle));
    for (const season of root.querySelectorAll<HTMLButtonElement>('[data-season]'))
      season.setAttribute('aria-pressed', String(season.dataset.season === options.season));
    for (const control of root.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      '[data-option]'
    )) {
      const key = control.dataset.option as keyof SceneOptions;
      if (control instanceof HTMLInputElement) control.checked = Boolean(options[key]);
      else control.value = String(options[key]);
      if (key === 'shadows') control.disabled = options.backend === 'webgpu';
    }
    root.querySelector<HTMLButtonElement>('#wind-clock')!.disabled = !options.wind;
    root.querySelector<HTMLButtonElement>('#wind-clock')!.textContent =
      options.windTime === null ? 'Pause wind' : 'Play wind';
    root.querySelector<HTMLInputElement>('#wind-time')!.disabled = !options.wind;
    for (const item of decks) refreshSpecimen(item);
    refreshStatus();
  };
  root.addEventListener('click', event => {
    if ((event.target as HTMLElement).id === 'wind-clock') {
      if (options.windTime === null) {
        const specimen = decks.find(item => item.onScreen) ?? decks[0];
        options.windTime = (specimen?.deck.layerManager?.context.timeline.getTime() ?? 0) / 1000;
        const slider = root.querySelector<HTMLInputElement>('#wind-time')!;
        slider.max = String(Math.max(10, Math.ceil(options.windTime)));
        slider.value = String(options.windTime);
      } else options.windTime = null;
      refresh();
      return;
    }
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-season]');
    if (button) {
      autoTour = false;
      options.season = button.dataset.season as SceneOptions['season'];
      refresh();
    }
  });
  root.addEventListener('change', event => {
    const control = event.target as HTMLInputElement;
    if (control.id === 'auto-tour') {
      autoTour = control.checked;
      tourStart = performance.now();
      refresh();
      return;
    }
    if (control.id === 'sun-angle') {
      autoTour = false;
      sunAngle = Number(control.value);
      refresh();
      return;
    }
    if (control.id === 'wind-time') {
      autoTour = false;
      options.windTime = Number(control.value);
      refresh();
      return;
    }
    if (control.id === 'camera') {
      syncCamera({...camera, pitch: Number(control.value)});
      return;
    }
    const key = control.dataset.option as keyof SceneOptions;
    if (!key) return;
    Object.assign(options, {[key]: control.type === 'checkbox' ? control.checked : control.value});
    if (key === 'pixelRatio') options.pixelRatio = Number(control.value);
    if (key === 'wind') options.windTime = options.wind ? null : 0;
    refresh();
  });
  const mount = async () => {
    const ReferenceLayer = ReferenceMeshTreeLayer;
    if (disposed) return;
    for (const element of root.querySelectorAll<HTMLDivElement>('.canvas')) {
      const species = element.dataset.species as (typeof SPECIES)[number];
      const renderer = element.dataset.renderer!;
      const LayerClass = renderer === 'native' ? TreeLayer : ReferenceLayer;
      element.replaceChildren();
      let firstFrame = true;
      const item = {
        renderer,
        species,
        element,
        LayerClass,
        lighting: createLighting(options.shadows),
        rendered: 0,
        onScreen:
          element.getBoundingClientRect().top < window.innerHeight &&
          element.getBoundingClientRect().bottom > 0,
        data: createSpecimens(species),
        deck: undefined as unknown as Deck<MapView>
      };
      item.deck = new Deck({
        parent: element,
        width: '100%',
        height: '100%',
        useDevicePixels: options.pixelRatio,
        deviceProps: {type: options.backend, adapters: [webgl2Adapter, webgpuAdapter]},
        views: createViews(),
        viewState: camera,
        layers: createSceneLayers(LayerClass, renderer, item.data, getSpecimenOptions(item)),
        effects: [item.lighting],
        onViewStateChange: ({viewState}) => syncCamera(viewState as MapViewState),
        onAfterRender: () => {
          item.rendered++;
          if (firstFrame) {
            firstFrame = false;
            ready++;
            refreshStatus();
          }
        },
        onError: error => {
          errors.push(`${renderer}/${species}: ${error.message}`);
          console.error(`${renderer}/${species}`, error);
          refreshStatus();
        }
      });
      decks.push(item as (typeof decks)[number]);
      visibilityObserver.observe(element);
    }
  };
  refresh();
  void mount();
  const tickTour = (now: number) => {
    if (disposed) return;
    if (autoTour && !document.hidden) {
      const frame = getTourFrame((now - tourStart) / 1000);
      sunAngle = frame.sunAngle;
      if (frame.season !== options.season) {
        options.season = frame.season;
        refresh();
      }
      root.querySelector<HTMLInputElement>('#sun-angle')!.value = String(Math.round(sunAngle));
      for (const item of decks) {
        if (!item.onScreen) continue;
        item.lighting.setSunDirection(frame.direction);
        item.deck.redraw('sun tour');
      }
    }
    tourRequest = requestAnimationFrame(tickTour);
  };
  tourRequest = requestAnimationFrame(tickTour);
  // A small deterministic review API used by the browser evidence runner.
  const api = {
    get ready() {
      return ready;
    },
    get errors() {
      return [...errors];
    },
    setOptions(next: Partial<SceneOptions>) {
      Object.assign(options, next);
      refresh();
    },
    setCamera: syncCamera,
    getOptions: () => ({...options}),
    getDecks: () => decks
  };
  Object.assign(window, {treeLab: api});
  return () => {
    disposed = true;
    cancelAnimationFrame(tourRequest);
    visibilityObserver.disconnect();
    document.removeEventListener('visibilitychange', refreshVisibility);
    for (const item of decks) item.deck.finalize();
    root.remove();
    const reviewWindow = window as Window & {treeLab?: typeof api};
    if (reviewWindow.treeLab === api) delete reviewWindow.treeLab;
  };
}

// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {Deck, type MapViewState} from '@deck.gl/core';
import {
  TreeLayer,
  type CropConfig,
  type TreeCharacteristics,
  type Season
} from '@deck.gl-community/layers';
import {webgl2Adapter} from '@luma.gl/webgl';
import {SimpleMeshLayer} from '@deck.gl/mesh-layers';
import {PlaneGeometry} from '@luma.gl/engine';
import {createLighting, createViews, VIEW, SEASONS} from './scene';
import {getTourFrame} from './tour';
import './style.css';
import './citrus.css';

export type CitrusVariety = 'orange' | 'lemon' | 'lime';
export type CitrusStage = 'bloom' | 'green' | 'ripe' | 'none';
export type CitrusSettings = {
  variety: CitrusVariety;
  stage: CitrusStage;
  height: number;
  canopy: number;
  trunk: number;
  radius: number;
  fruitCount: number;
  characteristics: TreeCharacteristics;
};
export const CITRUS_PRESETS: Record<string, CitrusSettings> = {
  orchard: {
    variety: 'orange',
    stage: 'ripe',
    height: 4.8,
    canopy: 4.2,
    trunk: 0.2,
    radius: 0.12,
    fruitCount: 90,
    characteristics: {}
  },
  patio: {
    variety: 'lemon',
    stage: 'ripe',
    height: 2.8,
    canopy: 2.8,
    trunk: 0.16,
    radius: 0.075,
    fruitCount: 40,
    characteristics: {seed: 19, crownDepth: 0.8, branchLift: 0.8, leafSize: 1.15}
  },
  spreading: {
    variety: 'lime',
    stage: 'green',
    height: 4,
    canopy: 4.6,
    trunk: 0.15,
    radius: 0.11,
    fruitCount: 110,
    characteristics: {
      seed: 43,
      crownSpread: 1.2,
      crownDepth: 0.8,
      crownAsymmetry: 1.4,
      branchLift: 0.5
    }
  }
};
/** Stage is supplied explicitly. Calendar season never predicts a cultivar's ripening date. */
export function getCitrusCrop(settings: CitrusSettings): CropConfig | null {
  if (settings.stage === 'none') return null;
  if (settings.stage === 'bloom')
    return {kind: 'flower', color: [255, 251, 235, 255], count: settings.fruitCount, radius: 0.018};
  const green = settings.stage === 'green';
  const colors = {
    orange: [250, 143, 23, 255],
    lemon: [245, 211, 37, 255],
    lime: [106, 174, 37, 255]
  } as const;
  return {
    kind: settings.variety === 'lemon' ? 'lemon' : 'fruit',
    color: green ? [91, 145, 32, 255] : [...colors[settings.variety]],
    count: settings.fruitCount,
    radius:
      (settings.variety === 'lime' ? 0.032 : settings.variety === 'lemon' ? 0.052 : 0.045) *
      (green ? 0.7 : 1)
  };
}
const DIMENSIONS = [
  ['height', 'Height', 2, 8, 0.1, ' m'],
  ['canopy', 'Crown spread', 1.5, 7, 0.1, ' m'],
  ['trunk', 'First fork', 0.1, 0.45, 0.01, ''],
  ['radius', 'Trunk radius', 0.05, 0.25, 0.005, ' m'],
  ['fruitCount', 'Crop count', 0, 240, 1, '']
] as const;
const MORPHOLOGY = [
  ['seed', 'Tree seed', 0, 100, 1],
  ['crownDepth', 'Crown depth', 0.6, 1.4, 0.01],
  ['crownAsymmetry', 'Crown asymmetry', 0, 2, 0.01],
  ['branchDensity', 'Branch density', 0.5, 1.5, 0.01],
  ['branchLift', 'Branch lift', 0, 3, 0.01],
  ['leafSize', 'Leaf size', 0.5, 1.8, 0.01],
  ['leafDensity', 'Leaf density', 0.25, 2, 0.01],
  ['internodeLength', 'Shoot length', 0.7, 1.4, 0.01]
] as const;
function createRange(
  key: string,
  label: string,
  min: number,
  max: number,
  step: number,
  trait: boolean,
  suffix = ''
) {
  return `<label class="citrus-range">${label}<output data-readout="${key}"></output><input aria-label="${label}" data-setting="${key}" data-trait="${trait}" data-suffix="${suffix}" type="range" min="${min}" max="${max}" step="${step}"></label>`;
}

/** A single instanced TreeLayer with live, coherent crown/branch/crop morphology controls. */
export function mountCitrusLabExample(
  container: HTMLElement,
  options: {standalone?: boolean} = {}
): () => void {
  let settings = structuredClone(CITRUS_PRESETS.orchard);
  let season: Season = 'summer';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let wind = !reduced,
    cycle = !reduced,
    shadows = true;
  let inspection = 'crown',
    sunAngle = 35,
    disposed = false,
    request = 0,
    debounce = 0;
  const errors: string[] = [];
  let frames = 0,
    lastFrame = 0,
    frameTotal = 0,
    lastStats = 0;
  let camera: MapViewState = {...VIEW, zoom: 22.4, position: [0, 0, 2], pitch: 62, bearing: 22};
  const root = document.createElement('div');
  root.className = 'tree-lab citrus-lab';
  if (!options.standalone) root.style.height = '100%';
  root.innerHTML = `<header><div><div class="eyebrow">vis.gl / Citrus Lab</div><h1>Shape a living crown.</h1><p>Branches, foliage and fruit grow from one shared skeleton.</p></div>${options.standalone ? '<a href="./index.html">← Tree suite</a>' : ''}</header>
    <main class="citrus-workbench"><aside class="citrus-controls">
      <label class="citrus-select">Tree form<select aria-label="Tree form"><option value="orchard">Orchard orange</option><option value="patio">Patio lemon</option><option value="spreading">Spreading lime</option></select></label>
      <div class="citrus-select-pair"><label class="citrus-select">Citrus<select aria-label="Citrus variety"><option value="orange">Orange</option><option value="lemon">Lemon</option><option value="lime">Lime</option></select></label><label class="citrus-select">Crop stage<select aria-label="Crop stage"><option value="bloom">White blossom</option><option value="green">Green fruit</option><option value="ripe">Ripe fruit</option><option value="none">No crop</option></select></label></div>
      <p class="citrus-note">Fruit stage is independent of season. Citrus keeps its leaves in winter.</p>
      <fieldset><legend>Structure</legend>${DIMENSIONS.slice(0, 4)
        .map(([key, label, min, max, step, suffix]) =>
          createRange(key, label, min, max, step, false, suffix)
        )
        .join('')}${MORPHOLOGY.slice(0, 5)
        .map(([key, label, min, max, step]) => createRange(key, label, min, max, step, true))
        .join('')}</fieldset>
      <fieldset><legend>Leaves &amp; crop</legend>${MORPHOLOGY.slice(5, 7)
        .map(([key, label, min, max, step]) => createRange(key, label, min, max, step, true))
        .join('')}${createRange('fruitCount', 'Crop count', 0, 240, 1, false)}</fieldset>
      <details><summary>Growth &amp; recipe</summary>${createRange('internodeLength', 'Shoot length', 0.7, 1.4, 0.01, true)}<p class="citrus-note">Morphology multipliers describe this procedural tree. They do not predict growth or yield.</p><pre class="citrus-recipe"></pre><button id="citrus-export">Export recipe</button></details>
      <button id="citrus-reset">Reset tree form</button>
    </aside><section class="citrus-stage"><div class="citrus-scene"></div><div class="citrus-stage-label"><strong>Orange · ripe fruit</strong><span>Continuous wood · Gaussian leaves · attached crop</span></div><div class="citrus-stage-controls">
      <button id="citrus-frame">Frame tree</button><label>Inspect <select aria-label="Inspect tree"><option value="crown">Full crown</option><option value="inside">Inside crown</option><option value="branches">Branches only</option></select></label>
      <label>Season <select aria-label="Season">${SEASONS.map(value => `<option>${value}</option>`).join('')}</select></label>
      <label><input aria-label="Wind" type="checkbox">Wind</label><label><input aria-label="Shadows" type="checkbox">Shadows</label><label><input aria-label="Cycle light and seasons" type="checkbox">Cycle light &amp; seasons</label>
      <label class="citrus-sun">Sun <input aria-label="Sun angle" type="range" min="0" max="360" value="35"></label>
    </div></section></main><footer><span class="citrus-status" aria-live="polite">Preparing citrus…</span><span>Drag to orbit · scroll to inspect</span></footer>`;
  container.replaceChildren(root);
  const element = root.querySelector<HTMLDivElement>('.citrus-scene')!;
  const status = root.querySelector<HTMLElement>('.citrus-status')!;
  const select = (label: string) =>
    root.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!;
  const checkbox = (label: string) =>
    root.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
  const ranges = [...root.querySelectorAll<HTMLInputElement>('[data-setting]')];
  const data = [{position: [0, 0] as [number, number]}];
  const ground = new SimpleMeshLayer({
    id: 'citrus-ground',
    data: [{position: [0, 0, -0.02]}],
    mesh: new PlaneGeometry({type: 'x,y', xlen: 1000, ylen: 1000}),
    getColor: [229, 232, 220],
    material: {ambient: 1, diffuse: 0.15},
    shadowEnabled: false
  });
  const lighting = createLighting(shadows);
  const getLayers = () => [
    ground,
    new TreeLayer<{position: [number, number]}>({
      id: 'citrus-tree',
      data,
      getTreeType: () => 'citrus',
      getHeight: () => settings.height,
      getCanopyRadius: () => settings.canopy,
      getTrunkHeightFraction: () => settings.trunk,
      getTrunkRadius: () => settings.radius,
      characteristics: settings.characteristics,
      getSeason: () => season,
      getCrop: () => (inspection === 'branches' ? null : getCitrusCrop(settings)),
      getCanopyColor: () =>
        inspection === 'crown' ? null : [38, 119, 35, inspection === 'inside' ? 38 : 0],
      windStrength: wind && !document.hidden ? 0.018 : 0,
      windTime: null,
      shadowEnabled: shadows,
      pickable: true,
      updateTriggers: {
        getHeight: settings.height,
        getCanopyRadius: settings.canopy,
        getTrunkHeightFraction: settings.trunk,
        getTrunkRadius: settings.radius,
        getSeason: season,
        getCrop: [settings.variety, settings.stage, settings.fruitCount, inspection],
        getCanopyColor: inspection
      }
    })
  ];
  function syncControls() {
    for (const input of ranges) {
      const key = input.dataset.setting!;
      const value =
        input.dataset.trait === 'true'
          ? (settings.characteristics[key] ?? (key === 'seed' ? 0 : 1))
          : settings[key];
      input.value = String(value);
      root.querySelector<HTMLOutputElement>(`[data-readout="${key}"]`)!.value =
        key === 'trunk'
          ? `${Math.round(value * 100)}% height`
          : `${Number(value.toFixed(3))}${input.dataset.trait === 'true' && key !== 'seed' ? '×' : input.dataset.suffix}`;
    }
    select('Citrus variety').value = settings.variety;
    select('Crop stage').value = settings.stage;
    select('Season').value = season;
    select('Inspect tree').value = inspection;
    checkbox('Wind').checked = wind;
    checkbox('Shadows').checked = shadows;
    checkbox('Cycle light and seasons').checked = cycle;
    checkbox('Sun angle').value = String(Math.round(sunAngle));
    root.querySelector('.citrus-stage-label strong')!.textContent =
      `${settings.variety[0].toUpperCase() + settings.variety.slice(1)} · ${settings.stage === 'bloom' ? 'white blossom' : settings.stage === 'none' ? 'no crop' : `${settings.stage} fruit`}`;
    root.querySelector('.citrus-recipe')!.textContent = JSON.stringify(settings, null, 2);
  }
  const deck = new Deck({
    parent: element,
    width: '100%',
    height: '100%',
    useDevicePixels: Math.min(devicePixelRatio, 2),
    deviceProps: {type: 'webgl', adapters: [webgl2Adapter]},
    views: createViews(),
    viewState: camera,
    layers: getLayers(),
    effects: [lighting],
    onViewStateChange({viewState}) {
      camera = viewState as MapViewState;
      deck.setProps({viewState: camera});
    },
    onLoad() {
      status.textContent = 'Citrus ready';
    },
    onError(error) {
      errors.push(error.message);
      status.textContent = error.message;
    },
    onAfterRender() {
      const now = performance.now();
      if (lastFrame) {
        frameTotal += now - lastFrame;
        frames++;
      }
      lastFrame = now;
      if (now - lastStats > 1500) {
        status.textContent = errors.length
          ? errors.at(-1)!
          : !wind && !cycle
            ? `Static view · ${season} · ${shadows ? 'shadows on' : 'shadows off'}`
            : frames
              ? `${Math.round((frames / frameTotal) * 1000)} draws/s · ${season} · ${shadows ? 'shadows on' : 'shadows off'}`
              : 'Citrus ready';
        frames = 0;
        frameTotal = 0;
        lastStats = now;
      }
    }
  });
  function frameTree() {
    const extent = Math.max(
      settings.height * Math.max(1, settings.characteristics.crownDepth ?? 1),
      settings.canopy * (settings.characteristics.crownSpread ?? 1)
    );
    const bounds = element.getBoundingClientRect();
    const fitScale = Math.max(0.25, Math.min(bounds.width / 320, bounds.height / 360));
    camera = {
      ...camera,
      longitude: 0,
      latitude: 0,
      position: [0, 0, settings.height * 0.42],
      zoom: 22.4 + Math.log2((4.8 * fitScale) / extent)
    };
    deck.setProps({viewState: camera});
  }
  root.querySelector('#citrus-frame')!.addEventListener('click', frameTree);
  function refresh() {
    if (!disposed) {
      if (!wind && !cycle && !errors.length)
        status.textContent = `Static view · ${season} · ${shadows ? 'shadows on' : 'shadows off'}`;
      syncControls();
      deck.setProps({layers: getLayers(), effects: [lighting]});
    }
  }
  const applySun = (direction?: [number, number, number]) => {
    const angle = (sunAngle * Math.PI) / 180;
    lighting.setSunDirection(direction ?? [-Math.cos(angle), -Math.sin(angle), -1.2]);
    deck.setProps({effects: [lighting]});
    deck.redraw('citrus sunlight');
  };
  root.addEventListener('input', event => {
    const input = event.target as HTMLInputElement;
    if (!input.matches('[data-setting]')) return;
    const key = input.dataset.setting!;
    const value = Number(input.value);
    if (input.dataset.trait === 'true')
      settings = {...settings, characteristics: {...settings.characteristics, [key]: value}};
    else settings = {...settings, [key]: value};
    syncControls();
    window.clearTimeout(debounce);
    debounce = window.setTimeout(refresh, 120);
  });
  select('Tree form').addEventListener('change', () => {
    settings = structuredClone(CITRUS_PRESETS[select('Tree form').value]);
    frameTree();
    refresh();
  });
  root.querySelector('#citrus-reset')!.addEventListener('click', () => {
    settings = structuredClone(CITRUS_PRESETS[select('Tree form').value]);
    frameTree();
    refresh();
  });
  select('Citrus variety').addEventListener('change', () => {
    settings = {...settings, variety: select('Citrus variety').value as CitrusVariety};
    refresh();
  });
  select('Crop stage').addEventListener('change', () => {
    settings = {...settings, stage: select('Crop stage').value as CitrusStage};
    refresh();
  });
  select('Inspect tree').addEventListener('change', () => {
    inspection = select('Inspect tree').value;
    refresh();
  });
  select('Season').addEventListener('change', () => {
    season = select('Season').value as Season;
    cycle = false;
    refresh();
  });
  checkbox('Wind').addEventListener('change', () => {
    wind = checkbox('Wind').checked;
    refresh();
  });
  checkbox('Shadows').addEventListener('change', () => {
    shadows = checkbox('Shadows').checked;
    lighting.setProps(createLighting(shadows).props);
    applySun();
    refresh();
  });
  checkbox('Cycle light and seasons').addEventListener('change', () => {
    cycle = checkbox('Cycle light and seasons').checked;
    refresh();
  });
  checkbox('Sun angle').addEventListener('input', () => {
    sunAngle = Number(checkbox('Sun angle').value);
    cycle = false;
    applySun();
    syncControls();
  });
  root.querySelector('#citrus-export')!.addEventListener('click', () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(settings, null, 2)], {type: 'application/json'})
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'citrus-tree.json';
    a.click();
    URL.revokeObjectURL(url);
  });
  const visibility = () => {
    lastFrame = 0;
    refresh();
  };
  document.addEventListener('visibilitychange', visibility);
  const start = performance.now();
  const animate = (now: number) => {
    if (disposed) return;
    if (cycle && !document.hidden) {
      const frame = getTourFrame((now - start) / 1000);
      sunAngle = frame.sunAngle;
      applySun(frame.direction);
      if (season !== frame.season) {
        season = frame.season;
        refresh();
      } else {
        checkbox('Sun angle').value = String(Math.round(sunAngle));
      }
    }
    request = requestAnimationFrame(animate);
  };
  syncControls();
  applySun();
  frameTree();
  request = requestAnimationFrame(animate);
  return () => {
    disposed = true;
    window.clearTimeout(debounce);
    cancelAnimationFrame(request);
    document.removeEventListener('visibilitychange', visibility);
    deck.finalize();
    root.remove();
  };
}

// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/// <reference types="vite/client" />

import {
  AmbientLight,
  COORDINATE_SYSTEM,
  Deck,
  DirectionalLight,
  OrbitView,
  type PickingInfo,
  type Position
} from '@deck.gl/core';
import {ScatterplotLayer, SolidPolygonLayer} from '@deck.gl/layers';
import '@deck.gl/widgets/stylesheet.css';
import {webgl2Adapter} from '@luma.gl/webgl';
import {
  applyPanelTheme,
  PANEL_THEME_DARK,
  SettingsPanel,
  type SettingsSchema,
  type SettingsState
} from '@deck.gl-community/panels';
import type {FieldFrame} from './field/field';
import {DEFAULT_DETAIL_REACH, getFieldDetailThresholds} from './field/field-detail';
import {getFieldLayers, getFieldSetup, getFieldStats} from './field/impl-field';
import {FieldInspector} from './playground-diagnostics';
import {FieldLightingEffect} from './playground-lighting';
import {
  applyAttributePatch,
  ATTRIBUTE_LIMITS,
  createFieldDetailGovernor,
  createPlaygroundField,
  DEFAULT_ATTRIBUTES,
  getFieldCamera,
  getPresetCamera,
  getScopeIndices,
  readTreeAttributes,
  settleFieldDetailGovernor,
  updateFieldDetailGovernor,
  type OrbitCamera,
  type PlaygroundTree,
  type TreeAttributes,
  type TreeScope,
  type ViewPreset
} from './playground-settings';

const element = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;
const count = Number(new URLSearchParams(location.search).get('count') || 20000);
const trees = createPlaygroundField(count);
let selectedIndex = trees.reduce(
  (closest, tree, index) =>
    Math.hypot(...tree.position) < Math.hypot(...trees[closest].position) ? index : closest,
  0
);
let scope: TreeScope = 'selected';
let indices = getScopeIndices(trees, selectedIndex, scope);
let camera = getPresetCamera('overview', trees, selectedIndex, innerHeight);
let cameraPending = false;
let pendingPatch: Partial<TreeAttributes> = {};
let warm = true;
let paused = false;
let windClock = 1000;
let frameNumber = 0;
let lastTime = performance.now();
let lastReadout = 0;
let startupMs = 0;
let detailGovernor = createFieldDetailGovernor(performance.now());
const frameTimes: number[] = [];
const startupTime = performance.now();
const settings: SettingsState = {
  ...DEFAULT_ATTRIBUTES,
  transitionMs: 550,
  windStrength: 0.035,
  windBearing: 80,
  wetness: 0,
  frost: 0,
  lodBias: 0,
  autoDetail: true,
  detailReach: DEFAULT_DETAIL_REACH,
  nearMost: 8
};
const schema: SettingsSchema = {
  sections: [
    {
      id: 'life',
      name: 'Life & foliage',
      initiallyCollapsed: false,
      settings: ['growth', 'health', 'foliage', 'flush'].map(name => ({
        name,
        label: {growth: 'Growth', health: 'Health', foliage: 'Foliage', flush: 'New growth'}[name],
        type: 'number',
        min: 0,
        max: 1,
        step: 0.01,
        sliderDebounceMs: 0
      }))
    },
    {
      id: 'structure',
      name: 'Structure & damage',
      settings: [
        {name: 'height', label: 'Height / metres', type: 'number', min: 0.25, max: 12, step: 0.1},
        {
          name: 'crownRadius',
          label: 'Crown radius / m',
          type: 'number',
          min: 0.1,
          max: 6,
          step: 0.05
        },
        {name: 'leanAngle', label: 'Lean / degrees', type: 'number', min: 0, max: 90, step: 1},
        {name: 'leanBearing', label: 'Lean bearing', type: 'number', min: 0, max: 360, step: 1},
        {name: 'damage', label: 'Broken limbs', type: 'number', min: 0, max: 1, step: 0.01},
        {name: 'decay', label: 'Decay', type: 'number', min: 0, max: 1, step: 0.01}
      ]
    },
    {
      id: 'crop',
      name: 'Fruit',
      settings: [
        {name: 'cropCount', label: 'Fruit / tree', type: 'number', min: 0, max: 500, step: 1},
        {
          name: 'cropSize',
          label: 'Radius / metres',
          type: 'number',
          min: 0.01,
          max: 0.1,
          step: 0.005
        },
        {name: 'cropRipeness', label: 'Ripeness', type: 'number', min: 0, max: 1, step: 0.01}
      ]
    },
    {
      id: 'weather',
      name: 'Weather · whole field',
      settings: [
        {name: 'windStrength', label: 'Wind strength', type: 'number', min: 0, max: 1, step: 0.005},
        {name: 'windBearing', label: 'Wind bearing', type: 'number', min: 0, max: 360, step: 1},
        {name: 'wetness', label: 'Wetness', type: 'number', min: 0, max: 1, step: 0.01},
        {name: 'frost', label: 'Frost', type: 'number', min: 0, max: 1, step: 0.01}
      ]
    },
    {
      id: 'render',
      name: 'Transitions & detail',
      settings: [
        {
          name: 'autoDetail',
          label: 'Auto detail',
          description: 'Target 60 fps by easing leaf detail. Fruit keeps its own distance detail.',
          type: 'boolean',
          defaultValue: true
        },
        {
          name: 'transitionMs',
          label: 'Transition / ms',
          type: 'number',
          min: 0,
          max: 3000,
          step: 50
        },
        {
          name: 'lodBias',
          label: 'Manual LOD bias',
          description: '0 is maximum detail. Editing this disables Auto detail.',
          type: 'number',
          min: 0,
          max: 3,
          step: 0.1
        },
        {
          name: 'detailReach',
          label: 'Detail reach',
          description: 'How far detailed crowns extend. Default 1.5 keeps them 50% farther away.',
          type: 'number',
          min: 0.5,
          max: 3,
          step: 0.1
        },
        {
          name: 'nearMost',
          label: 'Near tree budget',
          description: 'Maximum trees drawing individual leaves. Other trees keep a cheaper crown.',
          type: 'select',
          options: [2, 4, 8],
          defaultValue: 8
        }
      ]
    }
  ]
};

applyPanelTheme(document.body, PANEL_THEME_DARK);
const panel = new SettingsPanel({
  id: 'tree-field-settings',
  schema,
  settings: {...settings},
  theme: 'inherit',
  fontSize: 11,
  onSettingsChange: (next, changes) => {
    // The generic SettingsPanel emits the full snapshot; StudioSettingsPanel also supplies
    // descriptors. Accept either callback shape without doing field work in the input handler.
    const values = changes?.length
      ? changes.map(change => [change.name, change.nextValue] as const)
      : Object.entries(next).filter(([name, value]) => value !== settings[name]);
    const editingManualLod =
      !changes?.length &&
      document.activeElement?.getAttribute('aria-label')?.startsWith('Manual LOD bias');
    for (const [name, value] of values) {
      // Number controls emit input and change in one event turn. Their second snapshot can still
      // carry the old checkbox value; a manual edit takes precedence over that stale snapshot.
      if (editingManualLod && name === 'autoDetail') continue;
      setSetting(name, typeof value === 'boolean' ? value : Number(value));
    }
    if (editingManualLod) setSetting('lodBias', Number(next.lodBias));
  }
});
panel.onRenderHTML(element('settings'));
const formatNumber = (value: number) => Math.round(value).toLocaleString('en-US');
element('tree-total').textContent = formatNumber(trees.length);
element<HTMLSelectElement>('tree-count').value = String(trees.length);
let halfEast = 1;
let halfNorth = 1;
for (const tree of trees) {
  halfEast = Math.max(halfEast, Math.abs(tree.position[0]) + 6);
  halfNorth = Math.max(halfNorth, Math.abs(tree.position[1]) + 6);
}
const ground = new SolidPolygonLayer<Position[], {shadowEnabled: boolean}>({
  id: 'playground-ground',
  coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
  data: [
    [
      [-halfEast - 3000, -halfNorth - 3000, -0.04],
      [halfEast + 3000, -halfNorth - 3000, -0.04],
      [halfEast + 3000, halfNorth + 3000, -0.04],
      [-halfEast - 3000, halfNorth + 3000, -0.04]
    ]
  ],
  getPolygon: polygon => polygon,
  getFillColor: [97, 94, 65, 255],
  material: false,
  // A flat receiver cannot occlude any geometry above it.
  shadowEnabled: false,
  pickable: false
});
const frame: FieldFrame = {
  path: 'playground',
  frame: 0,
  frameCount: Number.MAX_SAFE_INTEGER,
  time: 1000,
  revision: 0,
  camera: getFieldCamera(camera),
  params: {
    impl: 'field',
    count: trees.length,
    seeds: 4,
    wideSpacing: 0,
    view: 'orbit',
    shadows: 1,
    msaa: 1,
    dpr: 1,
    width: innerWidth,
    height: innerHeight,
    wind: 0.035,
    windBearing: 80,
    growth: 1,
    fruit: 80,
    ground: 1,
    lodBias: 0,
    ...getFieldDetailThresholds(),
    nearMost: 8,
    fade: 0.2,
    skip: '',
    only: '',
    raster: 1,
    nodraw: 0,
    flush: 'none',
    autorun: '',
    camera: '',
    subsetHealth: 1,
    pictureWidth: 0,
    changedIndices: []
  },
  layerProps: {
    coordinateSystem: COORDINATE_SYSTEM.CARTESIAN as unknown as string,
    coordinateOrigin: [0, 0, 0],
    windStrength: 0.035,
    windDirection: 80,
    windTime: 1000,
    transitions: null,
    pickable: true,
    autoHighlight: false,
    updateTriggers: {getTree: 0}
  }
};
const light = new DirectionalLight({
  color: [255, 246, 221],
  intensity: 2,
  direction: [-1, -2, -3],
  _shadow: true
});
const lighting = new FieldLightingEffect({
  sun: light,
  ambient: new AmbientLight({color: [184, 209, 239], intensity: 1.2})
});
const inspector = new FieldInspector();
let savedCompaction: [unknown, unknown] | null = null;
let resolveLoaded: () => void;
const loaded = new Promise<void>(resolve => {
  resolveLoaded = resolve;
});
let afterRender: (() => void) | null = null;
const deck = new Deck({
  parent: element('scene'),
  deviceProps: {adapters: [webgl2Adapter]},
  useDevicePixels: 1,
  views: [createView()],
  viewState: {orchard: camera},
  controller: {inertia: 150, doubleClickZoom: false},
  effects: [lighting],
  layers: [ground],
  onLoad: () => resolveLoaded(),
  onError: error => {
    element('render-status').textContent = error.message;
    console.error(error);
  },
  onViewStateChange: ({viewState}) => {
    const next = viewState as OrbitCamera;
    if (
      Math.abs(next.zoom - camera.zoom) > 0.5 ||
      Math.abs(next.rotationOrbit - camera.rotationOrbit) > 15
    ) {
      settleFieldDetailGovernor(detailGovernor, performance.now());
    }
    camera = next;
    cameraPending = true;
    document.querySelectorAll('#presets button').forEach(button => {
      button.setAttribute('aria-pressed', 'false');
    });
  },
  onClick: selectTree,
  getCursor: ({isDragging, isHovering}) =>
    isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab',
  onAfterRender: () => {
    const resolve = afterRender;
    afterRender = null;
    resolve?.();
    if (!warm && inspector.enabled) {
      const setup = getFieldSetup();
      const viewport = deck.getViewports()[0];
      if (setup && viewport) {
        inspector.update(performance.now(), {
          setup,
          frame,
          viewport,
          selected: selectedIndex,
          shadow: lighting.shadowDiagnostics
        });
      }
    }
  }
});

function getFieldFar(distance: number, target: number[]): number {
  // The camera can orbit or pan outside the orchard, so include its target's distance to the field.
  return distance + Math.hypot(...target) + Math.hypot(halfEast, halfNorth) + 16;
}

function createView(): OrbitView {
  const scale = 2 ** camera.zoom / innerHeight;
  const distance = 1.5 / scale;
  return new OrbitView({
    id: 'orchard',
    orbitAxis: 'Z',
    fovy: 36.87,
    near: 0.005,
    far: getFieldFar(distance, camera.target) * scale
  });
}

function setSetting(name: string, value: number | boolean): void {
  if (name === 'autoDetail') {
    const enabled = Boolean(value);
    if (settings.autoDetail !== enabled)
      detailGovernor = createFieldDetailGovernor(performance.now());
    settings.autoDetail = enabled;
    return;
  }
  if (typeof value !== 'number') return;
  if (!Number.isFinite(value)) return;
  if (name === 'lodBias') {
    settings.autoDetail = false;
    value = Math.max(0, Math.min(3, value));
    queueMicrotask(() => panel.setProps({settings: {...settings}}));
  }
  if (name === 'detailReach') {
    value = Math.max(0.5, Math.min(3, value));
    Object.assign(frame.params, getFieldDetailThresholds(value));
  }
  if (name in ATTRIBUTE_LIMITS) {
    const key = name as keyof TreeAttributes;
    const [min, max] = ATTRIBUTE_LIMITS[key];
    settings[name] = Math.max(min, Math.min(max, value));
    pendingPatch[key] = Number(settings[name]);
  } else {
    settings[name] = value;
  }
}

function updateSelection(): void {
  indices = getScopeIndices(trees, selectedIndex, scope);
  Object.assign(settings, readTreeAttributes(trees[selectedIndex]));
  panel.setProps({settings: {...settings}});
  const tree = trees[selectedIndex];
  element('selection-label').textContent =
    `Tree ${formatNumber(selectedIndex + 1)} · row ${tree.row + 1}, position ${tree.column + 1}`;
  element('scope-label').textContent =
    `${formatNumber(indices.length)} ${indices.length === 1 ? 'tree' : 'trees'} will change · click any crown to select`;
  frame.params.selectedIndex = selectedIndex;
}

function selectTree(info: PickingInfo): void {
  const object = info.object as PlaygroundTree | {tree?: PlaygroundTree} | undefined;
  const tree = object && 'tree' in object ? object.tree : object;
  const index = tree ? trees.indexOf(tree as PlaygroundTree) : -1;
  if (index < 0) return;
  pendingPatch = {};
  selectedIndex = index;
  updateSelection();
}

function setPreset(preset: ViewPreset): void {
  settleFieldDetailGovernor(detailGovernor, performance.now());
  camera = getPresetCamera(preset, trees, selectedIndex, innerHeight);
  cameraPending = true;
  document.querySelectorAll<HTMLButtonElement>('#presets button').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.view === preset));
  });
}

function updateFrame(now: number): void {
  const frameDelta = now - lastTime;
  const delta = Math.min(100, frameDelta);
  lastTime = now;
  if (!paused) windClock += delta / 1000;
  frame.time = now / 1000 + 1000;
  frame.frame = frameNumber++;
  const updateCamera =
    cameraPending || frame.params.width !== innerWidth || frame.params.height !== innerHeight;
  if (updateCamera) {
    frame.camera = getFieldCamera(camera);
    cameraPending = false;
  }
  frame.params.width = innerWidth;
  frame.params.height = innerHeight;
  frame.params.diagnostics = inspector.enabled;
  frame.params.bypassShellFrustum = inspector.bypassShellFrustum;
  if (inspector.bypassCompaction && !savedCompaction) {
    savedCompaction = [frame.params.leafCulling, frame.params.woodCulling];
    frame.params.leafCulling = 0;
    frame.params.woodCulling = 0;
  } else if (!inspector.bypassCompaction && savedCompaction) {
    [frame.params.leafCulling, frame.params.woodCulling] = savedCompaction;
    savedCompaction = null;
  }
  frame.params.lodBias = settings.autoDetail
    ? warm
      ? detailGovernor.bias
      : updateFieldDetailGovernor(detailGovernor, frameDelta, now)
    : Number(settings.lodBias);
  frame.params.nearMost = settings.autoDetail
    ? Math.max(2, Math.min(8, Math.floor(Number(settings.nearMost) * detailGovernor.nearScale)))
    : Number(settings.nearMost);
  frame.params.wetness = Number(settings.wetness);
  frame.params.frost = Number(settings.frost);
  frame.params.transitionMs = Number(settings.transitionMs);
  frame.layerProps.windTime = windClock;
  frame.layerProps.windStrength = Number(settings.windStrength);
  frame.layerProps.windDirection = Number(settings.windBearing);
  if (Object.keys(pendingPatch).length) {
    applyAttributePatch(trees, indices, pendingPatch);
    pendingPatch = {};
    frame.revision++;
    frame.params.changedIndices = indices;
    frame.layerProps.updateTriggers = {getTree: frame.revision};
    const duration = Number(settings.transitionMs);
    frame.layerProps.transitions = Object.fromEntries(
      [
        'getTree',
        'getHeight',
        'getCanopyRadius',
        'getGrowth',
        'getHealth',
        'getFoliage',
        'getFlush',
        'getLean',
        'getDamage',
        'getDecay'
      ].map(key => [key, duration])
    );
  }
  const selected = trees[selectedIndex];
  deck.setProps({
    // The camera and the layer lists culled for it must become visible in the same draw.
    ...(updateCamera ? {viewState: {orchard: camera}, views: [createView()]} : {}),
    layers: [
      ground,
      getFieldLayers(trees, frame),
      new ScatterplotLayer({
        id: 'selected-tree-ring',
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        data: [selected],
        getPosition: tree => [tree.position[0], tree.position[1], 0.03],
        getRadius: tree => Math.max(0.4, tree.crownRadius * (0.3 + tree.growth * 0.8)),
        filled: false,
        stroked: true,
        getLineColor: [224, 245, 172, 220],
        lineWidthUnits: 'pixels',
        getLineWidth: 1.5,
        pickable: false,
        updateTriggers: {getRadius: frame.revision}
      })
    ]
  });
  if (!warm) {
    frameTimes.push(frameDelta);
    if (frameTimes.length > 120) frameTimes.shift();
    if (now - lastReadout > 300) {
      lastReadout = now;
      const stats = getFieldStats();
      const mean = frameTimes.reduce((sum, value) => sum + value, 0) / frameTimes.length;
      const sorted = [...frameTimes].sort((a, b) => a - b);
      const p95 = sorted[Math.floor((sorted.length - 1) * 0.95)];
      element('fps').textContent = `${Math.round(1000 / mean)} fps`;
      element('frame-time').textContent = `${mean.toFixed(1)} ms · p95 ${p95.toFixed(1)}`;
      element('prepare-time').textContent = `${(stats.prepareMs / 1000).toFixed(2)} s once`;
      element('visible-count').textContent = formatNumber(stats.visibleCount);
      element('near-count').textContent = formatNumber(stats.nearCount);
      element('detail-bias').textContent =
        `${Number(frame.params.lodBias).toFixed(2)} · ${settings.autoDetail ? 'auto / target 60 fps' : Number(frame.params.lodBias) === 0 ? 'manual / maximum' : 'manual'}`;
      element('render-status').textContent =
        `WebGL2 · ${innerWidth} × ${innerHeight} · startup ${(startupMs / 1000).toFixed(1)} s`;
    }
  }
  requestAnimationFrame(updateFrame);
}

document.querySelectorAll<HTMLButtonElement>('#presets button').forEach(button => {
  button.onclick = () => setPreset(button.dataset.view as ViewPreset);
});
element<HTMLSelectElement>('scope').onchange = event => {
  pendingPatch = {};
  scope = (event.target as HTMLSelectElement).value as TreeScope;
  updateSelection();
};
element('reset').onclick = () => {
  pendingPatch = {...DEFAULT_ATTRIBUTES};
  Object.assign(settings, DEFAULT_ATTRIBUTES);
  panel.setProps({settings: {...settings}});
};
element('pause').onclick = () => {
  paused = !paused;
  element('pause').textContent = paused ? 'Resume wind' : 'Pause wind';
  element('pause').setAttribute('aria-pressed', String(paused));
};
element('collapse').onclick = () => {
  const body = element('controls-body');
  body.hidden = !body.hidden;
  element('collapse').textContent = body.hidden ? '+' : '−';
  element('collapse').setAttribute('aria-expanded', String(!body.hidden));
};
element('rebuild').onclick = () => {
  const url = new URL(location.href);
  url.searchParams.set('count', element<HTMLSelectElement>('tree-count').value);
  location.assign(url);
};
window.addEventListener('keydown', event => {
  if ((event.target as HTMLElement).closest('input, select, button, [contenteditable]')) return;
  const preset = ['overview', 'rows', 'tree', 'leaf'][Number(event.key) - 1] as ViewPreset;
  if (preset) setPreset(preset);
  if (event.key.toLowerCase() === 'f') setPreset('tree');
  if (event.code === 'Space') {
    event.preventDefault();
    element('pause').click();
  }
});
updateSelection();

async function waitForRenderedFrame(): Promise<void> {
  await new Promise<void>(resolve => {
    afterRender = resolve;
    deck.redraw('playground prewarm');
  });
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
}

const ready = (async () => {
  await loaded;
  requestAnimationFrame(updateFrame);
  for (const preset of ['overview', 'rows', 'tree', 'leaf', 'overview'] as ViewPreset[]) {
    element('loading').querySelector('strong')!.textContent = `Preparing ${preset} detail`;
    setPreset(preset);
    await waitForRenderedFrame();
    // Let the bounded near list finish its hand-over before leaving a tier. This also makes the
    // first real wood, leaf and fruit draws part of startup rather than the user's first dive.
    await new Promise(resolve => setTimeout(resolve, 240));
    await waitForRenderedFrame();
    // Picking has its own framebuffer and shader variants. Warm those behind the loading overlay
    // too, so the first real hover/click is not a several-hundred-millisecond initialization task.
    deck.pickObject({x: innerWidth * 0.55, y: innerHeight * 0.5, radius: 1});
  }
  startupMs = performance.now() - startupTime;
  settleFieldDetailGovernor(detailGovernor, performance.now());
  warm = false;
  lastTime = performance.now();
  element('loading').style.opacity = '0';
  setTimeout(() => element('loading').remove(), 450);
})();

Object.assign(window, {
  treePlayground: {
    ready,
    deck,
    trees,
    frame,
    get shadow() {
      return lighting.shadowDiagnostics;
    },
    get stats() {
      return {
        ...getFieldStats(),
        startupMs,
        frameTimes: [...frameTimes],
        autoDetail: Boolean(settings.autoDetail),
        lodBias: Number(frame.params.lodBias),
        detailMeanMs: detailGovernor.meanMs,
        nearBudget: Number(frame.params.nearMost)
      };
    },
    setPreset,
    setSetting(name: string, value: number | boolean) {
      setSetting(name, value);
      panel.setProps({settings: {...settings}});
    },
    selectTree(index: number) {
      if (!trees[index]) return;
      selectedIndex = index;
      updateSelection();
    },
    setScope(next: TreeScope) {
      scope = next;
      element<HTMLSelectElement>('scope').value = next;
      updateSelection();
    }
  }
});

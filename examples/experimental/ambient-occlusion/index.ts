// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {getStandaloneExampleContainer} from '../../mount-example';
import {
  mountSwitchableAmbientOcclusionExample,
  type AmbientOcclusionExampleOptions,
  type ExampleEffectProps,
  type MethodId,
  type SceneId
} from './app';

const parameters = new URLSearchParams(location.search);
/** Reads a number parameter. Returns `undefined` if it is missing or not a number. */
const getNumber = (name: string) => {
  const value = parameters.get(name);
  return value === null || Number.isNaN(Number(value)) ? undefined : Number(value);
};
const effectProps: ExampleEffectProps = {showOcclusion: parameters.get('show') === '1'};
for (const [name, prop] of [
  ['samples', 'sampleCount'],
  ['radius', 'radius'],
  ['screenRadius', 'maxScreenSpaceRadius'],
  ['intensity', 'intensity']
] as const) {
  const value = getNumber(name);
  if (value !== undefined) {
    effectProps[prop] = value;
  }
}
if (parameters.get('filter') === '0') {
  effectProps.filter = false;
}

const container = getStandaloneExampleContainer();
const methodId = parameters.get('method');
const compareId = parameters.get('compare');
const baseOptions: AmbientOcclusionExampleOptions = {
  scene: (parameters.get('scene') ?? undefined) as SceneId | undefined,
  ambientOcclusion: parameters.get('ao') !== '0',
  effectProps
};

/** The second deck of the swipe comparison, or `null`. See below. */
let compare: Awaited<ReturnType<typeof mountSwitchableAmbientOcclusionExample>> | null = null;
let comparisonLabels: HTMLDivElement | undefined;
const updateComparisonLabels = () => {
  if (comparisonLabels && compare) {
    comparisonLabels.textContent = `Left: ${primary.example.method.label} | Right: ${compare.example.method.label}`;
  }
};

const primary = await mountSwitchableAmbientOcclusionExample(container, {
  ...baseOptions,
  deviceType: parameters.get('device') === 'webgpu' ? 'webgpu' : 'webgl',
  method: (methodId ?? undefined) as MethodId | undefined,
  controls: parameters.get('controls') !== '0',
  onSelectionChange: (method, device) => {
    const url = new URL(location.href);
    url.searchParams.set('method', method);
    url.searchParams.set('device', device);
    history.replaceState(null, '', url);
    updateComparisonLabels();
  },
  onSceneChange: scene => {
    reloadParameter('scene', scene);
    compare?.example.setScene(scene);
  },
  onEffectPropsChange: props => compare?.example.setEffectProps(props),
  onViewStateChange: viewState => compare?.example.setViewState(viewState)
});

/** Keeps the URL in step with the panel, without a reload. */
function reloadParameter(name: string, value: string) {
  const url = new URL(location.href);
  url.searchParams.set(name, value);
  history.replaceState(null, '', url);
}

/**
 * The optional swipe comparison (`?compare=<method>`): a second deck with its own device over the
 * first one. It shows the right part of the screen. Drag the divider to move the split. The two
 * cameras stay the same.
 */
if (compareId) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:1';
  container.append(overlay);
  compare = await mountSwitchableAmbientOcclusionExample(overlay, {
    ...baseOptions,
    deviceType: parameters.get('device') === 'webgpu' ? 'webgpu' : 'webgl',
    method: compareId as MethodId,
    controls: false,
    onViewStateChange: viewState => primary.example.setViewState(viewState)
  });
  const divider = document.createElement('div');
  divider.style.cssText =
    'position:absolute;top:0;bottom:0;z-index:3;width:4px;margin-left:-2px;cursor:ew-resize;' +
    'background:#fff;box-shadow:0 0 4px rgba(0,0,0,0.6)';
  const labels = document.createElement('div');
  labels.style.cssText =
    'position:absolute;top:52px;right:12px;z-index:3;padding:4px 8px;border-radius:4px;' +
    'background:rgba(255,255,255,0.9);font:13px sans-serif';
  comparisonLabels = labels;
  updateComparisonLabels();
  container.append(divider, labels);
  const setSplit = (fraction: number) => {
    const percent = Math.min(100, Math.max(0, fraction * 100));
    overlay.style.clipPath = `inset(0 0 0 ${percent}%)`;
    divider.style.left = `${percent}%`;
  };
  setSplit(getNumber('split') ?? 0.5);
  divider.onpointerdown = event => {
    divider.setPointerCapture(event.pointerId);
    divider.onpointermove = move => setSplit(move.clientX / container.clientWidth);
  };
  divider.onpointerup = () => {
    divider.onpointermove = null;
  };
}

// Lets scripts toggle the effect and read the frame state.
const globals = globalThis as Record<string, unknown>;
Object.defineProperty(globals, 'ambientOcclusionExample', {
  configurable: true,
  get: () => {
    const example = primary.example;
    return compare
      ? {
          ...example,
          get ready() {
            return example.ready && compare?.example.ready;
          }
        }
      : example;
  }
});
globals.ambientOcclusionCompare = compare?.example ?? null;
import.meta.hot?.dispose(() => {
  primary.finalize();
  compare?.finalize();
});

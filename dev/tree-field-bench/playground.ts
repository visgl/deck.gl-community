// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {OrbitView, type Deck, type OrbitViewState} from '@deck.gl/core';
import type {TreeLayer, TreeSpec} from '../../modules/layers/src/tree-layer/tree-layer';
import {
  getFieldMaxZoom,
  getFieldOrbitDistance,
  limitFieldCamera,
  orbitFieldCamera,
  type FieldOrbitCamera
} from './field-camera';
import type {FieldLightingEffect} from './field-lighting';

type FieldDeck = Deck<OrbitView[]> & {
  readonly trees: TreeLayer<TreeSpec> | undefined;
  readonly backend: string | undefined;
};
type View = 'overview' | 'tree' | 'macro' | 'dive';
type Point = OrbitViewState['target'];

const numberFormat = new Intl.NumberFormat('en-US');

export function mountFieldPlayground({
  deck,
  lighting,
  trees,
  fovy,
  getCamera
}: {
  deck: FieldDeck;
  lighting: FieldLightingEffect;
  trees: TreeSpec[];
  fovy: number;
  getCamera: (view: View, phase: number) => OrbitViewState;
}): (now: number) => void {
  const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const status = element('field-status');
  const height = element<HTMLInputElement>('tree-height');
  const radius = element<HTMLInputElement>('tree-radius');
  const foliage = element<HTMLInputElement>('tree-foliage');
  const wind = element<HTMLInputElement>('field-wind');
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('#field-views button')];
  let data = trees;
  let selected = Math.floor(data.length / 2);
  let pivot: Point | null = [0, 0, 0];
  let pivotFollowsZoom = true;
  let camera = normalize(getCamera('overview', 0));
  let view = new OrbitView({id: 'orchard', orbitAxis: 'Z', fovy, near: 0.005});
  let far = 1000;
  let dive = 0;
  let lastFrame: number | undefined;
  let lastReadout = 0;
  const intervals: number[] = [];

  function normalize(state: OrbitViewState): FieldOrbitCamera {
    return {...state, rotationX: state.rotationX ?? 0, rotationOrbit: state.rotationOrbit ?? 0};
  }

  function groundPoint(): Point {
    const position = data[selected].position ?? [0, 0, 0];
    return [position[0], position[1], position[2] ?? 0];
  }

  function updateCamera(next: FieldOrbitCamera): void {
    camera = limitFieldCamera(next, camera, innerHeight, fovy);
    const distance = getFieldOrbitDistance(camera.zoom, innerHeight, fovy);
    const nextFar = Math.max(
      1000,
      ((distance + Math.hypot(...camera.target) + 900) * 2 ** camera.zoom) / innerHeight
    );
    if (nextFar !== far) {
      far = nextFar;
      view = new OrbitView({id: 'orchard', orbitAxis: 'Z', fovy, near: 0.005, far});
    }
    deck.setProps({
      views: [view],
      viewState: {orchard: {...camera, maxZoom: getFieldMaxZoom(innerHeight, fovy)}}
    });
  }

  function showSelection(): void {
    const tree = data[selected];
    element('field-selection').textContent =
      `Tree ${numberFormat.format(selected + 1)} · ${tree.species}`;
    height.value = String(Number((tree.height ?? 3).toFixed(2)));
    radius.value = String(Number((tree.crownRadius ?? 2.25).toFixed(2)));
    foliage.value = String(tree.foliage ?? 1);
  }

  function updateTrees(props: {data?: TreeSpec[]; windStrength?: number}): void {
    const layers = deck.props.layers;
    if (!layers) return;
    deck.setProps({
      layers: layers.map(layer =>
        layer && !Array.isArray(layer) && layer.id === 'field' ? layer.clone(props) : layer
      )
    });
  }

  function edit(input: HTMLInputElement, name: 'height' | 'crownRadius' | 'foliage'): void {
    if (!input.checkValidity() || !Number.isFinite(input.valueAsNumber)) {
      showSelection();
      return;
    }
    data = data.slice();
    data[selected] = {...data[selected], [name]: input.valueAsNumber};
    updateTrees({data});
  }

  function setView(name: View): void {
    const sequence = ++dive;
    const [east, north, up] = groundPoint();
    const tree = data[selected];
    const pose = normalize(getCamera(name, 0));
    buttons.forEach(button =>
      button.setAttribute('aria-pressed', String(button.dataset.view === name))
    );
    if (name === 'dive') {
      pivotFollowsZoom = true;
      const start = performance.now();
      function step(now: number): void {
        if (sequence !== dive) return;
        const phase = Math.min((now - start) / 4000, 1);
        const next = normalize(getCamera('dive', phase));
        pivot = [next.target[0], next.target[1], 0];
        lighting.setShadowAnchor(next.target);
        updateCamera(next);
        if (phase < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
      return;
    }
    if (name === 'tree') pose.target = [east, north, up + (tree.height ?? 3) * 0.6];
    if (name === 'macro') {
      pose.target = [
        east,
        north - (tree.crownRadius ?? 2.25) * 0.75,
        up + (tree.height ?? 3) * 0.6
      ];
    }
    pivot = name === 'macro' ? null : name === 'tree' ? groundPoint() : [0, 0, 0];
    pivotFollowsZoom = name !== 'tree';
    lighting.setShadowAnchor(pose.target);
    updateCamera(pose);
  }

  for (const button of buttons) {
    button.onclick = () => setView(button.dataset.view as View);
  }
  height.onchange = () => edit(height, 'height');
  radius.onchange = () => edit(radius, 'crownRadius');
  foliage.onchange = () => edit(foliage, 'foliage');
  wind.onchange = () => {
    if (wind.checkValidity() && Number.isFinite(wind.valueAsNumber)) {
      updateTrees({windStrength: wind.valueAsNumber});
    }
  };

  deck.setProps({
    controller: {inertia: 150, doubleClickZoom: false},
    onViewStateChange: ({viewState, interactionState}) => {
      const {isRotating, isPanning, isZooming} = interactionState ?? {};
      if (!isRotating && !isPanning && !isZooming) return;
      dive++;
      let next = limitFieldCamera(
        normalize(viewState as OrbitViewState),
        camera,
        innerHeight,
        fovy
      );
      if (next === camera) return;
      if (pivot && isRotating && !isPanning && !isZooming) {
        next = orbitFieldCamera(camera, next, pivot, innerHeight, fovy);
      } else {
        const followsPan = isPanning && !isZooming;
        if (pivot && (followsPan || pivotFollowsZoom)) {
          pivot = [
            pivot[0] + next.target[0] - camera.target[0],
            pivot[1] + next.target[1] - camera.target[1],
            pivot[2]
          ];
          if (followsPan) pivotFollowsZoom = true;
        }
        lighting.setShadowAnchor(next.target);
      }
      updateCamera(next);
    },
    onClick: info => {
      const index = data.indexOf(info.object);
      if (index < 0) return;
      selected = index;
      if (pivot) pivot = groundPoint();
      pivotFollowsZoom = false;
      showSelection();
    }
  });
  showSelection();
  setView('overview');
  Object.assign(window, {
    treeFieldPlayground: {
      deck,
      lighting,
      setView,
      get pivot() {
        return pivot;
      }
    }
  });

  document.addEventListener('visibilitychange', () => {
    lastFrame = undefined;
  });

  return now => {
    if (document.visibilityState !== 'visible') return;
    const previous = lastFrame;
    lastFrame = now;
    if (previous === undefined) return;
    intervals.push(now - previous);
    if (intervals.length > 120) intervals.shift();
    if (now - lastReadout < 300 || intervals.length < 2) return;
    lastReadout = now;
    const fps = (1000 * intervals.length) / intervals.reduce((sum, interval) => sum + interval, 0);
    const sorted = [...intervals].sort((a, b) => a - b);
    const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
    const groups = deck.trees?.state.photoreal?.groups.values() ?? [];
    let color = 0;
    let near = 0;
    let shadows = 0;
    for (const group of groups) {
      for (const bucket of group.buckets) color += bucket.length;
      near += group.buckets[0].length;
      shadows += group.shadowBucket.length;
    }
    const fit = lighting.shadowDiagnostics;
    const backend = deck.backend === 'webgpu' ? 'WebGPU' : 'WebGL2';
    status.textContent = `${numberFormat.format(data.length)} trees · ${backend} · ${fps.toFixed(0)} fps · LOD bias 0`;
    element('field-p95').textContent = `${p95.toFixed(1)} ms`;
    element('field-color-count').textContent = numberFormat.format(color);
    element('field-near-count').textContent = numberFormat.format(near);
    element('field-shadow-count').textContent = numberFormat.format(shadows);
    element('field-texel').textContent = fit ? `${(fit.texelMetres * 100).toFixed(1)} cm` : '—';
  };
}

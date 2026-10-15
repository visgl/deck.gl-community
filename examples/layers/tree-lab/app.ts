// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {
  AmbientLight,
  CompositeLayer,
  COORDINATE_SYSTEM,
  Deck,
  DirectionalLight,
  LightingEffect,
  MapView,
  type Layer,
  type DeckProps,
  type Viewport
} from '@deck.gl/core';
import {BitmapLayer, TextLayer} from '@deck.gl/layers';
import {SimpleMeshLayer} from '@deck.gl/mesh-layers';
import {PlaneGeometry} from '@luma.gl/engine';
import {
  SplatLayer,
  SplatShadowPass,
  TreeLayer,
  type Season,
  type TreeSpec,
  type TreeType
} from '@deck.gl-community/layers';
import type {WebGLDevice} from '@luma.gl/webgl';
import './style.css';

const SPECIES: TreeType[] = [
  'banyan',
  'pine',
  'oak',
  'palm',
  'birch',
  'cherry',
  'mangrove',
  'citrus'
];
const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter'];
const SUN_DIRECTION: [number, number, number] = [0.8, 0.2, -1.6];
const SHADOW_MAP_SIZE = 512;
const SHADOW_SPAN = 48;
class GroundShadowLightingEffect extends LightingEffect {
  override getShaderModuleProps(
    layer: Layer,
    otherShaderModuleProps: Parameters<LightingEffect['getShaderModuleProps']>[1]
  ) {
    const props = super.getShaderModuleProps(layer, otherShaderModuleProps);
    // Keep opaque wood shadows on the ground; the canopy transmission overlay is composited separately.
    if (layer.id === 'ground') return props;
    return {...props, shadow: {...props.shadow, shadowEnabled: false}};
  }
}
type MountOptions = Pick<
  DeckProps<MapView>,
  | 'device'
  | 'initialViewState'
  | 'widgets'
  | 'onViewStateChange'
  | 'onAfterRender'
  | 'onDeviceInitialized'
> & {
  onDeckInitialized?: (deck: Deck<MapView>) => void;
};

function collectLayers(layer: Layer): Layer[] {
  return layer instanceof CompositeLayer
    ? [layer, ...layer.getSubLayers().flatMap(collectLayers)]
    : [layer];
}

function createTreeShadowProjection(viewport: Viewport) {
  const scale = 2 / (SHADOW_SPAN * viewport.distanceScales.unitsPerMeter[2]);
  const lightSlopeX = -SUN_DIRECTION[0] / SUN_DIRECTION[2];
  const lightSlopeY = -SUN_DIRECTION[1] / SUN_DIRECTION[2];
  return {
    matrix: [
      scale,
      0,
      0,
      0,
      0,
      scale,
      0,
      0,
      scale * lightSlopeX,
      scale * lightSlopeY,
      0,
      0,
      0,
      0,
      0,
      1
    ],
    center: [0, 0, 0, 0],
    width: SHADOW_MAP_SIZE,
    height: SHADOW_MAP_SIZE
  };
}

function createShadowImage(device: WebGLDevice, shadowPass: SplatShadowPass) {
  const size = shadowPass.transmission!.width;
  const pixels = device.readPixelsToArrayWebGL(shadowPass.transmission!) as Uint8Array;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d')!;
  const image = context.createImageData(size, size);
  const transmission = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const source = ((size - 1 - y) * size + x) * 4;
      transmission[y * size + x] = Math.max(0, 1 - pixels[source] / 255 - 0.015);
    }
  }
  const inside = new Uint8Array(size * size);
  const padded = new Uint8Array(size * size);
  for (let i = 0; i < transmission.length; i++) if (transmission[i] > 0.005) inside[i] = 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!inside[y * size + x]) continue;
      for (let offsetY = -7; offsetY <= 7; offsetY++) {
        for (let offsetX = -7; offsetX <= 7; offsetX++) {
          if (offsetX * offsetX + offsetY * offsetY > 49) continue;
          const targetX = x + offsetX;
          const targetY = y + offsetY;
          if (targetX >= 0 && targetX < size && targetY >= 0 && targetY < size)
            padded[targetY * size + targetX] = 1;
        }
      }
    }
  }
  const outside = new Uint8Array(size * size);
  const queue = new Int32Array(size * size);
  let head = 0;
  let tail = 0;
  const addOutside = (index: number) => {
    if (!outside[index] && !padded[index]) {
      outside[index] = 1;
      queue[tail++] = index;
    }
  };
  for (let i = 0; i < size; i++) {
    addOutside(i);
    addOutside((size - 1) * size + i);
    addOutside(i * size);
    addOutside(i * size + size - 1);
  }
  while (head < tail) {
    const index = queue[head++];
    const x = index % size;
    if (x > 0) addOutside(index - 1);
    if (x + 1 < size) addOutside(index + 1);
    if (index >= size) addOutside(index - size);
    if (index + size < size * size) addOutside(index + size);
  }
  for (let i = 0; i < transmission.length; i++)
    transmission[i] = outside[i] ? Math.min(transmission[i], 0.045) : 0.18;
  const weights = [1, 4, 6, 4, 1];
  const horizontal = new Float32Array(size * size);
  const filtered = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let offset = -2; offset <= 2; offset++)
        sum +=
          weights[offset + 2] *
          transmission[y * size + Math.max(0, Math.min(size - 1, x + offset))];
      horizontal[y * size + x] = sum / 16;
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let offset = -2; offset <= 2; offset++)
        sum +=
          weights[offset + 2] * horizontal[Math.max(0, Math.min(size - 1, y + offset)) * size + x];
      filtered[y * size + x] = sum / 16;
    }
  }
  // Close splat-scale gaps and fill holes so the soft shadow follows the projected crown.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const target = (y * size + x) * 4;
      const opacity = Math.min(0.28, filtered[y * size + x] * 1.45);
      image.data[target] = 35;
      image.data[target + 1] = 43;
      image.data[target + 2] = 32;
      image.data[target + 3] = Math.round(opacity * 255);
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

/** Mount a focused TreeLayer viewer for one species and its crown-spread trait. */
export function mountTreeLabExample(
  container: HTMLElement,
  options: MountOptions = {}
): () => void {
  const root = container.ownerDocument.createElement('div');
  root.className = 'trees-demo';
  root.innerHTML = `<div class="trees-controls">
    <div class="trees-heading"><strong>TreeLayer</strong><span>One tree · live traits</span></div>
    <label>Species <select name="species">${SPECIES.map(
      species =>
        `<option value="${species}"${species === 'banyan' ? ' selected' : ''}>${species}</option>`
    ).join('')}</select></label>
    <label>Season <select name="season">${SEASONS.map(
      season => `<option${season === 'summer' ? ' selected' : ''}>${season}</option>`
    ).join('')}</select></label>
    <label class="trees-spread">Crown spread <input name="spread" type="range" min="0.6" max="1.5" step="0.1" value="1"><output name="spread-value">1.0×</output></label>
    <label class="trees-shadow"><input name="shadows" type="checkbox"${options.device?.type === 'webgpu' ? ' disabled' : ' checked'}>Tree shadows</label>
  </div><div class="trees-stage"></div>`;
  container.append(root);
  const stage = root.querySelector<HTMLDivElement>('.trees-stage')!;
  const control = <T extends HTMLInputElement | HTMLSelectElement>(name: string) =>
    root.querySelector<T>(`[name="${name}"]`)!;
  const shadows = control<HTMLInputElement>('shadows');
  const spreadOutput = root.querySelector<HTMLOutputElement>('[name="spread-value"]')!;
  const groundMesh = new PlaneGeometry({type: 'x,y', xlen: 100, ylen: 100});
  const lighting = new GroundShadowLightingEffect({
    ambient: new AmbientLight({intensity: 1}),
    sun: new DirectionalLight({
      intensity: 0.5,
      direction: SUN_DIRECTION,
      _shadow: !shadows.disabled
    })
  });
  lighting.shadowColor = [0.04, 0.05, 0.03, 0.28];
  const coordinateProps = {
    coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
    coordinateOrigin: [0, 0, 0] as [number, number, number]
  };
  let deck!: Deck<MapView>;
  let device: Parameters<NonNullable<DeckProps<MapView>['onDeviceInitialized']>>[0] | null = null;
  let shadowPass: SplatShadowPass | undefined;
  let shadowImage: HTMLCanvasElement | undefined;
  let shadowPhase: 'idle' | 'prepare' | 'render' = 'prepare';
  let activeShadowProjection: ReturnType<typeof createTreeShadowProjection> | undefined;
  let shadowTimer: number | undefined;
  let render = () => {};
  deck = new Deck<MapView>({
    ...options,
    parent: stage,
    views: new MapView(),
    initialViewState: options.initialViewState ?? {
      longitude: 0,
      latitude: 0,
      zoom:
        20 + Math.log2(Math.max(0.25, Math.min(stage.clientWidth / 400, stage.clientHeight / 600))),
      pitch: 45,
      bearing: 20
    },
    controller: true,
    useDevicePixels: 1,
    // Billboard label backgrounds are visual-only; casting them creates a large floating quad.
    layerFilter: ({layer, renderPass}) => renderPass !== 'shadow' || layer.id !== 'labels',
    getTooltip: ({object}) => object?.species ?? null,
    onDeviceInitialized: initializedDevice => {
      device = initializedDevice;
      if (initializedDevice.type === 'webgpu') {
        shadows.checked = false;
        shadows.disabled = true;
        shadowPhase = 'idle';
      }
      options.onDeviceInitialized?.(initializedDevice);
    },
    onAfterRender: params => {
      options.onAfterRender?.(params);
      if (shadows.disabled || !shadows.checked || !device || device.type !== 'webgl') return;
      shadowPass ??= new SplatShadowPass(device);
      const layers = (deck.props.layers as Layer[]).flatMap(collectLayers);
      const canopyLayers = layers.filter(
        (layer): layer is SplatLayer => layer instanceof SplatLayer
      );
      if (shadowPhase === 'prepare') {
        const viewport = deck.getViewports()[0];
        if (!viewport) return;
        if (!canopyLayers.length) {
          shadowImage = undefined;
          shadowPhase = 'idle';
          render();
          return;
        }
        activeShadowProjection = createTreeShadowProjection(viewport);
        for (const layer of canopyLayers) layer.prepareShadow([activeShadowProjection], viewport);
        shadowPhase = 'render';
        deck.redraw('canopy-shadow-selection');
        return;
      }
      if (shadowPhase === 'render') {
        const viewports = deck.getViewports();
        if (!viewports.length) return;
        shadowPass.renderTransmission(
          {layers, viewports, pass: 'shadow-transmission'},
          activeShadowProjection ?? createTreeShadowProjection(viewports[0])
        );
        shadowImage = createShadowImage(device as WebGLDevice, shadowPass);
        shadowPhase = 'idle';
        render();
      }
    }
  });
  options.onDeckInitialized?.(deck);
  render = () => {
    const species = control<HTMLSelectElement>('species').value as TreeType;
    const season = control<HTMLSelectElement>('season').value as Season;
    const spread = Number(control<HTMLInputElement>('spread').value);
    const data: TreeSpec[] = [{species, position: [0, 0, 0]}];
    spreadOutput.textContent = `${spread.toFixed(1)}×`;
    deck.setProps({
      effects: [lighting],
      layers: [
        new SimpleMeshLayer({
          ...coordinateProps,
          id: 'ground',
          data: [{position: [0, 0, -0.05]}],
          mesh: groundMesh,
          getColor: [219, 228, 210],
          material: {ambient: 1, diffuse: 0, shininess: 0},
          shadowEnabled: false
        }),
        ...(shadowImage
          ? [
              new BitmapLayer({
                ...coordinateProps,
                id: 'canopy-shadow',
                image: shadowImage,
                bounds: [-SHADOW_SPAN / 2, -SHADOW_SPAN / 2, SHADOW_SPAN / 2, SHADOW_SPAN / 2],
                shadowEnabled: false,
                parameters: {depthWriteEnabled: false, depthCompare: 'less-equal'}
              })
            ]
          : []),
        new TreeLayer<TreeSpec>({
          ...coordinateProps,
          id: 'trees',
          data,
          shadowEnabled: shadows.checked && !shadows.disabled,
          maxShadowSplats: 2048,
          getTree: tree => ({
            ...tree,
            season,
            wind: false,
            characteristics: {crownSpread: spread}
          }),
          pickable: true,
          updateTriggers: {getTree: [season, spread]}
        }),
        new TextLayer<TreeSpec>({
          ...coordinateProps,
          id: 'labels',
          data,
          getPosition: tree => [tree.position![0], tree.position![1] - 9, 0.2],
          getText: tree => {
            const name = tree.species!;
            return name[0].toUpperCase() + name.slice(1);
          },
          getSize: 18,
          getColor: [35, 48, 36],
          getAlignmentBaseline: 'bottom',
          fontFamily: 'system-ui, sans-serif',
          fontWeight: 600,
          sizeUnits: 'pixels',
          sizeMinPixels: 16,
          billboard: true,
          background: true,
          backgroundPadding: [6, 3],
          backgroundBorderRadius: 5,
          getBackgroundColor: [250, 252, 247, 245]
        })
      ]
    });
  };
  const onInput = (event: Event) => {
    window.clearTimeout(shadowTimer);
    const changedControl = event.target as HTMLInputElement | HTMLSelectElement;
    if (changedControl.name === 'shadows') {
      shadowImage = undefined;
      shadowPhase = shadows.checked && !shadows.disabled ? 'prepare' : 'idle';
      render();
      return;
    }
    shadowPhase = 'idle';
    render();
    if (shadows.checked && !shadows.disabled)
      shadowTimer = window.setTimeout(() => {
        shadowPhase = 'prepare';
        deck.redraw('canopy-shadow-traits');
      }, 160);
  };
  root.addEventListener('input', onInput);
  render();
  return () => {
    window.clearTimeout(shadowTimer);
    root.removeEventListener('input', onInput);
    shadowPass?.destroy();
    deck.finalize();
    root.remove();
  };
}

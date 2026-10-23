// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {
  COORDINATE_SYSTEM,
  Deck,
  MapView,
  WebMercatorViewport,
  type MapViewState
} from '@deck.gl/core';
import {Model} from '@luma.gl/engine';
import {webgl2Adapter} from '@luma.gl/webgl';
import {expect, it, vi} from 'vitest';
import {
  SplatLayer,
  TreeLayer,
  type TreeCharacteristics,
  type TreeSpec,
  type TreeType
} from '../../src';

type FrameSample = {
  phase: 'settled' | 'rotate' | 'zoom';
  draws: number;
  destroyed: number;
  splats: number;
};

const STAGE_WIDTH = 800;
const STAGE_HEIGHT = 600;
// Eight species intentionally use separate shared foliage templates. Refinement may retain old and
// new representations together, so this is a bounded mixed-source pass count rather than a single
// monolithic draw.
const MAX_MIXED_CANOPY_PASSES = 64;

const SPECIES: TreeType[] = [
  'pine',
  'oak',
  'palm',
  'birch',
  'cherry',
  'banyan',
  'mangrove',
  'citrus'
];
const DIMENSIONS: Record<TreeType, Pick<TreeSpec, 'height' | 'crownRadius' | 'trunkRadius'>> = {
  pine: {height: 14.5, crownRadius: 2.8, trunkRadius: 0.29},
  oak: {height: 10.5, crownRadius: 3.6, trunkRadius: 0.32},
  palm: {height: 11.5, crownRadius: 3, trunkRadius: 0.22},
  birch: {height: 9.5, crownRadius: 2.3, trunkRadius: 0.17},
  cherry: {height: 7.2, crownRadius: 3.1, trunkRadius: 0.2},
  banyan: {height: 11, crownRadius: 4.8, trunkRadius: 0.38},
  mangrove: {height: 8.5, crownRadius: 3.5, trunkRadius: 0.25},
  citrus: {height: 5.6, crownRadius: 2.5, trunkRadius: 0.16}
};
// Two shared morphology batches per species, as a varied production grove would author them.
const MORPHOLOGIES: TreeCharacteristics[] = [
  {seed: 19, crownSpread: 0.94, crownDepth: 0.94, crownAsymmetry: 0.78, branchDensity: 0.92},
  {seed: 73, crownSpread: 1.1, crownDepth: 1.08, crownAsymmetry: 1.2, branchDensity: 1.12}
];
const SPACING = 1.6;

// A dense 4x4 arrangement keeps every species and morphology batch inside one close camera
// frustum without asking a software adapter to rasterize a production-scale forest.
const forest: TreeSpec[] = SPECIES.flatMap((species, speciesIndex) =>
  MORPHOLOGIES.map((characteristics, profileIndex) => {
    const cell = speciesIndex * 2 + profileIndex;
    return {
      position: [((cell % 4) - 1.5) * SPACING, (Math.floor(cell / 4) - 1.5) * SPACING, 0],
      species,
      ...DIMENSIONS[species],
      characteristics,
      season: 'summer'
    };
  })
);

const MAP_ORIGIN = new WebMercatorViewport({width: 1, height: 1});
const METER_ZOOM = Math.log2(1 / MAP_ORIGIN.distanceScales.unitsPerMeter[0]);
const [longitude, latitude] = MAP_ORIGIN.addMetersToLngLat([0, 0], [0, 0]);
const VIEW_STATE: MapViewState = {
  longitude,
  latitude,
  position: [0, 0, 3],
  pitch: 60,
  bearing: 24,
  zoom: METER_ZOOM + Math.log2(STAGE_WIDTH / 12)
};

it('keeps mixed canopy passes bounded without destroying models during camera refinement', async () => {
  const parent = document.createElement('div');
  parent.style.cssText = `width:${STAGE_WIDTH}px;height:${STAGE_HEIGHT}px`;
  document.body.append(parent);
  const samples: FrameSample[] = [];
  const errors: string[] = [];
  let frames = 0;
  let draws = 0;
  let destroyed = 0;
  let phase: FrameSample['phase'] = 'settled';
  const originalDraw = Model.prototype.draw;
  const draw = vi.spyOn(Model.prototype, 'draw').mockImplementation(function (pass) {
    if (this.id.includes('canopy')) draws++;
    return originalDraw.call(this, pass);
  });
  const originalDestroy = Model.prototype.destroy;
  const destroy = vi.spyOn(Model.prototype, 'destroy').mockImplementation(function () {
    if (this.id.includes('canopy')) destroyed++;
    return originalDestroy.call(this);
  });
  const trees = new TreeLayer<TreeSpec>({
    id: 'mixed-trees',
    data: forest,
    coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
    coordinateOrigin: [0, 0, 0]
  });
  const deck: Deck<MapView> = new Deck({
    parent,
    width: STAGE_WIDTH,
    height: STAGE_HEIGHT,
    useDevicePixels: false,
    _animate: true,
    deviceProps: {type: 'webgl', adapters: [webgl2Adapter]},
    views: new MapView({id: 'mixed-trees', nearZMultiplier: 0.02, altitude: 3}),
    viewState: VIEW_STATE,
    layers: [trees],
    onError: error => errors.push(error.message),
    onBeforeRender() {
      draws = 0;
      destroyed = 0;
    },
    onAfterRender() {
      // Skip the first frame, which uploads every template.
      if (++frames === 1) return;
      const splats = deck
        .layerManager!.getLayers()
        .reduce(
          (sum, layer) => sum + (layer instanceof SplatLayer ? layer.splatStats.renderedSplats : 0),
          0
        );
      samples.push({phase, draws, destroyed, splats});
      if (samples.length === 3) deck['animationLoop']?.stop();
      else if (samples.length === 1) {
        phase = 'rotate';
        deck.setProps({viewState: {...VIEW_STATE, bearing: 30, pitch: 35}});
      } else {
        phase = 'zoom';
        deck.setProps({
          viewState: {...VIEW_STATE, bearing: 60, pitch: 55, zoom: VIEW_STATE.zoom + 0.35}
        });
      }
    }
  });
  try {
    await expect.poll(() => samples.length, {timeout: 60_000}).toBe(3);
    expect(errors).toEqual([]);
    expect(samples.map(sample => sample.phase)).toEqual(['settled', 'rotate', 'zoom']);
    expect(samples.every(sample => sample.splats > 0)).toBe(true);
    expect(
      samples.every(sample => sample.draws > 0 && sample.draws <= MAX_MIXED_CANOPY_PASSES)
    ).toBe(true);
    expect(samples.every(sample => sample.destroyed === 0)).toBe(true);
  } finally {
    deck.finalize();
    parent.remove();
    draw.mockRestore();
    destroy.mockRestore();
  }
}, 90_000);

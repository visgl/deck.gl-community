// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * basemap-layers' runner of the shared basemap conformance corpus (`dev/basemap-conformance`):
 * renders every scene with MapLibre GL JS (the reference) and with `BasemapLayer`, and saves the
 * renders for the scorer. Report only: a test fails when a render is not a valid measurement
 * (errors, off-origin requests, missing fixtures), never on its scores.
 *
 *   yarn test-conformance
 *   VITE_CONFORMANCE_SCENES=paris-streets-z13.3 CONFORMANCE_RECORD=1 yarn test-conformance
 *   yarn conformance-report
 */

import '@fontsource/noto-sans/latin-400.css';
import '@fontsource/noto-sans/latin-400-italic.css';
import '@fontsource/noto-sans/latin-700.css';
import '@fontsource/montserrat/latin-400.css';
import '@fontsource/montserrat/latin-400-italic.css';
import '@fontsource/montserrat/latin-500.css';
import '@fontsource/montserrat/latin-500-italic.css';
import '@fontsource/open-sans/latin-400-italic.css';
import {expression, latest} from '@maplibre/maplibre-gl-style-spec';
import * as maplibregl from 'maplibre-gl';
import {beforeAll, describe, expect, test} from 'vitest';
import {
  VIEWPORT,
  createMapLibreRenderer,
  runConformanceScene,
  saveRendererManifest,
  selectScenes,
  type ConformanceRenderer
} from '../../../../dev/basemap-conformance/src/index';
import {renderBasemapLayer} from '../reference-render/renderers';
import packageJson from '../../package.json';

const env = (import.meta as any).env || {};
const SCENES = selectScenes(env.VITE_CONFORMANCE_SCENES);
const RENDERERS = (env.VITE_CONFORMANCE_RENDERERS || 'maplibre,basemap-layer').split(',');

/** The fonts the styles' `text-font` stacks map to when a renderer falls back to browser fonts. */
const FONTS = [
  '400 16px "Noto Sans"',
  'italic 400 16px "Noto Sans"',
  '700 16px "Noto Sans"',
  '400 16px Montserrat',
  'italic 400 16px Montserrat',
  '500 16px Montserrat',
  'italic 500 16px Montserrat',
  'italic 400 16px "Open Sans"'
];

/** `BasemapLayer`, through basemap-layers' reference-render harness (probe layers, sorted atlases). */
const basemapLayerRenderer: ConformanceRenderer = {
  id: 'basemap-layer',
  name: `BasemapLayer ${packageJson.version}`,
  supports: () => true,
  async render(scene, style) {
    // The scene's camera, as MapLibre's renderer reads it from the scene.
    const render = await renderBasemapLayer(
      style,
      scene as any,
      {},
      {pitch: scene.pitch, bearing: scene.bearing}
    );
    const unsorted = render.unsortedFontAtlases || [];
    return {
      pixels: render.pixels,
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      labels: render.labels,
      labelNote: 'Picked label text after collision (ProbeBasemapLayer)',
      problems: [
        ...render.problems,
        ...unsorted.map(key => `Font atlas built in tile load order: ${key}`)
      ],
      meta: {
        renderMs: Math.round(render.duration),
        firstDrawMs: Math.round(render.firstDrawDuration ?? 0),
        layers: render.layers,
        draws: render.draws,
        device: 'webgl2'
      }
    };
  }
};

const renderers = [
  createMapLibreRenderer({maplibregl, styleSpec: {expression, latest}}),
  basemapLayerRenderer
].filter(renderer => RENDERERS.includes(renderer.id));

beforeAll(async () => {
  await Promise.all(FONTS.map(font => document.fonts.load(font)));
});

for (const renderer of renderers) {
  describe(`conformance: ${renderer.name}`, () => {
    // First, so that the scorer reports a scene whose render never arrives as missing.
    beforeAll(() => saveRendererManifest(renderer, SCENES));
    test.each(SCENES.filter(scene => renderer.supports(scene)))('$id', async scene => {
      const saved = await runConformanceScene(renderer, scene);
      expect(saved.fixtureMisses, 'missing fixtures: run with CONFORMANCE_RECORD=1').toEqual([]);
      expect(saved.problems, 'the render is not a valid measurement').toEqual([]);
    }, 400_000);
  });
}

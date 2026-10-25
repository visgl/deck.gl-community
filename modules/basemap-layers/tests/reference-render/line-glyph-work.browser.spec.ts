// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * Counts the work of placing glyphs along lines while the view moves, frame by frame, over a
 * reference scene: rows whose glyphs are placed again, collision paths projected, and glyph
 * attribute refreshes, rows filled and bytes written. No timing is measured; the counts are written
 * to `__output__/line-glyph-work.json` for benchmarks run elsewhere.
 *
 * At a fixed zoom, neither an orbit nor a tilt places glyphs again: an orbit refreshes the glyph
 * attribute only when the bearing crosses a keep-upright step, to turn labels upright.
 */

import '@fontsource/montserrat/latin-400.css';
import '@fontsource/montserrat/latin-400-italic.css';
import '@fontsource/open-sans/latin-400-italic.css';
import type {Deck} from '@deck.gl/core';
import {Model} from '@luma.gl/engine';
import type {WebGLDevice} from '@luma.gl/webgl';
import {expect, test, vi} from 'vitest';
import {commands} from 'vitest/browser';
import {LINE_GLYPH_ATTRIBUTE_STATS} from '../../src/label-text-layer';
import {LINE_GLYPH_STATS} from '../../src/mvt-label-layer';
import {loadReferenceStyle} from './fixtures';
import {renderBasemapLayer} from './renderers';
import {DEFAULT_SCENES} from './scenes';

type ViewState = {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
};

type FrameWork = {
  frame: number;
  view: ViewState;
  rows: number;
  cacheHits: number;
  placementPaths: number;
  attributeRefreshes: number;
  attributeFills: number;
  attributeBytes: number;
};

function snapshot() {
  return {...LINE_GLYPH_STATS, ...LINE_GLYPH_ATTRIBUTE_STATS};
}

/**
 * Draws one frame at `viewState`, 16 ms after the last on the deck's timeline: label placement
 * tells frames apart by their timeline time, which only advances by itself while animating.
 */
function drawFrame(deck: Deck<any>, viewState: ViewState): Promise<void> {
  const timeline = (deck as any).layerManager.context.timeline;
  timeline.setTime(timeline.getTime() + 16);
  return new Promise(resolve => {
    deck.setProps({viewState, onAfterRender: () => resolve()});
    deck.redraw('line glyph work');
  });
}

/** Moves the view through `views`, counting the work of each frame. */
async function countWork(deck: Deck<any>, views: ViewState[]): Promise<FrameWork[]> {
  const frames: FrameWork[] = [];
  for (const [frame, view] of views.entries()) {
    const before = snapshot();
    await drawFrame(deck, view);
    const after = snapshot();
    frames.push({
      frame,
      view,
      rows: after.rows - before.rows,
      cacheHits: after.cacheHits - before.cacheHits,
      placementPaths: after.placementPaths - before.placementPaths,
      attributeRefreshes: after.refreshes - before.refreshes,
      attributeFills: after.fills - before.fills,
      attributeBytes: after.bytes - before.bytes
    });
  }
  return frames;
}

const scene = DEFAULT_SCENES.find(({id}) => id === 'paris-carto-positron-z14.2')!;

test('counts the work of glyphs along lines in an orbit, a tilt and a zoom', async () => {
  const style = await loadReferenceStyle(scene.style);
  const work: Record<string, FrameWork[]> = {};
  const base = {longitude: scene.center[0], latitude: scene.center[1], zoom: scene.zoom};
  await renderBasemapLayer(
    style,
    scene,
    {},
    {
      onRendered: async deck => {
        // The scene has rendered. Count CPU placement and attribute work while stepping
        // views, without queuing 120 frames of GPU rasterization on software renderers.
        const draw = vi.spyOn(Model.prototype, 'draw').mockReturnValue(true);
        try {
          // Settles the controlled view first.
          await drawFrame(deck, {...base, pitch: 0, bearing: 0});
          await drawFrame(deck, {...base, pitch: 0, bearing: 0});
          work.orbit = await countWork(
            deck,
            Array.from({length: 60}, (_, i) => ({...base, pitch: 40, bearing: (i + 1) * 3}))
          );
          work.tilt = await countWork(
            deck,
            Array.from({length: 30}, (_, i) => ({...base, pitch: i, bearing: 180}))
          );
          work.zoom = await countWork(
            deck,
            Array.from({length: 30}, (_, i) => ({
              ...base,
              zoom: scene.zoom + i / 64,
              pitch: 0,
              bearing: 0
            }))
          );
        } finally {
          draw.mockRestore();
          // Keep submitted GPU work inside the test, rather than deferring it to iframe removal.
          (deck.device as WebGLDevice).gl.finish();
        }
      }
    }
  );
  await commands.writeFile(
    'modules/basemap-layers/tests/reference-render/__output__/line-glyph-work.json',
    JSON.stringify(work, null, 1)
  );
  const total = (frames: FrameWork[], key: keyof FrameWork) =>
    frames.reduce((sum, frame) => sum + (frame[key] as number), 0);
  // Labels along lines are on screen, and their collision follows their glyphs.
  expect(total(work.orbit, 'placementPaths')).toBeGreaterThan(0);
  // Neither tilting nor turning the map places glyphs again at a fixed zoom: a turn only checks
  // which way each label reads, and refreshes the glyphs of frames that cross a 5 degree step.
  expect(total(work.tilt.slice(1), 'rows')).toBe(0);
  expect(total(work.tilt.slice(1), 'attributeRefreshes')).toBe(0);
  expect(total(work.orbit.slice(1), 'rows')).toBe(0);
  for (const frame of work.orbit.slice(1)) {
    const previous = work.orbit[frame.frame - 1].view.bearing;
    const crossed = Math.round(previous / 5) !== Math.round(frame.view.bearing / 5);
    if (!crossed) {
      expect(frame.attributeRefreshes, `frame ${frame.frame}`).toBe(0);
    }
  }
  // Zooming places them again at each 1/128 zoom step, refreshing only the glyph attribute.
  expect(total(work.zoom, 'rows')).toBeGreaterThan(0);
  expect(total(work.zoom, 'attributeRefreshes')).toBeGreaterThan(0);
}, 180_000);

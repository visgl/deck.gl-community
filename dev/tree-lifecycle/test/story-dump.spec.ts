// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {writeFileSync} from 'node:fs';
import type {CropConfig} from '@deck.gl-community/layers';
import {describe, expect, it} from 'vitest';
import {getCameraEye} from '../story/camera';
import {BEAT_TABLE, CYCLE_SECONDS, getStoryState, LOOP} from '../story/story';

/**
 * Path to write the table to, as a sanity check to read: `STORY_DUMP=/tmp/story.txt yarn vitest
 * ...`.
 */
const DUMP_PATH = process.env.STORY_DUMP;

function format(value: number, digits = 2): string {
  return value.toFixed(digits);
}

/** Key values at a chosen cycle second, in a 9:16 frame. */
function getRow(t: number): string {
  const state = getStoryState(t, {aspect: 9 / 16});
  const {cycle} = state;
  const hero = state.trees[0];
  const standing = state.trees.filter(tree => (tree.growth as number) > 0).length;
  const down = state.trees.filter(tree => ((tree.lean as number[])[0] ?? 0) > 60).length;
  const eye = getCameraEye(state.camera);
  const sun = (Math.asin(state.sky.sunDirection[2]) * 180) / Math.PI;
  const crop = hero.crop as CropConfig[];
  return [
    format(t, 2).padStart(6),
    `seam ${format(cycle.seam, 2).padStart(6)}`,
    cycle.world.padEnd(5),
    `rate ${format(cycle.rate)}`,
    `clk ${format(cycle.clock, 1).padStart(5)}`,
    state.beat.padEnd(13),
    format(state.year, 4).padStart(8),
    format(state.season, 2),
    state.timeline.readout.padEnd(8),
    `sun ${format(sun, 1).padStart(5)}`,
    `key ${format(state.key.intensity)}`,
    `amb ${format(state.ambient.intensity)}`,
    `cld ${format(state.sky.cloudCover)}`,
    `stm ${format(state.sky.storm)}`,
    `eye ${format(state.sky.eye)}`,
    `wnd ${format(state.wind.strength)}@${format(state.wind.bearing, 0).padStart(3)}`,
    `gst ${format(state.wind.gust)}`,
    `rain ${format(state.weather.rain)}`,
    `fog ${format(state.fog.density * 1000, 2)}`,
    `exp ${format(state.grade.exposure)}`,
    `con ${format(state.grade.contrast)}`,
    `sat ${format(state.grade.saturation)}`,
    `deck ${format(state.sky.deckShadow.shaded)}/${format(state.sky.deckShadow.sunlit)}` +
      `@${format(state.sky.deckShadow.position, 0)}`,
    `wat ${format(state.ground.flood.level)}`,
    `g ${format(hero.growth as number, 3)}`,
    `fol ${format(hero.foliage as number)}`,
    `dmg ${format(hero.damage as number)}`,
    `blo ${format(crop[0].count, 0).padStart(4)}`,
    `fru ${format(crop[1].count, 0).padStart(4)}`,
    `trees ${String(standing).padStart(3)}/${String(down).padStart(2)}`,
    `orb ${format(state.camera.orbit, 0).padStart(3)}`,
    `pit ${format(state.camera.pitch, 0).padStart(3)}`,
    `d ${format(state.camera.distance, 3).padStart(7)}`,
    `eye ${eye.map(value => format(value, 2)).join(',')}`,
    `n/f ${format(state.camera.near, 3)}/${format(state.camera.far, 1)}`,
    `shk ${format(Math.hypot(...state.shake), 2)}`,
    `bars ${state.timeline.bars.length}`,
    `flags ${state.timeline.flags.length}`,
    `span ${format(state.timeline.spanEnd, 3)}`,
    state.caption ? `"${state.caption.text}"` : ''
  ].join(' ');
}

describe('story dump', () => {
  it('has a value for the start of every beat, the file start and the last frame', () => {
    const lastFrame = CYCLE_SECONDS - 1 / 30;
    const rows = [...BEAT_TABLE.map(beat => beat.start), LOOP.fileStart, lastFrame].map(getRow);
    expect(rows.length).toBe(BEAT_TABLE.length + 2);
    if (DUMP_PATH) {
      const seconds = Array.from({length: CYCLE_SECONDS * 2}, (_, index) => index / 2);
      writeFileSync(
        DUMP_PATH,
        `Beat starts, the file start and the last frame:\n${rows.join('\n')}\n\n` +
          `Every half second:\n${seconds.map(getRow).join('\n')}\n`
      );
    }
  });
});

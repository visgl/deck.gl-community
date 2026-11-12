// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * Thirty Years as a pure function of time: `getStoryState(t, options)`, the only producer of the
 * `StoryState` that layers, the stage and the overlay read. Any time is taken mod the cycle, and
 * the numbers live in the tables of the files it composes.
 */

import {
  getBeat,
  getContentSeconds,
  getCycleSeconds,
  getFallSeconds,
  getSceneSeconds,
  getSeamSeconds,
  getSeason,
  getTimeRate,
  getWorld,
  getYear,
  getYearRate,
  isInSeamWindow,
  LOOP
} from './beats';
import {getCameraShake, getStoryCamera} from './camera';
import {getEnvironment} from './environment';
import {getFlood, getSilt} from './flood';
import {
  getGroveRows,
  getMagicRing,
  getReplantMicrojets,
  getReplantNets,
  getReplantSites,
  getSplashes,
  writeTrees
} from './grove';
import {getHeroPlanting, getHeroProps} from './props';
import type {StoryCycle, StoryLightShaft, StoryOptions, StoryState, Vec3} from './story-types';
import {getCaption, getTimeline} from './yield';

export {BEAT_TABLE, CYCLE_SECONDS, FILM_SECONDS, LOOP} from './beats';

/** Width over height of the default frame. */
const DEFAULT_ASPECT = 16 / 9;

/** The shaft of light through the eye of the storm: where it stands, and how wide. */
const EYE_SHAFT = {position: [-1.5, 1, 0] as Vec3, radius: 11};

/**
 * Where `t` is in the cycle, composed from the side of the swap its own second is on, or from the
 * one `options.world` asks for inside `LOOP.cover`.
 */
function getCycle(t: number, options?: StoryOptions): StoryCycle {
  const cover = isInSeamWindow(t, LOOP.cover);
  return {
    seconds: getCycleSeconds(t),
    seam: getSeamSeconds(t),
    world: cover && options?.world ? options.world : getWorld(t),
    rate: getTimeRate(t),
    clock: getSceneSeconds(t),
    fall: getFallSeconds(t),
    cover: cover ? 1 : 0
  };
}

/**
 * Everything a frame is, at any second `t`, taken mod the cycle: it never clamps. The same `t` and
 * options always give the same values, whatever came before. `state.trees` and its rows keep their
 * identity from call to call, with their numbers written in place, as deck.gl's `data` wants, so
 * hold on to a frame's trees only until the next call.
 *
 * Tracks of cycle seconds are read at the content second, `getContentSeconds(t, world)`; what runs
 * through the swap (the rate, the fall, the camera and the roll-over) gets `t` itself and the
 * world.
 */
export function getStoryState(t: number, options?: StoryOptions): StoryState {
  const aspect = options?.aspect ?? DEFAULT_ASPECT;
  const cycle = getCycle(t, options);
  const {world} = cycle;
  const content = getContentSeconds(t, world);
  const beat = getBeat(content);
  const year = getYear(content);
  const environment = getEnvironment(t, world);
  // The frame's own wind, so each tree's bend is `state.wind`'s, in whichever world.
  const trees = writeTrees(content, year, getYearRate(content), environment.wind);
  const flood = getFlood(content, getSplashes(content));
  const {orange, seed, pot, rootBall, net, microjet, puffs} = getHeroProps(t, world);
  const lightShafts: StoryLightShaft[] =
    environment.sky.eye > 0
      ? [
          {
            position: EYE_SHAFT.position,
            radius: EYE_SHAFT.radius,
            strength: environment.weather.shaft
          }
        ]
      : [];
  return {
    t: cycle.seconds,
    cycle,
    beat: beat.id,
    beatProgress: beat.progress,
    year,
    season: getSeason(year),
    camera: getStoryCamera(t, world, aspect, trees, orange, flood),
    shake: getCameraShake(content, cycle.clock, environment.wind.gust),
    key: environment.key,
    flash: environment.flash,
    ambient: environment.ambient,
    shadowColor: environment.shadowColor,
    sky: environment.sky,
    fog: environment.fog,
    grade: environment.grade,
    ground: {
      wetness: environment.groundWetness,
      frost: environment.groundFrost,
      hero: getHeroPlanting(content),
      sites: getReplantSites(content, year),
      magicRing: getMagicRing(content),
      rows: getGroveRows(content),
      flood,
      silt: getSilt(content)
    },
    weather: environment.weather,
    wind: environment.wind,
    treeWetness: environment.treeWetness,
    treeFrost: environment.treeFrost,
    trees,
    props: {
      orange,
      seed,
      pot,
      rootBall,
      nets: net ? [net, ...getReplantNets(content, year)] : getReplantNets(content, year),
      microjets: microjet ? [microjet, ...getReplantMicrojets(content)] : [],
      puffs
    },
    lightShafts,
    timeline: getTimeline(t, year, world),
    caption: getCaption(t)
  };
}

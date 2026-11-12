// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Device} from '@luma.gl/core';
import {describe, expect, it} from 'vitest';
import {
  getCumulusCover,
  getDeckFront,
  getDepartingDistance,
  getSkyProbe,
  getStormCenter,
  isSkyProbeFine,
  isSkyProbeWanted
} from '../layers/sky-layer';
import {
  createWeatherLayer,
  getCameraMotion,
  getCrownSteam,
  getFloodFlowTable,
  getPlumeCrowns,
  getRainVelocity,
  getRingArrival,
  getSteamCrowns,
  getWeatherCurtain,
  getWeatherDrift,
  getWeatherFrame,
  getWeatherNoiseData,
  getWrecks
} from '../layers/weather-layer';
import {CYCLE_SECONDS, getTimeRate, HURRICANE, isInSeamWindow, LOOP} from '../story/beats';
import {getCameraEye, getCameraForward} from '../story/camera';
import {getEnvironment} from '../story/environment';
import {FLOOD, getWaterLevel} from '../story/flood';
import {getMagicRing} from '../story/grove';
import {getStoryState} from '../story/story';
import type {StoryState} from '../story/story-types';

/** The cycle's seconds from `from` up to `to`, by `step`. */
function getSeconds(from: number, to: number, step: number): number[] {
  const seconds: number[] = [];
  for (let t = from; t < to - 1e-9; t += step) seconds.push(Number(t.toFixed(6)));
  return seconds;
}

function getUniforms(state: StoryState): Record<string, number[]> {
  return createWeatherLayer(state)?.props.uniforms as unknown as Record<string, number[]>;
}

describe('getRainVelocity', () => {
  it('falls at one speed, however it leans', () => {
    expect(getRainVelocity(8, 90)[2]).toBe(getRainVelocity(80, 200)[2]);
    expect(getRainVelocity(8, 90)[2]).toBeLessThan(0);
  });

  it('blows along the compass bearing', () => {
    const east = getRainVelocity(40, 90);
    expect(east[0]).toBeGreaterThan(0);
    expect(Math.abs(east[1])).toBeLessThan(1e-9);
    const north = getRainVelocity(40, 0);
    expect(north[1]).toBeGreaterThan(0);
    expect(Math.abs(north[0])).toBeLessThan(1e-9);
  });

  it('stays finite past the steepest slant', () => {
    expect(getRainVelocity(90, 0)).toEqual(getRainVelocity(88, 0));
    expect(Number.isFinite(getRainVelocity(90, 0)[1])).toBe(true);
  });
});

describe('getWeatherDrift', () => {
  it('is a function of the second alone', () => {
    const first = getWeatherDrift(36.2);
    getWeatherDrift(12);
    expect(getWeatherDrift(36.2)).toEqual(first);
  });

  it('starts at nothing at the swap and wraps with the cycle', () => {
    const start = getWeatherDrift(0);
    expect(start.rain).toEqual([0, 0, 0, 0]);
    expect(start.air).toEqual([0, 0, 0]);
    expect(start.leafSink).toBe(0);
    expect(getWeatherDrift(CYCLE_SECONDS + 10)).toEqual(getWeatherDrift(10));
    expect(getWeatherDrift(-5)).toEqual(getWeatherDrift(CYCLE_SECONDS - 5));
    expect(getWeatherDrift(LOOP.fileStart + CYCLE_SECONDS)).toEqual(
      getWeatherDrift(LOOP.fileStart)
    );
  });

  it('moves at the velocity of that second on the scene clock, whatever the wind did before', () => {
    const step = 0.2;
    // Slow motion at the swap's either side, the opening, the walls, the eye and the clearing.
    for (const seconds of [1, 12, 33.5, 36.2, 39.2, 42.2, 44.6, 62.5]) {
      const before = getWeatherDrift(seconds - step / 2);
      const after = getWeatherDrift(seconds + step / 2);
      const {weather, wind} = getEnvironment(seconds);
      const rate = getTimeRate(seconds);
      const velocity = getRainVelocity(weather.rainSlant, wind.bearing);
      const speed = Math.hypot(...velocity);
      for (let axis = 0; axis < 3; axis++) {
        const moved = (after.rain[axis] - before.rain[axis]) / step;
        // Within what a gust changes in that time.
        expect(Math.abs(moved - velocity[axis] * rate), `${seconds} ${axis}`).toBeLessThan(
          (0.1 * speed + 0.05) * rate + 0.05
        );
      }
    }
  });

  it('only ever adds to the length of a path, and to how far a leaf has sunk', () => {
    let last = getWeatherDrift(0);
    for (const seconds of getSeconds(0.5, CYCLE_SECONDS, 0.5)) {
      const next = getWeatherDrift(seconds);
      expect(next.rain[3]).toBeGreaterThan(last.rain[3]);
      expect(next.air[2]).toBeGreaterThanOrEqual(last.air[2]);
      expect(next.leafSink).toBeGreaterThan(last.leafSink);
      last = next;
    }
  });

  it('holds the air still where there is no wind at all', () => {
    const within = (seconds: number) => getWeatherDrift(seconds).air;
    expect(within(CYCLE_SECONDS + LOOP.stillAir[0] + 0.2)).toEqual(within(CYCLE_SECONDS - 0.05));
    expect(within(0.05)).toEqual(within(LOOP.stillAir[1] - 0.2));
  });

  it('never jumps between sub-frames of a frame, but at the swap', () => {
    // Fastest wind: the most a sub-frame 1/240 s on can have moved.
    const most = (64 * 1.2) / 240 + 1e-6;
    let previous = getWeatherDrift(32);
    for (let index = 1; index <= 240 * 14; index++) {
      const next = getWeatherDrift(32 + index / 240);
      const moved = Math.hypot(next.air[0] - previous.air[0], next.air[1] - previous.air[1]);
      expect(moved).toBeLessThan(most);
      previous = next;
    }
    // The file's own wrap is an ordinary step of the same world.
    const wrapped = getWeatherDrift(LOOP.fileStart);
    const before = getWeatherDrift(LOOP.fileStart - 1 / 30);
    expect(Math.abs(wrapped.rain[3] - before.rain[3])).toBeLessThan(9 / 30);
  });
});

describe('getRingArrival', () => {
  it('is the second the ring reaches a distance', () => {
    for (const metres of [1, 8, 30, 56, 120, 190]) {
      expect(getMagicRing(getRingArrival(metres)).radius).toBeCloseTo(metres, 3);
    }
  });

  it('comes later the farther out, within the grove-magic beat', () => {
    let last = 0;
    for (let metres = 1; metres <= 190; metres += 3) {
      const arrival = getRingArrival(metres);
      expect(arrival).toBeGreaterThan(last);
      expect(arrival).toBeLessThan(HURRICANE.arrive);
      last = arrival;
    }
  });
});

describe('getWeatherNoiseData', () => {
  const size = 32;
  const data = getWeatherNoiseData(size);

  it('fills a cube, using the whole range', () => {
    expect(data.length).toBe(size * size * size);
    expect(Math.min(...data.subarray(0, 4096))).toBeLessThan(90);
    expect(Math.max(...data)).toBe(255);
    expect(Math.min(...data)).toBe(0);
  });

  it('is the same every time', () => {
    expect(getWeatherNoiseData(size)).toEqual(data);
  });

  it('tiles: its seam is no rougher than the rest', () => {
    const at = (x: number, y: number, z: number) => data[x + size * (y + size * z)];
    let inside = 0;
    let seam = 0;
    for (let y = 0; y < size; y++) {
      for (let z = 0; z < size; z++) {
        inside += Math.abs(at(11, y, z) - at(10, y, z));
        seam += Math.abs(at(0, y, z) - at(size - 1, y, z));
      }
    }
    expect(seam).toBeLessThan(inside * 1.5);
  });
});

describe('getWeatherCurtain', () => {
  it('is a frame of unit vectors, square to each other, the fall leaning with the wind', () => {
    for (const t of [36.2, 42.2, 44.0]) {
      const state = getStoryState(t);
      const {across, above, fall} = getWeatherCurtain(state);
      const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      for (const vector of [across, above, fall]) expect(dot(vector, vector)).toBeCloseTo(1, 6);
      expect(dot(across, above)).toBeCloseTo(0, 6);
      expect(dot(across, fall)).toBeCloseTo(0, 6);
      expect(dot(above, fall)).toBeCloseTo(0, 6);
      expect(across[2]).toBe(0);
      expect(fall[2]).toBeLessThan(0);
    }
  });

  it('carries the sheets at 0.8 of the air', () => {
    const state = getStoryState(36.2);
    const {air} = getWeatherDrift(state.cycle.seconds);
    const {carried} = getWeatherCurtain(state);
    expect(carried[0]).toBeCloseTo(air[0] * 0.8, 9);
    expect(carried[1]).toBeCloseTo(air[1] * 0.8, 9);
  });
});

describe('getPlumeCrowns', () => {
  it('takes the nearest standing crowns in a storm, nearest first, and none without spray', () => {
    const state = getStoryState(36.2, {aspect: 9 / 16});
    const plumes = getPlumeCrowns(state);
    expect(state.weather.spray).toBeGreaterThan(0);
    expect(plumes.length).toBeGreaterThan(0);
    expect(plumes.length).toBeLessThanOrEqual(16);
    const eye = getCameraEye(state.camera);
    const metres = plumes.map(({top}) =>
      Math.hypot(top[0] - eye[0], top[1] - eye[1], top[2] - eye[2])
    );
    for (let i = 1; i < metres.length; i++) expect(metres[i]).toBeGreaterThanOrEqual(metres[i - 1]);
    for (const plume of plumes) {
      expect(plume.radius).toBeGreaterThan(0.9);
      expect(plume.top[2]).toBeGreaterThan(1);
      expect(plume.gust).toBeGreaterThanOrEqual(0);
      expect(plume.gust).toBeLessThanOrEqual(1);
    }
    const calm = getStoryState(20);
    expect(calm.weather.spray).toBe(0);
    expect(getPlumeCrowns(calm)).toEqual([]);
  });
});

describe('getSteamCrowns', () => {
  it('steams off the nearest crowns only in the eye, and never while spray is torn off them', () => {
    const eye = getStoryState(39.2, {aspect: 9 / 16});
    expect(getCrownSteam(eye)).toBeGreaterThan(0.2);
    const crowns = getSteamCrowns(eye);
    expect(crowns.length).toBeGreaterThan(0);
    expect(crowns.length).toBeLessThanOrEqual(16);
    const camera = getCameraEye(eye.camera);
    const metres = crowns.map(({top}) =>
      Math.hypot(top[0] - camera[0], top[1] - camera[1], top[2] - camera[2])
    );
    for (let i = 1; i < metres.length; i++) expect(metres[i]).toBeGreaterThanOrEqual(metres[i - 1]);
    for (const crown of crowns) {
      expect(crown.strength).toBeGreaterThan(0);
      expect(crown.strength).toBeLessThanOrEqual(1);
    }
    // In the walls the crowns tear into spray, and out of the storm there is no eye to steam in.
    for (const t of [36.2, 42.2, 44.9, 46.4, 20]) {
      expect(getCrownSteam(getStoryState(t)), `${t}`).toBe(0);
      expect(getSteamCrowns(getStoryState(t)), `${t}`).toEqual([]);
    }
  });
});

describe('getWrecks', () => {
  it('keeps the fallen in the grove own order, the same from frame to frame', () => {
    expect(getWrecks(getStoryState(20))).toEqual([]);
    const after = getWrecks(getStoryState(46.4));
    expect(after.length).toBeGreaterThan(0);
    expect(after.length).toBeLessThanOrEqual(12);
    // The same wrecks, as they settle by no more than a centimetre.
    const later = getWrecks(getStoryState(47));
    expect(later.length).toBe(after.length);
    later.forEach(({center, radius}, index) => {
      expect(center[0]).toBeCloseTo(after[index].center[0], 2);
      expect(center[1]).toBeCloseTo(after[index].center[1], 2);
      expect(radius).toBeCloseTo(after[index].radius, 2);
    });
  });
});

describe('getWeatherFrame', () => {
  it('holds the plumes, the splashes and the wrecks it counts', () => {
    for (const t of [20, 36.2, 43.45, 46.4]) {
      const state = getStoryState(t);
      const frame = getWeatherFrame(state);
      expect(frame.data.length).toBe(16 * 5 * 4);
      expect(frame.data.every(Number.isFinite)).toBe(true);
      expect(frame.plumes).toBe(getPlumeCrowns(state).length);
      expect(frame.splashes).toBe(Math.min(state.ground.flood.splashes.length, 4));
      expect(frame.wrecks).toBe(getWrecks(state).length);
    }
    expect(getWeatherFrame(getStoryState(43.45)).splashes).toBeGreaterThan(0);
  });

  it('carries the eye steam in the rows of the plumes, marked as steam', () => {
    const state = getStoryState(39.2);
    const frame = getWeatherFrame(state);
    expect(getPlumeCrowns(state)).toEqual([]);
    expect(frame.plumes).toBe(getSteamCrowns(state).length);
    expect(frame.plumes).toBeGreaterThan(0);
    for (let column = 0; column < frame.plumes; column++) {
      // plumeMore is the second row: strength, gust, and 1 for steam.
      expect(frame.data[(16 + column) * 4 + 2]).toBe(1);
    }
    const storm = getWeatherFrame(getStoryState(36.2));
    for (let column = 0; column < storm.plumes; column++) {
      expect(storm.data[(16 + column) * 4 + 2]).toBe(0);
    }
  });
});

describe('getFloodFlowTable', () => {
  it('samples the flood from its rise to after it has drained', () => {
    const table = getFloodFlowTable();
    const samples = table.length / 4;
    expect(samples).toBe(64);
    let peak = -Infinity;
    for (let sample = 0; sample < samples; sample++) {
      const seconds = FLOOD.rises + ((FLOOD.drained + 0.1 - FLOOD.rises) * sample) / (samples - 1);
      expect(table[sample * 4]).toBeCloseTo(getWaterLevel(seconds), 5);
      expect(table[sample * 4 + 3]).toBeGreaterThanOrEqual(0);
      expect(table[sample * 4 + 3]).toBeLessThanOrEqual(1);
      peak = Math.max(peak, table[sample * 4]);
    }
    expect(peak).toBeGreaterThan(0);
    expect(table[(samples - 1) * 4]).toBeLessThan(-0.6);
  });
});

describe('createWeatherLayer', () => {
  it('gives only finite numbers at every second of the cycle, on either side of the swap', () => {
    const states = getSeconds(0, CYCLE_SECONDS, 0.5).map(seconds => getStoryState(seconds));
    states.push(getStoryState(-0.1, {aspect: 9 / 16, world: 'start'}));
    states.push(getStoryState(0.1, {aspect: 9 / 16, world: 'end'}));
    for (const state of states) {
      const layer = createWeatherLayer(state);
      if (!layer) continue;
      expect(layer.id).toBe('weather');
      const uniforms = layer.props.uniforms as unknown as Record<string, number[]>;
      for (const [name, values] of Object.entries(uniforms)) {
        expect(values.length, name).toBe(4);
        expect(values.every(Number.isFinite), `${name} at ${state.t}`).toBe(true);
      }
      expect(layer.props.frame.every(Number.isFinite)).toBe(true);
    }
  });

  it('stays out of the shadow pass', () => {
    expect(createWeatherLayer(getStoryState(36.2))?.props.shadowEnabled).toBe(false);
  });

  it('gives the same numbers for the same second', () => {
    const uniforms = (seconds: number) =>
      createWeatherLayer(getStoryState(seconds))?.props.uniforms;
    const first = uniforms(36.2);
    uniforms(10);
    expect(uniforms(36.2)).toEqual(first);
  });

  it('runs on the scene clock, and keys its sparkles on the cycle second', () => {
    for (const seconds of [1, 6, 29.4, 36.2, 62.6]) {
      const state = getStoryState(seconds);
      const uniforms = getUniforms(state);
      if (!uniforms) continue;
      expect(uniforms.clock[0]).toBe(state.cycle.clock);
      expect(uniforms.timing[0]).toBe(state.cycle.seconds);
      expect(uniforms.timing[1]).toBe(state.cycle.rate);
    }
  });

  it('has no dust or petals where the swap would make them jump', () => {
    for (const seconds of getSeconds(CYCLE_SECONDS - 1, CYCLE_SECONDS + 1, 0.05)) {
      const state = getStoryState(seconds);
      const uniforms = getUniforms(state);
      if (!uniforms || !isInSeamWindow(seconds, LOOP.noMotes)) continue;
      expect(uniforms.amounts[2], `${seconds}`).toBe(0);
      expect(uniforms.amounts[3], `${seconds}`).toBe(0);
    }
  });

  it('draws the storm in curtains and spray, and what floats only on the flood', () => {
    const wall = getStoryState(36.2);
    const storm = getUniforms(wall).storm;
    expect(storm[0]).toBe(wall.weather.curtains);
    expect(storm[1]).toBe(wall.weather.spray);
    expect(storm[0]).toBeGreaterThan(0.5);
    expect(storm[1]).toBeGreaterThan(0.5);
    const dry = getStoryState(20);
    expect(createWeatherLayer(dry)?.props.uniforms.storm[2] ?? 0).toBe(0);
    const flooded = getStoryState(46.4);
    expect(getUniforms(flooded).storm[2]).toBe(flooded.ground.flood.floating);
    expect(getUniforms(flooded).flood[0]).toBe(flooded.ground.flood.level);
  });
});

describe('the storm sky', () => {
  it('comes over from the SSW, its edge past the view at 33.0, and clears from the west at 44.6', () => {
    const arriving = getDeckFront(33);
    expect(arriving[3]).toBe(1);
    expect(Math.abs(arriving[2])).toBeLessThan(1e-6);
    const [x, y] = arriving;
    // Toward the clear sky ahead of it, NNE, which is where the first wall blows.
    expect(x).toBeCloseTo(Math.sin((HURRICANE.firstWallBearing * Math.PI) / 180), 9);
    expect(y).toBeCloseTo(Math.cos((HURRICANE.firstWallBearing * Math.PI) / 180), 9);
    const clearing = getDeckFront(44.6);
    expect(clearing[3]).toBe(2);
    expect(Math.abs(clearing[2])).toBeLessThan(1e-6);
    // The clear sky is to the west of a clearing edge.
    expect(clearing[0]).toBeCloseTo(-1, 9);
    expect(getDeckFront(36.2)[3]).toBe(0);
    expect(getDeckFront(20)[3]).toBe(0);
  });

  it('moves its edges one way only: on as it arrives, and away as it clears', () => {
    let last = -Infinity;
    for (const t of getSeconds(HURRICANE.arrive - 0.5, HURRICANE.firstWall, 0.05)) {
      const [, , position] = getDeckFront(t);
      expect(position).toBeGreaterThanOrEqual(last);
      last = position;
    }
    last = Infinity;
    for (const t of getSeconds(HURRICANE.clearing, HURRICANE.clearing + 4, 0.05)) {
      const [, , position] = getDeckFront(t);
      expect(position).toBeLessThanOrEqual(last);
      last = position;
    }
  });

  it('turns its bands the other way after the eye', () => {
    const before = getStormCenter(HURRICANE.eyeOpen - 1);
    const after = getStormCenter(HURRICANE.eyeClose + 1);
    expect(after[0]).toBeCloseTo(-before[0], 6);
    expect(after[1]).toBeCloseTo(-before[1], 6);
  });

  it('draws its probe only while water may mirror it', () => {
    expect(isSkyProbeWanted(getStoryState(20))).toBe(false);
    expect(isSkyProbeWanted(getStoryState(39.9))).toBe(true);
    expect(isSkyProbeWanted(getStoryState(46.4))).toBe(true);
    expect(isSkyProbeWanted(getStoryState(LOOP.fileStart))).toBe(false);
    expect(getSkyProbe({} as Device)).toBeNull();
  });

  it('draws its probe finely where the water is calm enough to be a mirror, and only then', () => {
    // The eye's mirror and the standing flood are calm; the walls whip the water up.
    for (const t of [39.9, 46.4]) {
      const state = getStoryState(t);
      expect(state.ground.flood.calm, `${t}`).toBeGreaterThan(0.5);
      expect(isSkyProbeFine(state), `${t}`).toBe(true);
    }
    for (const t of [36.2, 42.2]) expect(isSkyProbeFine(getStoryState(t)), `${t}`).toBe(false);
    // Never without a probe at all.
    expect(isSkyProbeFine(getStoryState(20))).toBe(false);
  });

  it('has no fair-weather cumulus in the eye or under the deck, and the story own cover in fair weather', () => {
    for (const t of [36.2, 39.2, 39.9, 42.2])
      expect(getCumulusCover(getStoryState(t)), `${t}`).toBe(0);
    for (const t of [20, 29.4]) {
      const state = getStoryState(t);
      expect(getCumulusCover(state), `${t}`).toBeCloseTo(state.sky.cloudCover, 9);
    }
  });

  it('sees the departing wall go off east as the storm goes', () => {
    let last = 0;
    for (const t of getSeconds(HURRICANE.clearing, HURRICANE.clearing + 4, 0.1)) {
      const metres = getDepartingDistance(getStoryState(t));
      expect(metres, `${t}`).toBeGreaterThanOrEqual(last);
      last = metres;
    }
    // Some 40 km off as it clears, so its towers stand 10-15 degrees up.
    const clearing = getDepartingDistance(getStoryState(44.9));
    expect(clearing).toBeGreaterThan(38000);
    expect(clearing).toBeLessThan(50000);
    expect(getDepartingDistance(getStoryState(47))).toBeGreaterThan(clearing);
  });

  it('has only a few cumulus at first light, the same either side of the swap', () => {
    for (const t of [1.09, 57.6, 61.3]) {
      const state = getStoryState(t);
      const cover = getCumulusCover(state);
      expect(cover, `${t}`).toBeGreaterThan(0.1 * state.sky.cloudCover);
      expect(cover, `${t}`).toBeLessThan(0.6 * state.sky.cloudCover);
    }
    // More of them as the sun gets up.
    expect(getCumulusCover(getStoryState(5.6))).toBeGreaterThan(
      getCumulusCover(getStoryState(1.09))
    );
    const before = getStoryState(-0.001, {world: 'end'});
    const after = getStoryState(0.001, {world: 'start'});
    expect(getCumulusCover(after)).toBeCloseTo(getCumulusCover(before), 6);
  });
});

describe('getCameraMotion', () => {
  it('is the eye velocity of the take, to within what a portrait frame widens it by', () => {
    const step = 0.004;
    for (const t of [1.09, 29.4, 30.2, 57.6, 62.6]) {
      const state = getStoryState(t, {aspect: 9 / 16});
      const {velocity} = getCameraMotion(state);
      const before = getCameraEye(getStoryState(t - step, {aspect: 9 / 16}).camera);
      const after = getCameraEye(getStoryState(t + step, {aspect: 9 / 16}).camera);
      const speed = Math.hypot(...after.map((value, axis) => (value - before[axis]) / (2 * step)));
      for (let axis = 0; axis < 3; axis++) {
        const actual = (after[axis] - before[axis]) / (2 * step);
        expect(Math.abs(velocity[axis] - actual), `${t} ${axis}`).toBeLessThan(0.06 * speed + 0.01);
      }
    }
  });

  it('turns the camera forward as the take does', () => {
    const step = 0.004;
    for (const t of [5.6, 29.4, 57.6, 62.6]) {
      const {spin} = getCameraMotion(getStoryState(t));
      const before = getCameraForward(getStoryState(t - step).camera);
      const after = getCameraForward(getStoryState(t + step).camera);
      const forward = getCameraForward(getStoryState(t).camera);
      // d forward / dt = spin x forward.
      const turned = [
        spin[1] * forward[2] - spin[2] * forward[1],
        spin[2] * forward[0] - spin[0] * forward[2],
        spin[0] * forward[1] - spin[1] * forward[0]
      ];
      for (let axis = 0; axis < 3; axis++) {
        const actual = (after[axis] - before[axis]) / (2 * step);
        expect(Math.abs(turned[axis] - actual), `${t} ${axis}`).toBeLessThan(0.02);
      }
    }
  });

  it('is still where the camera is', () => {
    const {velocity, spin} = getCameraMotion(getStoryState(36.2));
    for (const value of [...velocity, ...spin]) expect(Number.isFinite(value)).toBe(true);
    // The eye of the first wall creeps east along the furrow, slowly.
    expect(Math.hypot(...velocity)).toBeLessThan(2);
  });
});

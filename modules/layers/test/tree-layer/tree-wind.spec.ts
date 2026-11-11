// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';
import {_treeWindGust, getTreeWindGust, type TreeWindGustOptions} from '../../src';
import {
  getTreeLeafPaleness,
  getTreeLeafShaders,
  getTreeWoodShaders,
  TREE_PHOTOREAL_VERTEX_CHUNK,
  treePhotoreal
} from '../../src/tree-layer/tree-photoreal-shaders';
import {TREE_WIND_GUST_GLSL} from '../../src/tree-layer/tree-wind';

/** Gusts over a stretch of the gust clock, a step apart. */
function sampleGusts(
  options: Omit<TreeWindGustOptions, 'time'>,
  from: number,
  to: number,
  step = 0.01
) {
  const gusts: number[] = [];
  for (let time = from; time <= to; time += step) gusts.push(getTreeWindGust({...options, time}));
  return gusts;
}

describe('getTreeWindGust', () => {
  it('reads the gusts the photoreal shaders bend trees by', () => {
    // Worked by hand for the breeze: along 3.649 and across 3.418 metres, front 0.2346 and chop 0.1826.
    expect(
      getTreeWindGust({position: [3, 4], time: 1.4, direction: 80, strength: 0.025})
    ).toBeCloseTo(0.3924259071, 9);
    expect(
      getTreeWindGust({position: [12, -5], time: 101.2, direction: 195, strength: 0.3, phase: 2})
    ).toBeCloseTo(0.6414355077, 9);
    expect(
      getTreeWindGust({position: [-18, 3.8], time: 36, direction: 195, strength: 0.75})
    ).toBeCloseTo(0.1999617266, 9);
    expect(
      getTreeWindGust({
        position: [250, -120],
        time: 413.1,
        direction: 15,
        strength: 0.75,
        phase: 5.5
      })
    ).toBeCloseTo(0.9255474186, 9);
    expect(
      getTreeWindGust({position: [0, 0], time: 20, direction: 90, strength: 0.6, phase: 1})
    ).toBeCloseTo(0.2395205129, 9);
  });

  it('is a gust from 0 to 1, and the same for the same options', () => {
    for (const strength of [0, 0.025, 0.3, 0.6, 0.9, 1]) {
      const gusts = sampleGusts(
        {position: [7, -11], direction: 15, strength, phase: 1.3},
        0,
        60,
        0.05
      );
      expect(Math.min(...gusts)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...gusts)).toBeLessThanOrEqual(1);
      expect(
        sampleGusts({position: [7, -11], direction: 15, strength, phase: 1.3}, 0, 60, 0.05)
      ).toEqual(gusts);
    }
  });

  it('reads a bearing as TreeLayer.windDirection does, clockwise from +y toward where it blows', () => {
    const at = (position: number[], direction: number) =>
      getTreeWindGust({position, time: 12.3, direction, strength: 0.7, phase: 0.4});
    // The same place downwind, and the same place to its left, whichever way the wind blows.
    expect(at([10, 0], 90)).toBeCloseTo(at([0, 10], 0), 12);
    expect(at([0, -10], 180)).toBeCloseTo(at([0, 10], 0), 12);
    expect(at([-10, 0], 270)).toBeCloseTo(at([0, 10], 0), 12);
    expect(at([-4, 10], 0)).toBeCloseTo(at([10, 4], 90), 12);
    expect(at([10, 0], 90)).not.toBeCloseTo(at([0, 10], 90), 3);
  });

  it('has no fronts in a wind of no direction, as TreeLayer sways then', () => {
    expect(getTreeWindGust({position: [5, 5], time: 3, direction: Number.NaN, strength: 0.8})).toBe(
      0.5
    );
  });

  it('blows any wind below force 0.06 as a breeze, and a storm with longer lulls', () => {
    const options = {position: [-18, 3.8], direction: 15, phase: 0};
    const calm = sampleGusts({...options, strength: 0}, 0, 40);
    expect(sampleGusts({...options, strength: 0.05}, 0, 40)).toEqual(calm);
    expect(sampleGusts({...options, strength: 0.06}, 0, 40)).toEqual(calm);
    const storm = sampleGusts({...options, strength: 0.9}, 0, 40);
    // Under 0.35 for over a third of the time in a storm, and under a sixth in a breeze.
    const lulls = (gusts: number[]) => gusts.filter(gust => gust < 0.35).length / gusts.length;
    expect(lulls(storm)).toBeGreaterThan(1 / 3);
    expect(lulls(calm)).toBeLessThan(1 / 6);
    expect(Math.max(...storm)).toBe(1);
  });

  it('carries fronts downwind at about 12 m a second of the gust clock', () => {
    // In a storm the front's pulse dominates the chop, so a peak at one place reaches a place 24 m downwind
    // later: at 8 to 20 m/s, as the front's wander speeds it up and slows it down, and the chop shifts a peak.
    const options = {direction: 90, strength: 0.9, phase: 0};
    const peakAfter = (x: number, from: number, to: number) => {
      let best = {time: from, gust: -1};
      for (let time = from; time <= to; time += 0.002) {
        const gust = getTreeWindGust({...options, position: [x, 0], time});
        if (gust > best.gust) best = {time, gust};
      }
      return best.time;
    };
    for (const from of [10, 40, 70]) {
      const here = peakAfter(0, from, from + 6);
      const later = peakAfter(24, here, here + 3.5) - here;
      expect(later).toBeGreaterThan(24 / 20);
      expect(later).toBeLessThan(24 / 8);
    }
  });
});

describe('_treeWindGust', () => {
  it('gives a host the GLSL twin, with the signature its docs name', () => {
    expect(_treeWindGust.name).toBe('treeWind');
    expect(_treeWindGust.vs).toBe(TREE_WIND_GUST_GLSL);
    expect(_treeWindGust.fs).toBe(TREE_WIND_GUST_GLSL);
    expect(TREE_WIND_GUST_GLSL).toContain(
      'float treeWind_getGust(vec2 metres, float time, vec2 direction, float force, float phase)'
    );
  });

  it('is the very GLSL the photoreal trees bend by, on the gust clock', () => {
    expect(TREE_PHOTOREAL_VERTEX_CHUNK).toContain(TREE_WIND_GUST_GLSL);
    expect(TREE_PHOTOREAL_VERTEX_CHUNK).toContain(
      'float gust = treeWind_getGustAt(along, side, treePhotoreal.gust.x, strong, tree.windPhase);'
    );
    expect(TREE_PHOTOREAL_VERTEX_CHUNK).toContain(
      'float strong = directed ? treeWind_getStrong(force) : 0.0;'
    );
    // No other copy of the front survives to drift from it.
    expect(TREE_PHOTOREAL_VERTEX_CHUNK.split('along * 0.085 - time * 1.05')).toHaveLength(2);
    expect(treePhotoreal.uniformTypes.gust).toBe('vec4<f32>');
    for (const blade of ['far', 'coarse', 'fine', 'macro'] as const) {
      expect(getTreeLeafShaders(blade).vs).toContain('treeWind_getGustAt(');
    }
    expect(getTreeWoodShaders(0).vs).toContain('treeWind_getGustAt(');
  });
});

describe('flying leaves', () => {
  it('streak only in the passes of leaves in the air, which alone draw by the pixel', () => {
    for (const air of ['blend', 'depth'] as const) {
      const {vs, fs} = getTreeLeafShaders('coarse', air);
      expect(vs).toContain('vec3 streak = vec3(0.0);');
      expect(vs).toContain('treeLeafFlightPoint(start, windAway, earlier,');
      // Each pixel is covered for as long as the leaf's outline lies over it in the moment.
      expect(fs).toContain('treeAirCover(');
      expect(fs).toContain('discard');
    }
    // The depth pass writes no color, and the leaves themselves blend.
    expect(getTreeLeafShaders('coarse', 'depth').fs).toContain('fragColor = vec4(0.0);');
    expect(getTreeLeafShaders('coarse', 'blend').fs).toContain('cover * layer.opacity');
    for (const blade of ['far', 'coarse', 'fine', 'macro'] as const) {
      const {vs, fs} = getTreeLeafShaders(blade);
      expect(vs).not.toContain('streak');
      // Never by the pixel: a leaf's depth test runs before it is shaded.
      expect(fs).not.toContain('discard');
    }
  });

  it('hands the leaves of the coarse blade in the air to their own pass until they land', () => {
    expect(getTreeLeafShaders('coarse').vs).toContain(
      'if (flight >= 0.06 && (!litter || flight < 0.72)) return;'
    );
    expect(getTreeLeafShaders('coarse', 'blend').vs).toContain(
      'if (flight < 0.06 || flight >= 1.0 || (litter && flight >= 0.72)) return;'
    );
    // A far tree's leaves in the air stay on its own blade, which knows how few of them it shows first.
    const far = getTreeLeafShaders('far').vs;
    expect(far).not.toContain('flight < 0.72)) return;');
    expect(far.indexOf('shownMost')).toBeLessThan(far.indexOf('treeLeafFlightPoint(start,'));
  });

  it('works out where the wind had a far leaf only once that would show on screen', () => {
    // A far crown sheds all at once, and the wind's way for each of its leaves cost more than the rest of a flight.
    const far = getTreeLeafShaders('far').vs;
    const gate = '(tree.windForce > 0.0 || tree.groundDetail > 0.0) && restPixels >= 3.0';
    expect(far).toContain(gate);
    expect(far.indexOf('float restPixels')).toBeLessThan(far.indexOf(gate));
    for (const blade of ['coarse', 'fine', 'macro'] as const) {
      expect(getTreeLeafShaders(blade).vs).not.toContain('restPixels');
      expect(getTreeLeafShaders(blade).vs).toContain('vec3 windAway = flight < 0.4 &&');
    }
    expect(getTreeLeafShaders('coarse', 'blend').vs).not.toContain('restPixels');
  });

  it('lets the open sky through a leaf in the air, but no more of the sun than through any other', () => {
    // 2.5 times the 0.3 of the sky behind it that comes through a leaf in a crown.
    const skyThrough = 'vec3 skyThrough = treeHemisphere(-gNormal, up) * crown.y * ';
    const blend = getTreeLeafShaders('coarse', 'blend').vs;
    expect(blend).toContain(`${skyThrough}0.75;`);
    for (const blade of ['far', 'coarse', 'fine', 'macro'] as const) {
      const {vs, fs} = getTreeLeafShaders(blade);
      expect(vs + fs).toContain(`${skyThrough}0.3;`);
      expect(vs + fs).not.toContain(`${skyThrough}0.75;`);
    }
    // The sun through a blade is the same in the air as in a crown.
    expect(blend).toContain('gGlow += color * through * (0.55 + 1.15 * toward) * visibility;');
  });
});

/** The body of a GLSL function, from its signature to the brace that closes it. */
function getFunctionBody(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let index = source.indexOf('{', start); index < source.length; index++) {
    if (source[index] === '{') depth++;
    if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`No end to ${signature}`);
}

describe('wet leaves', () => {
  it('glint only where the sun reaches the side of a bead the eye sees', () => {
    // Looking into a low sun through a blade, light and eye are opposite, and halfway between them is no way at all.
    for (const blade of ['far', 'coarse', 'fine', 'macro'] as const) {
      const {vs, fs} = getTreeLeafShaders(blade);
      const source = blade === 'fine' || blade === 'macro' ? fs : vs;
      const glint = getFunctionBody(source, 'vec3 treeLeafGlint(');
      expect(glint).toContain('if (dot(bead, light) <= 0.0) return vec3(0.0);');
      expect(glint).toContain('inversesqrt(max(dot(halfway, halfway), 1e-6))');
      // A tight sparkle, not a broad sheen: the 256th power, by squaring.
      expect(glint.split('facing *= facing;')).toHaveLength(9);
    }
  });

  it('cost a dry leaf nothing: all of it waits behind the rain early-out the wet film had', () => {
    for (const blade of ['far', 'coarse', 'fine', 'macro'] as const) {
      const {vs, fs} = getTreeLeafShaders(blade);
      const source = blade === 'fine' || blade === 'macro' ? fs : vs;
      const wet = getFunctionBody(source, 'vec3 treeLeafWet(');
      expect(wet.split('\n')[1].trim()).toBe(
        'if (treePhotoreal.weather.x <= 0.0) return vec3(0.0);'
      );
      expect(wet).toContain('treeLeafBeadGlint(');
      // The light of a leaf calls it once, at its end, and nothing else of the rain's beads.
      const shade = getFunctionBody(source, 'vec3 treeLeafShade(');
      expect(shade.split('treeLeafWet(')).toHaveLength(2);
      expect(shade).not.toContain('treeLeafGlint(');
      expect(shade).not.toContain('gWet');
    }
  });
});

describe('a storm on leaves', () => {
  it('pales a flip by the layer, so a leaf in a breeze carries nothing of it', () => {
    expect(getTreeLeafPaleness(0)).toEqual([0.85, 0.85, 0.85]);
    // Below force 0.06 nothing differs from a breeze.
    expect(getTreeLeafPaleness(0.05)).toEqual([0.85, 0.85, 0.85]);
    const gale = getTreeLeafPaleness(0.39);
    const storm = getTreeLeafPaleness(0.85);
    for (let channel = 0; channel < 3; channel++) {
      expect(gale[channel]).toBeGreaterThan(0.85);
      expect(storm[channel]).toBeGreaterThanOrEqual(gale[channel]);
    }
    // Silver, not yellow: the most in blue.
    expect(storm[2]).toBeGreaterThan(storm[1]);
    expect(storm[1]).toBeGreaterThan(storm[0]);
    for (const blade of ['far', 'coarse', 'fine', 'macro'] as const) {
      const {vs, fs} = getTreeLeafShaders(blade);
      expect(vs).toContain('flip * treePhotoreal.gust.yzw);');
      // What a leaf's light does is HEAD's, whatever the weather: a storm's underside comes in through its inputs.
      const shade = getFunctionBody(
        blade === 'fine' || blade === 'macro' ? fs : vs,
        'vec3 treeLeafShade('
      );
      expect(shade).not.toContain('abaxial');
      expect(shade).not.toContain('treePhotoreal.gust');
    }
    // Only the finer blades, few and near, carry how far over a blade is, and only in their vertex stage.
    for (const blade of ['far', 'coarse'] as const) {
      expect(getTreeLeafShaders(blade).vs).not.toContain('abaxial');
    }
    for (const blade of ['fine', 'macro'] as const) {
      const {vs, fs} = getTreeLeafShaders(blade);
      // And they turn its frame only in the layer's storm, a branch a breeze never takes.
      expect(vs).toMatch(/if \(treePhotoreal\.gust\.w > 0\.85\) \{\s*if \(abaxial > 0\.0\) \{/);
      expect(fs).not.toContain('abaxial');
    }
  });
});

describe('roots and the plate of soil', () => {
  it('cost a standing tree nothing: all of their work waits behind the return of wood not yet lifted', () => {
    for (const lod of [0, 1, 2, 3]) {
      const {vs} = getTreeWoodShaders(lod);
      const hidden = getFunctionBody(vs, 'if (isHidden) {');
      const lines = hidden.split('\n').map(line => line.trim());
      expect(lines[1]).toBe(
        'float lifted = smoothstep(TREE_LEAN_ROOTS_FROM, TREE_LEAN_ROOTS_TO, tree.lean);'
      );
      expect(lines[2]).toBe('if (lifted <= 0.0) return;');
      // Past it, the rest of the wood only scales a lifted point by what that worked out.
      const after = vs.slice(vs.indexOf(hidden) + hidden.length);
      expect(after).toContain(
        'if (isHidden) point = center * plateIn.xxy + radial * (radius * plateIn.z);'
      );
      expect(after).not.toContain('woodLevel.yz');
    }
  });
});

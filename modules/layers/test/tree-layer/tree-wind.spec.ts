// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';
import {
  getTreeLeafPaleness,
  getTreeLeafShaders,
  getTreeWoodShaders,
  TREE_PHOTOREAL_VERTEX_CHUNK
} from '../../src/tree-layer/tree-photoreal-shaders';
import {TREE_WIND_GUST_GLSL} from '../../src/tree-layer/tree-wind';

describe('tree wind', () => {
  it('uses the layer clock to animate gusts at every level of detail', () => {
    expect(TREE_PHOTOREAL_VERTEX_CHUNK).toContain(TREE_WIND_GUST_GLSL);
    expect(TREE_PHOTOREAL_VERTEX_CHUNK).toContain('float time = treePhotoreal.clock.x;');
    expect(TREE_PHOTOREAL_VERTEX_CHUNK).toContain(
      'float gust = treeWind_getGustAt(along, side, time, strong, tree.windPhase);'
    );
    expect(TREE_PHOTOREAL_VERTEX_CHUNK).toContain(
      'float strong = directed ? treeWind_getStrong(force) : 0.0;'
    );
    // No other copy of the front survives to drift from it.
    expect(TREE_PHOTOREAL_VERTEX_CHUNK.split('along * 0.085 - time * 1.05')).toHaveLength(2);
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
      expect(vs).toContain('flip * treePhotoreal.leafPaleness);');
      // The vertex stage supplies the paler color of the underside.
      const shade = getFunctionBody(
        blade === 'fine' || blade === 'macro' ? fs : vs,
        'vec3 treeLeafShade('
      );
      expect(shade).not.toContain('abaxial');
      expect(shade).not.toContain('treePhotoreal.leafPaleness');
    }
    // Only the finer blades, few and near, carry how far over a blade is, and only in their vertex stage.
    for (const blade of ['far', 'coarse'] as const) {
      expect(getTreeLeafShaders(blade).vs).not.toContain('abaxial');
    }
    for (const blade of ['fine', 'macro'] as const) {
      const {vs, fs} = getTreeLeafShaders(blade);
      // And they turn its frame only in the layer's storm, a branch a breeze never takes.
      expect(vs).toMatch(
        /if \(treePhotoreal\.leafPaleness\.z > 0\.85\) \{\s*if \(abaxial > 0\.0\) \{/
      );
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

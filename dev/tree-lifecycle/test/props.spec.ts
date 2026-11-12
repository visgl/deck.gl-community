// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';
import {
  createOrangeLayer,
  getHalfDrop,
  getRindPoint,
  getStalkValues,
  getTwigLeafFrames,
  STALK_END_SHARE,
  getTwigLeafMesh,
  getTwigValues
} from '../layers/orange-layer';
import {createSoilLumps, getLumpCount, getPotHeight, getSoilRadius} from '../layers/pot-layer';
import {
  CONTACT_FADE,
  CONTACT_STRIDE,
  createGridMesh,
  createSphereMesh,
  mergeMeshes,
  type PropMesh,
  writeContact
} from '../layers/prop-shading';
import {
  CYCLE_SECONDS,
  getFallSeconds,
  getSeamSeconds,
  getTimeRate,
  getWorld,
  LOOP
} from '../story/beats';
import {getCameraEye} from '../story/camera';
import {getLandHeight} from '../story/land';
import {
  getBearingTwig,
  getFruitTrack,
  getHeroProps,
  getImpactSecond,
  getSeedPosition,
  HERO_FRUIT_TABLE,
  ORANGE_ROTATION,
  ORANGE_TABLE,
  POT_TABLE,
  SEED_TABLE
} from '../story/props';
import {getStoryState} from '../story/story';
import type {Quat, StoryOrange, StoryPot, StoryWorld, Vec3} from '../story/story-types';

/** Cycle second `seam` seam seconds from the swap. */
function atSeam(seam: number): number {
  return seam < 0 ? CYCLE_SECONDS + seam : seam;
}

function getOrangeAt(seam: number, world: StoryWorld = getWorld(atSeam(seam))): StoryOrange {
  return getHeroProps(atSeam(seam), world).orange;
}

function getOffset(seam: number, world: StoryWorld): Vec3 {
  return getFruitTrack(atSeam(seam), world).offset;
}

function distance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(...a.map((value, index) => value - b[index]));
}

/** The angle between two turns, in radians, whichever sign each has. */
function getTurnAngle(a: Quat, b: Quat): number {
  const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return 2 * Math.acos(Math.min(1, dot));
}

/** Angular velocity in radians per scene second, from turns `step` scene seconds apart. */
function getSpin(before: Quat, after: Quat, step: number): Vec3 {
  // after = delta * before, so delta = after * conjugate(before).
  const [bx, by, bz, bw] = [-before[0], -before[1], -before[2], before[3]];
  const [ax, ay, az, aw] = after;
  const delta: Quat = [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz
  ];
  const sign = delta[3] < 0 ? -1 : 1;
  return [(2 * sign * delta[0]) / step, (2 * sign * delta[1]) / step, (2 * sign * delta[2]) / step];
}

function expectSound(mesh: PropMesh): void {
  const vertices = mesh.positions.length / 3;
  expect(mesh.normals.length).toBe(vertices * 3);
  expect(mesh.details.length).toBe(vertices * 4);
  for (const index of mesh.indices) expect(index).toBeLessThan(vertices);
  for (let vertex = 0; vertex < vertices; vertex++) {
    const length = Math.hypot(
      mesh.normals[vertex * 3],
      mesh.normals[vertex * 3 + 1],
      mesh.normals[vertex * 3 + 2]
    );
    expect(length).toBeCloseTo(1, 4);
  }
}

describe('prop meshes', () => {
  it('builds a grid whose normals follow its surface', () => {
    const mesh = createGridMesh({
      columns: 24,
      rows: 12,
      wrap: true,
      getPoint: (u, v) => [Math.cos(u * Math.PI * 2), Math.sin(u * Math.PI * 2), v]
    });
    expectSound(mesh);
    // A cylinder from its middle: every normal looks out.
    for (let vertex = 0; vertex < mesh.positions.length / 3; vertex++) {
      const out =
        mesh.positions[vertex * 3] * mesh.normals[vertex * 3] +
        mesh.positions[vertex * 3 + 1] * mesh.normals[vertex * 3 + 1];
      expect(out).toBeGreaterThan(0.99);
    }
  });

  it('builds a unit sphere', () => {
    const mesh = createSphereMesh(2);
    expectSound(mesh);
    expect(mesh.positions.length / 3).toBe(162);
    expect(mesh.indices.length / 3).toBe(320);
  });

  it('merges meshes with their indices moved along', () => {
    const a = createSphereMesh(0);
    const b = createSphereMesh(1);
    const merged = mergeMeshes([a, b]);
    expectSound(merged);
    expect(merged.positions.length).toBe(a.positions.length + b.positions.length);
    expect(merged.indices[a.indices.length]).toBe(b.indices[0] + a.positions.length / 3);
  });
});

describe('the orange', () => {
  it('has two halves that meet at the equator, so the seam does not show until it opens', () => {
    for (const theta of [0, 1, 2, 3, 4, 5, 6]) {
      const stem = getRindPoint(Math.PI / 2, theta, 1);
      const navel = getRindPoint(Math.PI / 2, theta, -1);
      expect(stem[0]).toBeCloseTo(navel[0], 5);
      expect(stem[1]).toBeCloseTo(navel[1], 5);
      expect(stem[2]).toBeCloseTo(0, 5);
      expect(navel[2]).toBeCloseTo(0, 5);
    }
  });

  it('rests a half on the ground wherever it has rolled to', () => {
    const {orange} = getStoryState(2.6).props;
    expect(orange.phase).toBe('resting');
    for (let index = 0; index < 2; index++) {
      // Whole, the fruit lies on its side, on its equator.
      expect(getHalfDrop(orange.halves[index].rotation, index, orange.radius)).toBeCloseTo(0, 6);
    }
    const settled = getStoryState(6).props.orange;
    expect(settled.phase).toBe('opening');
    for (let index = 0; index < 2; index++) {
      const drop = getHalfDrop(settled.halves[index].rotation, index, settled.radius);
      expect(drop).toBeGreaterThan(0);
      expect(drop).toBeLessThan(settled.radius * 0.05);
    }
  });

  it('opens on the new times, and is gone by 9.0', () => {
    expect(getStoryState(2.69).props.orange.seam).toBe(0);
    expect(getStoryState(3.15).props.orange.seam).toBe(1);
    expect(getStoryState(4.3).props.orange.juice).toBe(1);
    expect(getStoryState(8.9).props.orange.visible).toBe(true);
    expect(getStoryState(9).props.orange.visible).toBe(false);
    // The seed lands in the pot at 6.4, and is buried by 7.6.
    expect(getSeedPosition(SEED_TABLE.land)[0]).toBeCloseTo(0, 6);
    expect(getStoryState(7.6).props.seed.visible).toBe(false);
  });
});

describe('the hero fruit', () => {
  const {hang, twig, shows, buttonHeight} = HERO_FRUIT_TABLE;

  it('hangs still by its stalk from a real twig, from where it is first drawn until it lets go', () => {
    const first = getOrangeAt(shows + 1e-6);
    expect(first.visible).toBe(true);
    expect(first.phase).toBe('hanging');
    expect(getOrangeAt(shows - 0.01).visible).toBe(false);
    const ground = getLandHeight(hang[0], hang[1]);
    for (let seam = shows + 1e-6; seam <= LOOP.letGo; seam += 0.25) {
      const orange = getOrangeAt(seam);
      expect(orange.phase).toBe('hanging');
      expect(orange.position).toEqual([hang[0], hang[1], ground + LOOP.hangHeight]);
      expect(orange.rotation).toEqual(first.rotation);
      expect(orange.groundZ).toBe(ground);
      const stem = orange.stem as NonNullable<StoryOrange['stem']>;
      expect(stem.top).toEqual([twig[0], twig[1], twig[2]]);
      // Down to the top of its button, which is straight above its centre: its calyx is up.
      expect(
        distance(stem.bottom, [hang[0], hang[1], ground + LOOP.hangHeight + buttonHeight])
      ).toBe(0);
      const length = distance(stem.top, stem.bottom);
      expect(length).toBeGreaterThan(0.02);
      expect(length).toBeLessThan(0.036);
    }
    // Its calyx points up.
    const [x, y, z, w] = first.rotation;
    expect(2 * (x * z + w * y)).toBeCloseTo(0, 6);
    expect(2 * (y * z - w * x)).toBeCloseTo(0, 6);
    expect(1 - 2 * (x * x + y * y)).toBeCloseTo(1, 6);
  });

  it('keeps the stalk on its twig as it springs back without the fruit', () => {
    const hanging = getOrangeAt(LOOP.letGo).stem as NonNullable<StoryOrange['stem']>;
    const length = distance(hanging.top, hanging.bottom);
    let highest = -Infinity;
    for (let seam = LOOP.letGo + 0.05; seam < 0; seam += 0.05) {
      const stem = getOrangeAt(seam).stem as NonNullable<StoryOrange['stem']>;
      expect(stem.top).toEqual(hanging.top);
      expect(distance(stem.top, stem.bottom)).toBeCloseTo(length, 9);
      highest = Math.max(highest, stem.bottom[2]);
    }
    // It swings up and out, and rings down at 6 Hz of scene time.
    expect(highest).toBeGreaterThan(hanging.bottom[2] + 0.003);
    expect(getOrangeAt(-1).stem?.bottom[2]).toBeGreaterThan(hanging.bottom[2]);
    // The start world has no stalk.
    expect(getOrangeAt(0.1).stem).toBeNull();
    expect(getOrangeAt(-0.1, 'start').stem).toBeNull();
  });

  it('falls under gravity in scene time', () => {
    for (const seam of [-2.2, -1.4, -0.6, -0.2, 0.2, 0.8]) {
      const fall = getFallSeconds(atSeam(seam));
      const {offset} = getFruitTrack(atSeam(seam));
      expect(offset[2]).toBeCloseTo(LOOP.hangHeight - 0.5 * 9.81 * fall * fall, 9);
      expect(offset[0]).toBe(0);
      expect(offset[1]).toBe(0);
    }
  });

  it('is continuous through the swap in offset, velocity, orientation and spin', () => {
    const step = 1 / 2400;
    const rate = getTimeRate(0);
    const before = getOffset(-step, 'end');
    const after = getOffset(step, 'start');
    // About 2.7 m/s of scene time at the swap, so this far apart in a step either way.
    const speed = 9.81 * getFallSeconds(0);
    expect(speed).toBeCloseTo(2.71, 2);
    expect(distance(before, after)).toBeCloseTo(2 * step * rate * speed, 7);
    expect(getOffset(0, 'start')[2]).toBeCloseTo(0.476, 3);
    // Velocity just before and just after, 4 steps apart, which gravity alone tells apart.
    const left = (before[2] - getOffset(-3 * step, 'end')[2]) / (2 * step);
    const right = (getOffset(3 * step, 'start')[2] - after[2]) / (2 * step);
    expect(right - left).toBeCloseTo(-9.81 * rate * rate * 4 * step, 6);
    expect(left).toBeCloseTo(-speed * rate, 3);
    // Turn and spin.
    const turnBefore = getOrangeAt(-step, 'end').rotation;
    const turnAfter = getOrangeAt(step, 'start').rotation;
    expect(getTurnAngle(turnBefore, turnAfter)).toBeLessThan(1e-3);
    const fallStep = getFallSeconds(3 * step) - getFallSeconds(step);
    const spinBefore = getSpin(getOrangeAt(-3 * step, 'end').rotation, turnBefore, fallStep);
    const spinAfter = getSpin(turnAfter, getOrangeAt(3 * step, 'start').rotation, fallStep);
    expect(distance(spinBefore, spinAfter)).toBeLessThan(1e-3);
    expect(Math.hypot(...spinBefore)).toBeGreaterThan(1);
  });

  it('is the same fruit from either world inside the cover, but for where it is', () => {
    const shift = distance(getFruitTrack(-0.1, 'end').anchor, getFruitTrack(0.1, 'start').anchor);
    expect(shift).toBeGreaterThan(1);
    for (let seam = LOOP.cover[0]; seam <= LOOP.cover[1]; seam += 0.025) {
      const end = getOrangeAt(seam, 'end');
      const start = getOrangeAt(seam, 'start');
      expect(getOffset(seam, 'start')).toEqual(getOffset(seam, 'end'));
      expect(start.rotation).toEqual(end.rotation);
      expect(start.halves.map(half => half.rotation)).toEqual(
        end.halves.map(half => half.rotation)
      );
      for (const field of ['radius', 'seam', 'juice', 'dew', 'squash'] as const) {
        expect(start[field]).toBe(end[field]);
      }
      expect(start.dew).toBe(0.9);
      expect(start.phase).toBe('falling');
      // Well clear of the land on both sides, and nothing else near it.
      expect(start.position[2] - start.groundZ).toBeGreaterThan(0.38);
      expect(end.position[2] - end.groundZ).toBeCloseTo(start.position[2] - start.groundZ, 9);
      expect(start.droplets).toEqual([]);
      expect(end.droplets).toEqual([]);
    }
  });

  it('sheds five dew drops as it lets go, gone before the rind fills the frame', () => {
    expect(getOrangeAt(LOOP.letGo).droplets).toEqual([]);
    const shed = getOrangeAt(-1.4).droplets;
    expect(shed.length).toBe(HERO_FRUIT_TABLE.shed.count);
    const centre = getOrangeAt(-1.4).position;
    for (const {position, alpha} of shed) {
      expect(alpha).toBe(1);
      // Beside it, within a few centimetres.
      expect(distance(position, centre)).toBeGreaterThan(ORANGE_TABLE.radius);
      expect(distance(position, centre)).toBeLessThan(0.08);
    }
    expect(getOrangeAt(HERO_FRUIT_TABLE.shed.fade[1]).droplets).toEqual([]);
  });

  it('reaches the sand within 0.01 s of LOOP.impact', () => {
    expect(Math.abs(getImpactSecond() - LOOP.impact)).toBeLessThan(0.01);
    const at = getImpactSecond();
    expect(getOrangeAt(at - 0.02).squash).toBe(0);
    expect(getHeroProps(at - 0.02, 'start').puffs).toEqual([]);
  });

  it('lands with a squash, a crown of sand, flung dew and a hop, then rolls and rocks to rest', () => {
    const impact = getImpactSecond();
    let squash = 0;
    let apex = 0;
    let secondTouch = Infinity;
    let rolledPast = 0;
    const {center, radius} = ORANGE_TABLE;
    const restZ = getStoryState(2.6).props.orange.position[2];
    for (let seam = impact; seam < HERO_FRUIT_TABLE.restAt; seam += 0.002) {
      const orange = getOrangeAt(seam);
      squash = Math.max(squash, orange.squash);
      const lift = orange.position[2] - orange.groundZ - radius * (1 - orange.squash);
      if (seam < 1.6) apex = Math.max(apex, lift);
      if (seam > 1.3 && lift <= 1e-6 && secondTouch === Infinity) secondTouch = seam;
      rolledPast = Math.max(
        rolledPast,
        distance(orange.position.slice(0, 2), [
          center[0] - 0.06 * Math.sin((238 * Math.PI) / 180),
          center[1] - 0.06 * Math.cos((238 * Math.PI) / 180)
        ]) - 0.06
      );
    }
    expect(squash).toBeCloseTo(HERO_FRUIT_TABLE.squash, 3);
    expect(apex).toBeCloseTo(0.026, 3);
    expect(secondTouch).toBeGreaterThan(1.75);
    expect(secondTouch).toBeLessThan(1.9);
    // It rocks past its rest, by about 4 degrees of roll, and comes back.
    expect(rolledPast).toBeGreaterThan(0.001);
    expect(rolledPast).toBeLessThan(0.005);
    const landing = getHeroProps(impact + 0.02, 'start');
    expect(landing.puffs.length).toBe(HERO_FRUIT_TABLE.puff.count);
    expect(landing.orange.droplets.length).toBe(HERO_FRUIT_TABLE.flung.count);
    for (const puff of landing.puffs) {
      expect(puff.position[2]).toBeGreaterThanOrEqual(
        getLandHeight(puff.position[0], puff.position[1])
      );
    }
    expect(getHeroProps(2.4, 'start').puffs).toEqual([]);
    expect(restZ).toBeCloseTo(getLandHeight(center[0], center[1]) + radius, 9);
  });

  it('rests in exactly the opening pose, ORANGE_ROTATION at ORANGE_TABLE.center', () => {
    for (const seam of [HERO_FRUIT_TABLE.restAt, 2.55, 2.6, 2.65]) {
      const orange = getOrangeAt(seam);
      expect(orange.rotation).toEqual(ORANGE_ROTATION);
      expect(orange.position[0]).toBe(ORANGE_TABLE.center[0]);
      expect(orange.position[1]).toBe(ORANGE_TABLE.center[1]);
      expect(orange.phase).toBe('resting');
      expect(orange.squash).toBe(0);
    }
    // And moves into it smoothly: a frame before, it is all but there.
    const before = getOrangeAt(HERO_FRUIT_TABLE.restAt - 1 / 30);
    expect(getTurnAngle(before.rotation, ORANGE_ROTATION)).toBeLessThan(0.01);
    expect(distance(before.position, getOrangeAt(HERO_FRUIT_TABLE.restAt).position)).toBeLessThan(
      5e-4
    );
  });

  it('gives the camera the land under its fall line, which only jumps at the swap', () => {
    for (const seam of [-30, -5, LOOP.letGo, -1, -1e-4]) {
      expect(getFruitTrack(atSeam(seam)).anchor).toEqual(getFruitTrack(atSeam(-5)).anchor);
    }
    for (const seam of [1e-4, 1, 2.6, 20]) {
      expect(getFruitTrack(seam).anchor).toEqual(getFruitTrack(0).anchor);
    }
    const end = getFruitTrack(atSeam(-1)).anchor;
    expect(end[2]).toBe(getLandHeight(end[0], end[1]));
    expect(getSeamSeconds(atSeam(-1))).toBeCloseTo(-1, 9);
  });

  it('draws its stalk from the button to a little way into the twig', () => {
    const stem = getOrangeAt(-3).stem as NonNullable<StoryOrange['stem']>;
    const values = getStalkValues(stem, false);
    expect(values.bottom.slice(0, 3)).toEqual(stem.bottom);
    expect(values.top[2]).toBeGreaterThan(stem.top[2]);
    expect(values.look[0]).toBe(0);
    expect(getStalkValues(stem, true).look[0]).toBe(1);
  });
});

/** How far `point` is from the bearing twig's axis, and how far along it, 0 at its base and 1 at its tip. */
function getTwigDistance(point: readonly number[]): {off: number; along: number} {
  const {base, along, length} = getBearingTwig();
  const share =
    (point[0] - base[0]) * along[0] +
    (point[1] - base[1]) * along[1] +
    (point[2] - base[2]) * along[2];
  const t = Math.min(Math.max(share, 0), length);
  return {
    off: distance(
      point,
      [0, 1, 2].map(i => base[i] + along[i] * t)
    ),
    along: share / length
  };
}

/** The bearing twig's leaves, as points in the world. */
function getLeafPoints(): Vec3[] {
  const {positions} = getTwigLeafMesh();
  const points: Vec3[] = [];
  for (let i = 0; i < positions.length; i += 3) {
    points.push([positions[i], positions[i + 1], positions[i + 2]]);
  }
  return points;
}

describe('the bearing twig', () => {
  const twig = getBearingTwig();

  it('meets the stalk on its underside, 1 to 4 cm from its tip, and holds its top inside it', () => {
    expect(twig.junction).toBeGreaterThan(0.9);
    expect((1 - twig.junction) * twig.length).toBeGreaterThan(0.01);
    expect((1 - twig.junction) * twig.length).toBeLessThan(0.04);
    // The stalk's top is on its surface, where its radius is.
    expect(twig.offAxis).toBeLessThan(twig.radius[1]);
    expect(twig.offAxis).toBeGreaterThan(twig.radius[1] * 0.6);
    // What the layer draws of the stalk goes on into the twig, and all of its end is inside it, hanging or
    // sprung, so no cut end shows.
    for (const seam of [-3, LOOP.letGo, -1.4, -0.5]) {
      const stem = getOrangeAt(seam).stem as NonNullable<StoryOrange['stem']>;
      const top = getStalkValues(stem, seam > LOOP.letGo).top;
      const end = top[3] * STALK_END_SHARE;
      expect(getTwigDistance(top.slice(0, 3)).off + end).toBeLessThan(twig.radius[1]);
    }
  });

  it('runs up and back into the crown, to where it leaves its limb', () => {
    const {base, tip} = twig;
    const junction = HERO_FRUIT_TABLE.twig;
    // The hero stands at the origin.
    expect(Math.hypot(base[0], base[1])).toBeLessThan(Math.hypot(junction[0], junction[1]) - 0.25);
    expect(base[2]).toBeGreaterThan(junction[2] + 0.4);
    expect(tip[2]).toBeLessThan(junction[2]);
    expect(twig.radius[0]).toBeGreaterThan(twig.radius[1]);
    expect(twig.radius[1]).toBeGreaterThan(twig.radius[2]);
  });

  it('is drawn with the stalk, and never without it', () => {
    const ids = (state: ReturnType<typeof getStoryState>) =>
      ([createOrangeLayer(state)].flat().filter(Boolean) as {id: string}[]).map(layer => layer.id);
    for (const t of [59, 61.3, 61.7, 62.6]) {
      expect(ids(getStoryState(t))).toEqual(
        expect.arrayContaining(['orange-twig', 'orange-twig-leaves', 'orange-stalk'])
      );
    }
    for (const t of [0.2, 1.09, 2.6]) {
      expect(ids(getStoryState(t))).not.toContain('orange-twig');
    }
    const values = getTwigValues();
    expect(values.tip[3]).toBeCloseTo(twig.length, 9);
    expect(values.radius[3]).toBe(twig.junction);
  });

  it('keeps its leaves on it, clear of the fruit and its fall, and out of the camera way', () => {
    const points = getLeafPoints();
    const centre = getOrangeAt(-3).position;
    const {radius} = ORANGE_TABLE;
    for (const point of points) {
      expect(distance(point, centre)).toBeGreaterThan(radius + 0.02);
      // Above the fruit, so they shade nothing of it from a low sun and nothing falls through them.
      expect(point[2]).toBeGreaterThan(centre[2] + radius + 0.01);
    }
    // Each leaf's petiole starts on the twig.
    for (const {foot} of getTwigLeafFrames()) {
      expect(getTwigDistance(foot).off).toBeLessThan(twig.radius[0]);
    }
    // Clear of the eye all through the finale and the dive, as is the twig.
    let nearest = Infinity;
    let nearestTwig = Infinity;
    for (let t = CYCLE_SECONDS + HERO_FRUIT_TABLE.shows; t < CYCLE_SECONDS; t += 0.05) {
      const eye = getCameraEye(getStoryState(t).camera);
      for (const point of points) nearest = Math.min(nearest, distance(point, eye));
      nearestTwig = Math.min(nearestTwig, getTwigDistance(eye).off);
    }
    expect(nearest).toBeGreaterThan(0.1);
    expect(nearestTwig).toBeGreaterThan(0.1);
  });

  it('hides none of the hanging fruit from the camera', () => {
    const points = getLeafPoints();
    const {radius} = ORANGE_TABLE;
    const times = [LOOP.fileStart - 1 / 30, LOOP.fileStart];
    for (let t = CYCLE_SECONDS + LOOP.stillAir[0]; t <= CYCLE_SECONDS + LOOP.letGo; t += 0.1)
      times.push(t);
    for (const t of times) {
      const state = getStoryState(t);
      const eye = getCameraEye(state.camera);
      const centre = state.props.orange.position;
      const toFruit = [0, 1, 2].map(i => centre[i] - eye[i]);
      const away = Math.hypot(...toFruit);
      const disc = Math.asin(radius / away);
      for (const point of points) {
        const toPoint = [0, 1, 2].map(i => point[i] - eye[i]);
        const near = Math.hypot(...toPoint);
        if (near < away) {
          const cosine =
            toPoint.reduce((sum, value, i) => sum + value * toFruit[i], 0) / (near * away);
          expect(Math.acos(Math.min(cosine, 1))).toBeGreaterThan(disc);
        }
      }
    }
  });
});

describe('contact patches', () => {
  it('writes a patch under a body and a long one away from the key', () => {
    const out: number[] = [];
    writeContact(out, 1, 2, 0.1, 0.8, [-0.9, 0, -0.1]);
    expect(out.length).toBe(CONTACT_STRIDE * 2);
    expect(out[0]).toBe(1);
    expect(out[1]).toBe(2);
    // The light travels toward -x, so the long patch lies to that side.
    expect(out[CONTACT_STRIDE]).toBeLessThan(1);
    expect(out[CONTACT_STRIDE + 3]).toBeGreaterThan(out[CONTACT_STRIDE + 4]);
  });

  it('has no long patch under a light straight overhead', () => {
    const out: number[] = [];
    writeContact(out, 0, 0, 0.1, 0.8, [0, 0, -1]);
    expect(out.length).toBe(CONTACT_STRIDE);
  });

  it('lies on the land, and fades to nothing as the body leaves it', () => {
    const onGround: number[] = [];
    writeContact(onGround, 0, 0, 0.1, 0.8, [0, 0, -1], -0.2, 0);
    expect(onGround[2]).toBeCloseTo(-0.2, 2);
    expect(onGround[2]).toBeGreaterThan(-0.2);
    const near: number[] = [];
    writeContact(near, 0, 0, 0.1, 0.8, [0, 0, -1], 0, CONTACT_FADE / 2);
    expect(near[6]).toBeGreaterThan(0);
    expect(near[6]).toBeLessThan(0.8);
    const clear: number[] = [];
    writeContact(clear, 0, 0, 0.1, 0.8, [-0.9, 0, -0.1], 0, CONTACT_FADE);
    expect(clear).toEqual([]);
  });
});

describe('the pot', () => {
  const pot = {...POT_TABLE.small} as unknown as StoryPot;

  it('keeps its soil inside its rim, at both sizes', () => {
    for (const size of [POT_TABLE.small, POT_TABLE.large]) {
      const sized = {...size} as unknown as StoryPot;
      expect(getPotHeight(sized)).toBeGreaterThan(size.soilLevel);
      expect(getPotHeight(sized)).toBeLessThanOrEqual(size.height);
      expect(getSoilRadius(sized)).toBeLessThan(size.rimRadius);
      expect(getSoilRadius(sized)).toBeGreaterThan(size.rimRadius * 0.6);
    }
    expect(getSoilRadius(pot)).toBeGreaterThan(0);
  });

  it('lays out the same lumps every time, largest first', () => {
    const lumps = createSoilLumps();
    expect(createSoilLumps()).toEqual(lumps);
    const stride = 8;
    for (let index = 1; index < lumps.length / stride; index++) {
      expect(lumps[index * stride + 2]).toBeLessThanOrEqual(lumps[(index - 1) * stride + 2]);
    }
  });

  it('draws fewer lumps the farther off they are', () => {
    const lumps = createSoilLumps();
    const near = getLumpCount(lumps, 5000);
    const far = getLumpCount(lumps, 300);
    expect(near).toBe(lumps.length / 8);
    expect(far).toBeLessThan(near / 4);
    expect(getLumpCount(lumps, 1)).toBe(0);
  });
});

// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';
import {
  DEFAULT_FPS,
  DEFAULT_SHUTTER,
  getDiscPoint,
  getFarBlurRadius,
  getFocusedCamera,
  getFocusPull,
  getJitteredDirection,
  getLensAngles,
  getLensSamples,
  getPixelPadding,
  getSubFrameSeconds,
  getSubFrames,
  PINHOLE_SUB_FRAME
} from '../stage/accumulator';
import {getCameraEye} from '../story/camera';
import type {Vec3} from '../story/story-types';

const SAMPLE_COUNTS = [2, 4, 8, 16, 32, 64];

function getMean(points: readonly (readonly [number, number])[]): [number, number] {
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point[0] / points.length;
    y += point[1] / points.length;
  }
  return [x, y];
}

/** The smallest distance between any two points. Clumped points have a small one. */
function getLeastDistance(points: readonly (readonly [number, number])[]): number {
  let least = Infinity;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      least = Math.min(least, Math.hypot(points[i][0] - points[j][0], points[i][1] - points[j][1]));
    }
  }
  return least;
}

/** The correlation of two lists of numbers. */
function getCorrelation(a: number[], b: number[]): number {
  const meanA = a.reduce((sum, value) => sum + value, 0) / a.length;
  const meanB = b.reduce((sum, value) => sum + value, 0) / b.length;
  let product = 0;
  let squareA = 0;
  let squareB = 0;
  for (let index = 0; index < a.length; index++) {
    product += (a[index] - meanA) * (b[index] - meanB);
    squareA += (a[index] - meanA) ** 2;
    squareB += (b[index] - meanB) ** 2;
  }
  return product / Math.sqrt(squareA * squareB);
}

describe('sub-frames', () => {
  it('has no jitter at one sample', () => {
    expect(getSubFrames(1)).toEqual([PINHOLE_SUB_FRAME]);
    expect(getSubFrameSeconds(10, PINHOLE_SUB_FRAME)).toBe(10);
  });

  it('is the same for every call, so noise does not crawl', () => {
    expect(getSubFrames(16)).toBe(getSubFrames(16));
    expect(getSubFrames(16)[3].lens).toEqual(getSubFrames(16)[3].lens);
  });

  for (const samples of SAMPLE_COUNTS) {
    describe(`${samples} samples`, () => {
      const subFrames = getSubFrames(samples);

      it('only ever moves time forward, and evenly', () => {
        expect(subFrames).toHaveLength(samples);
        for (let index = 0; index < samples; index++) {
          expect(subFrames[index].shutter).toBeCloseTo((index + 0.5) / samples, 10);
        }
      });

      it('covers the shutter, around the frame', () => {
        const seconds = subFrames.map(subFrame => getSubFrameSeconds(50, subFrame));
        const open = DEFAULT_SHUTTER / DEFAULT_FPS;
        expect(seconds[0]).toBeGreaterThan(50 - open / 2);
        expect(seconds[samples - 1]).toBeLessThan(50 + open / 2);
        expect((seconds[0] + seconds[samples - 1]) / 2).toBeCloseTo(50, 8);
      });

      it('keeps the lens, grid and sun around their centers, so the average stays put', () => {
        for (const key of ['lens', 'pixel', 'sun'] as const) {
          const [x, y] = getMean(subFrames.map(subFrame => subFrame[key]));
          expect(Math.abs(x)).toBeLessThan(1e-9);
          expect(Math.abs(y)).toBeLessThan(1e-9);
        }
      });

      it('keeps the lens and sun near their discs, and the grid within its filter', () => {
        // Centering the set may carry a point a little past the rim, as a few samples cannot
        // average 0.
        const slack = samples < 8 ? 0.45 : 0.12;
        for (const {lens, sun, pixel} of subFrames) {
          expect(Math.hypot(lens[0], lens[1])).toBeLessThan(1 + slack);
          expect(Math.hypot(sun[0], sun[1])).toBeLessThan(1 + slack);
          expect(Math.abs(pixel[0])).toBeLessThan(1 + slack);
          expect(Math.abs(pixel[1])).toBeLessThan(1 + slack);
        }
      });

      it('spreads points evenly over the lens, not in clumps', () => {
        // About what a hexagonal packing of this many points on a disc would give, within reason.
        const packed = Math.sqrt(Math.PI / samples);
        expect(getLeastDistance(subFrames.map(subFrame => subFrame.lens))).toBeGreaterThan(
          packed * 0.3
        );
        expect(getLeastDistance(subFrames.map(subFrame => subFrame.sun))).toBeGreaterThan(
          packed * 0.3
        );
      });
    });
  }

  it('does not tie the lens to the clock, the sun or the pixel grid', () => {
    const subFrames = getSubFrames(32);
    const lensX = subFrames.map(subFrame => subFrame.lens[0]);
    expect(
      Math.abs(
        getCorrelation(
          lensX,
          subFrames.map(subFrame => subFrame.shutter)
        )
      )
    ).toBeLessThan(0.4);
    expect(
      Math.abs(
        getCorrelation(
          lensX,
          subFrames.map(subFrame => subFrame.sun[0])
        )
      )
    ).toBeLessThan(0.4);
    expect(
      Math.abs(
        getCorrelation(
          lensX,
          subFrames.map(subFrame => subFrame.pixel[0])
        )
      )
    ).toBeLessThan(0.4);
  });
});

describe('getDiscPoint', () => {
  it('maps the square onto the disc', () => {
    expect(getDiscPoint(0.5, 0.5)).toEqual([0, 0]);
    for (const [u, v] of [
      [0, 0],
      [1, 1],
      [0, 1],
      [1, 0],
      [1, 0.5],
      [0.5, 0]
    ]) {
      const [x, y] = getDiscPoint(u, v);
      expect(Math.hypot(x, y)).toBeCloseTo(1, 10);
    }
    for (let i = 0; i < 100; i++) {
      const [x, y] = getDiscPoint((i * 0.7548) % 1, (i * 0.5698) % 1);
      expect(Math.hypot(x, y)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});

describe('getLensAngles', () => {
  it('moves the eye by the aperture, at the camera distance', () => {
    const camera = {aperture: 0.02, distance: 10, pitch: 0};
    const [orbit, pitch] = getLensAngles(camera, [1, 0]);
    expect((orbit * Math.PI * 10) / 180).toBeCloseTo(0.02, 6);
    expect(pitch).toBe(0);
    const [, up] = getLensAngles(camera, [0, -1]);
    expect((up * Math.PI * 10) / 180).toBeCloseTo(-0.02, 6);
  });

  it('allows for the eye nearer the orbit axis when the camera looks down', () => {
    const [orbit] = getLensAngles({aperture: 0.02, distance: 10, pitch: 60}, [1, 0]);
    expect((orbit * Math.PI * 10 * Math.cos(Math.PI / 3)) / 180).toBeCloseTo(0.02, 6);
  });

  it('is a pinhole at no aperture and at scale 0', () => {
    expect(getLensAngles({aperture: 0, distance: 10, pitch: 0}, [1, 1])).toEqual([0, 0]);
    expect(getLensAngles({aperture: 0.02, distance: 10, pitch: 0}, [1, 1], 0)).toEqual([0, 0]);
  });
});

describe('getPixelPadding', () => {
  it('asks for twice the shift, on the side it moves from, in CSS pixels', () => {
    expect(getPixelPadding([0.25, -0.5], 1)).toEqual({left: 0.5, right: 0, top: 0, bottom: 1});
    expect(getPixelPadding([-0.5, 0.25], 2)).toEqual({left: 0, right: 0.5, top: 0.25, bottom: 0});
  });
});

describe('getJitteredDirection', () => {
  const DIRECTIONS: Vec3[] = [
    [0, 0, -1],
    [0.6, 0, -0.8],
    [0.3, -0.5, -Math.sqrt(1 - 0.34)],
    [0, 1, 0]
  ];

  it('is unmoved at the center of the disc, or with no softness', () => {
    expect(getJitteredDirection([0, 0, -1], [0, 0], 1)).toEqual([0, 0, -1]);
    expect(getJitteredDirection([0, 0, -1], [1, 0], 0)).toEqual([0, 0, -1]);
  });

  for (const direction of DIRECTIONS) {
    it(`moves ${direction} by the disc's radius, at the rim, whichever way`, () => {
      for (let index = 0; index < 8; index++) {
        const angle = (index / 8) * Math.PI * 2;
        const moved = getJitteredDirection(direction, [Math.cos(angle), Math.sin(angle)], 1.2);
        expect(Math.hypot(...moved)).toBeCloseTo(1, 10);
        const cosine = moved[0] * direction[0] + moved[1] * direction[1] + moved[2] * direction[2];
        expect((Math.acos(Math.min(cosine, 1)) * 180) / Math.PI).toBeCloseTo(1.2, 2);
      }
    });
  }

  it('goes round the disc, not back and forth along a line', () => {
    const a = getJitteredDirection([0.3, 0.4, -Math.sqrt(0.75)], [1, 0], 1);
    const b = getJitteredDirection([0.3, 0.4, -Math.sqrt(0.75)], [0, 1], 1);
    const cosine = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    // Two quarter-turned points are about radius times root 2 apart.
    expect((Math.acos(cosine) * 180) / Math.PI).toBeCloseTo(Math.SQRT2, 2);
  });
});

describe('getLensSamples', () => {
  it('leaves a single sample and an everyday lens alone', () => {
    expect(getLensSamples(1, 50)).toBe(1);
    expect(getLensSamples(16, 0)).toBe(16);
    expect(getLensSamples(16, 6)).toBe(16);
  });

  it('asks for more as the far blur widens, up to a limit', () => {
    const counts = [8, 12, 16, 20, 25, 30, 40, 80].map(radius => getLensSamples(16, radius));
    for (let index = 1; index < counts.length; index++) {
      expect(counts[index]).toBeGreaterThanOrEqual(counts[index - 1]);
    }
    expect(getLensSamples(16, 39)).toBe(64);
    expect(getLensSamples(16, 400)).toBe(64);
    expect(getLensSamples(32, 400)).toBe(128);
  });

  it('keeps lens points within reach of each other in the image', () => {
    for (const radius of [8, 12, 20, 26]) {
      const count = getLensSamples(16, radius);
      expect(radius * Math.sqrt(Math.PI / count)).toBeLessThanOrEqual(6.01);
    }
  });
});

describe('getFarBlurRadius', () => {
  it('is the aperture, scaled from the focus distance to the image', () => {
    // At a 90 degree lens and a frame 2000 high, the focal length is 1000 pixels.
    expect(getFarBlurRadius({aperture: 0.01, distance: 2, fovy: 90}, 2000)).toBeCloseTo(5);
    expect(getFarBlurRadius({aperture: 0.01, distance: 2, fovy: 90}, 2000, 0)).toBe(0);
  });
});

describe('focus', () => {
  const CAMERA = {
    target: [0, 0, 1] as Vec3,
    orbit: 0,
    pitch: 0,
    distance: 10,
    fovy: 40,
    near: 0.1,
    far: 100,
    aperture: 0.02
  };
  const CLOSED_HALVES = [{position: [0, 0, 0]}, {position: [0, 0, 0]}];
  const OPEN_HALVES = [{position: [-0.1, 0, 0]}, {position: [0.1, 0, 0]}];

  function getProps(visible: boolean, halves = CLOSED_HALVES) {
    return {orange: {visible, radius: 0.04, position: [0, 0, 0], halves}} as never;
  }

  function getTrees(growth: number) {
    return [{position: [0, 0, 0], crownRadius: 5, growth}] as never;
  }

  it('is on the target when nothing is in the way', () => {
    const away = {...CAMERA, target: [40, 0, 1] as Vec3};
    expect(getFocusPull({camera: away, props: getProps(false), trees: getTrees(0.6)})).toBe(0);
  });

  it('comes to the near side of a crown the target is inside', () => {
    const pull = getFocusPull({camera: CAMERA, props: getProps(false), trees: getTrees(0.6)});
    expect(pull).toBeGreaterThan(1.5);
    expect(pull).toBeLessThan(5);
    // A whip has no crown to speak of, and the pull comes in as one closes.
    expect(getFocusPull({camera: CAMERA, props: getProps(false), trees: getTrees(0.08)})).toBe(0);
    expect(
      getFocusPull({camera: CAMERA, props: getProps(false), trees: getTrees(0.2)})
    ).toBeLessThan(pull);
    expect(
      getFocusPull({camera: CAMERA, props: getProps(false), trees: getTrees(0.001)})
    ).toBeLessThan(0.02);
  });

  it('comes to the near side of a closed orange, and goes back as it parts or is left', () => {
    const macro = {...CAMERA, target: [0, 0, 0] as Vec3, distance: 0.3};
    const closed = getFocusPull({camera: macro, props: getProps(true), trees: getTrees(0)});
    expect(closed).toBeCloseTo(0.036, 5);
    expect(
      getFocusPull({camera: macro, props: getProps(true, OPEN_HALVES), trees: getTrees(0)})
    ).toBe(0);
    const left = {...macro, target: [0.3, 0, 0] as Vec3};
    expect(getFocusPull({camera: left, props: getProps(true), trees: getTrees(0)})).toBe(0);
  });

  it('comes to the near rind itself as the lens closes in on the fruit, nearer than half way', () => {
    const macro = {...CAMERA, target: [0, 0, 0] as Vec3};
    // At the swap's 0.068 m, the whole radius: the focus is on the rind nearest the lens.
    const swap = getFocusPull({
      camera: {...macro, distance: 0.068},
      props: getProps(true),
      trees: getTrees(1)
    });
    expect(swap).toBeCloseTo(0.04, 12);
    // And it comes there smoothly from the opening's 0.9 of it, without a step.
    let last = getFocusPull({
      camera: {...macro, distance: 0.3},
      props: getProps(true),
      trees: getTrees(1)
    });
    expect(last).toBeCloseTo(0.036, 12);
    for (let distance = 0.3; distance >= 0.068; distance -= 0.002) {
      const pull = getFocusPull({
        camera: {...macro, distance},
        props: getProps(true),
        trees: getTrees(1)
      });
      expect(pull).toBeGreaterThanOrEqual(last - 1e-12);
      expect(pull - last).toBeLessThan(0.0002);
      last = pull;
    }
  });

  it('never focuses closer than half way to the target', () => {
    const close = {...CAMERA, distance: 3};
    expect(getFocusPull({camera: close, props: getProps(false), trees: getTrees(1)})).toBe(1.5);
  });

  it('leaves the eye, direction and framing where they are', () => {
    const focused = getFocusedCamera({...CAMERA, orbit: 37, pitch: 12}, 2.5);
    const camera = {...CAMERA, orbit: 37, pitch: 12};
    expect(focused.distance).toBe(7.5);
    const eye = getCameraEye(camera);
    const focusedEye = getCameraEye(focused);
    for (let axis = 0; axis < 3; axis++) expect(focusedEye[axis]).toBeCloseTo(eye[axis], 10);
    expect(getFocusedCamera(camera, 0)).toBe(camera);
  });
});

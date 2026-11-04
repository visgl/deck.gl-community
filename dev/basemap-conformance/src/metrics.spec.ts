// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, test} from 'vitest';
import {
  detectEdges,
  edgeScores,
  formatDeltaTable,
  getRegressions,
  labelScores,
  ssim,
  tightenBaseline,
  toGray,
  type GrayImage,
  type SceneMetrics
} from './metrics';

const SIZE = 64;

/** A gray image with dark squares on white, optionally shifted right. */
function squares(shift = 0, color = 40): GrayImage {
  const data = new Float32Array(SIZE * SIZE).fill(255);
  for (const [left, top] of [
    [8, 8],
    [36, 12],
    [16, 40]
  ]) {
    for (let y = top; y < top + 14; y++) {
      for (let x = left + shift; x < left + shift + 14; x++) {
        data[y * SIZE + x] = color;
      }
    }
  }
  return {width: SIZE, height: SIZE, data};
}

function blank(value = 255): GrayImage {
  return {
    width: SIZE,
    height: SIZE,
    data: new Float32Array(SIZE * SIZE).fill(value)
  };
}

const edges = (image: GrayImage) => detectEdges(image);

describe('reference-render metrics', () => {
  test('toGray uses BT.601 luma', () => {
    const gray = toGray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255], 3, 1);
    expect([...gray.data].map(value => Math.round(value))).toEqual([76, 150, 29]);
  });

  test('SSIM is 1 for identical images and falls with structural change', () => {
    expect(ssim(squares(), squares()).mean).toBeCloseTo(1, 6);
    const shifted = ssim(squares(), squares(3)).mean;
    const missing = ssim(squares(), blank()).mean;
    expect(shifted).toBeLessThan(0.95);
    expect(missing).toBeLessThan(shifted);
  });

  test('SSIM counts a loss of contrast', () => {
    // Squares at 150 instead of 40 on white: same structure, less than half the contrast.
    expect(ssim(squares(), squares(0, 150)).mean).toBeLessThan(0.97);
  });

  test('SSIM counts texture added to flat areas', () => {
    // A fixed pattern of up to 12 levels over the whole image: structure where there was none.
    const textured = {
      ...squares(),
      data: squares().data.map((value, i) => value + ((i * 7919) % 13) - 6)
    };
    expect(ssim(squares(), textured).mean).toBeLessThan(0.95);
  });

  test('SSIM barely changes with a small uniform brightness change', () => {
    const brighter = {
      ...squares(),
      data: squares().data.map(value => Math.min(255, value + 4))
    };
    expect(ssim(squares(), brighter).mean).toBeGreaterThan(0.99);
  });

  test('edges are thin and absent from a blank image', () => {
    expect(edges(blank()).reduce((sum, value) => sum + value, 0)).toBe(0);
    const count = edges(squares()).reduce((sum, value) => sum + value, 0);
    // Three 14 px squares have 3 * 4 * 14 = 168 boundary pixels; thin edges stay near that.
    expect(count).toBeGreaterThan(120);
    expect(count).toBeLessThan(260);
  });

  test('edge F is 1 within the tolerance and falls beyond it', () => {
    const reference = edges(squares());
    expect(edgeScores(reference, edges(squares()), SIZE, SIZE).f).toBe(1);
    expect(edgeScores(reference, edges(squares(1)), SIZE, SIZE).f).toBeGreaterThan(0.95);
    const offset = edgeScores(reference, edges(squares(3)), SIZE, SIZE);
    expect(offset.precision).toBeLessThan(0.75);
    expect(offset.recall).toBeLessThan(0.75);
    const none = edgeScores(reference, edges(blank()), SIZE, SIZE);
    expect(none).toEqual({precision: 0, recall: 0, f: 0});
  });

  test('edge precision drops for extra edges, recall for missing ones', () => {
    const reference = edges(squares());
    const extra = edges(squares());
    for (let x = 2; x < SIZE - 2; x++) {
      extra[60 * SIZE + x] = 1;
    }
    const scores = edgeScores(reference, extra, SIZE, SIZE);
    expect(scores.recall).toBe(1);
    expect(scores.precision).toBeLessThan(0.85);
  });

  test('label scores compare distinct strings, ignoring case and wrapping', () => {
    const scores = labelScores(
      ['Paris', 'La Seine', 'Le\nMarais', 'Paris', 'Baden-Württemberg'],
      ['PARIS', 'le marais', 'Rue X', 'Baden-\nWürttemberg']
    );
    expect(scores.recall).toBeCloseTo(3 / 4);
    expect(scores.precision).toBeCloseTo(3 / 4);
    expect(scores.missing).toEqual(['la seine']);
    expect(scores.extra).toEqual(['rue x']);
    expect(labelScores([], []).recall).toBe(1);
    expect(labelScores(['a'], []).precision).toBe(0);
  });
});

const BASE: SceneMetrics = {
  ssim: 0.8,
  edgeF: 0.7,
  labelRecall: 0.8,
  labelPrecision: 0.5,
  referenceLabels: 20,
  candidateLabels: 40
};

describe('reference-render bounds', () => {
  test('a metric within its tolerance passes, one beyond it fails', () => {
    expect(getRegressions({...BASE, ssim: 0.795}, BASE)).toEqual([]);
    expect(getRegressions({...BASE, ssim: 0.785}, BASE)).toHaveLength(1);
    expect(getRegressions({...BASE, edgeF: 0.67}, BASE)[0]).toMatch(/^Edge F 0.6700/);
  });

  test('label metrics allow one label of slack', () => {
    // One of 20 reference labels is 0.05.
    expect(getRegressions({...BASE, labelRecall: 0.75}, BASE)).toEqual([]);
    expect(getRegressions({...BASE, labelRecall: 0.7}, BASE)).toHaveLength(1);
  });

  test('tightening keeps the better value of every metric and adds new scenes', () => {
    const next = tightenBaseline(
      {a: BASE},
      {a: {...BASE, ssim: 0.85, edgeF: 0.6}, b: {...BASE, ssim: 0.5}}
    );
    expect(next.a.ssim).toBe(0.85);
    expect(next.a.edgeF).toBe(0.7);
    expect(next.b.ssim).toBe(0.5);
  });

  test('tightening never lowers a label floor through a smaller label count', () => {
    // Precision 0.5 of 40 labels has a floor near 0.475; 0.6 of 2 labels would have one near 0.1.
    const next = tightenBaseline(
      {a: BASE},
      {a: {...BASE, labelPrecision: 0.6, candidateLabels: 2}}
    );
    expect(next.a.labelPrecision).toBe(0.5);
    expect(next.a.candidateLabels).toBe(40);
    const better = tightenBaseline(
      {a: BASE},
      {a: {...BASE, labelPrecision: 0.6, candidateLabels: 50}}
    );
    expect(better.a.labelPrecision).toBe(0.6);
  });

  test('losing exactly one label passes despite rounding', () => {
    const base = {...BASE, labelPrecision: 0.8056, candidateLabels: 36};
    // 28 of 36 labels, rounded as stored.
    expect(getRegressions({...base, labelPrecision: 0.7778}, base)).toEqual([]);
  });

  test('the delta table shows changes from the baseline', () => {
    const table = formatDeltaTable(
      {a: BASE},
      {a: {...BASE, ssim: 0.83}, b: BASE},
      {a: ['regressed']}
    );
    expect(table).toContain('| a **(regressed)** | 0.830 (+0.030) | 0.700 |');
    expect(table).toContain('| b | 0.800 (new) |');
  });
});

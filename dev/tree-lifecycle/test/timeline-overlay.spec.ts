// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';
import {
  findFlagOverlaps,
  findPoleCrossings,
  getFlagBoxes,
  getOverlayMetrics,
  getScrimAlpha,
  layOutTimelineOverlay,
  type MeasureText,
  type OverlayLayout,
  type OverlayReadoutLine
} from '../stage/timeline-overlay';
import {
  CYCLE_SECONDS,
  getContentSeconds,
  getSeamSeconds,
  getYear,
  isInSeamWindow,
  LOOP
} from '../story/beats';
import {smoothstep} from '../story/story-math';
import type {StoryWorld} from '../story/story-types';
import {
  CAPTION_TABLE,
  FLAG_TABLE,
  getCaption,
  getTimeline,
  ROLLOVER,
  YIELD_TABLE
} from '../story/yield';

/**
 * Text as wide as the widest of the faces the overlay asks for, with its tracking. The real faces
 * are checked against this film in a browser by `checkOverlay`.
 */
const measure: MeasureText = (text, font) => text.length * (font.size * 0.58 + font.tracking);

const FRAMES = [
  {name: 'landscape 1920x1080', width: 1920, height: 1080},
  {name: 'portrait 1080x1920', width: 1080, height: 1920},
  {name: 'landscape 1280x720', width: 1280, height: 720},
  {name: 'landscape at twice the pixels', width: 3840, height: 2160}
];

const FPS = 30;
/** The file's frames: one cycle from `LOOP.fileStart`, 1,920 of them. */
const FILE_FRAMES = CYCLE_SECONDS * FPS;
const FILE_START_FRAME = Math.round(LOOP.fileStart * FPS);
/** Steps through the roll-over: eight a frame, as the accumulator's sub-frames come. */
const SUB_FRAME = 1 / 240;
/**
 * Time for a test that lays out every frame of the file and every step of the roll-over and checks
 * every mark of each, which may take a few seconds while the rest of the suite runs beside it.
 */
const WHOLE_FILM_TIMEOUT = 30_000;

function getLayout(
  t: number,
  width: number,
  height: number,
  measureText: MeasureText = measure,
  world?: StoryWorld
): OverlayLayout {
  const timeline = getTimeline(t, getYear(getContentSeconds(t, world)), world);
  return layOutTimelineOverlay(
    timeline,
    getCaption(t),
    getOverlayMetrics(width, height),
    measureText
  );
}

/** Every frame of the file, in its order, then its first again, so its wrap is a step too. */
function forEachFrame(visit: (t: number) => void): void {
  for (let frame = 0; frame <= FILE_FRAMES; frame++) visit((FILE_START_FRAME + frame) / FPS);
}

/** Through the roll-over and a little either side, a sub-frame at a time, as seam seconds. */
function forEachRolloverStep(visit: (seam: number) => void): void {
  for (let seam = ROLLOVER.start - 0.2; seam <= ROLLOVER.end + 0.2; seam += SUB_FRAME) {
    visit(seam);
  }
}

function isRollingOver(t: number): boolean {
  const seam = getSeamSeconds(t);
  return seam >= ROLLOVER.start && seam < ROLLOVER.end;
}

/**
 * About how tall the readout face's tallest letters are, ascenders over its capitals, and how deep
 * its descenders, in its size, as Chromium measures Iowan Old Style.
 */
const READOUT_ASCENT = 0.76;
const READOUT_DESCENT = 0.26;

/**
 * Room a readout line's letters may take as the drum draws it, whatever its text: from the top of
 * its ascenders over its baseline to the foot of its descenders.
 */
function getReadoutBox(line: OverlayReadoutLine, layout: OverlayLayout) {
  const {size} = layout.metrics.fonts.readout;
  return {
    top: line.y - size * READOUT_ASCENT * line.scale,
    baseline: line.y,
    bottom: line.y + size * READOUT_DESCENT * line.scale
  };
}

/** This year's yield on the axis at cycle second `t`, as the story has it. */
function getThisYear(t: number): number | undefined {
  return getTimeline(t, getYear(getContentSeconds(t))).yield?.thisYear;
}

/**
 * A mark of a layout as numbers: what it is, if it says (a flag's id, a label's text), else `''`,
 * where it is in pixels, and its opacities.
 */
type Mark = {kind: string; id: string; pixels: number[]; alphas: number[]};

/** Coming or going between two frames, a mark this faint is not a jump. */
const FAINT = 0.05;

function getMarks(layout: OverlayLayout): Mark[] {
  const marks: Mark[] = [
    {kind: 'playhead', id: 'playhead', pixels: [layout.playheadX], alphas: [1]}
  ];
  for (const {x, height, alpha} of layout.ticks) {
    marks.push({kind: 'tick', id: '', pixels: [x, height], alphas: [alpha]});
  }
  for (const {x, text, alpha} of layout.tickLabels) {
    marks.push({kind: 'label', id: text, pixels: [x], alphas: [alpha]});
  }
  for (const {x, width, height, lostHeight, alpha} of layout.bars) {
    marks.push({kind: 'bar', id: '', pixels: [x, width, height, lostHeight], alphas: [alpha]});
  }
  for (const {id, x, poleTop, textX, textY, poleAlpha, textAlpha} of layout.flags) {
    marks.push({
      kind: 'flag',
      id,
      pixels: [x, poleTop, textX, textY],
      alphas: [poleAlpha, textAlpha]
    });
  }
  for (const {left, right, alpha} of layout.ribbon) {
    // A piece too thin to see is only just starting.
    if (right - left > 0.5)
      marks.push({kind: 'ribbon', id: '', pixels: [left, right], alphas: [alpha]});
  }
  for (const {text, y, alpha, scale} of layout.readout) {
    marks.push({kind: 'readout', id: text, pixels: [y], alphas: [alpha, scale]});
  }
  if (layout.yield)
    marks.push({kind: 'yield', id: 'yield', pixels: [], alphas: [layout.yield.alpha]});
  if (layout.caption) {
    marks.push({
      kind: 'caption',
      id: layout.caption.text,
      pixels: [],
      alphas: [layout.caption.alpha]
    });
  }
  return marks;
}

/**
 * Where two layouts differ by more than `pixels`, or in opacity by more than `alpha`. Marks that
 * say what they are are paired by that, and others with the nearest of their kind within `pixels`,
 * so one only just coming or going at an end of the axis leaves the rest paired.
 */
function getDifferences(
  a: OverlayLayout,
  b: OverlayLayout,
  pixels: number,
  alpha: number
): string[] {
  const after = getMarks(b);
  const differences: string[] = [];
  const name = (mark: Mark) => `${mark.kind} ${mark.id || mark.pixels.map(p => p.toFixed(2))}`;
  for (const mark of getMarks(a)) {
    let best = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    after.forEach((other, index) => {
      if (other.kind === mark.kind && other.id === mark.id) {
        const steps = mark.pixels.map((value, i) => Math.abs(other.pixels[i] - value));
        const distance = steps.reduce((sum, step) => sum + step, 0);
        if ((mark.id || Math.max(0, ...steps) <= pixels) && distance < bestDistance) {
          best = index;
          bestDistance = distance;
        }
      }
    });
    if (best < 0) {
      if (Math.max(...mark.alphas) > FAINT) differences.push(`${name(mark)} goes`);
    } else {
      const [other] = after.splice(best, 1);
      mark.pixels.forEach((value, i) => {
        if (Math.abs(other.pixels[i] - value) > pixels) {
          differences.push(`${name(mark)} moves ${value} -> ${other.pixels[i]}`);
        }
      });
      mark.alphas.forEach((value, i) => {
        if (Math.abs(other.alphas[i] - value) > alpha) {
          differences.push(`${name(mark)} fades ${value} -> ${other.alphas[i]}`);
        }
      });
    }
  }
  for (const mark of after) {
    if (Math.max(...mark.alphas) > FAINT) differences.push(`${name(mark)} comes`);
  }
  return differences;
}

describe('timeline overlay layout', () => {
  for (const {name, width, height} of FRAMES) {
    describe(name, () => {
      const metrics = getOverlayMetrics(width, height);
      const axisWidth = metrics.axisRight - metrics.axisLeft;

      it('keeps flag labels apart at every frame of the cycle', () => {
        forEachFrame(t => {
          const overlaps = findFlagOverlaps(getLayout(t, width, height));
          expect(overlaps, `t=${t}`).toEqual([]);
        });
      });

      it('never strikes a pole through another flag', () => {
        forEachFrame(t => {
          const crossings = findPoleCrossings(getLayout(t, width, height));
          expect(crossings, `t=${t}`).toEqual([]);
        });
      });

      it('keeps both charts free of overlaps and pole crossings through the roll-over', () => {
        forEachRolloverStep(seam => {
          const layout = getLayout(seam, width, height);
          expect(findFlagOverlaps(layout), `seam=${seam}`).toEqual([]);
          expect(findPoleCrossings(layout), `seam=${seam}`).toEqual([]);
        });
      });

      it('moves flag labels only a little from frame to frame', () => {
        let previous = new Map<string, number>();
        forEachFrame(t => {
          const next = new Map<string, number>();
          for (const flag of getLayout(t, width, height).flags) {
            next.set(flag.id, flag.textY);
            const before = previous.get(flag.id);
            if (before !== undefined) {
              expect(Math.abs(flag.textY - before), `${flag.id} at t=${t}`).toBeLessThan(
                metrics.flagRow * 0.5
              );
            }
          }
          previous = next;
        });
      });

      it('fades a flag label in and out only smoothly, and only out as it slides away', () => {
        // From the file's last frame, which comes before its first.
        const last = getLayout((FILE_START_FRAME - 1) / FPS, width, height);
        let previous = new Map(last.flags.map(flag => [flag.id, flag.textAlpha]));
        forEachFrame(t => {
          const next = new Map<string, number>();
          for (const flag of getLayout(t, width, height).flags) {
            next.set(flag.id, flag.textAlpha);
            const before = previous.get(flag.id) ?? 0;
            if (isRollingOver(t)) {
              // The Year 30 chart's labels go at the end of the axis, and none come.
              expect(flag.textAlpha, `${flag.id} at t=${t}`).toBeLessThanOrEqual(before + 1e-9);
            } else {
              expect(Math.abs(flag.textAlpha - before), `${flag.id} at t=${t}`).toBeLessThan(0.3);
            }
          }
          previous = next;
        });
      });

      it(
        'keeps every label inside the axis and the frame, or fading past its end',
        () => {
          const visit = (t: number) => {
            const layout = getLayout(t, width, height);
            for (const box of getFlagBoxes(layout)) {
              const past = metrics.axisLeft - box.left;
              const flag = layout.flags.find(({id}) => id === box.id);
              expect(flag?.textAlpha, `${box.id} at t=${t}`).toBeLessThanOrEqual(
                1 - smoothstep(0, metrics.edgeFade, past) + 1e-9
              );
              expect(box.left, `${box.id} at t=${t}`).toBeGreaterThanOrEqual(
                metrics.axisLeft - (isRollingOver(t) ? metrics.edgeFade : 0) - 1
              );
              expect(box.right, `${box.id} at t=${t}`).toBeLessThanOrEqual(metrics.axisRight + 1);
              expect(box.top, `${box.id} at t=${t}`).toBeGreaterThan(0);
            }
          };
          forEachFrame(visit);
          forEachRolloverStep(visit);
        },
        WHOLE_FILM_TIMEOUT
      );

      it('keeps the playhead on the axis, most of the way across once it is moving', () => {
        forEachFrame(t => {
          const {playheadX} = getLayout(t, width, height);
          expect(playheadX, `t=${t}`).toBeGreaterThanOrEqual(metrics.axisLeft);
          expect(playheadX, `t=${t}`).toBeLessThanOrEqual(metrics.axisRight + 1e-6);
        });
        const across = (t: number) =>
          (getLayout(t, width, height).playheadX - metrics.axisLeft) / axisWidth;
        expect(across(12)).toBeGreaterThan(0.7);
        expect(across(30)).toBeGreaterThan(0.7);
        expect(across(50)).toBeGreaterThan(0.7);
        expect(across(LOOP.fileStart)).toBeCloseTo(1, 5);
      });

      it('rides the playhead on the join, from the right end to the left', () => {
        let last = Number.POSITIVE_INFINITY;
        forEachRolloverStep(seam => {
          const layout = getLayout(seam, width, height);
          if (seam >= ROLLOVER.start && seam < 0) {
            const [previous, next] = layout.charts;
            // Year 30 on the chart sliding out and Day 0 on the one coming in are one point.
            expect(layout.playheadX, `seam=${seam}`).toBeCloseTo(
              metrics.axisRight + previous.offset,
              6
            );
            expect(layout.playheadX, `seam=${seam}`).toBeCloseTo(metrics.axisLeft + next.offset, 6);
            expect(layout.playheadX, `seam=${seam}`).toBeLessThanOrEqual(last + 1e-9);
            last = layout.playheadX;
          }
        });
        expect(getLayout(ROLLOVER.start, width, height).playheadX).toBeCloseTo(
          metrics.axisRight,
          6
        );
        // Then it sets off from Day 0 as it does on any other day.
        const settled = getLayout(ROLLOVER.end, width, height).playheadX;
        expect(settled - metrics.axisLeft).toBeLessThan(axisWidth * 0.05);
      });

      it('keeps tick labels inside the frame', () => {
        const visit = (t: number) => {
          for (const label of getLayout(t, width, height).tickLabels) {
            const half = measure(label.text, metrics.fonts.tick) / 2;
            expect(label.x - half, `${label.text} at t=${t}`).toBeGreaterThanOrEqual(0);
            expect(label.x + half, `${label.text} at t=${t}`).toBeLessThanOrEqual(width);
          }
        };
        forEachFrame(visit);
        forEachRolloverStep(visit);
      });

      it('keeps tick labels apart at every frame, the two charts too', () => {
        const visit = (t: number) => {
          const layout = getLayout(t, width, height);
          const seen = layout.tickLabels
            .map(label => ({...label, width: measure(label.text, metrics.fonts.tick)}))
            .sort((a, b) => a.x - b.x);
          for (let index = 1; index < seen.length; index++) {
            const a = seen[index - 1];
            const b = seen[index];
            expect(b.x - b.width / 2, `${a.text}, ${b.text} at t=${t}`).toBeGreaterThanOrEqual(
              a.x + a.width / 2
            );
          }
        };
        forEachFrame(visit);
        forEachRolloverStep(visit);
      });

      it('shows every event in the file’s first frame', () => {
        const ids = getLayout(LOOP.fileStart, width, height)
          .flags.filter(flag => flag.textAlpha > 0.99)
          .map(flag => flag.id);
        expect(ids.sort()).toEqual(FLAG_TABLE.map(flag => flag.id).sort());
      });

      it('spans exactly Year 0 to Year 30 in the file’s first frame', () => {
        const labels = getLayout(LOOP.fileStart, width, height).tickLabels.filter(
          label => label.alpha > 0.99
        );
        expect(labels[0].text).toBe('Year 0');
        expect(labels[labels.length - 1].text).toBe('Year 30');
        const half = metrics.width * 0.05;
        expect(Math.abs(labels[0].x - metrics.axisLeft)).toBeLessThan(half);
        expect(Math.abs(labels[labels.length - 1].x - metrics.axisRight)).toBeLessThan(half);
      });

      it('is continuous at the swap', () => {
        const before = getLayout(-1e-6, width, height);
        const after = getLayout(1e-6, width, height);
        expect(getDifferences(before, after, 0.01, 1e-4)).toEqual([]);
      });

      it('starts and ends the roll-over on the ordinary layouts either side of it', () => {
        const before = getLayout(ROLLOVER.start - 1e-6, width, height);
        const start = getLayout(ROLLOVER.start + 1e-6, width, height);
        expect(before.charts).toHaveLength(1);
        expect(start.charts).toHaveLength(2);
        expect(getDifferences(before, start, 1e-3, 1e-4)).toEqual([]);
        const end = getLayout(ROLLOVER.end - 1e-6, width, height);
        const after = getLayout(ROLLOVER.end + 1e-6, width, height);
        expect(end.charts).toHaveLength(2);
        expect(after.charts).toHaveLength(1);
        expect(getDifferences(end, after, 1e-3, 1e-4)).toEqual([]);
      });
    });
  }

  it('lays out seam -0.001 and +0.001 within 1 px on the film’s frame', () => {
    // The roll-over moves about 0.9 px in these 2 ms on its own, which takes what is fading at
    // the axis's end up to 0.04 further.
    const before = getLayout(-0.001, 1080, 1920);
    const after = getLayout(0.001, 1080, 1920);
    expect(getDifferences(before, after, 1, 0.05)).toEqual([]);
  });

  it('lays out the file’s first frame and the frame before it, its last, alike', () => {
    for (const {width, height} of FRAMES) {
      const first = getLayout(FILE_START_FRAME / FPS, width, height);
      const last = getLayout((FILE_START_FRAME - 1) / FPS, width, height);
      expect(last).toEqual(first);
      expect(first.caption).toEqual({text: 'Thirty years', alpha: 1});
      expect(first.readout).toEqual([
        {text: 'Year 30', y: first.metrics.readoutY, alpha: 1, scale: 1}
      ]);
      expect(first.yield).toEqual({thisYear: '7.0', total: '96.7', alpha: 1});
      expect(first.bars).toHaveLength(YIELD_TABLE.length);
      expect(first.flags).toHaveLength(FLAG_TABLE.length);
    }
  });

  it('rolls the Year 30 chart over into the Day 0 axis', () => {
    const at = (seam: number) => getLayout(seam, 1080, 1920);
    // The yields go first.
    expect(at(-1).yield?.alpha).toBeCloseTo(1, 6);
    expect(at(-0.5).yield).toBeNull();
    // The readout's drum turns over the middle, a twelfth of a turn each way at -0.1, the one line
    // above the other, with the season staying put. Its window, a line tall, shows only the foot of
    // the one going and the head of the one coming, as an odometer does.
    expect(at(-0.41).readout.map(line => line.text)).toEqual(['Year 30']);
    const middle = at(-0.1);
    expect(middle.readout.map(line => line.text)).toEqual(['Year 30', 'Day 0']);
    for (const line of middle.readout) expect(line.scale).toBeCloseTo(Math.cos(Math.PI / 6), 6);
    const [rolling, coming] = middle.readout.map(line => getReadoutBox(line, middle));
    expect(rolling.bottom).toBeLessThan(coming.top);
    const window = middle.readoutWindow;
    expect(window).not.toBeNull();
    expect(rolling.baseline).toBeGreaterThan(window?.top as number);
    expect(rolling.top).toBeLessThan(window?.top as number);
    expect(coming.top).toBeLessThan(window?.bottom as number);
    expect(coming.baseline).toBeGreaterThan(window?.bottom as number);
    expect(window?.feather).toBeCloseTo(middle.metrics.readoutFeather, 9);
    expect(at(0.21).readout.map(line => line.text)).toEqual(['Day 0']);
    expect(at(0.21).readoutWindow).toBeNull();
    forEachRolloverStep(seam => expect(at(seam).subReadout).toBe('SPRING'));
    // The Year 30 chart is the whole of it, frozen, until it has slid away.
    const frozen = at(ROLLOVER.start + 0.01);
    expect(frozen.bars).toHaveLength(YIELD_TABLE.length);
    expect(frozen.bars.filter(bar => bar.lostHeight > 0)).toHaveLength(1);
    expect(frozen.flags).toHaveLength(FLAG_TABLE.length);
    // By the end only the Day 0 axis is left, with nothing of the Year 30 chart.
    const gone = at(0.3);
    expect(gone.flags).toEqual([]);
    expect(gone.tickLabels.map(label => label.text)).toEqual(['Day 0', 'Day 1']);
    // Nothing fades the overlay as a whole, at any frame.
    forEachFrame(t => expect(getLayout(t, 1080, 1920).alpha).toBe(1));
  });

  it('shows the same roll-over from either side of the swap', () => {
    for (let seam = LOOP.cover[0]; seam <= LOOP.cover[1]; seam += SUB_FRAME) {
      const end = getLayout(seam, 1080, 1920, measure, 'end');
      const start = getLayout(seam, 1080, 1920, measure, 'start');
      expect(start, `seam=${seam}`).toEqual(end);
    }
  });

  it('keeps captions out of the dive and the roll-over', () => {
    forEachRolloverStep(seam => {
      if (isInSeamWindow(seam, LOOP.noCaption))
        expect(getLayout(seam, 1080, 1920).caption).toBeNull();
    });
    for (let t = LOOP.noCaption[0]; t <= LOOP.noCaption[1]; t += SUB_FRAME) {
      expect(getCaption(t), `t=${t}`).toBeNull();
    }
    expect(getCaption(LOOP.fileStart)).toEqual({text: 'Thirty years', alpha: 1});
  });

  it('keeps captions clear of the flags', () => {
    const portrait = getOverlayMetrics(1080, 1920);
    const topRow = portrait.flagBaseline - portrait.flagMostRow * portrait.flagRow;
    expect(portrait.captionY).toBeLessThan(topRow - portrait.fonts.flag.size);
    // About what the longest caption measures in its face.
    const landscape = getOverlayMetrics(1920, 1080);
    const longest = Math.max(...CAPTION_TABLE.map(({text}) => text.length));
    const width = longest * landscape.fonts.caption.size * 0.42;
    expect(landscape.captionX + width).toBeLessThan(landscape.axisLeft);
  });

  it('shades a caption with a patch behind its words only, leaving the sky around its light', () => {
    const metrics = getOverlayMetrics(1080, 1920);
    const {captionX, captionY, captionScrimY: y, captionScrimReach: reach, fonts} = metrics;
    const {size} = fonts.caption;
    expect(metrics.captionScrimStrength).toBeGreaterThan(0);
    // Its line runs through the middle of the words, and the tops of their ascenders and the feet
    // of their descenders are a quarter of its reach from it at most, where it is still as good as
    // full.
    const ascenders = captionY - size * READOUT_ASCENT;
    const descenders = captionY + size * READOUT_DESCENT;
    expect(Math.abs(y - (ascenders + descenders) / 2)).toBeLessThan(size * 0.1);
    expect(Math.max(y - ascenders, descenders - y)).toBeLessThan(reach / 4);
    // It is gone well short of the top of the frame, and by its own bottom.
    expect(y - reach).toBeGreaterThan(metrics.height * 0.05);
    expect(y + reach).toBeLessThanOrEqual(metrics.captionScrimBottom + 0.5);
    // It runs from the first letter to the last, and past the longest caption it is gone well short
    // of the right of the frame.
    for (const {text} of CAPTION_TABLE) {
      const right = captionX + measure(text, fonts.caption) + reach;
      expect(right, text).toBeLessThan(metrics.width * 0.75);
    }
    // Lying down, the caption sits in the overlay's scrim and has none of its own.
    expect(getOverlayMetrics(1920, 1080).captionScrimStrength).toBe(0);
  });

  it(
    'keeps a portrait frame clear of what TikTok, Reels and Shorts draw over it',
    () => {
      const width = 1080;
      const height = 1920;
      // The widest margins that guides to the three apps give, as edges of a 1080x1920 frame.
      const clear = {top: 260, right: width - 164, bottom: height - 370, left: 60};
      const metrics = getOverlayMetrics(width, height);
      const {fonts} = metrics;
      expect(metrics.axisLeft).toBeGreaterThanOrEqual(clear.left);
      expect(metrics.axisRight).toBeLessThanOrEqual(clear.right);
      expect(metrics.tickLabelRight).toBeLessThanOrEqual(clear.right);
      expect(metrics.yieldRight).toBeLessThanOrEqual(clear.right);
      expect(metrics.subReadoutY).toBeLessThanOrEqual(clear.bottom);
      expect(metrics.yieldLabelY).toBeLessThanOrEqual(clear.bottom);
      expect(metrics.readoutWindowBottom).toBeLessThanOrEqual(clear.bottom);
      expect(metrics.captionY - fonts.caption.size * 0.8).toBeGreaterThanOrEqual(clear.top);
      // What leaves in the roll-over fades before the frame's edge, and what comes, before the
      // apps' buttons: nothing passes the right end of the axis, and only what starts at the left
      // end passes it, fading, by no more than `edgeFade`.
      expect(metrics.axisLeft - metrics.edgeFade).toBeGreaterThan(0);
      const {axisLeft, axisRight, tickLabelLeft, tickLabelRight, edgeFade} = metrics;
      const visit = (t: number) => {
        const layout = getLayout(t, width, height);
        const marks = [
          ...layout.ticks.map(({x}) => [x, x]),
          ...layout.bars.map(({x}) => [x, x]),
          ...layout.ribbon.map(({left, right}) => [left, right]),
          ...layout.flags.map(({x, textX, textWidth}) => [
            Math.min(x, textX),
            Math.max(x, textX + textWidth)
          ])
        ];
        for (const [left, right] of marks) {
          expect(left, `t=${t}`).toBeGreaterThanOrEqual(axisLeft - edgeFade - 1e-6);
          expect(right, `t=${t}`).toBeLessThanOrEqual(axisRight + 1e-6);
        }
        for (const label of layout.tickLabels) {
          const half = measure(label.text, fonts.tick) / 2;
          expect(label.x - half, `${label.text} at t=${t}`).toBeGreaterThanOrEqual(
            tickLabelLeft - edgeFade - 1e-6
          );
          expect(label.x + half, `${label.text} at t=${t}`).toBeLessThanOrEqual(
            tickLabelRight + 1e-6
          );
        }
        for (const box of getFlagBoxes(layout)) {
          expect(box.top, `${box.id} at t=${t}`).toBeGreaterThanOrEqual(clear.top);
          expect(box.right, `${box.id} at t=${t}`).toBeLessThanOrEqual(clear.right);
        }
        if (layout.caption) {
          const right = metrics.captionX + measure(layout.caption.text, fonts.caption);
          expect(right, `${layout.caption.text} at t=${t}`).toBeLessThanOrEqual(clear.right);
        }
        // The readout and the yield beside it, on one line.
        if (layout.yield) {
          const thisYearLeft =
            metrics.yieldRight - metrics.yieldColumn - measure(layout.yield.thisYear, fonts.number);
          for (const line of layout.readout) {
            const readoutRight = metrics.readoutX + measure(line.text, fonts.readout);
            expect(readoutRight, `${line.text} at t=${t}`).toBeLessThan(thisYearLeft);
          }
        }
      };
      forEachFrame(visit);
      forEachRolloverStep(visit);
      // The caption's scrim fades out above the overlay's.
      expect(metrics.captionScrimBottom).toBeLessThan(metrics.scrimTop);
    },
    WHOLE_FILM_TIMEOUT
  );

  it('draws the storm bar broken and the others whole', () => {
    const {bars} = getLayout(LOOP.fileStart, 1920, 1080);
    const broken = bars.filter(bar => bar.lostHeight > 0);
    expect(broken).toHaveLength(1);
    const index = bars.indexOf(broken[0]);
    expect(broken[0].height).toBeLessThan(bars[index - 1].height);
    expect(broken[0].height + broken[0].lostHeight).toBeCloseTo(bars[index - 1].height);
    expect(bars[index + 1].height).toBeLessThan(broken[0].height);
    expect(bars[bars.length - 1].height).toBeGreaterThan(bars[index - 1].height);
  });

  it('shows no yield before the first harvest, and adds up after it', () => {
    expect(getLayout(17, 1920, 1080).yield).toBeNull();
    const {yield: end} = getLayout(LOOP.fileStart, 1920, 1080);
    expect(end?.thisYear).toBe('7.0');
    expect(end?.total).toBe('96.7');
  });

  it('has no overlap even if text comes out far wider than expected', () => {
    const wide: MeasureText = (text, font) => measure(text, font) * 1.4;
    const visit = (t: number) => {
      const layout = getLayout(t, 1080, 1920, wide);
      expect(findFlagOverlaps(layout), `t=${t}`).toEqual([]);
    };
    forEachFrame(visit);
    forEachRolloverStep(visit);
  });

  it('lays out a frame of either shape with room for everything', () => {
    for (const {width, height} of FRAMES) {
      const metrics = getOverlayMetrics(width, height);
      const {axisLeft, axisRight, axisY, tickLabelY, subReadoutY, scrimTop, fonts} = metrics;
      expect(axisRight - axisLeft).toBeGreaterThan(width * 0.5);
      expect(axisY).toBeLessThan(height);
      expect(tickLabelY).toBeLessThan(height);
      expect(subReadoutY).toBeLessThan(height);
      expect(scrimTop).toBeGreaterThan(0);
      // The drum's window, a line tall, sits between the tick labels, or lying down the caption,
      // and the season, and holds the line in place whole, from the tops of its ascenders, with
      // the fade over them, to the feet of its descenders.
      const {readoutY, readoutWindowTop: top, readoutWindowBottom: bottom} = metrics;
      const {size} = fonts.readout;
      if (metrics.isPortrait) {
        expect(top).toBeGreaterThan(tickLabelY + fonts.tick.size * 0.25);
      } else {
        expect(top).toBeGreaterThan(metrics.captionY + fonts.caption.size * 0.3);
      }
      expect(bottom).toBeLessThan(subReadoutY - fonts.subReadout.size * 0.74);
      expect(top + metrics.readoutFeather).toBeLessThanOrEqual(
        readoutY - size * READOUT_ASCENT + 1e-9
      );
      expect(bottom).toBeGreaterThan(readoutY + size * READOUT_DESCENT);
      expect(bottom - top).toBeLessThan(1.25 * size);
      // Its edges fade softly, and over half of it, the middle, is clear.
      expect(metrics.readoutFeather).toBeGreaterThan(0.1 * size);
      expect(bottom - top - 2 * metrics.readoutFeather).toBeGreaterThan((bottom - top) / 2);
    }
    // On the film's frame no edge is ever harder than 6 pixels.
    expect(getOverlayMetrics(1080, 1920).readoutFeather).toBeGreaterThanOrEqual(6);
  });

  it('turns the readout over on its drum in a window a line tall, cutting no letter hard', () => {
    for (const {width, height} of FRAMES) {
      const metrics = getOverlayMetrics(width, height);
      const {size} = metrics.fonts.readout;
      const lastY = new Map<string, number>();
      let turning = 0;
      forEachRolloverStep(seam => {
        const layout = getLayout(seam, width, height);
        const {readoutWindow: window} = layout;
        const boxes = layout.readout.map(line => getReadoutBox(line, layout));
        if (window) {
          turning++;
          expect(window.bottom - window.top).toBeLessThan(1.25 * size);
          for (const box of boxes) {
            // A line in the layout shows in the window, and one cut by an edge of the window is
            // cut only where that edge fades it in full.
            expect(box.top, `seam=${seam}`).toBeLessThan(window.bottom);
            expect(box.bottom, `seam=${seam}`).toBeGreaterThan(window.top);
            if (box.top < window.top || box.bottom > window.bottom) {
              expect(window.feather, `seam=${seam}`).toBeCloseTo(metrics.readoutFeather, 9);
            }
          }
        } else {
          expect(layout.readout, `seam=${seam}`).toHaveLength(1);
          expect(layout.readout[0].y, `seam=${seam}`).toBe(metrics.readoutY);
          expect(layout.readout[0].scale, `seam=${seam}`).toBe(1);
        }
        // The two never touch, the one going above the one coming, and each only rolls up.
        if (boxes.length === 2) expect(boxes[0].bottom, `seam=${seam}`).toBeLessThan(boxes[1].top);
        for (const line of layout.readout) {
          const before = lastY.get(line.text);
          if (before !== undefined) {
            expect(line.y, `${line.text} at seam=${seam}`).toBeLessThanOrEqual(before + 1e-9);
          }
          lastY.set(line.text, line.y);
        }
      });
      expect(turning).toBeGreaterThan(100);
    }
  });

  it('darkens a band behind the axis and readout, and leaves the ground below its light', () => {
    const metrics = getOverlayMetrics(1080, 1920);
    const {axisY, barHeight, readoutY, subReadoutY, tickLabelY, fonts, height} = metrics;
    const {flagBaseline, flagRow} = metrics;
    const alphaAt = (y: number) => getScrimAlpha(y, metrics);
    // Nothing over the picture above the flags' first rows, and next to nothing over their fourth.
    expect(alphaAt(flagBaseline - 4 * flagRow)).toBe(0);
    expect(alphaAt(flagBaseline - 3 * flagRow)).toBeLessThan(0.05);
    // Behind the tallest bars, then every line of type in the band: the tick labels, the readout
    // with its descenders, the season and the yields, and fully from the axis to the descenders.
    for (let y = axisY - barHeight; y <= subReadoutY; y++) {
      expect(alphaAt(y), `y=${y}`).toBeGreaterThanOrEqual(0.3);
      if (y >= tickLabelY - fonts.tick.size) {
        expect(alphaAt(y), `y=${y}`).toBeGreaterThanOrEqual(0.38);
      }
    }
    for (let y = axisY; y <= readoutY + fonts.readout.size * READOUT_DESCENT; y++) {
      expect(alphaAt(y), `y=${y}`).toBeGreaterThanOrEqual(0.4);
    }
    // Never dark, light over the ground at the bottom of the frame, and a quarter or less over the
    // bottom 45% of it on average.
    let sum = 0;
    let count = 0;
    for (let y = 0; y < height; y++) {
      expect(alphaAt(y), `y=${y}`).toBeLessThanOrEqual(0.45);
      if (y >= 0.885 * height) expect(alphaAt(y), `y=${y}`).toBeLessThanOrEqual(0.15);
      if (y >= 0.55 * height) {
        sum += alphaAt(y);
        count++;
      }
    }
    expect(sum / count).toBeLessThanOrEqual(0.25);
  });

  it('lands the broken bar as the flood peaks, still rising at the peak', () => {
    const at = (t: number) => getTimeline(t, getYear(t));
    const getBroken = (t: number) => at(t).bars.find(bar => bar.broken);
    expect(getBroken(45.9)).toBeUndefined();
    const rising = getBroken(46.4)?.rise as number;
    expect(rising).toBeGreaterThan(0.25);
    expect(rising).toBeLessThan(0.75);
    expect(getBroken(46.75)?.rise).toBe(1);
    // THIS YEAR counts from the year before's harvest down to what was saved of the storm's, and
    // never reads nothing.
    const before = YIELD_TABLE.find(row => row.year === 19)?.boxes as number;
    const saved = YIELD_TABLE.find(row => row.broken)?.boxes as number;
    expect(getThisYear(46)).toBe(before);
    expect(getThisYear(46.4)).toBeGreaterThan(saved + 0.5);
    expect(getThisYear(46.4)).toBeLessThan(before - 0.5);
    expect(getThisYear(46.75)).toBe(saved);
  });

  it('counts THIS YEAR steadily on as bars land, never back from 0 in the fast years', () => {
    const first = YIELD_TABLE[0].boxes;
    const storm = 46;
    let previous: number | undefined;
    for (let frame = 0; frame <= LOOP.fileStart * FPS; frame++) {
      const t = frame / FPS;
      const thisYear = getThisYear(t);
      if (thisYear !== undefined && previous !== undefined) {
        // Up a frame at a time through the good years before the storm and after the replanting,
        // and never more than a step of a few tenths of a box.
        if (t < storm || t > 53) expect(thisYear, `t=${t}`).toBeGreaterThanOrEqual(previous);
        expect(Math.abs(thisYear - previous), `t=${t}`).toBeLessThan(0.5);
      }
      if (thisYear !== undefined && t > 19.5) expect(thisYear, `t=${t}`).toBeGreaterThan(first);
      previous = thisYear;
    }
  });
});

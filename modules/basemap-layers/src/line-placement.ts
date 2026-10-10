/**
 * Label anchors along lines, for `symbol-placement: line` and `line-center`. The placement follows
 * MapLibre GL JS (`getAnchors`, `getCenterAnchor` and `checkMaxAngle` in its symbol code): labels
 * repeat every `symbol-spacing` pixels where the line is long enough for them, and a placement is
 * skipped where the line bends more than `text-max-angle` within the label.
 *
 * Lines are given in pixels, with y pointing down. An anchor is returned as the segment it lies
 * on and its position along that segment, so the caller can interpolate the anchor in its own
 * coordinates.
 */

/** An anchor on a line: `t` along the segment from `line[segment]` to `line[segment + 1]`. */
export type LineAnchor = {
  segment: number;
  t: number;
  /** The direction of the segment, in degrees counter-clockwise from the +x axis on screen. */
  angle: number;
};

export type LineAnchorOptions = {
  /** `line` repeats labels along the line; `line-center` places one at its middle. */
  placement: 'line' | 'line-center';
  /** `symbol-spacing`: pixels between two labels of a line. */
  spacing: number;
  /** `text-max-angle`: the largest bend, in degrees, within any window of the label. */
  maxAngle: number;
  /** The label's length along the line, in pixels. */
  labelLength: number;
  /** `text-size` in pixels; the bend window is 3/5 of it, as in MapLibre. */
  textSize: number;
  /**
   * Whether the line continues in a neighbouring tile. MapLibre then starts the first label half
   * a spacing in, so labels line up across tile edges, and does not fall back to the middle.
   */
  isContinued: boolean;
  /**
   * Work the placement may spend, in steps along the line and vertices checked for bends. It is
   * drawn down as the placement runs; once it is spent, no further anchors are placed. Tile
   * geometry is untrusted, so callers share one budget across a tile.
   */
  budget?: LineAnchorBudget;
};

/** Remaining placement work; see `LineAnchorOptions.budget`. */
export type LineAnchorBudget = {steps: number};

/** Work one feature's line labels may spend, unless the tile's budget has less left. */
export const DEFAULT_LINE_ANCHOR_STEPS = 1e5;

/**
 * The least distance, in pixels, between two labels of a line beyond the label's own length. It
 * only matters for a `symbol-spacing` far below any label's length: with a spacing of 1, a short
 * or empty label would otherwise be placed at every pixel of the line.
 */
export const MIN_LABEL_GAP = 16;

/**
 * MapLibre's first label on a line that starts in this tile is placed `2 * glyphSize` pixels past
 * the label's half length, where the glyph size is the 24 px of its SDF glyphs, scaled to the text
 * size.
 */
const FIXED_EXTRA_OFFSET_EMS = 2;

function distance(a: number[], b: number[]): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/** Direction from `a` to `b`, in radians counter-clockwise on screen (y down). */
function direction(a: number[], b: number[]): number {
  return Math.atan2(a[1] - b[1], b[0] - a[0]);
}

function getLineLength(line: number[][]): number {
  let length = 0;
  for (let i = 0; i < line.length - 1; i++) {
    length += distance(line[i], line[i + 1]);
  }
  return length;
}

/**
 * Whether the line bends no more than `maxAngle` (radians) within any `windowSize` pixels of the
 * `labelLength` centred on the anchor. The label must also fit on the line around the anchor.
 */
function checkMaxAngle(
  line: number[][],
  anchor: {point: number[]; segment: number},
  labelLength: number,
  windowSize: number,
  maxAngle: number,
  budget: LineAnchorBudget
): boolean {
  let point = anchor.point;
  let index = anchor.segment + 1;
  let anchorDistance = 0;

  // Move back along the line to the first vertex under the label.
  while (anchorDistance > -labelLength / 2) {
    index--;
    if (index < 0 || --budget.steps < 0) {
      return false;
    }
    anchorDistance -= distance(line[index], point);
    point = line[index];
  }
  if (!line[index + 1]) {
    return false;
  }
  anchorDistance += distance(line[index], line[index + 1]);
  index++;

  // Move forward along the label, summing the bends within the window.
  const recentCorners: {distance: number; angleDelta: number}[] = [];
  let recentAngleDelta = 0;
  while (anchorDistance < labelLength / 2) {
    const previous = line[index - 1];
    const current = line[index];
    const next = line[index + 1];
    if (!next || --budget.steps < 0) {
      return false;
    }
    let angleDelta = direction(previous, current) - direction(current, next);
    angleDelta = Math.abs(((angleDelta + 3 * Math.PI) % (Math.PI * 2)) - Math.PI);
    recentCorners.push({distance: anchorDistance, angleDelta});
    recentAngleDelta += angleDelta;
    while (anchorDistance - recentCorners[0].distance > windowSize) {
      recentAngleDelta -= recentCorners.shift()!.angleDelta;
    }
    if (recentAngleDelta > maxAngle) {
      return false;
    }
    index++;
    anchorDistance += distance(current, next);
  }
  return true;
}

function interpolate(a: number[], b: number[], t: number): number[] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Anchors every `spacing` pixels from `offset`, where the label fits and the line is straight. */
function resample(
  line: number[][],
  offset: number,
  spacing: number,
  options: LineAnchorOptions,
  placeAtMiddle: boolean,
  budget: LineAnchorBudget
): LineAnchor[] {
  const {labelLength, isContinued} = options;
  const windowSize = (options.textSize * 3) / 5;
  const maxAngle = (options.maxAngle * Math.PI) / 180;
  const lineLength = getLineLength(line);
  const anchors: LineAnchor[] = [];
  let travelled = 0;
  let markedDistance = offset - spacing;

  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const segmentLength = distance(a, b);
    if (--budget.steps < 0) {
      return anchors;
    }
    while (segmentLength > 0 && markedDistance + spacing < travelled + segmentLength) {
      if (--budget.steps < 0) {
        return anchors;
      }
      markedDistance += spacing;
      const t = (markedDistance - travelled) / segmentLength;
      const fits =
        markedDistance - labelLength / 2 >= 0 && markedDistance + labelLength / 2 <= lineLength;
      if (
        fits &&
        checkMaxAngle(
          line,
          {point: interpolate(a, b, t), segment: i},
          labelLength,
          windowSize,
          maxAngle,
          budget
        )
      ) {
        anchors.push({segment: i, t, angle: (direction(a, b) * 180) / Math.PI});
      }
    }
    travelled += segmentLength;
  }

  // No label fits at the regular positions: try one at the middle of a line that starts and ends
  // in this tile.
  if (!placeAtMiddle && anchors.length === 0 && !isContinued) {
    return resample(line, travelled / 2, spacing, options, true, budget);
  }
  return anchors;
}

/**
 * Label anchors along a line in pixels. `line` repeats labels every `spacing` pixels, starting
 * where MapLibre starts them; `line-center` places one at the middle of the line by length. Either
 * skips a placement where the label does not fit on the line or where the line bends more than
 * `maxAngle` within the label.
 */
export function getLineAnchors(line: number[][], options: LineAnchorOptions): LineAnchor[] {
  const {labelLength, textSize} = options;
  if (
    !Array.isArray(line) ||
    line.length < 2 ||
    !line.every(isFinitePoint) ||
    ![options.spacing, options.maxAngle, labelLength, textSize].every(Number.isFinite) ||
    !(labelLength > 0)
  ) {
    return [];
  }
  const budget = options.budget || {steps: DEFAULT_LINE_ANCHOR_STEPS};

  if (options.placement === 'line-center') {
    const center = getLineLength(line) / 2;
    let travelled = 0;
    for (let i = 0; i < line.length - 1; i++) {
      const segmentLength = distance(line[i], line[i + 1]);
      if (--budget.steps < 0) {
        return [];
      }
      if (travelled + segmentLength > center) {
        const t = (center - travelled) / segmentLength;
        const anchor = {point: interpolate(line[i], line[i + 1], t), segment: i};
        const maxAngle = (options.maxAngle * Math.PI) / 180;
        return checkMaxAngle(line, anchor, labelLength, (textSize * 3) / 5, maxAngle, budget)
          ? [{segment: i, t, angle: (direction(line[i], line[i + 1]) * 180) / Math.PI}]
          : [];
      }
      travelled += segmentLength;
    }
    return [];
  }

  // A spacing shorter than the label is widened, as in MapLibre, and never leaves less than
  // `MIN_LABEL_GAP` between labels.
  let spacing = Math.max(1, options.spacing);
  if (spacing - labelLength < spacing / 4) {
    spacing = labelLength + spacing / 4;
  }
  spacing = Math.max(spacing, labelLength + MIN_LABEL_GAP);
  const offset = options.isContinued
    ? (spacing / 2) % spacing
    : (labelLength / 2 + FIXED_EXTRA_OFFSET_EMS * textSize) % spacing;
  return resample(line, offset, spacing, options, false, budget);
}

/**
 * The angle at which a label along a line is drawn: the line's direction, turned by 180 degrees
 * when `keepUpright` is set and the text would otherwise read upside down on a map rotated by
 * `bearing` degrees.
 */
export function getUprightAngle(angle: number, bearing: number, keepUpright: boolean): number {
  if (!keepUpright) {
    return angle;
  }
  const onScreen = ((((angle + bearing + 180) % 360) + 360) % 360) - 180;
  return onScreen > 90 || onScreen <= -90 ? angle + 180 : angle;
}

function isFinitePoint(point: number[]): boolean {
  return Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]);
}

/**
 * The parts of `line` inside `[minX, minY, maxX, maxY]`, clipped segment by segment
 * (Liang-Barsky). A line that leaves the box and comes back gives one part per stay inside.
 */
export function clipLine(line: number[][], [minX, minY, maxX, maxY]: number[]): number[][][] {
  const parts: number[][][] = [];
  let part: number[][] | null = null;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, ay] = line[i];
    const [bx, by] = line[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    let t0 = 0;
    let t1 = 1;
    const edges: [number, number][] = [
      [-dx, ax - minX],
      [dx, maxX - ax],
      [-dy, ay - minY],
      [dy, maxY - ay]
    ];
    let inside = true;
    for (const [p, q] of edges) {
      if (p === 0) {
        inside = inside && q >= 0;
      } else if (p < 0) {
        t0 = Math.max(t0, q / p);
      } else {
        t1 = Math.min(t1, q / p);
      }
    }
    if (!inside || t0 > t1) {
      part = null;
      continue;
    }
    const start = [ax + dx * t0, ay + dy * t0];
    const end = [ax + dx * t1, ay + dy * t1];
    if (!part || t0 > 0) {
      part = [start];
      parts.push(part);
    }
    part.push(end);
    if (t1 < 1) {
      part = null;
    }
  }
  return parts.filter(clipped => clipped.length > 1);
}

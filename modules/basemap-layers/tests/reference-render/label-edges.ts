// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * Measures how sharply labels are drawn, for label-only renders of a reference scene: a plain
 * background and horizontal point labels of one size, color and font, with or without a halo.
 * Scene SSIM hardly sees label edges (labels cover a few percent of a scene), so these measures
 * check them directly.
 */

/** A label-only style: what `getLabelStyle` draws. */
export type LabelStyleOptions = {
  /** `text-size`, in pixels. */
  size: number;
  /** Background color, CSS. Default white. */
  background?: string;
  /** Text color, CSS. Default black. */
  color?: string;
  /** `text-halo-*`, or none. */
  halo?: {color: string; width: number; blur?: number};
  /** Which labels are drawn: `symbol-placement`. Default `point`. */
  placement?: 'point' | 'line';
};

/**
 * A copy of `style` that draws only its point labels (or only its line labels, with
 * `placement: 'line'`), in Noto Sans Regular of one size and color, on a plain background. Icons,
 * rotation, letter spacing, line breaks and text transforms are left out, so that point labels are
 * horizontal runs of the same font.
 */
export function getLabelStyle(style: any, options: LabelStyleOptions): any {
  const {size, background = '#ffffff', color = '#000000', halo, placement = 'point'} = options;
  const labelStyle = structuredClone(style);
  labelStyle.layers = labelStyle.layers
    .filter(
      (layer: any) =>
        layer.type === 'background' ||
        (layer.type === 'symbol' &&
          layer.layout?.['text-field'] &&
          (layer.layout['symbol-placement'] || 'point') === placement)
    )
    .map((layer: any) => {
      if (layer.type === 'background') {
        return {id: layer.id, type: 'background', paint: {'background-color': background}};
      }
      const layout = {...layer.layout, 'text-size': size, 'text-font': ['Noto Sans Regular']};
      for (const key of [
        'icon-image',
        'text-rotate',
        'text-transform',
        'text-letter-spacing',
        'text-max-width'
      ]) {
        delete layout[key];
      }
      const paint: Record<string, unknown> = {'text-color': color};
      if (halo) {
        paint['text-halo-color'] = halo.color;
        paint['text-halo-width'] = halo.width;
        paint['text-halo-blur'] = halo.blur || 0;
      }
      return {...layer, layout, paint};
    });
  return labelStyle;
}

/** How sharply the labels of a label-only render are drawn. */
export type LabelEdgeMetrics = {
  /** Median width, in device pixels, over which ink rises from 10% to 90% across an edge. */
  edgeWidth: number;
  /**
   * The same, of the edges crossed along rows (screen x) alone, then along columns (screen y)
   * alone: they differ where the labels are foreshortened, along y on a pitched map.
   */
  rowEdgeWidth: number;
  columnEdgeWidth: number;
  /** Mean ink at the middle of a stroke: of the rows' local maxima above 30% ink. */
  stemPeak: number;
  /** Median width, in device pixels, of the runs of a row above 50% ink. */
  stemWidth: number;
  /** Mean ink of the pixels with more than 10% ink. */
  inkDensity: number;
  /**
   * Share of the pixels with more than 10% ink that have 90% or more: the wider an edge fades, the
   * fewer. It measures a blurred halo whose fade is too wide for most edges to reach 90% ink.
   */
  solidShare: number;
  /** Edges measured. */
  edges: number;
};

function luminance(pixels: ArrayLike<number>, index: number): number {
  return 0.2126 * pixels[index] + 0.7152 * pixels[index + 1] + 0.0722 * pixels[index + 2];
}

/**
 * The ink of each pixel: 0 at the luminance of `background`, 1 at the luminance of `ink`, clamped.
 * With a halo, pass the halo's color as `ink` to measure the halo.
 */
export function getInk(
  pixels: ArrayLike<number>,
  width: number,
  height: number,
  {background, ink}: {background: number; ink: number}
): Float32Array {
  const values = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const value = (luminance(pixels, i * 4) - background) / (ink - background);
    values[i] = Math.min(1, Math.max(0, value));
  }
  return values;
}

function median(values: number[]): number {
  if (values.length === 0) {
    return NaN;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * The 10-90% widths of the monotone rises and falls of one line of ink. With `bare`, only the edges
 * whose low end is a bare pixel count.
 */
function addEdgeWidths(line: Float32Array, widths: number[], bare?: Uint8Array): void {
  for (const sign of [1, -1]) {
    const at = (i: number) => (sign === 1 ? line[i] : 1 - line[i]);
    for (let i = 0; i < line.length - 1; i++) {
      if (!(at(i) < 0.1 && at(i + 1) >= 0.1)) {
        continue;
      }
      let j = i + 1;
      while (j < line.length && at(j) < 0.9 && at(j) >= at(j - 1)) {
        j++;
      }
      const low = sign === 1 ? i : j;
      if (j < line.length && at(j) >= 0.9 && (!bare || bare[low])) {
        const start = i + (0.1 - at(i)) / (at(i + 1) - at(i));
        const end = j - 1 + (0.9 - at(j - 1)) / (at(j) - at(j - 1));
        widths.push(end - start);
      }
    }
  }
}

/**
 * Which pixels show the background alone: their luminance within `tolerance` of `background`, and
 * no more than `tolerance` in any channel from its color. Measuring a halo, edges between the halo
 * and the text are left out with it.
 */
export function getBarePixels(
  pixels: ArrayLike<number>,
  width: number,
  height: number,
  background: [number, number, number],
  tolerance = 24
): Uint8Array {
  const bare = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    bare[i] = background.every(
      (value, channel) => Math.abs(pixels[i * 4 + channel] - value) <= tolerance
    )
      ? 1
      : 0;
  }
  return bare;
}

/**
 * Measures the edges, strokes and ink of an ink image (see `getInk`). With `bare` (see
 * `getBarePixels`), edge widths are measured only across edges that rise from the background.
 */
export function measureLabelEdges(
  ink: Float32Array,
  width: number,
  height: number,
  bare?: Uint8Array
): LabelEdgeMetrics {
  const rowWidths: number[] = [];
  const columnWidths: number[] = [];
  const peaks: number[] = [];
  const stems: number[] = [];
  let inkSum = 0;
  let inked = 0;
  let solid = 0;
  for (let y = 0; y < height; y++) {
    const row = ink.subarray(y * width, (y + 1) * width);
    addEdgeWidths(row, rowWidths, bare?.subarray(y * width, (y + 1) * width));
    for (let x = 1; x < width - 1; x++) {
      if (row[x] > 0.3 && row[x] >= row[x - 1] && row[x] > row[x + 1]) {
        peaks.push(row[x]);
      }
    }
    for (let x = 1; x < width; x++) {
      if (row[x] >= 0.5 && row[x - 1] < 0.5) {
        let end = x;
        while (end < width && row[end] >= 0.5) {
          end++;
        }
        if (end < width) {
          const start = x - 1 + (0.5 - row[x - 1]) / (row[x] - row[x - 1]);
          const stop = end - 1 + (row[end - 1] - 0.5) / (row[end - 1] - row[end]);
          stems.push(stop - start);
        }
        x = end;
      }
    }
  }
  const column = new Float32Array(height);
  const bareColumn = bare && new Uint8Array(height);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      column[y] = ink[y * width + x];
      if (bare && bareColumn) {
        bareColumn[y] = bare[y * width + x];
      }
    }
    addEdgeWidths(column, columnWidths, bareColumn);
  }
  for (const value of ink) {
    if (value > 0.1) {
      inkSum += value;
      inked++;
      solid += value >= 0.9 ? 1 : 0;
    }
  }
  const widths = [...rowWidths, ...columnWidths];
  return {
    edgeWidth: median(widths),
    rowEdgeWidth: median(rowWidths),
    columnEdgeWidth: median(columnWidths),
    stemPeak: peaks.length ? peaks.reduce((sum, value) => sum + value, 0) / peaks.length : NaN,
    stemWidth: median(stems),
    inkDensity: inked ? inkSum / inked : NaN,
    solidShare: inked ? solid / inked : NaN,
    edges: widths.length
  };
}

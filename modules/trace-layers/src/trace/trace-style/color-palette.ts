/** RGBA tuple used by rendering layers, with channels in 0-255 order. */
export type TraceColor = readonly [number, number, number, number];

/** Shared palette of canonical accent colors for visual grouping. */
export const COLORS = {
  BLUE: makeDeckColor('#4285f4'),
  RED: makeDeckColor('#db4437'),
  YELLOW: makeDeckColor('#ca8a04'),
  GREEN: makeDeckColor('#007843'),
  PURPLE: makeDeckColor('#ab47bc'),
  TEAL: makeDeckColor('#00acc1'),
  ORANGE: makeDeckColor('#ff7043'),
  OLIVE: makeDeckColor('#9e9d24'),
  INDIGO: makeDeckColor('#5c6bc0'),
  PINK: makeDeckColor('#f06292'),
  PLUM: makeDeckColor('#9d174d'),
  DEEP_PURPLE: makeDeckColor('#7e57c2'),
  CYAN: makeDeckColor('#26a69a'),
  /** @note maybe too close to RED which is used for critical paths etc */
  MAGENTA: makeDeckColor('#ec407a'),
  BROWN: makeDeckColor('#8d6e63'),
  SAGE: makeDeckColor('#789262'),
  AMBER: makeDeckColor('#ffca28'),
  VIOLET: makeDeckColor('#8e24aa'),
  MEDIUM_GREEN: makeDeckColor('#43a047'),
  /** @note Deep, saturated blue intended to be distinct from BLUE/INDIGO */
  COBALT: makeDeckColor('#005fcc'),
  NAVY: makeDeckColor('#1d4ed8')
} as const;

/**
 * Shared color-wheel list used by generated span color schemes.
 *
 * Red-adjacent entries stay available as named colors for explicit semantic styling, but the wheel
 * skips them so generated span colors do not compete with red dependency arrows.
 */
export const COLORS_LIST = [
  COLORS.BLUE,
  COLORS.YELLOW,
  COLORS.GREEN,
  COLORS.PURPLE,
  COLORS.TEAL,
  COLORS.ORANGE,
  COLORS.OLIVE,
  COLORS.INDIGO,
  COLORS.PINK,
  COLORS.PLUM,
  COLORS.DEEP_PURPLE,
  COLORS.CYAN,
  COLORS.BROWN,
  COLORS.SAGE,
  COLORS.AMBER,
  COLORS.VIOLET,
  COLORS.MEDIUM_GREEN,
  COLORS.COBALT,
  COLORS.NAVY
] as const;

const perfettoSliceColorWheel = createColorWheel();

/** Stable color allocator that assigns deterministic colors per key. */
export function createColorWheel() {
  const keyToColor = new Map<string, TraceColor>();
  let wheelOffset = 0;

  return {
    /** Returns a stable palette color for the input key. */
    getColorByKey: (key: string): Readonly<TraceColor> => {
      const existing = keyToColor.get(key);
      if (existing) {
        return existing;
      }

      const color = getColorFromPalette(wheelOffset);
      wheelOffset += 1;
      keyToColor.set(key, color);
      return color;
    }
  };
}

/**
 * Returns a shared palette-wheel color for a slice name using Perfetto-style name normalization.
 *
 * Numeric suffixes are stripped so related slice names stay grouped while the rendered colors come
 * from the default trace palette rather than Perfetto's more saturated HSL colorizer.
 */
export function getPerfettoSliceColor(sliceName: string): TraceColor {
  const normalizedName = normalizePerfettoSliceName(sliceName);
  return perfettoSliceColorWheel.getColorByKey(normalizedName);
}

/** Makes an RGBA color in 0-255 channel order from numeric or hex input. */
export function makeDeckColor(
  color: [number, number, number, number] | [number, number, number] | string
): TraceColor {
  if (typeof color === 'string') {
    return Array.from({length: 4}, (_, i) =>
      parseInt(color.slice(i * 2 + 1, i * 2 + 3) || 'ff', 16)
    ) as [number, number, number, number];
  }

  const color4 = color.length === 3 ? [...color, 1] : color;
  const deckColor = color4.map(component => Math.min(255, Math.max(0, component * 255)));
  return deckColor as [number, number, number, number];
}

/** Linearly interpolates between two RGBA colors based on a normalized amount in [0, 1]. */
export function interpolateColor(
  minColor: TraceColor,
  toColor: TraceColor,
  value: number
): TraceColor {
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const t = clamp(value);

  const r = Math.round(minColor[0] + (toColor[0] - minColor[0]) * t);
  const g = Math.round(minColor[1] + (toColor[1] - minColor[1]) * t);
  const b = Math.round(minColor[2] + (toColor[2] - minColor[2]) * t);
  const a = Math.round(minColor[3] + (toColor[3] - minColor[3]) * t);

  return [r, g, b, a];
}

function getColorFromPalette(index: number) {
  const color = COLORS_LIST[index % COLORS_LIST.length];
  return color;
}

function normalizePerfettoSliceName(sliceName: string): string {
  return sliceName.replace(/( )?\d+/g, '') || '__unknown_slice__';
}

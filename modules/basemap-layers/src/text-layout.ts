// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

// Line breaking follows MapLibre GL JS's src/symbol/shaping.ts (BSD-3-Clause).
const WHITESPACE = new Set([0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20]);
const BREAKABLE = new Set([
  0x0a, 0x20, 0x26, 0x29, 0x2b, 0x2d, 0x2f, 0xad, 0xb7, 0x200b, 0x2010, 0x2013, 0x2027
]);
const BREAKABLE_BEFORE = new Set([0x28]);

/** Builds MapLibre's script regexp, skipping scripts unsupported by the runtime. */
function createIdeographicBreakingRegExp(): RegExp {
  const escapes = ['Bopo', 'Hani', 'Hira', 'Kana', 'Kits', 'Nshu', 'Tang', 'Yiii']
    .map(code => {
      try {
        return new RegExp(`\\p{sc=${code}}`, 'u').source;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  return new RegExp(escapes.join('|'), 'u');
}

const IDEOGRAPHIC_BREAKING_REGEXP = createIdeographicBreakingRegExp();

/** Tests the blocks and scripts where MapLibre permits ideographic line breaks. */
function charAllowsIdeographicBreaking(codePoint: number): boolean {
  if (codePoint < 0x2e80) return false;
  if (
    (codePoint >= 0xfe30 && codePoint <= 0xfe4f) ||
    (codePoint >= 0x3300 && codePoint <= 0x33ff) ||
    (codePoint >= 0x31c0 && codePoint <= 0x31ef) ||
    (codePoint >= 0x3000 && codePoint <= 0x303f) ||
    (codePoint >= 0x3200 && codePoint <= 0x32ff) ||
    (codePoint >= 0xff00 && codePoint <= 0xffef) ||
    (codePoint >= 0x2ff0 && codePoint <= 0x2fff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe1f)
  )
    return true;
  return IDEOGRAPHIC_BREAKING_REGEXP.test(String.fromCodePoint(codePoint));
}

/** `text-transform`, as MapLibre applies it: locale-aware upper or lower case. */
export function transformText(text: string, transform: unknown): string {
  if (transform === 'uppercase') return text.toLocaleUpperCase();
  if (transform === 'lowercase') return text.toLocaleLowerCase();
  return text;
}

/** Calculates the target width, including whitespace advances as MapLibre does. */
function determineAverageLineWidth(
  characters: string[],
  maxWidth: number,
  measure: (character: string) => number
): number {
  let totalWidth = 0;
  for (const character of characters) totalWidth += measure(character);
  const lineCount = Math.max(1, Math.ceil(totalWidth / maxWidth));
  return totalWidth / lineCount;
}

/** Scores raggedness, favoring a shorter final line and applying signed penalties. */
function calculateBadness(
  lineWidth: number,
  targetWidth: number,
  penalty: number,
  isLastBreak: boolean
): number {
  const raggedness = Math.pow(lineWidth - targetWidth, 2);
  if (isLastBreak) return lineWidth < targetWidth ? raggedness / 2 : raggedness * 2;
  return raggedness + Math.abs(penalty) * penalty;
}

/** Applies MapLibre's newline, suggested-break and parenthesis penalties. */
function calculatePenalty(
  codePoint: number,
  nextCodePoint: number,
  penalizableIdeographicBreak: boolean
): number {
  let penalty = 0;
  if (codePoint === 0x0a) penalty -= 10000;
  if (penalizableIdeographicBreak) penalty += 150;
  if (codePoint === 0x28 || codePoint === 0xff08) penalty += 50;
  if (nextCodePoint === 0x29 || nextCodePoint === 0xff09) penalty += 50;
  return penalty;
}

type LineBreak = {
  index: number;
  x: number;
  priorBreak: LineBreak | null;
  badness: number;
};

/** Finds the least costly prior break, allowing lines wider than the requested width. */
function evaluateBreak(
  index: number,
  x: number,
  targetWidth: number,
  potentialBreaks: LineBreak[],
  penalty: number,
  isLastBreak: boolean
): LineBreak {
  let priorBreak: LineBreak | null = null;
  let badness = calculateBadness(x, targetWidth, penalty, isLastBreak);
  for (const potentialBreak of potentialBreaks) {
    const candidateBadness =
      calculateBadness(x - potentialBreak.x, targetWidth, penalty, isLastBreak) +
      potentialBreak.badness;
    if (candidateBadness <= badness) {
      priorBreak = potentialBreak;
      badness = candidateBadness;
    }
  }
  return {index, x, priorBreak, badness};
}

/** Recovers break indices iteratively so long labels do not exhaust the call stack. */
function leastBadBreaks(lastLineBreak: LineBreak | null): number[] {
  const breaks: number[] = [];
  for (let current = lastLineBreak; current; current = current.priorBreak) {
    breaks.push(current.index);
  }
  return breaks.reverse();
}

/** Determines balanced line breaks using MapLibre's dynamic programming algorithm. */
function determineLineBreaks(
  characters: string[],
  maxWidth: number,
  measure: (character: string) => number
): number[] {
  const potentialLineBreaks: LineBreak[] = [];
  const targetWidth = determineAverageLineWidth(characters, maxWidth, measure);
  const hasServerSuggestedBreakpoints = characters.includes('\u200b');
  let currentX = 0;
  for (let i = 0; i < characters.length; i++) {
    const codePoint = characters[i].codePointAt(0)!;
    if (!WHITESPACE.has(codePoint)) currentX += measure(characters[i]);
    if (i < characters.length - 1) {
      const nextCodePoint = characters[i + 1].codePointAt(0)!;
      const ideographicBreak = charAllowsIdeographicBreaking(codePoint);
      if (
        BREAKABLE.has(codePoint) ||
        ideographicBreak ||
        (i !== characters.length - 2 && BREAKABLE_BEFORE.has(nextCodePoint))
      ) {
        potentialLineBreaks.push(
          evaluateBreak(
            i + 1,
            currentX,
            targetWidth,
            potentialLineBreaks,
            calculatePenalty(
              codePoint,
              nextCodePoint,
              ideographicBreak && hasServerSuggestedBreakpoints
            ),
            false
          )
        );
      }
    }
  }
  return leastBadBreaks(
    evaluateBreak(characters.length, currentX, targetWidth, potentialLineBreaks, 0, true)
  );
}

/**
 * Breaks `text` into lines no wider than `maxWidth` ems where it can, with MapLibre's balanced
 * line breaking, and returns the lines joined by '\n'. Advances from `measure` are in ems;
 * words without break opportunities stay intact, even when they exceed the requested width.
 */
export function wrapText(
  text: string,
  maxWidth: number,
  measure: (character: string) => number
): string {
  const characters = Array.from(text);
  if (
    !characters.some(character => {
      const codePoint = character.codePointAt(0)!;
      return (
        BREAKABLE.has(codePoint) ||
        BREAKABLE_BEFORE.has(codePoint) ||
        charAllowsIdeographicBreaking(codePoint)
      );
    })
  )
    return text;

  const lines: string[] = [];
  let start = 0;
  for (const end of determineLineBreaks(characters, maxWidth, measure)) {
    let first = start;
    let last = end;
    while (first < last && WHITESPACE.has(characters[first].codePointAt(0)!)) first++;
    while (last > first && WHITESPACE.has(characters[last - 1].codePointAt(0)!)) last--;
    lines.push(characters.slice(first, last).join(''));
    start = end;
  }
  return lines.join('\n');
}

/** Advance in ems used when canvas measurement is unavailable, as for missing atlas glyphs. */
export const FALLBACK_CHARACTER_WIDTH = 0.5;
const FONT_SIZE = 64;
const CHARACTER_WIDTH_MEASURERS = new Map<string, (character: string) => number>();

/**
 * Returns a function giving a character's advance width in ems for a CSS font, measured the way
 * deck.gl's TextLayer builds its font atlas: at 64px, then divided by 64. Measurers and character
 * advances are cached; environments without a canvas 2D context use a half-em advance.
 */
export function getCharacterWidthMeasurer(
  fontWeight: number | string,
  fontFamily: string
): (character: string) => number {
  const font = `${fontWeight} ${FONT_SIZE}px ${fontFamily}`;
  const cached = CHARACTER_WIDTH_MEASURERS.get(font);
  if (cached) return cached;
  const context =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(1, 1).getContext('2d')
      : typeof document !== 'undefined'
        ? document.createElement('canvas').getContext('2d')
        : null;
  if (context) context.font = font;
  const widths = new Map<string, number>();
  /** Measures each code point once for this font. */
  const measure = (character: string): number => {
    let width = widths.get(character);
    if (width === undefined) {
      width = context ? context.measureText(character).width / FONT_SIZE : FALLBACK_CHARACTER_WIDTH;
      widths.set(character, width);
    }
    return width;
  };
  CHARACTER_WIDTH_MEASURERS.set(font, measure);
  return measure;
}

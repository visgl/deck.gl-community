// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

// Line breaking follows MapLibre GL JS's src/symbol/shaping.ts (BSD-3-Clause).
import {applyArabicShaping} from './arabic-shaping';
import {containsRightToLeftText, processBidirectionalText} from './bidi';

const WHITESPACE = new Set([0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20]);
const BREAKABLE = new Set([
  0x0a, 0x20, 0x26, 0x29, 0x2b, 0x2d, 0x2f, 0xad, 0xb7, 0x200b, 0x2010, 0x2013, 0x2027
]);
const BREAKABLE_BEFORE = new Set([0x28]);

/** Builds a regexp of MapLibre's script codes, skipping scripts unsupported by the runtime. */
function createScriptRegExp(scriptCodes: string[]): RegExp {
  const escapes = scriptCodes
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

const IDEOGRAPHIC_BREAKING_REGEXP = createScriptRegExp([
  'Bopo',
  'Hani',
  'Hira',
  'Kana',
  'Kits',
  'Nshu',
  'Tang',
  'Yiii'
]);

/** Cursive scripts, whose letters join, take no letter spacing in MapLibre. */
const CURSIVE_SCRIPT_REGEXP = createScriptRegExp(['Arab', 'Dupl', 'Mong', 'Ougr', 'Syrc']);

/**
 * Whether `text-letter-spacing` applies to `text`: as in MapLibre, text with any character of a
 * cursive script (Arabic, Duployan, Mongolian, Old Uyghur, Syriac) is not letter-spaced.
 */
export function allowsLetterSpacing(text: string): boolean {
  return !CURSIVE_SCRIPT_REGEXP.test(text);
}

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

/**
 * `text-transform`, as MapLibre applies it: locale-aware upper or lower case, then Arabic shaping
 * (see {@link applyArabicShaping}), so that the glyphs looked up, measured and drawn are those of
 * the shapes the letters take.
 */
export function transformText(text: string, transform: unknown): string {
  if (transform === 'uppercase') text = text.toLocaleUpperCase();
  else if (transform === 'lowercase') text = text.toLocaleLowerCase();
  return applyArabicShaping(text);
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
 * Longest label, in UTF-16 code units, that {@link wrapText} wraps. Line breaking is quadratic in
 * the number of break opportunities, and tile data is untrusted, so longer text is returned
 * unwrapped. Real labels are far shorter; at this length even ideographic text, where every
 * character is a break opportunity, costs tens of thousands of steps.
 */
export const MAX_WRAPPED_TEXT_LENGTH = 256;

/**
 * Line-breaking work that {@link wrapText} may still spend, shared by the labels of one tile and
 * style layer. Each wrap costs an upper bound of its steps: one per character plus one per pair of
 * break opportunities. A label whose cost exceeds what is left is returned unwrapped.
 */
export type WrapBudget = {steps: number};

/**
 * Breaks `text` into lines no wider than `maxWidth` ems where it can, with MapLibre's balanced
 * line breaking, and returns the lines joined by '\n', each in the order it is drawn (see
 * {@link orderBidirectionalText}). Advances from `measure` are in ems; words without break
 * opportunities stay intact, even when they exceed the requested width. Text longer than
 * {@link MAX_WRAPPED_TEXT_LENGTH}, or whose cost exceeds `budget`, is not broken.
 */
export function wrapText(
  text: string,
  maxWidth: number,
  measure: (character: string) => number,
  budget?: WrapBudget
): string {
  return layOutLines(text, getLineBreaks(text, maxWidth, measure, budget));
}

/**
 * Puts text that is not wrapped, such as a label along a line, into the order it is drawn: right-
 * to-left runs reversed, as MapLibre does. Text without right-to-left characters is unchanged.
 */
export function orderBidirectionalText(text: string): string {
  return layOutLines(text, null);
}

/**
 * The code point offsets where `wrapText` ends the lines of `text`, the last being its length, or
 * null when it is not broken.
 */
function getLineBreaks(
  text: string,
  maxWidth: number,
  measure: (character: string) => number,
  budget?: WrapBudget
): number[] | null {
  if (text.length > MAX_WRAPPED_TEXT_LENGTH) {
    return null;
  }
  const characters = Array.from(text);
  let breakOpportunities = 0;
  for (const character of characters) {
    const codePoint = character.codePointAt(0)!;
    if (
      BREAKABLE.has(codePoint) ||
      BREAKABLE_BEFORE.has(codePoint) ||
      charAllowsIdeographicBreaking(codePoint)
    ) {
      breakOpportunities++;
    }
  }
  if (!breakOpportunities) return null;
  if (budget) {
    const cost = characters.length + (breakOpportunities * (breakOpportunities + 1)) / 2;
    if (cost > budget.steps) return null;
    budget.steps -= cost;
  }
  return determineLineBreaks(characters, maxWidth, measure);
}

/** Trims whitespace from both ends of a line, given as code points. */
function trimLine(characters: string[]): string {
  let first = 0;
  let last = characters.length;
  while (first < last && WHITESPACE.has(characters[first].codePointAt(0)!)) first++;
  while (last > first && WHITESPACE.has(characters[last - 1].codePointAt(0)!)) last--;
  return characters.slice(first, last).join('');
}

/**
 * Breaks `text` at `breaks` (code point offsets, or null for none) into trimmed lines joined by
 * '\n'. As MapLibre's shaping, text with right-to-left characters is broken in logical order and
 * each line is then reordered by the Unicode Bidirectional Algorithm, with the embedding levels of
 * the whole label (see {@link processBidirectionalText}).
 */
function layOutLines(text: string, breaks: number[] | null): string {
  const rightToLeft = containsRightToLeftText(text);
  if (!breaks && !rightToLeft) {
    return text;
  }
  const characters = Array.from(text);
  if (rightToLeft) {
    const codeUnitBreaks: number[] = [];
    if (breaks) {
      let codeUnit = 0;
      let index = 0;
      for (const end of breaks) {
        for (; index < end; index++) codeUnit += characters[index].length;
        codeUnitBreaks.push(codeUnit);
      }
    }
    return processBidirectionalText(text, codeUnitBreaks)
      .map(line => trimLine(Array.from(line)))
      .join('\n');
  }
  const lines: string[] = [];
  let start = 0;
  for (const end of breaks!) {
    lines.push(trimLine(characters.slice(start, end)));
    start = end;
  }
  return lines.join('\n');
}

/**
 * Whether text can be measured with a canvas here; otherwise {@link getCharacterWidthMeasurer}
 * returns {@link FALLBACK_CHARACTER_WIDTH} for every character.
 */
export function canMeasureText(): boolean {
  return typeof OffscreenCanvas !== 'undefined' || typeof document !== 'undefined';
}

/** Advance in ems used when canvas measurement is unavailable, as for missing atlas glyphs. */
export const FALLBACK_CHARACTER_WIDTH = 0.5;
const FONT_SIZE = 64;
/**
 * Bounds on the measurement caches: fonts and characters both come from untrusted style and tile
 * data. A full cache is cleared rather than grown.
 */
export const MAX_CACHED_FONTS = 32;
export const MAX_CACHED_CHARACTERS = 4096;
/** Bound on the fonts remembered as measured, which also come from untrusted style data. */
const MAX_MEASURED_FONTS = 4096;
const CHARACTER_WIDTH_MEASURERS = new Map<string, (character: string) => number>();

/** The advances each measurer has measured, so that a forgotten font can be compared. */
const MEASURED_WIDTHS = new WeakMap<(character: string) => number, Map<string, number>>();
/**
 * Measurers that do not hold every advance measured in their font since it was last forgotten:
 * their characters were cleared, or an earlier measurer of the font was evicted.
 */
const INCOMPLETE_MEASURERS = new WeakSet<(character: string) => number>();
/** CSS fonts measured since they were last forgotten. */
const MEASURED_FONTS = new Set<string>();
/** Per CSS font, how many times its advances changed when forgotten. */
const CHARACTER_WIDTH_REVISIONS = new Map<string, number>();

/**
 * Forgets the character advances measured for a CSS font, so they are measured again: a font that
 * was still loading was measured with a fallback font. When the advances measured before differ
 * from those measured now, or were not all kept, the font's revision changes.
 */
export function forgetCharacterWidths(fontWeight: number | string, fontFamily: string): void {
  const font = `${fontWeight} ${FONT_SIZE}px ${fontFamily}`;
  const before = CHARACTER_WIDTH_MEASURERS.get(font);
  CHARACTER_WIDTH_MEASURERS.delete(font);
  MEASURED_FONTS.delete(font);
  const widths = before && !INCOMPLETE_MEASURERS.has(before) && MEASURED_WIDTHS.get(before);
  if (widths) {
    const measure = getCharacterWidthMeasurer(fontWeight, fontFamily);
    let changed = false;
    for (const [character, width] of widths) {
      if (measure(character) !== width) {
        changed = true;
        break;
      }
    }
    if (!changed) {
      return;
    }
  }
  CHARACTER_WIDTH_REVISIONS.set(font, (CHARACTER_WIDTH_REVISIONS.get(font) ?? 0) + 1);
}

/**
 * A number that changes whenever {@link forgetCharacterWidths} finds a font's advances changed, so
 * that what was measured in it before can be measured again. Loading another font, or a measurer
 * evicted from a full cache, measuring the same advances again, does not change it.
 */
export function getCharacterWidthsRevision(
  fontWeight: number | string,
  fontFamily: string
): number {
  return CHARACTER_WIDTH_REVISIONS.get(`${fontWeight} ${FONT_SIZE}px ${fontFamily}`) ?? 0;
}

/**
 * Returns a function giving a character's advance width in ems for a CSS font, measured the way
 * deck.gl's TextLayer builds its font atlas: at 64px, then divided by 64. Measurers and character
 * advances are cached, up to {@link MAX_CACHED_FONTS} and {@link MAX_CACHED_CHARACTERS}.
 * Environments without a canvas 2D context use a half-em advance.
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
      if (widths.size >= MAX_CACHED_CHARACTERS) {
        widths.clear();
        INCOMPLETE_MEASURERS.add(measure);
      }
      widths.set(character, width);
    }
    return width;
  };
  MEASURED_WIDTHS.set(measure, widths);
  if (MEASURED_FONTS.has(font)) {
    // An earlier measurer of the font was evicted, with advances this one does not hold.
    INCOMPLETE_MEASURERS.add(measure);
  } else {
    if (MEASURED_FONTS.size >= MAX_MEASURED_FONTS) {
      MEASURED_FONTS.clear();
    }
    MEASURED_FONTS.add(font);
  }
  if (CHARACTER_WIDTH_MEASURERS.size >= MAX_CACHED_FONTS) {
    CHARACTER_WIDTH_MEASURERS.clear();
  }
  CHARACTER_WIDTH_MEASURERS.set(font, measure);
  return measure;
}

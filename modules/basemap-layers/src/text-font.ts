/**
 * A label font as CSS: a family list ending with a generic family, a numeric weight and a style.
 */
export type LabelFont = {
  /** CSS `font-family` list, e.g. `"Noto Sans", sans-serif`. */
  fontFamily: string;
  /** CSS numeric `font-weight`, 100-900. */
  fontWeight: number;
  /** CSS `font-style`. */
  fontStyle: 'normal' | 'italic';
};

/**
 * Overrides the label font derived from `text-font`. A string is the CSS family list for every
 * label; the weight and style still come from `text-font`. A function receives the evaluated
 * `text-font` names and returns a CSS family list, or any of the {@link LabelFont} fields; fields
 * it leaves out, or a `null` result, keep the mapped values.
 */
export type LabelFontFamily =
  | string
  | ((fontStack: string[]) => string | Partial<LabelFont> | null | undefined);

/** The style specification's default `text-font`. */
export const DEFAULT_TEXT_FONT = ['Open Sans Regular', 'Arial Unicode MS Regular'];

const FONT_WEIGHTS = new Map<string, number>([
  ['thin', 100],
  ['hairline', 100],
  ['extralight', 200],
  ['ultralight', 200],
  ['light', 300],
  ['regular', 400],
  ['normal', 400],
  ['book', 400],
  ['roman', 400],
  ['medium', 500],
  ['semibold', 600],
  ['demibold', 600],
  ['bold', 700],
  ['extrabold', 800],
  ['ultrabold', 800],
  ['black', 900],
  ['heavy', 900]
]);

/** First words of two-word weights such as `Semi Bold` and `Extra Light`. */
const WEIGHT_PREFIXES = new Set(['semi', 'demi', 'extra', 'ultra']);

const FONT_STYLES = ['italic', 'oblique'];

/**
 * Splits a font name such as `Open Sans Semibold Italic` into its family and its trailing weight
 * and style words. Only trailing words are read, and a name is never reduced to nothing.
 */
function parseFontName(name: string): {family: string; fontWeight: number; italic: boolean} {
  const words = name.trim().split(/\s+/).filter(Boolean);
  let fontWeight = 400;
  let italic = false;

  const last = words.at(-1)?.toLowerCase() || '';
  const style = FONT_STYLES.find(suffix => last.endsWith(suffix));
  const styleWeight = style ? last.slice(0, -style.length) : '';
  if (style && words.length > 1 && (!styleWeight || FONT_WEIGHTS.has(styleWeight))) {
    italic = true;
    words.pop();
    if (styleWeight) {
      // A combined word such as `BoldItalic`.
      return {family: words.join(' '), fontWeight: FONT_WEIGHTS.get(styleWeight)!, italic};
    }
  }

  const weightWord = words.at(-1)?.toLowerCase() || '';
  if (words.length > 1 && FONT_WEIGHTS.has(weightWord)) {
    fontWeight = FONT_WEIGHTS.get(weightWord)!;
    words.pop();
    const prefix = words.at(-1)?.toLowerCase() || '';
    if (words.length > 1 && WEIGHT_PREFIXES.has(prefix) && FONT_WEIGHTS.has(prefix + weightWord)) {
      fontWeight = FONT_WEIGHTS.get(prefix + weightWord)!;
      words.pop();
    }
  }

  return {family: words.join(' '), fontWeight, italic};
}

/** The generic CSS family a font name implies: serif or monospace when it says so. */
function getGenericFamily(family: string): string {
  const words = family.toLowerCase().split(' ');
  if (words.includes('mono') || words.includes('monospace')) {
    return 'monospace';
  }
  if (words.includes('serif') && !words.includes('sans')) {
    return 'serif';
  }
  return 'sans-serif';
}

function quoteFamily(family: string): string {
  return `"${family.replace(/["\\]/g, '\\$&')}"`;
}

/**
 * Maps a style's `text-font` stack to a CSS font. Each name's trailing weight and style words
 * (`Regular`, `Bold`, `Semibold Italic`, ...) are stripped to give its family; the families are
 * listed in stack order and end with a generic family, so labels still draw when none of the
 * fonts is installed. `TextLayer` takes one weight per layer, so the weight and style come from
 * the first font of the stack.
 */
export function getLabelFont(fontStack: string[]): LabelFont {
  const fonts = fontStack.map(parseFontName);
  const families = [...new Set(fonts.map(font => font.family))];
  const generic = families.length ? getGenericFamily(families[0]) : 'sans-serif';
  return {
    fontFamily: [...families.map(quoteFamily), generic].join(', '),
    fontWeight: fonts[0]?.fontWeight ?? 400,
    fontStyle: fonts[0]?.italic ? 'italic' : 'normal'
  };
}

/** {@link getLabelFont}, with the caller's {@link LabelFontFamily} override applied. */
export function resolveLabelFont(
  fontStack: string[],
  fontFamily?: LabelFontFamily | null
): LabelFont {
  const font = getLabelFont(fontStack);
  const override = typeof fontFamily === 'function' ? fontFamily(fontStack) : fontFamily;
  if (typeof override === 'string') {
    return {...font, fontFamily: override};
  }
  if (!override) {
    return font;
  }
  const fields = Object.entries(override).filter(
    ([, value]) => value !== undefined && value !== null
  );
  return {...font, ...Object.fromEntries(fields)};
}

/**
 * `TextLayer`'s `fontWeight` prop for a font. `TextLayer` has no `fontStyle` prop and writes
 * `fontWeight` in front of the size in the canvas font string, so an italic font puts its style
 * in front of the weight there (`italic 400`), which is valid CSS font shorthand.
 */
export function getTextLayerFontWeight(font: LabelFont): number | string {
  return font.fontStyle === 'italic' ? `italic ${font.fontWeight}` : font.fontWeight;
}

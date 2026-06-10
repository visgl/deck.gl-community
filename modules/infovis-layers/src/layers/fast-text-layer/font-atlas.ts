// deck.gl and luma.gl inspired text atlas utilities.
// SPDX-License-Identifier: MIT

/* global document */

/** One rasterized font glyph entry in atlas pixel coordinates. */
export type FastTextCharacter = {
  /** Left atlas pixel coordinate. */
  x: number;
  /** Top atlas pixel coordinate. */
  y: number;
  /** Glyph bitmap width in atlas pixels. */
  width: number;
  /** Glyph bitmap height in atlas pixels. */
  height: number;
  /** Horizontal anchor in glyph bitmap pixels. */
  anchorX: number;
  /** Vertical anchor in glyph bitmap pixels. */
  anchorY: number;
  /** Horizontal cursor advance in atlas pixels. */
  advance: number;
};

/** Lookup from a rendered character to its atlas frame and metrics. */
export type FastTextCharacterMapping = Record<string, FastTextCharacter | undefined>;

/** Font rasterization inputs used to build a generated atlas. */
export type FastTextFontSettings = {
  /** CSS font family used when rasterizing glyphs. */
  fontFamily?: string;
  /** CSS font weight used when rasterizing glyphs. */
  fontWeight?: string | number;
  /** Characters to rasterize into the atlas. */
  characterSet?: Set<string> | readonly string[] | string;
  /** Atlas rasterization size in CSS pixels. */
  fontSize?: number;
  /** Transparent pixel padding around every glyph. */
  buffer?: number;
  /** Whether generated atlases encode signed distance fields. */
  sdf?: boolean;
  /** SDF inside-glyph cutoff. Larger values make glyphs thinner. */
  cutoff?: number;
  /** SDF distance radius in atlas pixels. */
  radius?: number;
  /** SDF edge smoothing used by the shader. */
  smoothing?: number;
};

/** Font atlas consumed by {@link FastTextLayer}. */
export type FastTextFontAtlas = {
  /** Distance from a label baseline to its visual center in atlas pixels. */
  baselineOffset: number;
  /** Glyph metric lookup keyed by rendered character. */
  mapping: FastTextCharacterMapping;
  /** Canvas containing the packed glyph bitmaps. */
  data: HTMLCanvasElement;
  /** Atlas width in pixels. */
  width: number;
  /** Atlas height in pixels. */
  height: number;
};

/** Default font settings used by {@link FastTextLayer}. */
export const DEFAULT_FAST_TEXT_FONT_SETTINGS: Required<FastTextFontSettings> = {
  fontFamily: 'Monaco, monospace',
  fontWeight: 'normal',
  characterSet: getDefaultCharacterSet(),
  fontSize: 64,
  buffer: 4,
  sdf: true,
  cutoff: 0.25,
  radius: 12,
  smoothing: 0.1
};

/** Build a font atlas for a fixed character set without retaining a process cache. */
export function createFastTextFontAtlas(settings: FastTextFontSettings = {}): FastTextFontAtlas {
  if (typeof document === 'undefined') {
    throw new Error('FastTextLayer font atlas generation requires document.createElement');
  }

  const resolvedSettings = {
    ...DEFAULT_FAST_TEXT_FONT_SETTINGS,
    ...settings,
    characterSet: normalizeCharacterSet(
      settings.characterSet ?? DEFAULT_FAST_TEXT_FONT_SETTINGS.characterSet
    )
  };
  const canvas = document.createElement('canvas');
  canvas.width = MAX_CANVAS_WIDTH;
  const context = canvas.getContext('2d', {willReadFrequently: true});
  if (!context) {
    throw new Error('FastTextLayer font atlas generation requires a 2D canvas context');
  }

  setTextStyle(context, resolvedSettings);
  const sdfRenderer = resolvedSettings.sdf
    ? createFastTextSdfRenderer(resolvedSettings)
    : undefined;
  const mappingResult = buildFastTextCharacterMapping({
    characterSet: resolvedSettings.characterSet,
    measureText: character => measureFastText(context, resolvedSettings.fontSize, character),
    buffer: resolvedSettings.buffer,
    maxCanvasWidth: MAX_CANVAS_WIDTH
  });

  canvas.height = mappingResult.canvasHeight;
  setTextStyle(context, resolvedSettings);

  for (const character of resolvedSettings.characterSet) {
    const frame = mappingResult.mapping[character];
    if (frame) {
      if (sdfRenderer) {
        drawFastTextSdfCharacter(context, sdfRenderer, character, frame, resolvedSettings.buffer);
      } else {
        context.fillText(character, frame.x, frame.y + frame.anchorY);
      }
    }
  }

  const fontMetrics = measureFastText(context, resolvedSettings.fontSize);
  return {
    baselineOffset: (fontMetrics.ascent - fontMetrics.descent) / 2,
    mapping: mappingResult.mapping,
    data: canvas,
    width: canvas.width,
    height: canvas.height
  };
}

/** Build glyph atlas frames from text measurements without drawing the atlas canvas. */
export function buildFastTextCharacterMapping({
  characterSet,
  measureText,
  buffer,
  maxCanvasWidth
}: {
  /** Characters that need atlas entries. */
  characterSet: Set<string>;
  /** Glyph measurement callback for one character. */
  measureText: (character: string) => FastTextMeasuredCharacter;
  /** Transparent pixel padding around every glyph. */
  buffer: number;
  /** Maximum atlas row width in pixels. */
  maxCanvasWidth: number;
}): {
  /** Glyph metric lookup keyed by rendered character. */
  mapping: FastTextCharacterMapping;
  /** Power-of-two atlas height in pixels. */
  canvasHeight: number;
} {
  const mapping: FastTextCharacterMapping = {};
  let x = 0;
  let yMin = 0;
  let yMax = 0;

  for (const character of characterSet) {
    const {advance, width, ascent, descent} = measureText(character);
    const height = ascent + descent;
    if (x + width + buffer * 2 > maxCanvasWidth) {
      x = 0;
      yMin = yMax;
    }
    mapping[character] = {
      x: x + buffer,
      y: yMin + buffer,
      width,
      height,
      advance,
      anchorX: width / 2,
      anchorY: ascent
    };
    x += width + buffer * 2;
    yMax = Math.max(yMax, yMin + height + buffer * 2);
  }

  return {
    mapping,
    canvasHeight: Math.max(1, nextPowerOfTwo(yMax))
  };
}

/** Minimal atlas manager that rebuilds only when rasterization inputs change. */
export class FastTextFontAtlasManager {
  /** Current resolved font settings. */
  props: Required<FastTextFontSettings> = {...DEFAULT_FAST_TEXT_FONT_SETTINGS};
  private currentAtlas?: FastTextFontAtlas;
  private currentKey?: string;

  /** Current atlas, if one has been built. */
  get atlas(): Readonly<FastTextFontAtlas> | undefined {
    return this.currentAtlas;
  }

  /** Current character mapping, if an atlas has been built. */
  get mapping(): FastTextCharacterMapping | undefined {
    return this.currentAtlas?.mapping;
  }

  /** Update font settings and return whether the atlas was rebuilt. */
  setProps(props: FastTextFontSettings = {}): boolean {
    this.props = {
      ...this.props,
      ...props,
      characterSet: normalizeCharacterSet(props.characterSet ?? this.props.characterSet)
    };
    const nextKey = getFontAtlasKey(this.props);
    if (this.currentAtlas && this.currentKey === nextKey) {
      return false;
    }

    this.currentAtlas = createFastTextFontAtlas(this.props);
    this.currentKey = nextKey;
    return true;
  }
}

type FastTextMeasuredCharacter = {
  /** Horizontal cursor advance in atlas pixels. */
  readonly advance: number;
  /** Glyph bitmap width in atlas pixels. */
  readonly width: number;
  /** Distance from baseline to glyph top in atlas pixels. */
  readonly ascent: number;
  /** Distance from baseline to glyph bottom in atlas pixels. */
  readonly descent: number;
};

const MAX_CANVAS_WIDTH = 1024;
const DEFAULT_ASCENT = 0.9;
const DEFAULT_DESCENT = 0.3;

/** Return the default printable ASCII atlas character set. */
function getDefaultCharacterSet(): string[] {
  const characterSet: string[] = [];
  for (let code = 32; code < 128; code++) {
    characterSet.push(String.fromCharCode(code));
  }
  return characterSet;
}

/** Normalize caller-supplied character sets into a Set for deterministic use. */
function normalizeCharacterSet(
  characterSet: Set<string> | readonly string[] | string
): Set<string> {
  return typeof characterSet === 'string'
    ? new Set(Array.from(characterSet))
    : new Set(characterSet);
}

/** Generate a stable atlas key from font settings and sorted character set contents. */
function getFontAtlasKey(settings: Required<FastTextFontSettings>): string {
  const characters = Array.from(settings.characterSet).sort().join('');
  return [
    settings.fontFamily,
    settings.fontWeight,
    settings.fontSize,
    settings.buffer,
    settings.sdf,
    settings.cutoff,
    settings.radius,
    characters
  ].join('\n');
}

/** Apply font rendering settings to a 2D canvas context. */
function setTextStyle(
  context: CanvasRenderingContext2D,
  settings: Pick<Required<FastTextFontSettings>, 'fontFamily' | 'fontSize' | 'fontWeight'>
): void {
  context.font = `${settings.fontWeight} ${settings.fontSize}px ${settings.fontFamily}`;
  context.fillStyle = '#000';
  context.textBaseline = 'alphabetic';
  context.textAlign = 'left';
}

/** Measure one character or the fallback font metrics for the current canvas font. */
function measureFastText(
  context: CanvasRenderingContext2D,
  fontSize: number,
  character?: string
): FastTextMeasuredCharacter {
  if (character === undefined) {
    const fontMetrics = context.measureText('A');
    if (fontMetrics.fontBoundingBoxAscent) {
      return {
        advance: 0,
        width: 0,
        ascent: Math.ceil(fontMetrics.fontBoundingBoxAscent),
        descent: Math.ceil(fontMetrics.fontBoundingBoxDescent)
      };
    }
    return {
      advance: 0,
      width: 0,
      ascent: fontSize * DEFAULT_ASCENT,
      descent: fontSize * DEFAULT_DESCENT
    };
  }

  const metrics = context.measureText(character);
  if (!metrics.actualBoundingBoxAscent) {
    return {
      advance: metrics.width,
      width: metrics.width,
      ascent: fontSize * DEFAULT_ASCENT,
      descent: fontSize * DEFAULT_DESCENT
    };
  }
  return {
    advance: metrics.width,
    width: Math.ceil(metrics.actualBoundingBoxRight - metrics.actualBoundingBoxLeft),
    ascent: Math.ceil(metrics.actualBoundingBoxAscent),
    descent: Math.ceil(metrics.actualBoundingBoxDescent)
  };
}

/** Create a local TinySDF-style renderer for one resolved font. */
function createFastTextSdfRenderer(
  settings: Pick<
    Required<FastTextFontSettings>,
    'buffer' | 'cutoff' | 'fontFamily' | 'fontSize' | 'fontWeight' | 'radius'
  >
): FastTextSdfRenderer {
  const buffer = Math.ceil(settings.buffer);
  const size = Math.ceil(settings.fontSize + buffer * 4);
  const scratchSize = size + buffer;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d', {willReadFrequently: true});
  if (!context) {
    throw new Error('FastTextLayer SDF generation requires a 2D canvas context');
  }

  setTextStyle(context, settings);
  const gridOuter = new Float64Array(scratchSize * scratchSize);
  const gridInner = new Float64Array(scratchSize * scratchSize);
  const f = new Float64Array(scratchSize);
  const z = new Float64Array(scratchSize + 1);
  const v = new Uint16Array(scratchSize);
  return {
    draw: character =>
      drawFastTextSdfGlyph({
        character,
        context,
        fontSize: settings.fontSize,
        buffer,
        cutoff: settings.cutoff,
        radius: settings.radius,
        size,
        gridOuter,
        gridInner,
        f,
        z,
        v
      })
  };
}

/** Draw one SDF glyph into the target atlas canvas. */
function drawFastTextSdfCharacter(
  context: CanvasRenderingContext2D,
  sdfRenderer: FastTextSdfRenderer,
  character: string,
  frame: FastTextCharacter,
  buffer: number
): void {
  const {data, width, height} = sdfRenderer.draw(character);
  const imageData = context.createImageData(width, height);
  populateAlphaChannel(data, imageData);

  const x = frame.x - buffer;
  const y = frame.y - buffer;
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const w = Math.min(width, context.canvas.width - x0);
  const h = Math.min(height, context.canvas.height - y0);
  context.putImageData(imageData, x0, y0, 0, 0, w, h);

  frame.x += x0 - x;
  frame.y += y0 - y;
}

/** Copy grayscale SDF values into an ImageData alpha channel. */
function populateAlphaChannel(
  alphaChannel: Uint8ClampedArray | Uint8Array,
  imageData: ImageData
): void {
  for (let index = 0; index < alphaChannel.length; index++) {
    imageData.data[4 * index + 3] = alphaChannel[index];
  }
}

type FastTextSdfRenderer = {
  /** Draw one character into a grayscale SDF glyph buffer. */
  draw: (character: string) => FastTextSdfGlyph;
};

type FastTextSdfGlyph = {
  /** Grayscale SDF values for the glyph image. */
  readonly data: Uint8ClampedArray;
  /** Width of the returned SDF image in pixels. */
  readonly width: number;
  /** Height of the returned SDF image in pixels. */
  readonly height: number;
};

type DrawFastTextSdfGlyphProps = {
  /** Character to rasterize. */
  readonly character: string;
  /** Canvas context configured with the target font. */
  readonly context: CanvasRenderingContext2D;
  /** Font size used for metric fallbacks. */
  readonly fontSize: number;
  /** SDF padding around the glyph. */
  readonly buffer: number;
  /** SDF inside-glyph cutoff. */
  readonly cutoff: number;
  /** SDF distance radius. */
  readonly radius: number;
  /** Square scratch canvas dimension. */
  readonly size: number;
  /** Scratch grid for distances outside the glyph. */
  readonly gridOuter: Float64Array;
  /** Scratch grid for distances inside the glyph. */
  readonly gridInner: Float64Array;
  /** Scratch values for the 1D distance transform. */
  readonly f: Float64Array;
  /** Scratch boundary locations for the 1D distance transform. */
  readonly z: Float64Array;
  /** Scratch source indices for the 1D distance transform. */
  readonly v: Uint16Array;
};

const FAST_TEXT_SDF_INF = 1e20;

/** Rasterize one glyph and convert its alpha mask into signed distance values. */
function drawFastTextSdfGlyph({
  character,
  context,
  fontSize,
  buffer,
  cutoff,
  radius,
  size,
  gridOuter,
  gridInner,
  f,
  z,
  v
}: DrawFastTextSdfGlyphProps): FastTextSdfGlyph {
  const metrics = context.measureText(character);
  const glyphTop = Math.ceil(metrics.actualBoundingBoxAscent ?? fontSize * DEFAULT_ASCENT);
  const glyphWidth = Math.max(
    0,
    Math.min(
      size - buffer,
      Math.ceil(
        (metrics.actualBoundingBoxRight ?? metrics.width) - (metrics.actualBoundingBoxLeft ?? 0)
      )
    )
  );
  const glyphHeight = Math.min(
    size - buffer,
    glyphTop + Math.ceil(metrics.actualBoundingBoxDescent ?? fontSize * DEFAULT_DESCENT)
  );
  const width = glyphWidth + 2 * buffer;
  const height = glyphHeight + 2 * buffer;
  const data = new Uint8ClampedArray(Math.max(width * height, 0));
  if (glyphWidth === 0 || glyphHeight === 0) {
    return {data, width, height};
  }

  context.clearRect(buffer, buffer, glyphWidth, glyphHeight);
  context.fillText(character, buffer, buffer + glyphTop);
  const imageData = context.getImageData(buffer, buffer, glyphWidth, glyphHeight);

  gridOuter.fill(FAST_TEXT_SDF_INF, 0, data.length);
  gridInner.fill(0, 0, data.length);

  for (let y = 0; y < glyphHeight; y++) {
    for (let x = 0; x < glyphWidth; x++) {
      const alpha = imageData.data[4 * (y * glyphWidth + x) + 3] / 255;
      if (alpha === 0) {
        continue;
      }

      const gridIndex = (y + buffer) * width + x + buffer;
      if (alpha === 1) {
        gridOuter[gridIndex] = 0;
        gridInner[gridIndex] = FAST_TEXT_SDF_INF;
      } else {
        const distance = 0.5 - alpha;
        gridOuter[gridIndex] = distance > 0 ? distance * distance : 0;
        gridInner[gridIndex] = distance < 0 ? distance * distance : 0;
      }
    }
  }

  transformFastTextSdfGrid(gridOuter, 0, 0, width, height, width, f, v, z);
  transformFastTextSdfGrid(gridInner, buffer, buffer, glyphWidth, glyphHeight, width, f, v, z);

  for (let index = 0; index < data.length; index++) {
    const distance = Math.sqrt(gridOuter[index]) - Math.sqrt(gridInner[index]);
    data[index] = Math.round(255 - 255 * (distance / radius + cutoff));
  }
  return {data, width, height};
}

/** Run a 2D squared Euclidean distance transform over one SDF grid. */
function transformFastTextSdfGrid(
  data: Float64Array,
  x0: number,
  y0: number,
  width: number,
  height: number,
  gridSize: number,
  f: Float64Array,
  v: Uint16Array,
  z: Float64Array
): void {
  for (let x = x0; x < x0 + width; x++) {
    transformFastTextSdfGrid1d(data, y0 * gridSize + x, gridSize, height, f, v, z);
  }
  for (let y = y0; y < y0 + height; y++) {
    transformFastTextSdfGrid1d(data, y * gridSize + x0, 1, width, f, v, z);
  }
}

/** Run the 1D pass for the squared Euclidean distance transform. */
function transformFastTextSdfGrid1d(
  grid: Float64Array,
  offset: number,
  stride: number,
  length: number,
  f: Float64Array,
  v: Uint16Array,
  z: Float64Array
): void {
  v[0] = 0;
  z[0] = -FAST_TEXT_SDF_INF;
  z[1] = FAST_TEXT_SDF_INF;
  f[0] = grid[offset];

  for (let q = 1, k = 0; q < length; q++) {
    f[q] = grid[offset + q * stride];
    const q2 = q * q;
    let s = 0;
    do {
      const r = v[k];
      s = (f[q] - f[r] + q2 - r * r) / (q - r) / 2;
    } while (s <= z[k] && --k > -1);

    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = FAST_TEXT_SDF_INF;
  }

  for (let q = 0, k = 0; q < length; q++) {
    while (z[k + 1] < q) {
      k++;
    }
    const r = v[k];
    const qr = q - r;
    grid[offset + q * stride] = f[r] + qr * qr;
  }
}

/** Return the next power-of-two canvas dimension for one positive number. */
function nextPowerOfTwo(value: number): number {
  return Math.pow(2, Math.ceil(Math.log2(Math.max(1, value))));
}

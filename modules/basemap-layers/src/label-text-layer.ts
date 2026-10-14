// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {createIterable} from '@deck.gl/core';
import {TextLayer, _MultiIconLayer as MultiIconLayer} from '@deck.gl/layers';
import type {TextLayerProps} from '@deck.gl/layers';
import type {
  Accessor,
  AccessorContext,
  Attribute,
  DefaultProps,
  FilterContext
} from '@deck.gl/core';
import type {Texture} from '@luma.gl/core';
import {SharedTextureSet} from './shared-texture';

/** `text-justify`: `auto` aligns the lines of a label by its text anchor, as `TextLayer` does. */
export type LabelTextJustify = 'auto' | 'left' | 'center' | 'right';

/** Where each character of a label is drawn, as `TextLayer`'s `transformParagraph` returns it. */
export type ParagraphLayout = {
  /** Character positions in the row, in font atlas pixels. */
  x: number[];
  y: number[];
  /** Width of each character's row. */
  rowWidth: number[];
  /** Width and height of the label box. */
  size: [number, number];
};

type _LabelTextLayerProps<DataT> = {
  /** Space added after each character but the last of a line, in ems of the text size. */
  getLetterSpacing?: Accessor<DataT, number>;
  /** How the lines of a label are aligned within its box. */
  getTextJustify?: Accessor<DataT, LabelTextJustify>;
};

export type LabelTextLayerProps<DataT = unknown> = _LabelTextLayerProps<DataT> &
  TextLayerProps<DataT>;

/** The text anchor's position across the label box: 0 at its left edge, 1 at its right edge. */
const ANCHOR_POSITION = {start: 0, middle: 0.5, end: 1} as const;

/** `text-justify` as a position across the box, as MapLibre's `justify`. */
const JUSTIFY_POSITION = {left: 0, center: 0.5, right: 1} as const;

/**
 * Spaces and justifies the lines of a label laid out by `TextLayer`, as MapLibre shapes text:
 * `spacing` atlas pixels follow each character of a line but the last, the label box widens to the
 * widest line, and each line is placed at `justify` across the box (0 left, 0.5 center, 1 right).
 * `TextLayer` places each line at the text anchor's position, `anchor`, so a line is shifted by
 * `(justify - anchor)` times the space it leaves in the box. `layout` is returned as is when
 * neither changes it.
 */
export function spaceParagraph(
  layout: ParagraphLayout,
  text: string,
  spacing: number,
  justify: number,
  anchor: number
): ParagraphLayout {
  const shift = justify - anchor;
  if (!spacing && !shift) {
    return layout;
  }
  const characters = Array.from(text);
  const x = layout.x.slice();
  const rowWidth = layout.rowWidth.slice();
  let width = 0;
  // `TextLayer` breaks lines at newlines only, as no `maxWidth` is set; a newline has no position.
  let start = 0;
  for (let i = 0; i <= characters.length; i++) {
    if (i < characters.length && characters[i] !== '\n') {
      continue;
    }
    if (i > start) {
      const lineWidth = layout.rowWidth[start] + (i - start - 1) * spacing;
      for (let j = start; j < i; j++) {
        x[j] += (j - start) * spacing;
        rowWidth[j] = lineWidth;
      }
      width = Math.max(width, lineWidth);
    }
    start = i + 1;
  }
  if (shift) {
    for (let i = 0; i < characters.length; i++) {
      if (characters[i] !== '\n') {
        x[i] += shift * (width - rowWidth[i]);
      }
    }
  }
  return {x, y: layout.y, rowWidth, size: [width, layout.size[1]]};
}

const defaultProps: DefaultProps<LabelTextLayerProps> = {
  getLetterSpacing: {type: 'accessor', value: 0},
  getTextJustify: {type: 'accessor', value: 'auto'}
};

/** Evaluates a constant or function accessor. */
function evaluate<DataT, T>(
  accessor: Accessor<DataT, T>,
  object: DataT,
  objectInfo: AccessorContext<DataT>
): T {
  return typeof accessor === 'function'
    ? (accessor as (object: DataT, objectInfo: AccessorContext<DataT>) => T)(object, objectInfo)
    : accessor;
}

/** A label's packed character definitions and the inputs they were made from. */
type CachedIconDefs = {
  text: string;
  offsets: number[];
  iconAtlas: unknown;
  iconMapping: unknown;
  defs: Float32Array;
};

/** Whether two number lists hold the same values. */
function isSameNumbers(a: number[], b: number[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

/**
 * Half the width, in device pixels, over which MapLibre GL JS antialiases the edges of glyphs and
 * of their halos: its symbol shader's `EDGE_GAMMA` (0.105 / device pixel ratio) of a distance
 * field that falls by 1/8 per glyph pixel, scaled with the text.
 */
export const LABEL_EDGE_DEVICE_PIXELS = 0.84;

/** Distance field units per atlas pixel of the font atlas, `1 / fontSettings.radius`. */
const labelEdgeUniforms = {
  name: 'labelEdge',
  fs: /* glsl */ `\
layout(std140) uniform labelEdgeUniforms {
  float distancePerAtlasPixel;
} labelEdge;
`,
  uniformTypes: {distancePerAtlasPixel: 'f32'}
} as const;

/**
 * `MultiIconLayer`'s signed distance field statements: the glyph edge, then the outline (halo)
 * edge, both smoothed over `sdf.gamma`, a fixed distance. On screen that is a share of the text
 * size: 0.0375 × size × device pixel ratio device pixels on each side for the label font atlas.
 */
const SDF_EDGES =
  /if \(sdf\.enabled\) \{\s*float distance = alpha;\s*alpha = smoothstep\(sdf\.buffer - sdf\.gamma, sdf\.buffer \+ sdf\.gamma, distance\);\s*if \(sdf\.outlineBuffer > 0\.0\) \{\s*float inFill = alpha;\s*float inBorder = smoothstep\(sdf\.outlineBuffer - sdf\.gamma, sdf\.outlineBuffer \+ sdf\.gamma, distance\);\s*color = mix\(sdf\.outlineColor, vColor, inFill\);\s*alpha = inBorder;\s*\}\s*\}/;

/**
 * The edges as MapLibre GL JS antialiases them: over `LABEL_EDGE_DEVICE_PIXELS` device pixels on
 * each side, whatever the text size and device pixel ratio. The distance a device pixel spans is
 * measured from the screen-space rate of change of the atlas coordinates, in uniform control flow.
 * - The glyph edge is never smoothed more than `TextLayer` smooths it (`sdf.gamma`): on small text
 *   at device pixel ratio 1, `TextLayer`'s edge is the narrower.
 * - The halo edge is smoothed as MapLibre's, also when it has no blur, unless the halo reaches so
 *   far out that the distance field ends within the smoothing: then it is smoothed no more than
 *   that allows, or than `sdf.gamma`. `TextHaloBlurExtension` widens it
 *   from `labelHaloGamma`, after `alpha = inBorder;`.
 * - The pass that draws the glyphs again over every halo (`sdf.outlineBuffer` at `sdf.buffer`)
 *   blends their edge with the halo color, as `TextLayer`'s does, over the glyph edge's own width.
 */
const LABEL_SDF_EDGES = /* glsl */ `\
if (sdf.enabled) {
      float distance = alpha;
      vec2 atlasPixel = vTextureCoords * vec2(textureSize(iconsTexture, 0));
      float atlasPixelsPerDevicePixel = 0.5 * (length(dFdx(atlasPixel)) + length(dFdy(atlasPixel)));
      float labelEdgeGamma =
        ${LABEL_EDGE_DEVICE_PIXELS.toFixed(2)} * atlasPixelsPerDevicePixel * labelEdge.distancePerAtlasPixel;
      float labelFillGamma = min(sdf.gamma, labelEdgeGamma);
      alpha = smoothstep(sdf.buffer - labelFillGamma, sdf.buffer + labelFillGamma, distance);
      if (sdf.outlineBuffer > 0.0 && sdf.outlineBuffer < sdf.buffer) {
        float inFill = alpha;
        // Capped, as TextHaloBlurExtension caps its blur, so that the halo fades out before the
        // distance field ends, at the edge of the glyph's quad, or no later than with sdf.gamma.
        float labelHaloGamma = min(labelEdgeGamma, max(sdf.gamma, sdf.outlineBuffer - 4.0 / 255.0));
        float inBorder = smoothstep(
          sdf.outlineBuffer - labelHaloGamma, sdf.outlineBuffer + labelHaloGamma, distance
        );
        color = mix(sdf.outlineColor, vColor, inFill);
        alpha = inBorder;
      } else if (sdf.outlineBuffer > 0.0) {
        // The glyphs drawn again over the halos, blended with the halo color at their edge as the
        // halo pass blends them, so that an edge pixel is half glyph and half halo, as MapLibre's.
        color = mix(sdf.outlineColor, vColor, alpha);
      }
    }`;

/**
 * The character layer of a `LabelTextLayer`. `TextLayer` packs, for every character of every
 * label, its place in the font atlas and its offset in the label, whenever the layer's data
 * changes. The packed values of each label are kept, and reused while its text, character offsets
 * and font atlas are the same, so the labels a layer held before are not packed again.
 *
 * On WebGL it antialiases glyph and halo edges as MapLibre GL JS (see `LABEL_SDF_EDGES`). The
 * WebGPU shader is `MultiIconLayer`'s.
 */
export class LabelCharactersLayer extends MultiIconLayer<any> {
  static layerName = 'LabelCharactersLayer';
  static defaultProps: DefaultProps<any> = {sdfRadius: {type: 'number', value: 12}};

  getShaders() {
    const shaders = super.getShaders();
    if (!SDF_EDGES.test(shaders.fs)) {
      throw new Error(`${this.id}: MultiIconLayer's signed distance field edges not found`);
    }
    return {
      ...shaders,
      modules: [...shaders.modules, labelEdgeUniforms],
      fs: shaders.fs.replace(SDF_EDGES, LABEL_SDF_EDGES)
    };
  }

  draw(params: any): void {
    const radius = Number((this.props as any).sdfRadius) || 12;
    this.setShaderModuleProps({labelEdge: {distancePerAtlasPixel: 1 / radius}});
    super.draw(params);
  }

  declare state: MultiIconLayer<any>['state'] & {
    /** Each label's packed character definitions, by label object. */
    iconDefs?: WeakMap<object, CachedIconDefs>;
  };

  protected calculateInstanceIconDefs(
    attribute: Attribute,
    {startRow, endRow}: {startRow: number; endRow: number}
  ): void {
    const {data, getIcon, getIconOffsets, iconAtlas, iconMapping} = this.props as any;
    const size = attribute.size;
    const output = attribute.value as Float32Array;
    let i = attribute.getVertexOffset(startRow);
    this.state.iconDefs ||= new WeakMap();
    const cache = this.state.iconDefs;
    const {iterable, objectInfo} = createIterable(data, startRow, endRow);
    for (const object of iterable) {
      objectInfo.index++;
      const text = getIcon(object, objectInfo) as string;
      const offsets = getIconOffsets(object, objectInfo) as number[];
      if (!text) {
        continue;
      }
      const isObject = object && typeof object === 'object';
      let entry = isObject ? cache.get(object as object) : undefined;
      if (
        !entry ||
        entry.text !== text ||
        entry.iconAtlas !== iconAtlas ||
        entry.iconMapping !== iconMapping ||
        !isSameNumbers(entry.offsets, offsets)
      ) {
        const characters = Array.from(text);
        const defs = new Float32Array(characters.length * size);
        characters.forEach((character, j) => {
          const def = this.getInstanceIconDef(character);
          def[0] = offsets[j * 2];
          def[1] += offsets[j * 2 + 1];
          // mask
          def[6] = 1;
          defs.set(def, j * size);
        });
        entry = {text, offsets: offsets.slice(), iconAtlas, iconMapping, defs};
        if (isObject) {
          cache.set(object as object, entry);
        }
      }
      output.set(entry.defs, i);
      i += entry.defs.length;
    }
  }
}

/**
 * A `TextLayer` with MapLibre's `text-letter-spacing` and `text-justify`. Both change where the
 * characters are drawn and the label box, which the background, and so the collision box, covers.
 * The box is recomputed when the `getText` (letter spacing) or `getTextAnchor` (justification)
 * update triggers change.
 *
 * It draws its glyphs from a font atlas texture shared with every other label layer of the same
 * atlas. `TextLayer` hands its glyph layer the atlas canvas, from which deck.gl creates and uploads
 * a texture per layer: one per label sublayer of every tile.
 */
export class LabelTextLayer<DataT = any, ExtraPropsT extends {} = {}> extends TextLayer<
  DataT,
  ExtraPropsT & Required<_LabelTextLayerProps<DataT>>
> {
  static layerName = 'LabelTextLayer';
  static defaultProps = defaultProps;

  declare state: TextLayer<DataT>['state'] & {
    atlasTextures?: SharedTextureSet;
    /** The shared texture of the current font atlas, which the glyph layer draws from. */
    atlasTexture?: Texture;
    /** Each label's layout, by label object (see `transformParagraph`). */
    layouts?: WeakMap<object, CachedLayout>;
  };

  renderLayers(): any {
    const {atlas} = this.state.fontAtlasManager;
    const {device} = this.context;
    if (atlas && device) {
      let {atlasTextures} = this.state;
      if (!atlasTextures) {
        atlasTextures = new SharedTextureSet(device);
        this.state.atlasTextures = atlasTextures;
      }
      // A new atlas, with more characters, is a new texture; the previous one is released.
      this.state.atlasTexture = atlasTextures.get(atlas);
      atlasTextures.retainOnly([atlas]);
    }
    return super.renderLayers();
  }

  /** Its characters are drawn by a `LabelCharactersLayer`. */
  getSubLayerClass(subLayerId: string, DefaultLayerClass: any): any {
    if (subLayerId === 'characters' && DefaultLayerClass === MultiIconLayer) {
      return super.getSubLayerClass(subLayerId, LabelCharactersLayer);
    }
    return super.getSubLayerClass(subLayerId, DefaultLayerClass);
  }

  /** The glyph layer's props, with the shared texture in place of the atlas canvas. */
  getSubLayerProps(sublayerProps: any = {}): any {
    const props = super.getSubLayerProps(sublayerProps);
    if (sublayerProps.id === 'characters') {
      if (this.state.atlasTexture) {
        props.iconAtlas = this.state.atlasTexture;
      }
      // The distance field's reach, from which the glyph layer measures its antialiasing.
      props.sdfRadius = this.props.fontSettings?.radius || 12;
    }
    return props;
  }

  /**
   * A transparent background without a border draws nothing on screen: it only marks the labels in
   * the collision map and the picking buffer. It is left out of the screen pass, which saves a draw
   * per label layer and frame.
   */
  filterSubLayer({layer, renderPass, isPicking}: FilterContext): boolean {
    return !(
      renderPass === 'screen' &&
      !isPicking &&
      layer.id === `${this.id}-background` &&
      this.hasInvisibleBackground()
    );
  }

  /**
   * Whether the background box is a constant transparent color without a border, no transition
   * fades it out, and no highlight colors it.
   */
  hasInvisibleBackground(): boolean {
    const {getBackgroundColor, getBorderWidth, transitions, autoHighlight, highlightedObjectIndex} =
      this.props;
    return (
      !autoHighlight &&
      !(typeof highlightedObjectIndex === 'number' && highlightedObjectIndex >= 0) &&
      Array.isArray(getBackgroundColor) &&
      getBackgroundColor[3] === 0 &&
      getBorderWidth === 0 &&
      !transitions?.getBackgroundColor &&
      !transitions?.getBorderWidth
    );
  }

  finalizeState(context: any): void {
    super.finalizeState(context);
    this.state.atlasTextures?.releaseAll();
  }
}

/**
 * `TextLayer` lays out the characters of each label in `transformParagraph`, from which both the
 * character offsets and the background box are computed. Its types declare it private, so it is
 * extended here on the prototype.
 */
const transformParagraph: (
  this: LabelTextLayer,
  object: unknown,
  objectInfo: AccessorContext<unknown>
) => ParagraphLayout = (TextLayer.prototype as any).transformParagraph;

/** A label's layout and every input it was computed from (see `transformParagraph`). */
type CachedLayout = {
  text: string;
  letterSpacing: number;
  justify: unknown;
  anchor: unknown;
  atlas: unknown;
  lineHeight: number;
  wordBreak: unknown;
  maxWidth: number;
  layout: ParagraphLayout;
};

Object.defineProperty(LabelTextLayer.prototype, 'transformParagraph', {
  configurable: true,
  writable: true,
  /**
   * Lays out a label, or returns the layout last computed for the same object from the same text,
   * spacing, justification, anchor, font atlas and line settings. `TextLayer` lays out each label
   * twice per update, for its background box and its characters, and a layer whose data changes
   * lays out every label again: the labels it held before keep their layouts.
   */
  value(this: LabelTextLayer, object: unknown, objectInfo: AccessorContext<unknown>) {
    const {getLetterSpacing, getTextJustify, getTextAnchor, lineHeight, wordBreak, maxWidth} =
      this.props;
    const text = this.state.getText!(object, objectInfo) || '';
    const letterSpacing = Number(evaluate(getLetterSpacing, object, objectInfo)) || 0;
    const justify = evaluate(getTextJustify, object, objectInfo);
    const anchor = evaluate(getTextAnchor, object, objectInfo);
    const {atlas} = this.state.fontAtlasManager;
    let cache = this.state.layouts;
    const cached = object && typeof object === 'object' ? cache?.get(object) : undefined;
    if (
      cached &&
      cached.text === text &&
      cached.letterSpacing === letterSpacing &&
      cached.justify === justify &&
      cached.anchor === anchor &&
      cached.atlas === atlas &&
      cached.lineHeight === lineHeight &&
      cached.wordBreak === wordBreak &&
      cached.maxWidth === maxWidth
    ) {
      return cached.layout;
    }
    let layout = transformParagraph.call(this, object, objectInfo);
    if (letterSpacing || (justify !== 'auto' && layout.x.length)) {
      const anchorPosition = ANCHOR_POSITION[anchor as keyof typeof ANCHOR_POSITION] ?? 0.5;
      const {fontSize} = this.state.fontAtlasManager.props;
      layout = spaceParagraph(
        layout,
        text,
        letterSpacing * fontSize,
        JUSTIFY_POSITION[justify as keyof typeof JUSTIFY_POSITION] ?? anchorPosition,
        anchorPosition
      );
    }
    if (object && typeof object === 'object') {
      if (!cache) {
        cache = new WeakMap();
        this.state.layouts = cache;
      }
      cache.set(object, {
        text,
        letterSpacing,
        justify,
        anchor,
        atlas,
        lineHeight,
        wordBreak,
        maxWidth,
        layout
      });
    }
    return layout;
  }
});

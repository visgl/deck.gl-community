// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {TextLayer} from '@deck.gl/layers';
import type {TextLayerProps} from '@deck.gl/layers';
import type {Accessor, AccessorContext, DefaultProps, FilterContext} from '@deck.gl/core';
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

  /** The glyph layer's props, with the shared texture in place of the atlas canvas. */
  getSubLayerProps(sublayerProps: any = {}): any {
    const props = super.getSubLayerProps(sublayerProps);
    if (sublayerProps.id === 'characters' && this.state.atlasTexture) {
      props.iconAtlas = this.state.atlasTexture;
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

  /** Whether the background box is a constant transparent color without a border. */
  hasInvisibleBackground(): boolean {
    const {getBackgroundColor, getBorderWidth} = this.props;
    return Array.isArray(getBackgroundColor) && getBackgroundColor[3] === 0 && getBorderWidth === 0;
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

Object.defineProperty(LabelTextLayer.prototype, 'transformParagraph', {
  configurable: true,
  writable: true,
  value(this: LabelTextLayer, object: unknown, objectInfo: AccessorContext<unknown>) {
    const layout = transformParagraph.call(this, object, objectInfo);
    const {getLetterSpacing, getTextJustify, getTextAnchor} = this.props;
    const letterSpacing = Number(evaluate(getLetterSpacing, object, objectInfo)) || 0;
    const justify = evaluate(getTextJustify, object, objectInfo);
    if (!letterSpacing && (justify === 'auto' || !layout.x.length)) {
      return layout;
    }
    const anchor = ANCHOR_POSITION[evaluate(getTextAnchor, object, objectInfo)] ?? 0.5;
    const {fontSize} = this.state.fontAtlasManager.props;
    return spaceParagraph(
      layout,
      this.state.getText!(object, objectInfo) || '',
      letterSpacing * fontSize,
      JUSTIFY_POSITION[justify as keyof typeof JUSTIFY_POSITION] ?? anchor,
      anchor
    );
  }
});

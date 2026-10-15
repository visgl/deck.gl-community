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
import {Buffer} from '@luma.gl/core';
import type {Texture} from '@luma.gl/core';
import {getLabelFontRenderer} from './label-font-renderer';
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
  /**
   * Where each glyph of a label along a line is drawn in a viewport (see {@link LineGlyphPlacement}),
   * or null to draw the label straight, turned by `getAngle`. Null for every label draws them all
   * straight. Its update trigger is `updateTriggers.getLineGlyphs`. WebGL only.
   */
  getLineGlyphs?: ((object: DataT, viewport: any) => Float32Array | null) | null;
  /**
   * What `getLineGlyphs` depends on in the viewport: the glyphs are placed again when it changes,
   * as the layer draws.
   */
  getLineGlyphKey?: ((viewport: any) => string) | null;
};

/**
 * `getLineGlyphs` of a label: 4 values per character, `dx, dy, angle, mode`. With mode 1 the
 * character's advance centre is drawn `dx, dy` pixels from the label's position (y down), turned by
 * `angle` degrees counter-clockwise, and `getPixelOffset` is not added; with mode -1 the label is not
 * drawn; with mode 0 it is drawn straight.
 */
export type LineGlyphPlacement = Float32Array;

/** The vertex shader line that turns a character about the label's anchor, which curved glyphs replace. */
const TURN_CHARACTER = `pixelOffset = rotate_by_angle(pixelOffset, instanceAngles) * instanceScale;
pixelOffset += instancePixelOffset;`;

/** The shader line before which a hidden label's characters collapse. */
const HIDE_CHARACTER_BEFORE = 'vTextureCoords = mix(';

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

/** Appended to the font atlas cache keys of label layers (see `initializeState`). */
const LABEL_ATLAS_KEY = 'label-glyph-overhang';

const defaultProps: DefaultProps<LabelTextLayerProps> = {
  getLetterSpacing: {type: 'accessor', value: 0},
  getTextJustify: {type: 'accessor', value: 'auto'},
  getLineGlyphs: {type: 'function', value: null, optional: true} as any,
  getLineGlyphKey: {type: 'function', value: null, optional: true} as any,
  // Keeps the part of italic glyphs left of their origin (see `getLabelFontRenderer`).
  _getFontRenderer: {type: 'function', value: getLabelFontRenderer}
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

/** The glyphs along lines of a view other than the one the glyph attribute holds. */
type ViewLineGlyphs = {
  /** The `getLineGlyphKey` they were placed for. */
  key: string;
  /** The glyph attribute revision they were placed at. */
  revision: number;
  values: Float32Array;
  buffer: Buffer;
};

/**
 * The most views whose glyphs along lines a layer keeps beside the attribute's, as a main map and a
 * minimap. The view drawn least recently is forgotten first.
 */
const MAX_LINE_GLYPH_VIEWS = 3;

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
 * The character layer of a `LabelTextLayer`. `TextLayer` packs, for every character of every
 * label, its place in the font atlas and its offset in the label, whenever the layer's data
 * changes. The packed values of each label are kept, and reused while its text, character offsets
 * and font atlas are the same, so the labels a layer held before are not packed again.
 */
/** @internal Exported for tests. */
export class LabelCharactersLayer extends MultiIconLayer<any> {
  static layerName = 'LabelCharactersLayer';

  declare state: MultiIconLayer<any>['state'] & {
    /** Each label's packed character definitions, by label object. */
    iconDefs?: WeakMap<object, CachedIconDefs>;
    /**
     * The view whose glyphs along lines the glyph attribute holds, and the `getLineGlyphKey` they
     * were placed for (null when some rows were placed for another).
     */
    lineGlyphView?: {id: string; key: string | null};
    /** Glyphs along lines of the other views drawn, by view id, least recently drawn first. */
    lineGlyphViews?: Map<string, ViewLineGlyphs>;
    /** Counts the glyph attribute's updates, after which the other views' glyphs are placed again. */
    lineGlyphRevision?: number;
  };

  /** Whether characters can be placed along lines: on WebGL, whose shader this layer extends. */
  drawsLineGlyphs(): boolean {
    return this.context.device.type !== 'webgpu';
  }

  getShaders(): any {
    const shaders = super.getShaders();
    if (!this.drawsLineGlyphs()) {
      return shaders;
    }
    const {vs} = shaders;
    if (!vs.includes(TURN_CHARACTER) || !vs.includes(HIDE_CHARACTER_BEFORE)) {
      throw new Error('LabelCharactersLayer: the text vertex shader has changed');
    }
    return {
      ...shaders,
      vs: vs
        .replace(
          'in vec4 instanceClipRect;',
          'in vec4 instanceClipRect;\nin vec4 instanceLineGlyphs;\nin float instanceGlyphCentres;'
        )
        .replace(
          TURN_CHARACTER,
          `if (instanceLineGlyphs.w > 0.5) {
  // A glyph along a line: turned about its advance centre, placed on the line.
  pixelOffset.x -= instanceGlyphCentres;
  pixelOffset = rotate_by_angle(pixelOffset, instanceLineGlyphs.z) * instanceScale + instanceLineGlyphs.xy;
} else {
${TURN_CHARACTER}
}`
        )
        .replace(
          HIDE_CHARACTER_BEFORE,
          `if (instanceLineGlyphs.w < -0.5) {
  gl_Position = vec4(0.0);
}
${HIDE_CHARACTER_BEFORE}`
        )
    };
  }

  initializeState(): void {
    super.initializeState();
    if (!this.drawsLineGlyphs()) {
      return;
    }
    this.getAttributeManager()!.addInstanced({
      instanceLineGlyphs: {
        size: 4,
        accessor: 'getLineGlyphs',
        update: this.calculateInstanceLineGlyphs
      },
      instanceGlyphCentres: {
        size: 1,
        accessor: ['getIcon', 'getIconOffsets', 'getLineGlyphs'],
        update: this.calculateInstanceGlyphCentres
      }
    });
  }

  updateState(params: any): void {
    super.updateState(params);
    const {props, oldProps} = params;
    const attributes = this.getAttributeManager();
    if (attributes && this.drawsLineGlyphs()) {
      if (props.iconMapping !== oldProps.iconMapping) {
        attributes.invalidate('instanceGlyphCentres');
      }
      // Without glyphs along lines, both attributes are constant; with them, the centres are needed.
      if (Boolean(props.getLineGlyphs) !== Boolean(oldProps.getLineGlyphs)) {
        attributes.invalidate('instanceGlyphCentres');
      }
    }
  }

  /**
   * Places the glyphs along lines again before drawing when the view has moved to another zoom or
   * bearing step (`getLineGlyphKey`). The rows and every other attribute stay as they are. A layer
   * drawn in several views, as a main map and a minimap, keeps the glyphs of each: the attribute
   * holds one view's, the others are kept in buffers of their own, bound in their place as each
   * view is drawn.
   */
  draw(params: any): void {
    const {getLineGlyphs, getLineGlyphKey} = this.props as any;
    const attribute = this.getAttributeManager()?.attributes.instanceLineGlyphs;
    if (getLineGlyphs && getLineGlyphKey && attribute && !attribute.isConstant && attribute.value) {
      const {viewport} = this.context;
      const id = getViewId(viewport);
      const key = getLineGlyphKey(viewport);
      const held = this.state.lineGlyphView;
      let buffer: Buffer | null = null;
      if (!held || held.id === id) {
        if (held?.key !== key) {
          this.state.lineGlyphView = {id, key};
          this.fillLineGlyphs(attribute, 0, Infinity);
          (attribute as any).updateSubBuffer({startOffset: 0, endOffset: attribute.value.length});
          LINE_GLYPH_ATTRIBUTE_STATS.refreshes++;
        }
        buffer = attribute.getBuffer();
      } else {
        buffer = this.getViewLineGlyphs(attribute, id, key).buffer;
      }
      // With one view, the attribute stays bound; with more, each view binds its own glyphs.
      if (this.state.lineGlyphViews?.size && buffer) {
        this.state.model?.setAttributes({instanceLineGlyphs: buffer});
      }
    }
    super.draw(params);
  }

  /**
   * The glyphs along lines of view `id`, which the glyph attribute does not hold: kept while its
   * key and the attribute's rows are the same, placed again and uploaded otherwise.
   */
  getViewLineGlyphs(attribute: Attribute, id: string, key: string): ViewLineGlyphs {
    if (!this.state.lineGlyphViews) {
      this.state.lineGlyphViews = new Map();
    }
    const views = this.state.lineGlyphViews;
    const revision = this.state.lineGlyphRevision ?? 0;
    const length = (attribute.value as Float32Array).length;
    let entry = views.get(id);
    if (entry) {
      // The most recently drawn view last.
      views.delete(id);
    }
    if (!entry || entry.key !== key || entry.revision !== revision) {
      if (!entry || entry.values.length !== length) {
        entry?.buffer.destroy();
        const values = new Float32Array(length);
        const buffer = this.context.device.createBuffer({
          id: `${this.id}-line-glyphs-${id}`,
          usage: Buffer.VERTEX | Buffer.COPY_DST,
          byteLength: values.byteLength
        });
        entry = {key, revision, values, buffer};
      }
      entry.key = key;
      entry.revision = revision;
      this.fillLineGlyphs(attribute, 0, Infinity, entry.values);
      entry.buffer.write(entry.values);
      LINE_GLYPH_ATTRIBUTE_STATS.refreshes++;
    }
    views.set(id, entry);
    for (const [oldId, old] of views) {
      if (views.size <= MAX_LINE_GLYPH_VIEWS) {
        break;
      }
      old.buffer.destroy();
      views.delete(oldId);
    }
    return entry;
  }

  finalizeState(context: any): void {
    super.finalizeState(context);
    this.forgetViewLineGlyphs();
  }

  /** Releases the glyphs along lines kept for views other than the attribute's. */
  forgetViewLineGlyphs(): void {
    for (const entry of this.state.lineGlyphViews?.values() ?? []) {
      entry.buffer.destroy();
    }
    this.state.lineGlyphViews?.clear();
  }

  /** Each character's `getLineGlyphs` values; a constant when no label is placed along a line. */
  protected calculateInstanceLineGlyphs(
    attribute: Attribute,
    {startRow, endRow}: {startRow: number; endRow: number}
  ): void {
    const {getLineGlyphs, getLineGlyphKey} = this.props as any;
    if (!getLineGlyphs) {
      this.forgetViewLineGlyphs();
      setConstant(attribute);
      return;
    }
    // The rows changed: every view's glyphs are placed again as it is drawn.
    this.state.lineGlyphRevision = (this.state.lineGlyphRevision ?? 0) + 1;
    const {viewport} = this.context;
    const id = getViewId(viewport);
    const key = getLineGlyphKey?.(viewport) ?? null;
    const held = this.state.lineGlyphView;
    // Rows left as they were hold the glyphs of the view and key the attribute held.
    const allRows = startRow <= 0 && !Number.isFinite(endRow);
    this.state.lineGlyphView = {
      id,
      key: allRows || (held?.id === id && held.key === key) ? key : null
    };
    this.fillLineGlyphs(attribute, startRow, endRow);
  }

  /**
   * Writes the `getLineGlyphs` values of rows `startRow` to `endRow` at the current viewport, into
   * `output`, laid out as the attribute: by default, its value.
   */
  fillLineGlyphs(
    attribute: Attribute,
    startRow: number,
    endRow: number,
    output = attribute.value as Float32Array
  ): void {
    const {data, getIcon, getLineGlyphs} = this.props as any;
    const {viewport} = this.context;
    const {iterable, objectInfo} = createIterable(data, startRow, endRow);
    for (const object of iterable) {
      objectInfo.index++;
      // A row's characters, as `TextLayer` counts them; a row left out of this layer has none.
      const start = attribute.getVertexOffset(objectInfo.index);
      const end = attribute.getVertexOffset(objectInfo.index + 1);
      if (end <= start || !getIcon(object, objectInfo)) {
        continue;
      }
      const glyphs = getLineGlyphs(object, viewport) as Float32Array | null;
      if (glyphs && glyphs.length === end - start) {
        output.set(glyphs, start);
      } else {
        output.fill(0, start, end);
      }
      LINE_GLYPH_ATTRIBUTE_STATS.fills++;
      LINE_GLYPH_ATTRIBUTE_STATS.bytes += (end - start) * 4;
    }
  }

  /**
   * Each character's advance centre in the label, in font atlas pixels, about which a glyph along a
   * line turns: its offset in the label, less its frame's anchor, plus half its advance.
   */
  protected calculateInstanceGlyphCentres(
    attribute: Attribute,
    {startRow, endRow}: {startRow: number; endRow: number}
  ): void {
    const {data, getIcon, getIconOffsets, getLineGlyphs, iconMapping} = this.props as any;
    if (!getLineGlyphs) {
      setConstant(attribute);
      return;
    }
    const output = attribute.value as Float32Array;
    const {iterable, objectInfo} = createIterable(data, startRow, endRow);
    for (const object of iterable) {
      objectInfo.index++;
      const text = getIcon(object, objectInfo) as string;
      if (!text) {
        continue;
      }
      const offsets = getIconOffsets(object, objectInfo) as number[];
      let i = attribute.getVertexOffset(objectInfo.index);
      let j = 0;
      for (const character of Array.from(text)) {
        const frame = iconMapping?.[character];
        output[i++] = frame
          ? offsets[j * 2] - (frame.anchorX ?? 0) + (frame.advance ?? 0) / 2
          : offsets[j * 2];
        j++;
      }
    }
  }

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
 * Glyph attribute work for benchmarks: rows filled and bytes written from `getLineGlyphs`, and
 * refreshes of the whole attribute when the view crosses a zoom or bearing step.
 */
export const LINE_GLYPH_ATTRIBUTE_STATS = {fills: 0, bytes: 0, refreshes: 0};

/** The id of the view `viewport` draws, by which a layer keeps each view's glyphs along lines. */
function getViewId(viewport: any): string {
  return String(viewport?.id ?? '');
}

/** Makes an attribute with a custom updater a constant zero. */
function setConstant(attribute: Attribute): void {
  (attribute as any).constant = true;
  attribute.value = new Float32Array(attribute.size);
}

/**
 * Mip levels of the font atlas texture: the atlas and one of half its size. A label atlas is drawn
 * at 64 px per em and labels at 10 to 16 px, 4 to 6 times smaller at device pixel ratio 1, where a
 * full mip chain samples levels of 16 or 8 px per em: averaging the distance field over that many
 * atlas pixels thins and blurs strokes unevenly. MapLibre GL JS samples its 24 px glyphs without
 * mipmaps. The half-size level keeps the minification at most 2 to 3 times, as MapLibre's.
 */
const LABEL_ATLAS_MIP_LEVELS = 2;

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

  initializeState(): void {
    super.initializeState();
    // deck.gl caches font atlases by their font and settings, not by the renderer that draws their
    // glyphs: a TextLayer with the same font and settings would share glyphs drawn without their
    // overhang (see `getLabelFontRenderer`). The atlases of label layers have keys of their own.
    const manager = this.state.fontAtlasManager as any;
    const getKey = manager._getKey.bind(manager);
    manager._getKey = () => `${getKey()} ${LABEL_ATLAS_KEY}`;
  }

  renderLayers(): any {
    const {atlas} = this.state.fontAtlasManager;
    const {device} = this.context;
    if (atlas && device) {
      let {atlasTextures} = this.state;
      if (!atlasTextures) {
        atlasTextures = new SharedTextureSet(device, {maxMipLevels: LABEL_ATLAS_MIP_LEVELS});
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

  /**
   * The glyph layer's props, with the shared texture in place of the atlas canvas, and the row's
   * placement slot (see `LabelPlacementExtension`).
   */
  getSubLayerProps(sublayerProps: any = {}): any {
    const props = super.getSubLayerProps(sublayerProps);
    if (sublayerProps.id === 'characters' && this.state.atlasTexture) {
      props.iconAtlas = this.state.atlasTexture;
    }
    // The placement slot is a row's, and the sublayers draw this layer's rows: it is handed down
    // as is. deck.gl would otherwise call it with the feature a row was made from.
    const {getPlacementSlot, getLineGlyphs, getLineGlyphKey, updateTriggers} = this.props as any;
    if (typeof getPlacementSlot === 'function') {
      props.getPlacementSlot = getPlacementSlot;
    }
    // Glyphs along lines are the characters' only: handed down with their trigger.
    if (sublayerProps.id === 'characters') {
      props.getLineGlyphs = getLineGlyphs || null;
      props.getLineGlyphKey = getLineGlyphKey || null;
      props.updateTriggers = {
        ...props.updateTriggers,
        getLineGlyphs: updateTriggers?.getLineGlyphs
      };
    }
    // The background box stays straight, about the anchor, where glyphs along a line may not be:
    // it would pick empty space beside a bend. The glyphs pick their labels.
    if (sublayerProps.id === 'background' && typeof getLineGlyphs === 'function') {
      props.pickable = false;
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

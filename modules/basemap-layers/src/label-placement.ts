// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {LayerExtension} from '@deck.gl/core';
import type {Layer, Viewport} from '@deck.gl/core';
import type {Device, Texture} from '@luma.gl/core';
import {GridIndex, type OverlapMode} from './grid-index';

/**
 * Pixels around the viewport in which symbols are placed, so that a symbol just outside it still
 * hides those it would overlap when it comes in: MapLibre GL JS's `viewportPadding`.
 */
export const PLACEMENT_VIEWPORT_PADDING = 100;

/** The grid's cell size in pixels, as MapLibre GL JS's collision index. */
const PLACEMENT_CELL_SIZE = 25;

/**
 * Milliseconds between two placements while the view keeps changing, as MapLibre GL JS's default
 * `fadeDuration`. The view the map comes to rest in is always placed.
 */
export const DEFAULT_PLACEMENT_INTERVAL = 300;

/**
 * A symbol part's collision shape in grid pixels (screen pixels moved by
 * `PLACEMENT_VIEWPORT_PADDING`): a box `[x1, y1, x2, y2]`, or circles `[x, y, radius, ...]` for
 * text along a line.
 */
export type PlacementShape =
  | {box: number[]; circles?: undefined}
  | {circles: number[]; box?: undefined};

/** One symbol to place: the slot its visibility is written to, and its parts' shapes. */
export type PlacementSymbol = {
  slot: number;
  /** `null` when the symbol draws no text. */
  text: PlacementShape | null;
  /** `null` when the symbol draws no icon. */
  icon: PlacementShape | null;
  /** Hidden whatever its collisions: beyond a globe's horizon. */
  occluded?: boolean;
};

/** A symbol style layer's placement rules, from its layout, as MapLibre GL JS reads them. */
export type SymbolPlacementRules = {
  textOverlap: OverlapMode;
  iconOverlap: OverlapMode;
  textIgnorePlacement: boolean;
  iconIgnorePlacement: boolean;
  textOptional: boolean;
  iconOptional: boolean;
  /** Whether the layer draws any text, and any icon (MapLibre's `hasTextData`/`hasIconData`). */
  hasTextData: boolean;
  hasIconData: boolean;
};

/** Visibility bits of a placed symbol. */
export const TEXT_VISIBLE = 1;
export const ICON_VISIBLE = 2;

function isPlaceable(grid: GridIndex, shape: PlacementShape, mode: OverlapMode): boolean {
  if (shape.box) {
    const [x1, y1, x2, y2] = shape.box;
    return (
      grid.isInside(x1, y1, x2, y2) && (mode === 'always' || !grid.hitTest(x1, y1, x2, y2, mode))
    );
  }
  const {circles} = shape;
  let inside = false;
  for (let i = 0; i < circles.length; i += 3) {
    const [x, y, r] = [circles[i], circles[i + 1], circles[i + 2]];
    inside ||= grid.isInside(x - r, y - r, x + r, y + r);
    if (mode !== 'always' && grid.hitTestCircle(x, y, r, mode)) {
      return false;
    }
  }
  return inside;
}

function insertShape(grid: GridIndex, shape: PlacementShape, mode: OverlapMode): void {
  if (shape.box) {
    const [x1, y1, x2, y2] = shape.box;
    grid.insert(x1, y1, x2, y2, mode);
    return;
  }
  const {circles} = shape;
  for (let i = 0; i < circles.length; i += 3) {
    grid.insertCircle(circles[i], circles[i + 1], circles[i + 2], mode);
  }
}

/**
 * Places one symbol in `grid`, as MapLibre GL JS's `Placement.placeLayerBucketPart` places a
 * symbol instance: each part is placeable where it lies in the grid and overlaps nothing it may not
 * overlap; a part that is not optional is placed only with the other part; placed parts are added
 * to the grid unless they ignore placement. Returns the visibility bits (`TEXT_VISIBLE`,
 * `ICON_VISIBLE`). A part that always overlaps, of a symbol whose other part does too or is
 * optional or absent, is shown even outside the grid (MapLibre's `alwaysShowText`/`Icon`).
 */
export function placeSymbol(
  grid: GridIndex,
  symbol: PlacementSymbol,
  rules: SymbolPlacementRules
): number {
  // Beyond the horizon: neither drawn nor in the way of the symbols placed after it.
  if (symbol.occluded) {
    return 0;
  }
  const {text, icon} = symbol;
  let placeText = Boolean(text) && isPlaceable(grid, text!, rules.textOverlap);
  let placeIcon = Boolean(icon) && isPlaceable(grid, icon!, rules.iconOverlap);

  const iconWithoutText = rules.textOptional || !text;
  const textWithoutIcon = rules.iconOptional || !icon;
  if (!iconWithoutText && !textWithoutIcon) {
    placeIcon = placeText = placeIcon && placeText;
  } else if (!textWithoutIcon) {
    placeText = placeIcon && placeText;
  } else if (!iconWithoutText) {
    placeIcon = placeIcon && placeText;
  }

  if (placeText && !rules.textIgnorePlacement) {
    insertShape(grid, text!, rules.textOverlap);
  }
  if (placeIcon && !rules.iconIgnorePlacement) {
    insertShape(grid, icon!, rules.iconOverlap);
  }

  const textAlways = rules.textOverlap === 'always';
  const iconAlways = rules.iconOverlap === 'always';
  const alwaysShowText = textAlways && (iconAlways || !rules.hasIconData || rules.iconOptional);
  const alwaysShowIcon = iconAlways && (textAlways || !rules.hasTextData || rules.textOptional);
  return (
    (placeText || (alwaysShowText && Boolean(text)) ? TEXT_VISIBLE : 0) |
    (placeIcon || (alwaysShowIcon && Boolean(icon)) ? ICON_VISIBLE : 0)
  );
}

/** A label layer that takes part in placement (`MVTLabelLayer`). */
export interface PlacementLayer {
  /**
   * The layer's place in the style: layers with a higher order are placed first, as MapLibre GL
   * JS places style layers from the top down.
   */
  getPlacementOrder(): number;
  /** A value that changes whenever what the layer would place changes, other than the view. */
  getPlacementRevision(): number;
  /** The number of slots the layer's symbols use, `0..count-1` from its slot base. */
  getPlacementSlotCount(): number;
  /**
   * Whether the layer is drawn in `viewport`: a hidden layer, or one of another view, has no say
   * in what is placed there.
   */
  isDrawnIn(viewport: Viewport): boolean;
  /** Appends the layer's symbols in its placement order, for `viewport`, to `out`. */
  getPlacementSymbols(
    viewport: Viewport,
    slotBase: number,
    out: PlacementSymbol[]
  ): SymbolPlacementRules | null;
  /** Requests another frame, while a placement waits for the throttle. */
  setNeedsRedraw(): void;
  /** Requests an update, after which the layer reads its slot base again (`getSlotBase`). */
  setNeedsUpdate(): void;
}

/** The placement of one viewport (one view of the deck). */
type ViewPlacement = {
  /** Four bytes per slot (an RGBA texel): text, then icon visibility (0 or 255). */
  values: Uint8Array;
  texture: Texture | null;
  /** Whether `values` changed since they were written to the texture. */
  dirty: boolean;
  viewport: Viewport | null;
  revision: string;
  placedAt: number;
  /** The frame being drawn, and the viewports of it and of the frame before. */
  frame: number;
  frameViewport: Viewport | null;
  lastViewport: Viewport | null;
};

/** The width of the visibility textures, in slots. */
const TEXTURE_WIDTH = 1024;

/**
 * Places the symbols of every registered label layer together, as MapLibre GL JS's `Placement`:
 * greedily, style layers from the top down, each against the symbols placed before it in a grid
 * over the viewport. Each symbol's text and icon visibility is written to a texture that the label
 * sublayers read (`LabelPlacementExtension`), one per viewport id. Placement runs from the label
 * sublayers' draw: at most every `interval` ms while the view keeps moving, and at once when the
 * view is at rest and the labels or the view changed since the last placement.
 */
export class LabelPlacement {
  interval = DEFAULT_PLACEMENT_INTERVAL;
  private readonly layers = new Map<PlacementLayer, {base: number; count: number}>();
  private readonly views = new Map<string, ViewPlacement>();
  private capacity = 0;
  private next = 0;
  /** Changes when a layer joins, leaves or moves its slots. */
  private version = 0;
  private readonly symbols: PlacementSymbol[] = [];

  /** Adds a layer, or updates its slot count; returns its slot base. */
  register(layer: PlacementLayer): number {
    const count = layer.getPlacementSlotCount();
    const entry = this.layers.get(layer);
    if (entry && entry.count >= count) {
      entry.count = count;
      return entry.base;
    }
    if (this.next + count > this.capacity) {
      this.compact(count);
    }
    const base = this.next;
    this.next += count;
    this.layers.set(layer, {base, count});
    this.version++;
    return base;
  }

  unregister(layer: PlacementLayer): void {
    if (this.layers.delete(layer)) {
      this.version++;
    }
  }

  /** The slot base of a registered layer, or -1. */
  getSlotBase(layer: PlacementLayer): number {
    return this.layers.get(layer)?.base ?? -1;
  }

  /** The slots of every layer packed again from 0, with room for `extra` more. */
  private compact(extra: number): void {
    let next = 0;
    for (const [layer, entry] of this.layers) {
      if (entry.base !== next) {
        entry.base = next;
        layer.setNeedsUpdate();
      }
      next += entry.count;
    }
    this.next = next;
    let capacity = Math.max(this.capacity, TEXTURE_WIDTH);
    while (capacity < next + extra) {
      capacity *= 2;
    }
    if (capacity !== this.capacity) {
      this.capacity = capacity;
      for (const view of this.views.values()) {
        view.texture?.destroy();
        view.texture = null;
        view.values = new Uint8Array(capacity * 4);
        view.revision = '';
      }
    }
    this.version++;
  }

  private getView(viewport: Viewport): ViewPlacement {
    let view = this.views.get(viewport.id);
    if (!view) {
      view = {
        values: new Uint8Array(Math.max(this.capacity, TEXTURE_WIDTH) * 4),
        texture: null,
        dirty: true,
        viewport: null,
        revision: '',
        placedAt: Number.NEGATIVE_INFINITY,
        frame: Number.NaN,
        frameViewport: null,
        lastViewport: null
      };
      this.views.set(viewport.id, view);
    }
    return view;
  }

  /**
   * The visibility texture for `viewport`, placing first when a placement is due. `frame` names the
   * frame being drawn (deck.gl's timeline time; each call is a frame of its own without it): the
   * label sublayers of a frame all draw with the placement decided at its first one. Picking passes
   * read the last placement and never place.
   */
  prepare(
    device: Device,
    viewport: Viewport,
    isPicking: boolean,
    now: number,
    frame: number = now
  ): Texture {
    const view = this.getView(viewport);
    if (!isPicking && frame !== view.frame) {
      view.frame = frame;
      view.lastViewport = view.frameViewport;
      view.frameViewport = viewport;
      const revision = this.getRevision();
      const changed =
        revision !== view.revision || !view.viewport || !view.viewport.equals(viewport);
      // A view at rest (the same as at the frame before) is placed at once; a moving one at most
      // every `interval`, as MapLibre places while the map moves.
      const resting = Boolean(view.lastViewport?.equals(viewport));
      if (changed) {
        if (resting || now - view.placedAt >= this.interval) {
          this.place(view, viewport, revision, now);
        } else {
          // Another frame, so that the view is placed once it rests.
          for (const layer of this.layers.keys()) {
            layer.setNeedsRedraw();
            break;
          }
        }
      }
    }
    return this.getTexture(device, view);
  }

  private getRevision(): string {
    let revision = `${this.version}`;
    for (const layer of this.layers.keys()) {
      revision += `|${layer.getPlacementRevision()}`;
    }
    return revision;
  }

  private getTexture(device: Device, view: ViewPlacement): Texture {
    const height = view.values.length / 4 / TEXTURE_WIDTH;
    if (view.texture?.device !== device || view.texture.height !== height) {
      view.texture?.destroy();
      view.texture = device.createTexture({
        format: 'rgba8unorm',
        width: TEXTURE_WIDTH,
        height,
        mipLevels: 1,
        sampler: {minFilter: 'nearest', magFilter: 'nearest'}
      });
      view.dirty = true;
    }
    if (view.dirty) {
      view.texture.writeData(view.values);
      view.dirty = false;
    }
    return view.texture;
  }

  /** Places every registered layer's symbols for `viewport`. */
  private place(view: ViewPlacement, viewport: Viewport, revision: string, now: number): void {
    const padding = PLACEMENT_VIEWPORT_PADDING;
    const grid = new GridIndex(
      viewport.width + 2 * padding,
      viewport.height + 2 * padding,
      PLACEMENT_CELL_SIZE
    );
    view.values.fill(0);
    const layers = [...this.layers.entries()].sort(
      ([a], [b]) => b.getPlacementOrder() - a.getPlacementOrder()
    );
    const symbols = this.symbols;
    for (const [layer, {base}] of layers) {
      if (!layer.isDrawnIn(viewport)) {
        continue;
      }
      symbols.length = 0;
      const rules = layer.getPlacementSymbols(viewport, base, symbols);
      if (!rules) {
        continue;
      }
      for (const symbol of symbols) {
        const bits = placeSymbol(grid, symbol, rules);
        view.values[symbol.slot * 4] = bits & TEXT_VISIBLE ? 255 : 0;
        view.values[symbol.slot * 4 + 1] = bits & ICON_VISIBLE ? 255 : 0;
      }
    }
    symbols.length = 0;
    view.viewport = viewport;
    view.revision = revision;
    view.placedAt = now;
    view.dirty = true;
  }

  /** Releases the textures. */
  destroy(): void {
    for (const view of this.views.values()) {
      view.texture?.destroy();
    }
    this.views.clear();
  }
}

/** Props that `LabelPlacementExtension` adds to a label sublayer. */
export type LabelPlacementExtensionProps = {
  /** The placement that decides which symbols are drawn; all are drawn without it. */
  labelPlacement?: LabelPlacement | null;
  /** The slot of each object; a negative slot is always drawn. */
  getPlacementSlot?: (object: any, info: {index: number}) => number;
  /** Which visibility the sublayer draws by: its symbols' text (0) or icons (1). */
  placementPart?: 0 | 1;
};

const placementModule = {
  name: 'labelPlacement',
  vs: /* glsl */ `\
uniform highp sampler2D labelPlacementTexture;
layout(std140) uniform labelPlacementUniforms {
  float part;
} labelPlacement;
`,
  uniformTypes: {part: 'f32'}
} as const;

const PLACEMENT_INJECTION = {
  'vs:#decl': /* glsl */ `
in float instancePlacementSlots;
`,
  'vs:DECKGL_FILTER_GL_POSITION': /* glsl */ `
  if (instancePlacementSlots >= 0.0) {
    int labelPlacement_slot = int(instancePlacementSlots + 0.5);
    vec2 labelPlacement_value = texelFetch(
      labelPlacementTexture,
      ivec2(labelPlacement_slot % ${TEXTURE_WIDTH}, labelPlacement_slot / ${TEXTURE_WIDTH}),
      0
    ).rg;
    float labelPlacement_visible = labelPlacement.part < 0.5
      ? labelPlacement_value.r
      : labelPlacement_value.g;
    if (labelPlacement_visible < 0.5) {
      // Every vertex of the quad lands beyond the far plane, so it is clipped.
      position = vec4(0.0, 0.0, 2.0, 1.0);
    }
  }
`
};

/** The texture last handed to each model's shaders. */
const boundTextures = new WeakMap<object, Texture>();

/**
 * Draws a label sublayer's objects only where `labelPlacement` placed their part (text or icon):
 * each object's slot is an attribute (`getPlacementSlot`), and the vertex shader reads its
 * visibility from the placement's texture for the viewport being drawn. Added to a composite layer
 * such as `TextLayer`, it reaches the character and background sublayers, so a hidden label is
 * neither drawn nor picked. WebGL only.
 */
export class LabelPlacementExtension extends LayerExtension {
  static extensionName = 'LabelPlacementExtension';
  static defaultProps = {
    labelPlacement: {type: 'object', value: null, compare: false},
    getPlacementSlot: {type: 'accessor', value: -1},
    placementPart: 0
  };

  isEnabled(layer: Layer): boolean {
    return layer.context.device.type !== 'webgpu' && layer.getAttributeManager() !== null;
  }

  getShaders(this: Layer<LabelPlacementExtensionProps>, extension: this): any {
    if (!extension.isEnabled(this)) {
      return null;
    }
    return {modules: [placementModule], inject: PLACEMENT_INJECTION};
  }

  initializeState(this: Layer<LabelPlacementExtensionProps>, context: any, extension: this) {
    if (!extension.isEnabled(this)) {
      return;
    }
    this.getAttributeManager()!.add({
      instancePlacementSlots: {
        size: 1,
        stepMode: 'dynamic',
        accessor: 'getPlacementSlot',
        defaultValue: -1
      }
    });
  }

  updateState(this: Layer<LabelPlacementExtensionProps>, params: any, extension: this) {
    if (!extension.isEnabled(this)) {
      return;
    }
    this.setShaderModuleProps({labelPlacement: {part: this.props.placementPart || 0}} as any);
  }

  draw(this: Layer<LabelPlacementExtensionProps>, params: any, extension: this) {
    const {labelPlacement} = this.props;
    const {device, viewport} = this.context;
    if (!labelPlacement || !viewport || !extension.isEnabled(this)) {
      return;
    }
    const isPicking = Boolean(params?.shaderModuleProps?.picking?.isActive);
    const now = performance.now();
    // The timeline's time is set once per frame by deck.gl's animation loop.
    const frame = this.context.timeline?.getTime();
    const texture = labelPlacement.prepare(device, viewport, isPicking, now, frame ?? now);
    const models = this.getModels();
    if (models.some(model => boundTextures.get(model) !== texture)) {
      this.setShaderModuleProps({labelPlacement: {labelPlacementTexture: texture}} as any);
      for (const model of models) {
        boundTextures.set(model, texture);
      }
    }
  }
}

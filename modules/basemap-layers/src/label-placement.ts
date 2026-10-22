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
  /**
   * Its icon is still loading. Unless the icon is optional, the symbol is not placed until it has
   * loaded, as MapLibre GL JS lays out no symbol until its images have loaded: its text, placed
   * alone, would hide when the icon arrives and collides.
   */
  iconPending?: boolean;
  /**
   * With `text-variable-anchor`: the text's shape at each of its anchors, in the order they are
   * tried, and the slot whose text is drawn at each. `text` is the first one's shape, and `key`
   * names the symbol across placements, so that it keeps the anchor it was placed at while that
   * still fits, as in MapLibre GL JS.
   */
  textAnchors?: {shapes: PlacementShape[]; slots: number[]; key: object};
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
/** `placeSymbol` returns the index of the anchor its text is placed at above the visibility bits. */
export const ANCHOR_SHIFT = 2;

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
 * The anchor that text with `text-variable-anchor` is placed at, as MapLibre GL JS's
 * `placeBoxForVariableAnchors`: the anchor it was placed at before while it still fits, else the
 * first anchor where it overlaps nothing, else, when the text may overlap, the first anchor where
 * it may be placed so. Returns the anchor's index, or -1 when it fits at none.
 */
function getTextAnchor(
  grid: GridIndex,
  shapes: PlacementShape[],
  overlap: OverlapMode,
  previous: number
): number {
  if (previous >= 0 && previous < shapes.length && isPlaceable(grid, shapes[previous], 'never')) {
    return previous;
  }
  const modes: OverlapMode[] = overlap === 'never' ? ['never'] : ['never', overlap];
  for (const mode of modes) {
    for (let index = 0; index < shapes.length; index++) {
      if (isPlaceable(grid, shapes[index], mode)) {
        return index;
      }
    }
  }
  return -1;
}

/**
 * Places one symbol in `grid`, as MapLibre GL JS's `Placement.placeLayerBucketPart` places a
 * symbol instance: each part is placeable where it lies in the grid and overlaps nothing it may not
 * overlap; a part that is not optional is placed only with the other part; placed parts are added
 * to the grid unless they ignore placement. Text with variable anchors is placed at the first of
 * them where it fits (see `getTextAnchor`); its icon stays where it is. Returns the visibility bits
 * (`TEXT_VISIBLE`, `ICON_VISIBLE`), and the index of the text's anchor shifted by `ANCHOR_SHIFT`.
 * A part that always overlaps, of a symbol whose other part does too or is optional or absent, is
 * shown even outside the grid (MapLibre's `alwaysShowText`/`Icon`).
 */
export function placeSymbol(
  grid: GridIndex,
  symbol: PlacementSymbol,
  rules: SymbolPlacementRules,
  previousAnchor = -1
): number {
  // Beyond the horizon, or waiting for its icon: neither drawn nor in the way of the symbols placed
  // after it.
  if (symbol.occluded || (symbol.iconPending && !rules.iconOptional)) {
    return 0;
  }
  const {icon, textAnchors} = symbol;
  let {text} = symbol;
  let anchor = 0;
  let placeText: boolean;
  if (text && textAnchors && textAnchors.shapes.length > 1) {
    const index = getTextAnchor(grid, textAnchors.shapes, rules.textOverlap, previousAnchor);
    placeText = index >= 0;
    anchor = Math.max(index, 0);
    text = textAnchors.shapes[anchor];
  } else {
    placeText = Boolean(text) && isPlaceable(grid, text!, rules.textOverlap);
  }
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
    (placeIcon || (alwaysShowIcon && Boolean(icon)) ? ICON_VISIBLE : 0) |
    (anchor << ANCHOR_SHIFT)
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
  /**
   * A value that changes whenever the layer's symbols take other slots from its slot base, as when
   * its rows change: the placement made before then holds the visibility of other symbols in
   * those slots, or of none, so the layer is placed again at once, whether or not the view moves.
   */
  getPlacementSlotRevision(): number;
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
  /**
   * The deck layer the layer is drawn under (its topmost parent, or itself), and the deck's layers
   * in draw order. Of two layers under different deck layers, the one under the later deck layer
   * is placed first, as MapLibre GL JS places the layers drawn over others first; the placement
   * order decides only between layers under the same deck layer. Without it, the layer is placed
   * by its placement order alone, after the layers that give one. Deck layers are told apart by
   * their ids, which deck.gl keeps when it makes a new instance of a layer.
   */
  getPlacementRoot?(): {root: {id: string}; layers: readonly PlacementDeckLayer[]} | null;
}

/** What placement reads of a deck's layers (see `PlacementLayer.getPlacementRoot`). */
export type PlacementDeckLayer = {id: string; parent?: unknown};

/** What a placement reads of a registered layer at a frame, for one viewport. */
type PlacementLayerState = {
  layer: PlacementLayer;
  base: number;
  /** Whether the layer is drawn in the viewport. */
  drawn: boolean;
  /** The index of its deck layer among the deck's layers, or -1 (see `getPlacementRoot`). */
  rootIndex: number;
};

/** The placement of one viewport (one view of the deck). */
type ViewPlacement = {
  /** Four bytes per slot (an RGBA texel): text, then icon visibility (0 or 255). */
  values: Uint8Array;
  texture: Texture | null;
  /** Whether `values` changed since they were written to the texture. */
  dirty: boolean;
  viewport: Viewport | null;
  revision: string;
  /** The slots the placement was made for (see `getSlotLayout`). */
  slotLayout: string;
  placedAt: number;
  /** The frame being drawn, and the viewports of it and of the frame before. */
  frame: number;
  frameViewport: Viewport | null;
  lastViewport: Viewport | null;
  /** The anchor each symbol with variable anchors had its text placed at (see `textAnchors`). */
  anchors: WeakMap<object, number>;
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
  /** Each layer's slots, and the allocation that gave them (see `getSlotLayout`). */
  private readonly layers = new Map<
    PlacementLayer,
    {base: number; count: number; allocation: number}
  >();
  private readonly views = new Map<string, ViewPlacement>();
  private capacity = 0;
  /** Counts the slot allocations made. */
  private allocations = 0;
  /** Changes when a layer joins, leaves or moves its slots. */
  private version = 0;
  private readonly symbols: PlacementSymbol[] = [];
  /** Each layer's state at the frame being placed, in registration order (see `getRevision`). */
  private readonly states: PlacementLayerState[] = [];
  /** The index of each top-level deck layer, by id, in the deck's layers last read. */
  private rootIndices: {layers: readonly PlacementDeckLayer[] | null; byId: Map<string, number>} = {
    layers: null,
    byId: new Map()
  };

  /**
   * Adds a layer, or updates its slot count; returns its slot base. A layer that needs more slots
   * than it has takes the first free ones that are enough, and gives up its own. No other layer
   * moves: each draws from the slots it read at its last update, until it updates again.
   */
  register(layer: PlacementLayer): number {
    const count = layer.getPlacementSlotCount();
    const entry = this.layers.get(layer);
    if (entry && entry.count >= count) {
      entry.count = count;
      return entry.base;
    }
    const base = this.allocate(count, layer);
    const allocation = ++this.allocations;
    if (entry) {
      // Updated in place, so that the layer keeps its place among layers of the same order.
      entry.base = base;
      entry.count = count;
      entry.allocation = allocation;
    } else {
      this.layers.set(layer, {base, count, allocation});
    }
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

  /**
   * The first `count` slots that no layer but `growing` uses, past the last layer's slots when no
   * gap between them is enough. The textures grow to hold them, keeping every slot's visibility.
   */
  private allocate(count: number, growing: PlacementLayer): number {
    const used = [...this.layers]
      .filter(([layer]) => layer !== growing)
      .map(([, {base, count: length}]) => [base, base + length])
      .sort((a, b) => a[0] - b[0]);
    let base = 0;
    for (const [start, end] of used) {
      if (start - base >= count) {
        break;
      }
      base = Math.max(base, end);
    }
    let capacity = Math.max(this.capacity, TEXTURE_WIDTH);
    while (capacity < base + count) {
      capacity *= 2;
    }
    if (capacity !== this.capacity) {
      this.capacity = capacity;
      for (const view of this.views.values()) {
        const values = new Uint8Array(capacity * 4);
        values.set(view.values);
        view.values = values;
        view.dirty = true;
      }
    }
    return base;
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
        slotLayout: '',
        placedAt: Number.NEGATIVE_INFINITY,
        frame: Number.NaN,
        frameViewport: null,
        lastViewport: null,
        anchors: new WeakMap()
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
      const revision = this.getRevision(viewport);
      const slotLayout = this.getSlotLayout();
      const changed =
        revision !== view.revision || !view.viewport || !view.viewport.equals(viewport);
      // A view at rest (the same as at the frame before) is placed at once; a moving one at most
      // every `interval`, as MapLibre places while the map moves. Symbols in other slots than at
      // the last placement are placed at once, whether the view moves or not: their slots hold
      // the visibility of other symbols, or of none.
      const resting = Boolean(view.lastViewport?.equals(viewport));
      if (changed) {
        if (resting || slotLayout !== view.slotLayout || now - view.placedAt >= this.interval) {
          this.place(view, viewport, revision, slotLayout, now);
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

  /**
   * A value that changes whenever what would be placed in `viewport` changes, other than the view:
   * a layer joins or leaves, its symbols change, it is drawn in the viewport or no longer is, or
   * its deck layer moves among the deck's layers. Reads each layer's state for `place`.
   */
  private getRevision(viewport: Viewport): string {
    let revision = `${this.version}`;
    const states = this.states;
    states.length = 0;
    for (const [layer, {base}] of this.layers) {
      const drawn = layer.isDrawnIn(viewport);
      const rootIndex = this.getRootIndex(layer);
      states.push({layer, base, drawn, rootIndex});
      revision += `|${layer.getPlacementRevision()}:${drawn ? rootIndex : 'hidden'}`;
    }
    return revision;
  }

  /** The index of a layer's deck layer among the deck's layers, or -1. */
  private getRootIndex(layer: PlacementLayer): number {
    const placementRoot = layer.getPlacementRoot?.();
    if (!placementRoot) {
      return -1;
    }
    // The deck's layers are indexed again only when deck.gl gives it new ones.
    if (placementRoot.layers !== this.rootIndices.layers) {
      const byId = new Map<string, number>();
      placementRoot.layers.forEach((deckLayer, index) => {
        if (!deckLayer.parent) {
          byId.set(deckLayer.id, index);
        }
      });
      this.rootIndices = {layers: placementRoot.layers, byId};
    }
    return this.rootIndices.byId.get(placementRoot.root.id) ?? -1;
  }

  /**
   * A value that changes whenever a layer's symbols take other slots: the layer is given new ones,
   * by an allocation of its own (a layer that takes the slots another left has another), or its
   * rows change.
   */
  private getSlotLayout(): string {
    let layout = '';
    for (const [layer, {allocation}] of this.layers) {
      layout += `|${allocation}:${layer.getPlacementSlotRevision()}`;
    }
    return layout;
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
  private place(
    view: ViewPlacement,
    viewport: Viewport,
    revision: string,
    slotLayout: string,
    now: number
  ): void {
    const padding = PLACEMENT_VIEWPORT_PADDING;
    const grid = new GridIndex(
      viewport.width + 2 * padding,
      viewport.height + 2 * padding,
      PLACEMENT_CELL_SIZE
    );
    view.values.fill(0);
    const symbols = this.symbols;
    const previousAnchors = view.anchors;
    const anchors = new WeakMap<object, number>();
    for (const {layer, base} of this.getPlacementOrder()) {
      symbols.length = 0;
      const rules = layer.getPlacementSymbols(viewport, base, symbols);
      if (!rules) {
        continue;
      }
      for (const symbol of symbols) {
        const {textAnchors} = symbol;
        const previous = textAnchors ? (previousAnchors.get(textAnchors.key) ?? -1) : -1;
        const bits = placeSymbol(grid, symbol, rules, previous);
        // Text with variable anchors is drawn from the slot of the anchor it is placed at; the
        // slots of its other anchors stay hidden.
        const anchor = bits >> ANCHOR_SHIFT;
        const textSlot = textAnchors ? textAnchors.slots[anchor] : symbol.slot;
        view.values[textSlot * 4] = bits & TEXT_VISIBLE ? 255 : 0;
        view.values[symbol.slot * 4 + 1] = bits & ICON_VISIBLE ? 255 : 0;
        if (textAnchors && bits & TEXT_VISIBLE) {
          anchors.set(textAnchors.key, anchor);
        }
      }
    }
    view.anchors = anchors;
    symbols.length = 0;
    view.viewport = viewport;
    view.revision = revision;
    view.slotLayout = slotLayout;
    view.placedAt = now;
    view.dirty = true;
  }

  /**
   * The layers drawn in the viewport of the last `getRevision`, in the order they are placed: under
   * the later deck layer first, then by placement order, highest first (see
   * `PlacementLayer.getPlacementRoot`). Layers that tie keep the order they registered in.
   */
  private getPlacementOrder(): PlacementLayerState[] {
    return this.states
      .filter(state => state.drawn)
      .map(state => ({state, order: state.layer.getPlacementOrder()}))
      .sort((a, b) => b.state.rootIndex - a.state.rootIndex || b.order - a.order)
      .map(({state}) => state);
  }

  /** Releases the textures. */
  destroy(): void {
    for (const view of this.views.values()) {
      view.texture?.destroy();
    }
    this.views.clear();
    this.states.length = 0;
    this.rootIndices = {layers: null, byId: new Map()};
  }
}

/** The placement shared by the label layers of each deck, and how many users it has. */
const sharedPlacements = new WeakMap<object, {placement: LabelPlacement; users: number}>();

/**
 * Takes a use of the placement shared by the label layers of the deck that `key` names (its layer
 * manager), made at the first use. Each use is given back with `releaseSharedLabelPlacement`.
 */
export function acquireSharedLabelPlacement(key: object): LabelPlacement {
  let shared = sharedPlacements.get(key);
  if (!shared) {
    shared = {placement: new LabelPlacement(), users: 0};
    sharedPlacements.set(key, shared);
  }
  shared.users++;
  return shared.placement;
}

/** Gives back a use of a deck's shared placement, which is released with its last use. */
export function releaseSharedLabelPlacement(key: object | null | undefined): void {
  const shared = key && sharedPlacements.get(key);
  if (shared && --shared.users === 0) {
    shared.placement.destroy();
    sharedPlacements.delete(key);
  }
}

/** The key of the shared placement of a layer's deck: its layer manager. */
export function getSharedLabelPlacementKey(layer: {context?: unknown}): object {
  const context = layer.context as {layerManager?: object} | undefined;
  return context?.layerManager || context || layer;
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

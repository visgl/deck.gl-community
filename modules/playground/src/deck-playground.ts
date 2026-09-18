// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, type DeckProps, type PickingInfo} from '@deck.gl/core';
import {Playground, type PlaygroundProps, type PlaygroundRenderer} from './playground';
import {createPlaygroundResolver} from './runtime/playground-resolver';
import type {PlaygroundBindings, PlaygroundRegistry} from './runtime/playground-registry';

const DEFAULT_VIEW_STATE = {longitude: 0, latitude: 0, zoom: 0};

/** A picked row in the current externally supplied binding. */
export type PlaygroundSelection = {
  /** Name referenced by the layer's `@@data` descriptor. */
  bindingId: string;
  /** Id of the picking layer, including the parent id for composite layers. */
  layerId: string;
  /** Stable host identity when getRowId is supplied; otherwise the current row index. */
  rowId: string | number;
  /** Index in the binding's current rows. */
  index: number;
  /** Original host row, without cloning or expression conversion. */
  object: unknown;
};

/** Inputs to the managed deck.gl editor and preview. */
export type DeckPlaygroundProps = Omit<
  PlaygroundProps,
  'parse' | 'render' | 'renderer' | 'jsonSchema'
> & {
  /** Constructors paired with their JSON validation schemas. */
  registry: PlaygroundRegistry;
  /** External rows referenced from JSON; the host retains ownership. */
  bindings?: PlaygroundBindings;
  /** Reports bound row picks, or null for a pick without a bound row. */
  onSelect?: (selection: PlaygroundSelection | null) => void;
  /** Observes camera interaction. Return values do not control the camera. */
  onViewStateChange?: (params: Parameters<NonNullable<DeckProps['onViewStateChange']>>[0]) => void;
  /** Called after Deck initializes; asynchronous layer loading may still be in progress. */
  onLoad?: () => void;
};

/**
 * A JSON playground that owns one Deck instance, its canvas, and its GPU lifecycle.
 * Layer constructors are supplied explicitly so applications choose their runtime dependencies.
 * Initial document callbacks may run synchronously during construction.
 */
export class DeckPlayground extends Playground {
  private readonly deckRenderer: DeckPlaygroundRenderer;

  constructor(props: DeckPlaygroundProps) {
    const renderer = new DeckPlaygroundRenderer(props);
    super({
      ...props,
      jsonSchema: renderer.jsonSchema,
      renderer,
      onError: error => renderer.reportError(error)
    });
    this.deckRenderer = renderer;
  }

  /**
   * Replaces the complete binding map and updates the current document without editing its text.
   * Returns false and reports an error if resolution fails; the last accepted preview is retained.
   * Supply new row arrays when rows change so deck.gl can invalidate the corresponding attributes.
   */
  setBindings(bindings: PlaygroundBindings): boolean {
    this.assertActive();
    return this.deckRenderer.setBindings(bindings);
  }

  /** Resets the camera to the latest accepted document's initialViewState. */
  resetView(): void {
    this.assertActive();
    this.deckRenderer.resetView();
  }
}

class DeckPlaygroundRenderer implements PlaygroundRenderer {
  readonly jsonSchema: Record<string, unknown>;
  private readonly resolver: ReturnType<typeof createPlaygroundResolver>;
  private readonly props: DeckPlaygroundProps;
  private bindings: PlaygroundBindings;
  private deck?: Deck;
  private element?: HTMLDivElement;
  private requestedDocument?: unknown;
  private resolvedProps: Partial<DeckProps> = {};
  private layerBindings = new Map<string, string>();
  private viewTopology: {type: Function; id: string}[] = [];
  private finalized = false;

  constructor(props: DeckPlaygroundProps) {
    this.props = props;
    this.bindings = props.bindings ?? {};
    this.resolver = createPlaygroundResolver(props.registry);
    this.jsonSchema = this.resolver.jsonSchema;
  }

  update(element: HTMLDivElement, value: unknown): void {
    this.element = element;
    if (!this.deck) this.requestedDocument = value;
    this.applyDocument(value, this.bindings);
    this.requestedDocument = value;
  }

  setBindings(bindings: PlaygroundBindings): boolean {
    try {
      if (this.requestedDocument !== undefined) {
        this.applyDocument(this.requestedDocument, bindings);
      } else {
        this.bindings = bindings;
      }
      return true;
    } catch (error) {
      this.reportError(error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }

  resetView(): void {
    if (this.deck) {
      // Deck compares against the previous initial value, not its interactive camera state.
      this.deck.setProps({initialViewState: null});
      this.deck.setProps({
        initialViewState: this.resolvedProps.initialViewState ?? DEFAULT_VIEW_STATE
      });
    }
  }

  finalize(): void {
    if (this.finalized) return;
    this.finalized = true;
    this.deck?.finalize();
    this.deck = undefined;
    this.element = undefined;
    this.requestedDocument = undefined;
    this.bindings = {};
    this.layerBindings.clear();
    this.resolvedProps = {};
    this.viewTopology = [];
  }

  reportError(error: Error): void {
    if (this.finalized) return;
    if (this.props.onError) this.props.onError(error);
    else console.error(error);
  }

  private applyDocument(value: unknown, bindings: PlaygroundBindings): void {
    // Validate and resolve before modifying the live renderer or accepted binding map.
    const resolved = this.resolver.resolve(value, bindings);
    const nextProps = resolved.props;
    const views = nextProps.views
      ? Array.isArray(nextProps.views)
        ? nextProps.views
        : [nextProps.views]
      : [];
    if (nextProps.controller === undefined) {
      nextProps.controller = views.length ? null : true;
      for (const view of views) {
        if (view.props.controller === undefined) view.props.controller = true;
      }
    }
    const topology = views.map(view => ({type: view.constructor, id: view.id}));
    const topologyChanged =
      topology.length !== this.viewTopology.length ||
      topology.some((view, index) => {
        const previous = this.viewTopology[index];
        return view.type !== previous.type || view.id !== previous.id;
      });
    const callbacks: Partial<DeckProps> = {
      onClick: this.handleClick,
      onViewStateChange: params => {
        if (this.finalized) return;
        const result = nextProps.onViewStateChange?.(params);
        this.props.onViewStateChange?.(params);
        return result;
      },
      onLoad: () => {
        if (!this.finalized) this.props.onLoad?.();
      },
      onError: error => this.reportError(error)
    };
    if (this.deck) {
      const removedProps = Object.fromEntries(
        Object.keys(this.resolvedProps)
          .filter(key => key !== 'initialViewState' && !(key in nextProps))
          .map(key => [key, key === 'controller' ? true : Deck.defaultProps[key]])
      );
      const {initialViewState, ...updates} = nextProps;
      if (topologyChanged) {
        this.deck.setProps({initialViewState: null});
      }
      this.deck.setProps({
        ...removedProps,
        ...updates,
        ...callbacks,
        ...(topologyChanged ? {initialViewState: initialViewState ?? DEFAULT_VIEW_STATE} : {})
      });
    } else {
      this.deck = new Deck({
        parent: this.element,
        controller: true,
        initialViewState: DEFAULT_VIEW_STATE,
        ...nextProps,
        ...callbacks
      });
    }
    this.bindings = bindings;
    this.layerBindings = resolved.layerBindings;
    this.resolvedProps = nextProps;
    this.viewTopology = topology;
  }

  private readonly handleClick: NonNullable<DeckProps['onClick']> = (info, event) => {
    if (this.finalized) return;
    this.resolvedProps.onClick?.(info, event);
    this.props.onSelect?.(this.getSelection(info));
  };

  private getSelection(info: PickingInfo): PlaygroundSelection | null {
    let layer = info.layer;
    while (layer && !this.layerBindings.has(layer.id)) layer = layer.parent;
    const bindingId = layer && this.layerBindings.get(layer.id);
    const binding = bindingId && this.bindings[bindingId];
    if (!binding || !info.picked) return null;
    // Composite/aggregate layers and in-flight picks need not retain the current source index.
    // Only identify a source row when the picked object is actually present in the binding.
    const index =
      info.index >= 0 &&
      info.index < binding.data.length &&
      binding.data[info.index] === info.object
        ? info.index
        : binding.data.indexOf(info.object);
    if (index < 0) return null;
    const object = binding.data[index];
    return {
      bindingId,
      layerId: layer.id,
      rowId: binding.getRowId ? binding.getRowId(object, index) : index,
      index,
      object
    };
  }
}

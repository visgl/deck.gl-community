// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, MapView, type DeckProps, type PickingInfo} from '@deck.gl/core';
import {Playground, type PlaygroundProps, type PlaygroundRenderer} from './playground';
import {
  createPlaygroundResolver,
  PlaygroundDataSourceError,
  type ResolvedPlaygroundConfiguration
} from './runtime/playground-resolver';
import type {PlaygroundDataSourceManagerLike} from './runtime/playground-data-source-manager';
import {PlaygroundSourceBindings} from './runtime/playground-source-bindings';
import type {PlaygroundBindings, PlaygroundRegistry} from './runtime/playground-registry';

const DEFAULT_VIEW_STATE = {longitude: 0, latitude: 0, zoom: 0};
const DEFAULT_BASEMAP = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';
const BASEMAP_STYLES = [
  {label: 'Positron', style: DEFAULT_BASEMAP},
  {label: 'Dark Matter', style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'},
  {label: 'Voyager', style: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json'}
];

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
  /** Application-selected constructors; known layers use bundled schemas, custom layers supply one. */
  registry: PlaygroundRegistry;
  /** External rows referenced from JSON; the host retains ownership. */
  bindings?: PlaygroundBindings;
  /** Independently owned sources shared across playgrounds; local bindings take precedence. */
  dataSources?: PlaygroundDataSourceManagerLike;
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
   * Replaces local bindings and retries the pending or accepted document without editing its text.
   * Returns false if resolution fails; the previous bindings and preview are retained.
   * Missing or failed sources report an error; sources still loading do not.
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
  private bindings: PlaygroundBindings;
  private resolved?: ResolvedPlaygroundConfiguration;
  private request?: {value: unknown; sourceIds: Set<string>; text?: string};
  private readonly sourceBindings?: PlaygroundSourceBindings;
  private deck?: Deck<any>;
  private element?: HTMLDivElement;
  private controls?: HTMLDivElement;
  private controlLabel?: HTMLLabelElement;
  private controlSelect?: HTMLSelectElement;
  private attribution?: HTMLElement;
  private selectedBasemap = DEFAULT_BASEMAP;
  private activeDocument?: unknown;
  private finalized = false;

  constructor(private readonly props: DeckPlaygroundProps) {
    this.bindings = props.bindings ?? {};
    this.resolver = createPlaygroundResolver(props.registry);
    this.jsonSchema = this.resolver.jsonSchema;
    if (props.dataSources) {
      this.sourceBindings = new PlaygroundSourceBindings(
        props.dataSources,
        this.handleSourceChange
      );
    }
  }

  update(element: HTMLDivElement, value: unknown, text?: string): void {
    this.element = element;
    try {
      const resolved = this.applyDocument(value, this.bindings);
      this.request = {value, sourceIds: new Set(resolved.layerBindings.values())};
    } catch (error) {
      if (error instanceof PlaygroundDataSourceError) {
        // Retry a valid document when its sources become available.
        this.request = {value, sourceIds: new Set(error.sourceIds), text};
      }
      throw error;
    } finally {
      this.retainSources();
    }
  }

  setBindings(bindings: PlaygroundBindings): boolean {
    try {
      if (this.request) {
        this.applyDocument(this.request.value, bindings);
      } else {
        this.bindings = bindings;
      }
    } catch (error) {
      this.reportError(error);
      return false;
    }
    if (this.request?.text !== undefined) {
      const {value, text} = this.request;
      this.request.text = undefined;
      this.props.onChange?.(value, text);
    }
    this.retainSources();
    return true;
  }

  private retainSources(): void {
    this.sourceBindings?.retain(
      [...(this.request?.sourceIds ?? []), ...(this.resolved?.layerBindings.values() ?? [])].filter(
        name => !Object.hasOwn(this.bindings, name)
      )
    );
  }

  private readonly handleSourceChange = (sourceId: string): void => {
    if (
      this.finalized ||
      !this.request?.sourceIds.has(sourceId) ||
      Object.hasOwn(this.bindings, sourceId)
    ) {
      return;
    }
    this.setBindings(this.bindings);
  };

  resetView(): void {
    if (this.deck) {
      // Deck compares against the previous initial value, not its interactive camera state.
      this.deck.setProps({initialViewState: null});
      this.deck.setProps({
        initialViewState: this.resolved?.props.initialViewState ?? DEFAULT_VIEW_STATE
      });
    }
  }

  finalize(): void {
    if (this.finalized) return;
    this.finalized = true;
    this.sourceBindings?.finalize();
    this.resolver.finalize();
    this.deck?.finalize();
    this.controls?.remove();
    this.deck = undefined;
    this.element = undefined;
    this.controls = undefined;
    this.controlLabel = undefined;
    this.controlSelect = undefined;
    this.attribution = undefined;
    this.activeDocument = undefined;
    this.request = undefined;
    this.resolved = undefined;
    this.bindings = {};
  }

  reportError(error: unknown): void {
    if (
      this.finalized ||
      (error instanceof PlaygroundDataSourceError && error.status === 'loading')
    )
      return;
    (this.props.onError ?? console.error)(
      error instanceof Error ? error : new Error(String(error))
    );
  }

  private applyDocument(
    value: unknown,
    bindings: PlaygroundBindings
  ): ResolvedPlaygroundConfiguration {
    // Validate and resolve before modifying the live renderer or accepted binding map.
    const resolved = this.resolver.resolve(value, bindings, this.sourceBindings);
    const input = value as Record<string, unknown>;
    const hasDocumentMapStyle = Object.hasOwn(input, 'mapStyle');
    const mapStyle = hasDocumentMapStyle
      ? resolveBasemapStyle(input.mapStyle, input.mapboxApiAccessToken)
      : this.props.registry.layers.BasemapLayer
        ? this.selectedBasemap
        : null;
    const nextProps = resolved.props;
    const views = nextProps.views ?? [];
    if (nextProps.controller === undefined) {
      nextProps.controller = views.length ? null : true;
      for (const view of views) {
        if (view.props.controller === undefined) view.props.controller = true;
      }
    }
    const mapViewOnly = views.length === 0 || views.every(view => view instanceof MapView);
    if (mapViewOnly && mapStyle) {
      const registration = this.props.registry.layers.BasemapLayer;
      const BasemapLayer = typeof registration === 'function' ? registration : registration?.type;
      if (!BasemapLayer) {
        throw new Error('Register BasemapLayer to render a document mapStyle');
      }
      nextProps.layers = [
        new BasemapLayer({
          id: 'playground-basemap',
          style: mapStyle,
          loadOptions: createMapboxLoadOptions(input.mapboxApiAccessToken)
        }),
        ...(nextProps.layers ?? [])
      ];
    }
    const previousProps = this.resolved?.props ?? {};
    const previousViews = previousProps.views ?? [];
    const topologyChanged =
      views.length !== previousViews.length ||
      views.some((view, index) => {
        const previous = previousViews[index];
        return view.constructor !== previous.constructor || view.id !== previous.id;
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
        Object.keys(previousProps)
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
      this.deck = new Deck<any>({
        parent: this.element,
        controller: true,
        initialViewState: DEFAULT_VIEW_STATE,
        ...nextProps,
        ...callbacks
      });
    }
    this.bindings = bindings;
    this.resolved = resolved;
    this.activeDocument = value;
    this.syncBasemapControl(mapViewOnly, hasDocumentMapStyle, mapStyle);
    return resolved;
  }

  private syncBasemapControl(
    mapViewOnly: boolean,
    hasDocumentMapStyle: boolean,
    mapStyle: string | Record<string, unknown> | null
  ): void {
    if (!this.element || !this.props.registry.layers.BasemapLayer) return;
    if (!this.controls) {
      const document = this.element.ownerDocument;
      const controls = document.createElement('div');
      Object.assign(controls.style, {
        position: 'absolute',
        top: '12px',
        right: '12px',
        zIndex: '20',
        display: 'grid',
        gap: '4px',
        padding: '8px 10px',
        borderRadius: '6px',
        background: 'rgba(255, 255, 255, 0.94)',
        color: '#172033',
        font: '12px/1.3 system-ui, sans-serif',
        boxShadow: '0 1px 5px rgba(0, 0, 0, 0.24)',
        pointerEvents: 'auto'
      });
      const label = document.createElement('label');
      label.textContent = 'Basemap';
      const select = document.createElement('select');
      select.setAttribute('aria-label', 'Basemap');
      for (const option of [...BASEMAP_STYLES, {label: 'None', style: ''}]) {
        const element = document.createElement('option');
        element.textContent = option.label;
        element.value = option.style;
        select.append(element);
      }
      select.value = this.selectedBasemap;
      select.addEventListener('change', this.handleBasemapChange);
      const attribution = document.createElement('small');
      controls.append(label, select, attribution);
      this.element.append(controls);
      this.controls = controls;
      this.controlLabel = label;
      this.controlSelect = select;
      this.attribution = attribution;
    }
    this.controls.style.display = mapViewOnly ? 'grid' : 'none';
    if (this.controlLabel) {
      this.controlLabel.style.display = mapViewOnly && !hasDocumentMapStyle ? 'block' : 'none';
    }
    if (this.controlSelect) {
      this.controlSelect.style.display = mapViewOnly && !hasDocumentMapStyle ? 'block' : 'none';
    }
    if (this.controlSelect) this.controlSelect.value = this.selectedBasemap;
    if (this.attribution) {
      const labels = hasDocumentMapStyle
        ? getBasemapAttribution(mapStyle)
        : this.selectedBasemap
          ? ['© CARTO', '© OpenStreetMap']
          : [];
      this.attribution.textContent = labels.join(' · ');
      this.attribution.style.display = labels.length && mapViewOnly ? 'block' : 'none';
    }
  }

  private readonly handleBasemapChange = () => {
    this.selectedBasemap = this.controlSelect?.value ?? '';
    if (this.activeDocument === undefined) return;
    try {
      this.applyDocument(this.activeDocument, this.bindings);
    } catch (error) {
      this.reportError(error);
    }
  };

  private readonly handleClick: NonNullable<DeckProps['onClick']> = (info, event) => {
    if (this.finalized) return;
    this.resolved?.props.onClick?.(info, event);
    this.props.onSelect?.(this.getSelection(info));
  };

  private getSelection(info: PickingInfo): PlaygroundSelection | null {
    if (!this.resolved || !info.picked) return null;
    const {layerBindings, bindings} = this.resolved;
    let layer = info.layer;
    while (layer && !layerBindings.has(layer.id)) layer = layer.parent;
    const bindingId = layer && layerBindings.get(layer.id);
    const binding = bindingId && bindings[bindingId];
    if (
      bindingId &&
      !Object.hasOwn(this.bindings, bindingId) &&
      this.sourceBindings &&
      this.sourceBindings.get(bindingId) !== binding
    ) {
      return null;
    }
    if (!binding) return null;
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

function addMapboxAccessTokenToUrl(url: string, accessToken: string): string {
  if (url.startsWith('mapbox://styles/')) {
    url = `https://api.mapbox.com/styles/v1/${url.slice('mapbox://styles/'.length)}`;
  } else if (url.startsWith('mapbox://sprites/')) {
    url = `https://api.mapbox.com/styles/v1/${url.slice('mapbox://sprites/'.length)}/sprite`;
  } else if (url.startsWith('mapbox://fonts/')) {
    url = `https://api.mapbox.com/fonts/v1/${url.slice('mapbox://fonts/'.length)}`;
  } else if (url.startsWith('mapbox://')) {
    url = `https://api.mapbox.com/v4/${url.slice('mapbox://'.length)}.json?secure`;
  }

  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.hostname === 'api.mapbox.com') {
      parsedUrl.searchParams.set('access_token', accessToken);
      return parsedUrl.toString();
    }
  } catch {
    // Leave relative URLs and other non-URL values unchanged.
  }
  return url;
}

function resolveBasemapStyle(
  style: unknown,
  accessToken: unknown
): string | Record<string, unknown> | null {
  if (style === null) return null;
  if (typeof style === 'string') {
    return typeof accessToken === 'string' ? addMapboxAccessTokenToUrl(style, accessToken) : style;
  }
  if (!style || typeof style !== 'object' || Array.isArray(style)) {
    throw new Error('mapStyle must be a URL, a style object, or null');
  }
  if (typeof accessToken !== 'string') return style as Record<string, unknown>;
  const addToken = (value: unknown): unknown => {
    if (typeof value === 'string') return addMapboxAccessTokenToUrl(value, accessToken);
    if (Array.isArray(value)) return value.map(addToken);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [key, addToken(child)])
      );
    }
    return value;
  };
  return addToken(style) as Record<string, unknown>;
}

function createMapboxLoadOptions(accessToken: unknown): Record<string, unknown> | null {
  if (typeof accessToken !== 'string') return null;
  return {
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const response = await fetch(addMapboxAccessTokenToUrl(url, accessToken), init);
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('json')) return response;
      const json = await response.json();
      return new Response(JSON.stringify(rewriteMapboxUrls(json, accessToken)), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      });
    }
  };
}

function rewriteMapboxUrls(value: unknown, accessToken: string): unknown {
  if (typeof value === 'string') return addMapboxAccessTokenToUrl(value, accessToken);
  if (Array.isArray(value)) return value.map(child => rewriteMapboxUrls(child, accessToken));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, rewriteMapboxUrls(child, accessToken)])
    );
  }
  return value;
}

function getBasemapAttribution(style: unknown): string[] {
  if (style && typeof style === 'object' && !Array.isArray(style)) {
    const sources = (style as {sources?: Record<string, {attribution?: unknown}>}).sources;
    return Object.values(sources ?? {}).flatMap(source =>
      source && typeof source === 'object' && typeof source.attribution === 'string'
        ? [source.attribution]
        : []
    );
  }
  if (typeof style === 'string' && style.includes('mapbox')) return ['© Mapbox'];
  if (typeof style === 'string' && style.includes('cartocdn')) {
    return ['© CARTO', '© OpenStreetMap'];
  }
  return [];
}

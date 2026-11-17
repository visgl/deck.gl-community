// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {MapView} from '@deck.gl/core';
import type {Deck, DeckProps, LayersList, View, ViewStateChangeParameters} from '@deck.gl/core';

/** Caller-owned scene rendered in one DeckPanel canvas. */
export type DeckPanelSceneProps = {
  /** View with an id unique across the shared Deck. Its canvas and camera are supplied by the panel. */
  view: View;
  /** Layers exclusive to this panel. Layer ids must be unique across all scenes. */
  layers?: LayersList;
  /** Controlled camera state for this view, independent of the root camera. */
  viewState: Record<string, unknown> & {id?: never};
  /** Receives controller changes. Apply the new camera with panel.setProps({sceneProps: ...}). */
  onViewStateChange?: (params: ViewStateChangeParameters) => void;
  /** Optional filter applied only to this panel's layers, including picking passes. */
  layerFilter?: DeckProps['layerFilter'];
};

type RootProps = Pick<
  DeckProps<View | View[] | null>,
  '_canvases' | 'views' | 'layers' | 'layerFilter' | 'onViewStateChange'
>;
type Scene = {canvas: HTMLCanvasElement; props: DeckPanelSceneProps};
type Registry = {root: RootProps; scenes: Map<object, Scene>};
const registries = new WeakMap<Deck<any>, Registry>();
const pendingProps = new WeakMap<Deck<any>, RootProps>();
const ROOT_KEYS = ['_canvases', 'views', 'layers', 'layerFilter', 'onViewStateChange'] as const;

/**
 * Update the root scene without replacing mounted DeckPanel scenes.
 * Use this instead of deck.setProps when changing views, layers, canvases, filters or camera callbacks.
 * Other Deck props pass through unchanged. With no mounted panels this delegates to deck.setProps.
 */
export function setDeckPropsWithPanels<ViewsT extends View | View[] | null>(
  deck: Deck<ViewsT>,
  props: DeckProps<ViewsT>
): void;
export function setDeckPropsWithPanels(deck: Deck<any>, props: DeckProps<any>): void {
  const registry = registries.get(deck);
  if (!registry) {
    const pending = pendingProps.get(deck);
    pendingProps.delete(deck);
    deck.setProps({...pending, ...props});
    return;
  }
  const root = {...registry.root};
  for (const key of ROOT_KEYS) {
    if (Object.hasOwn(props, key)) Object.assign(root, {[key]: props[key]});
  }
  const next = {...registry, root};
  const composed = composeScenes(next);
  registry.root = root;
  pendingProps.delete(deck);
  deck.setProps({...props, ...composed});
}

/** @internal Attach a canvas until its panel content is unmounted. */
export function registerDeckPanel(
  deck: Deck<any>,
  canvas: HTMLCanvasElement,
  props: DeckPanelSceneProps
) {
  if (!deck.isInitialized) {
    throw new Error('DeckPanel requires an initialized Deck. Mount panels after Deck.onLoad.');
  }
  if (!deck.props._canvases) {
    throw new Error('DeckPanel requires a Deck constructed with the 9.4 _canvases option.');
  }
  const registry = registries.get(deck) || {
    root:
      pendingProps.get(deck) ||
      (Object.fromEntries(ROOT_KEYS.map(key => [key, deck.props[key]])) as RootProps),
    scenes: new Map<object, Scene>()
  };
  const token = {};
  function update(scene: DeckPanelSceneProps | null) {
    const scenes = new Map(registry.scenes);
    if (scene) scenes.set(token, {canvas, props: scene});
    else scenes.delete(token);
    const composed = scenes.size ? composeScenes({...registry, scenes}) : registry.root;
    registry.scenes = scenes;
    if (scenes.size) registries.set(deck, registry);
    else registries.delete(deck);
    // Deck removes its view manager before unmounting widgets during finalize().
    // Calling setProps then would recreate presentation targets on the finalized Deck.
    scheduleSceneUpdate(deck, composed);
  }
  update(props);
  return {update: (scene: DeckPanelSceneProps) => update(scene), remove: () => update(null)};
}

function composeScenes({root, scenes}: Registry): RootProps {
  if (!root._canvases) throw new Error('DeckPanel requires the root _canvases option.');
  const views: View[] = root.views
    ? Array.isArray(root.views)
      ? [...root.views]
      : [root.views]
    : root._canvases.length
      ? [new MapView({id: 'default-view'})]
      : [];
  const viewIds = new Set(views.map(view => view.id));
  const owners = new Map<string, string | null>();
  const layers: LayersList = [root.layers];
  const panelViews = new Map<string, DeckPanelSceneProps>();
  const canvases = [...root._canvases];
  function addLayers(list: LayersList, owner: string | null) {
    for (const layer of list) {
      if (!layer) continue;
      if (Array.isArray(layer)) {
        addLayers(layer, owner);
        continue;
      }
      if (owners.has(layer.id)) throw new Error(`DeckPanel requires unique layer ids: ${layer.id}`);
      owners.set(layer.id, owner);
    }
  }
  addLayers(root.layers || [], null);
  for (const {canvas, props} of scenes.values()) {
    const id = props.view.id;
    if (viewIds.has(id)) throw new Error(`DeckPanel requires unique view ids: ${id}`);
    if (props.viewState.id !== undefined) {
      throw new Error('DeckPanel viewState must be a camera state without an id.');
    }
    viewIds.add(id);
    panelViews.set(id, props);
    addLayers(props.layers || [], id);
    layers.push(cloneLayers(props.layers || []));
    canvases.push(canvas);
    views.push(props.view.clone({canvasId: canvas.id, viewState: props.viewState}));
  }
  return {
    _canvases: canvases,
    views,
    layers,
    layerFilter: context => {
      const owner = owners.get(context.layer.root.id);
      const scene = panelViews.get(context.viewport.id);
      if (scene) {
        return owner === context.viewport.id && (scene.layerFilter?.(context) ?? true);
      }
      return owner === null && (root.layerFilter?.(context) ?? true);
    },
    onViewStateChange: params => {
      const scene = panelViews.get(params.viewId);
      if (scene) {
        scene.onViewStateChange?.(params);
        return params.viewState;
      }
      return root.onViewStateChange?.(params);
    }
  };
}

// Panel content can mount/unmount inside WidgetManager.setProps. Applying scenes in
// the same stack would recursively reconcile an unfinished widget list. Coalesce
// changes until that transaction completes, before the next rendering frame.
function scheduleSceneUpdate(deck: Deck<any>, props: RootProps): void {
  const scheduled = pendingProps.has(deck);
  pendingProps.set(deck, props);
  if (scheduled) return;
  queueMicrotask(() => {
    const next = pendingProps.get(deck);
    pendingProps.delete(deck);
    if (next && deck.isInitialized) deck.setProps(next);
  });
}

// Removed layers are finalized by Deck and cannot be initialized again. Keep the
// caller's layer definitions reusable when an accordion remounts the same panel.
function cloneLayers(layers: LayersList): LayersList {
  return layers.map(layer =>
    Array.isArray(layer) ? cloneLayers(layer) : layer && layer.clone({})
  );
}

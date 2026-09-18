// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, type DeckProps, type PickingInfo} from '@deck.gl/core';
import {ScatterplotLayer} from '@deck.gl/layers';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {
  DeckPlayground,
  PlaygroundDataSourceRegistry,
  ScatterplotLayerSchema,
  type PlaygroundBindings,
  type PlaygroundDataBinding
} from '../src/index';

const ROWS = [
  {id: 'west', position: [-122.4, 37.8]},
  {id: 'east', position: [-122.3, 37.8]}
];
const INITIAL_VIEW_STATE = {longitude: -122.4, latitude: 37.8, zoom: 10};
const REGISTRY = {
  layers: {ScatterplotLayer: {type: ScatterplotLayer, schema: ScatterplotLayerSchema}}
};
const PLAYGROUNDS: DeckPlayground[] = [];
const HOSTS: HTMLElement[] = [];

function createDocument(sourceId = 'points', radius = 4) {
  return {
    initialViewState: INITIAL_VIEW_STATE,
    controller: {scrollZoom: {smooth: false}},
    layers: [
      {
        '@@type': 'ScatterplotLayer',
        id: 'points',
        data: {'@@data': sourceId},
        getPosition: '@@=position',
        getRadius: radius,
        radiusUnits: 'pixels',
        pickable: true
      }
    ]
  };
}

function createBinding(rows = ROWS): PlaygroundDataBinding {
  return {data: rows, getRowId: row => row.id};
}

function mountPlayground(
  sources: PlaygroundDataSourceRegistry,
  sourceId = 'points',
  bindings?: PlaygroundBindings
) {
  const host = document.createElement('div');
  host.style.width = '900px';
  host.style.height = '500px';
  document.body.append(host);
  HOSTS.push(host);
  const onLoad = vi.fn();
  const onError = vi.fn();
  const onChange = vi.fn();
  const onSelect = vi.fn();
  const playground = new DeckPlayground({
    parentElement: host,
    templates: {points: createDocument(sourceId)},
    registry: REGISTRY,
    dataSources: sources,
    bindings,
    onLoad,
    onError,
    onChange,
    onSelect
  });
  PLAYGROUNDS.push(playground);
  return {playground, host, onLoad, onError, onChange, onSelect};
}

function getLayer(deck: Deck): ScatterplotLayer {
  return (deck.props.layers as ScatterplotLayer[])[0];
}

function zoomCanvas(canvas: HTMLCanvasElement): void {
  const bounds = canvas.getBoundingClientRect();
  canvas.dispatchEvent(
    new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      clientX: bounds.left + 700,
      clientY: bounds.top + 250,
      deltaY: -120
    })
  );
}

afterEach(() => {
  for (const playground of PLAYGROUNDS.splice(0)) playground.finalize();
  for (const host of HOSTS.splice(0)) host.remove();
  vi.restoreAllMocks();
});

describe('DeckPlayground independent data sources', () => {
  it('shares source updates while preserving cameras and respecting local overrides', async () => {
    const setProps = vi.spyOn(Deck.prototype, 'setProps');
    const sources = new PlaygroundDataSourceRegistry();
    sources.register('points', createBinding());
    const first = mountPlayground(sources);
    const firstDeck = setProps.mock.contexts[0] as Deck;
    const secondStart = setProps.mock.contexts.length;
    const second = mountPlayground(sources);
    const secondDeck = setProps.mock.contexts[secondStart] as Deck;
    await vi.waitFor(
      () => {
        expect(first.onLoad).toHaveBeenCalledTimes(1);
        expect(second.onLoad).toHaveBeenCalledTimes(1);
      },
      {timeout: 10_000}
    );
    const firstCanvas = first.host.querySelector('canvas')!;
    const secondCanvas = second.host.querySelector('canvas')!;
    expect(getLayer(firstDeck).props.data).toBe(ROWS);
    expect(getLayer(secondDeck).props.data).toBe(ROWS);

    zoomCanvas(firstCanvas);
    await vi.waitFor(() =>
      expect(firstDeck.getViewports()[0].zoom).not.toBe(INITIAL_VIEW_STATE.zoom)
    );
    const zoom = firstDeck.getViewports()[0].zoom;
    setProps.mockClear();
    sources.register('unrelated', createBinding());
    expect(setProps).not.toHaveBeenCalled();

    const filteredRows = [ROWS[1]];
    sources.register('points', createBinding(filteredRows));
    expect(getLayer(firstDeck).props.data).toBe(filteredRows);
    expect(getLayer(secondDeck).props.data).toBe(filteredRows);
    expect(first.host.querySelector('canvas')).toBe(firstCanvas);
    expect(second.host.querySelector('canvas')).toBe(secondCanvas);
    expect(firstDeck.getViewports()[0].zoom).toBe(zoom);
    expect(first.onChange).toHaveBeenCalledTimes(1);
    expect(second.onChange).toHaveBeenCalledTimes(1);

    const onClick = firstDeck.props.onClick as NonNullable<DeckProps['onClick']>;
    onClick(
      {picked: true, index: 0, object: ROWS[1], layer: getLayer(firstDeck)} as PickingInfo,
      undefined!
    );
    expect(first.onSelect).toHaveBeenLastCalledWith({
      bindingId: 'points',
      layerId: 'points',
      rowId: 'east',
      index: 0,
      object: ROWS[1]
    });

    const overrideRows = [ROWS[0]];
    expect(first.playground.setBindings({points: createBinding(overrideRows)})).toBe(true);
    const overriddenLayer = getLayer(firstDeck);
    sources.register('points', createBinding());
    expect(getLayer(firstDeck)).toBe(overriddenLayer);
    expect(getLayer(firstDeck).props.data).toBe(overrideRows);
    expect(getLayer(secondDeck).props.data).toBe(ROWS);
    expect(first.playground.setBindings({})).toBe(true);
    expect(getLayer(firstDeck).props.data).toBe(ROWS);
    expect(firstDeck.getViewports()[0].zoom).toBe(zoom);
    expect(first.onError).not.toHaveBeenCalled();
    expect(second.onError).not.toHaveBeenCalled();
  }, 20_000);

  it('recovers an initial document when an independent owner registers its source', async () => {
    const setProps = vi.spyOn(Deck.prototype, 'setProps');
    const sources = new PlaygroundDataSourceRegistry();
    const mounted = mountPlayground(sources);
    expect(mounted.host.querySelector('canvas')).toBeNull();
    expect(mounted.onError).toHaveBeenCalledWith(expect.any(Error));
    expect(mounted.onChange).not.toHaveBeenCalled();

    mounted.onError.mockClear();
    sources.register('points', createBinding());
    await vi.waitFor(() => expect(mounted.onLoad).toHaveBeenCalledTimes(1), {timeout: 10_000});
    const deck = setProps.mock.contexts[0] as Deck;
    expect(getLayer(deck).props.data).toBe(ROWS);
    expect(mounted.onChange).toHaveBeenCalledTimes(1);
    expect(mounted.onError).not.toHaveBeenCalled();
  }, 20_000);

  it('retains the preview and pending document until an edited source becomes ready', async () => {
    const setProps = vi.spyOn(Deck.prototype, 'setProps');
    const sources = new PlaygroundDataSourceRegistry();
    sources.register('points', createBinding());
    const mounted = mountPlayground(sources);
    await vi.waitFor(() => expect(mounted.onLoad).toHaveBeenCalledTimes(1), {timeout: 10_000});
    const deck = setProps.mock.contexts[0] as Deck;
    const canvas = mounted.host.querySelector('canvas');
    const acceptedLayer = getLayer(deck);
    const pendingDocument = createDocument('later', 9);
    const pendingText = JSON.stringify(pendingDocument, null, 2);
    mounted.playground.setText(pendingText);
    expect(mounted.onError).toHaveBeenCalledWith(expect.any(Error));
    expect(getLayer(deck)).toBe(acceptedLayer);
    expect(mounted.onChange).toHaveBeenCalledTimes(1);

    mounted.playground.setText('{');
    mounted.playground.setText(
      JSON.stringify({
        ...pendingDocument,
        layers: [{...pendingDocument.layers[0], radiusMinPixels: -1}]
      })
    );
    let resolveSource!: (binding: PlaygroundDataBinding) => void;
    const pending = new Promise<PlaygroundDataBinding>(resolve => {
      resolveSource = resolve;
    });
    const loader = vi.fn(() => pending);
    mounted.onError.mockClear();
    sources.register('later', loader);
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
    expect(getLayer(deck)).toBe(acceptedLayer);
    expect(mounted.host.querySelector('canvas')).toBe(canvas);
    expect(mounted.onError).not.toHaveBeenCalled();
    expect(mounted.onChange).toHaveBeenCalledTimes(1);

    const nextRows = [ROWS[1]];
    resolveSource(createBinding(nextRows));
    await vi.waitFor(() => expect(getLayer(deck).props.data).toBe(nextRows));
    expect(getLayer(deck).props.getRadius).toBe(9);
    expect(mounted.onChange).toHaveBeenCalledTimes(2);
    expect(mounted.onChange).toHaveBeenLastCalledWith(pendingDocument, pendingText);
    expect(mounted.host.querySelector('canvas')).toBe(canvas);
    expect(mounted.onLoad).toHaveBeenCalledTimes(1);
    expect(mounted.onError).not.toHaveBeenCalled();

    sources.register('later', createBinding());
    expect(getLayer(deck).props.data).toBe(ROWS);
    expect(mounted.onChange).toHaveBeenCalledTimes(2);
  }, 20_000);

  it('retains the preview but suppresses source picks after removal or loading failure', async () => {
    const setProps = vi.spyOn(Deck.prototype, 'setProps');
    const sources = new PlaygroundDataSourceRegistry();
    sources.register('points', createBinding());
    const mounted = mountPlayground(sources);
    await vi.waitFor(() => expect(mounted.onLoad).toHaveBeenCalledTimes(1), {timeout: 10_000});
    const deck = setProps.mock.contexts[0] as Deck;
    const canvas = mounted.host.querySelector('canvas');
    const acceptedLayer = getLayer(deck);
    const onClick = deck.props.onClick as NonNullable<DeckProps['onClick']>;
    const pick = () =>
      onClick(
        {picked: true, index: 0, object: ROWS[0], layer: acceptedLayer} as PickingInfo,
        undefined!
      );
    pick();
    expect(mounted.onSelect).toHaveBeenLastCalledWith(expect.objectContaining({rowId: 'west'}));

    sources.unregister('points');
    expect(mounted.onError).toHaveBeenCalledTimes(1);
    expect(getLayer(deck)).toBe(acceptedLayer);
    pick();
    expect(mounted.onSelect).toHaveBeenLastCalledWith(null);

    sources.register('points', () => Promise.reject(new Error('Source failed to load')));
    expect(mounted.onError).toHaveBeenCalledTimes(1);
    pick();
    expect(mounted.onSelect).toHaveBeenLastCalledWith(null);
    await vi.waitFor(() => expect(mounted.onError).toHaveBeenCalledTimes(2));
    expect(getLayer(deck)).toBe(acceptedLayer);
    expect(mounted.host.querySelector('canvas')).toBe(canvas);
    pick();
    expect(mounted.onSelect).toHaveBeenLastCalledWith(null);

    const nextRows = [ROWS[1]];
    sources.register('points', createBinding(nextRows));
    expect(getLayer(deck).props.data).toBe(nextRows);
    onClick(
      {picked: true, index: 0, object: ROWS[1], layer: getLayer(deck)} as PickingInfo,
      undefined!
    );
    expect(mounted.onSelect).toHaveBeenLastCalledWith(expect.objectContaining({rowId: 'east'}));
    expect(mounted.host.querySelector('canvas')).toBe(canvas);
    expect(mounted.onChange).toHaveBeenCalledTimes(1);
    expect(mounted.onError).toHaveBeenCalledTimes(2);
  }, 20_000);

  it('keeps shared loading alive when one consumer finalizes and detaches its callbacks', async () => {
    const setProps = vi.spyOn(Deck.prototype, 'setProps');
    const sources = new PlaygroundDataSourceRegistry();
    let resolveSource!: (binding: PlaygroundDataBinding) => void;
    const pending = new Promise<PlaygroundDataBinding>(resolve => {
      resolveSource = resolve;
    });
    let loadSignal: AbortSignal | undefined;
    const loader = vi.fn(({signal}: {signal: AbortSignal}) => {
      loadSignal = signal;
      return pending;
    });
    sources.register('points', loader);
    const first = mountPlayground(sources);
    const second = mountPlayground(sources);
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
    expect(first.onError).not.toHaveBeenCalled();
    expect(second.onError).not.toHaveBeenCalled();
    expect(first.onChange).not.toHaveBeenCalled();
    expect(second.onChange).not.toHaveBeenCalled();
    first.playground.finalize();
    expect(loadSignal?.aborted).toBe(false);

    resolveSource(createBinding());
    await vi.waitFor(() => expect(second.onLoad).toHaveBeenCalledTimes(1), {timeout: 10_000});
    const deck = setProps.mock.contexts[0] as Deck;
    expect(getLayer(deck).props.data).toBe(ROWS);
    expect(second.onChange).toHaveBeenCalledTimes(1);
    expect(first.host.children).toHaveLength(0);
    expect(first.onLoad).not.toHaveBeenCalled();
    expect(first.onChange).not.toHaveBeenCalled();
    expect(first.onError).not.toHaveBeenCalled();

    const nextRows = [ROWS[0]];
    sources.register('points', createBinding(nextRows));
    expect(getLayer(deck).props.data).toBe(nextRows);
    expect(second.onChange).toHaveBeenCalledTimes(1);
    expect(second.onError).not.toHaveBeenCalled();
    expect(first.onChange).not.toHaveBeenCalled();
    expect(first.onError).not.toHaveBeenCalled();
  }, 20_000);
});

// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, type DeckProps, type PickingInfo} from '@deck.gl/core';
import {ScatterplotLayer} from '@deck.gl/layers';
import {tableFromArrays, tableToIPC} from 'apache-arrow';
import {afterEach, beforeEach, describe, expect, it, vi, type MockInstance} from 'vitest';

import {
  DeckPlayground,
  PlaygroundDataSourceManager,
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
let sources: PlaygroundDataSourceManager;
let setProps: MockInstance<Deck['setProps']>;

beforeEach(() => {
  sources = new PlaygroundDataSourceManager();
  setProps = vi.spyOn(Deck.prototype, 'setProps');
});

function addSource(dataSourceId: string, dataSource: object | Promise<object> | null) {
  sources.add({dataSourceId, dataSource});
}

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

function mountPlayground(sourceId = 'points', bindings?: PlaygroundBindings) {
  const host = document.createElement('div');
  host.style.width = '900px';
  host.style.height = '500px';
  document.body.append(host);
  HOSTS.push(host);
  const callbacks = {onLoad: vi.fn(), onError: vi.fn(), onChange: vi.fn(), onSelect: vi.fn()};
  const playground = new DeckPlayground({
    parentElement: host,
    templates: {points: createDocument(sourceId)},
    registry: REGISTRY,
    dataSources: sources,
    bindings,
    ...callbacks
  });
  PLAYGROUNDS.push(playground);
  const ready = async () => {
    await vi.waitFor(() => expect(callbacks.onLoad).toHaveBeenCalledTimes(1), {timeout: 10_000});
    const deck = setProps.mock.contexts.find(
      (deck: Deck) => deck.props.parent === playground.previewElement
    ) as Deck;
    await vi.waitFor(() =>
      expect(deck.getViewports()[0]).toMatchObject({
        width: host.clientWidth,
        height: host.clientHeight
      })
    );
    return deck;
  };
  return {playground, host, ready, ...callbacks};
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

afterEach(async () => {
  for (const playground of PLAYGROUNDS.splice(0)) playground.finalize();
  for (const host of HOSTS.splice(0)) host.remove();
  await sources.finalize();
  vi.restoreAllMocks();
});

describe('DeckPlayground independent data sources', () => {
  it.each([
    'template',
    'edit'
  ] as const)('applies deferred %s camera behavior once and preserves later source-update interaction', async selection => {
    addSource('points', createBinding());
    let resolveSource!: (binding: PlaygroundDataBinding) => void;
    addSource(
      'later',
      new Promise<PlaygroundDataBinding>(resolve => {
        resolveSource = resolve;
      })
    );
    const mounted = mountPlayground();
    const deck = await mounted.ready();
    const nextViewState = {longitude: -96, latitude: 37, zoom: 3};
    const deferredDocument = {...createDocument('later', 9), initialViewState: nextViewState};
    mounted.playground.setTemplates({points: createDocument(), later: deferredDocument});
    const canvas = mounted.host.querySelector('canvas')!;
    zoomCanvas(canvas);
    await vi.waitFor(() => expect(deck.getViewports()[0].zoom).not.toBe(INITIAL_VIEW_STATE.zoom));
    const interactiveViewport = deck.getViewports()[0];
    const interactiveViewState = {
      longitude: interactiveViewport.longitude,
      latitude: interactiveViewport.latitude,
      zoom: interactiveViewport.zoom
    };
    const interactiveZoom = interactiveViewport.zoom;
    const acceptedLayer = getLayer(deck);
    if (selection === 'template') mounted.playground.setTemplate('later');
    else mounted.playground.setText(JSON.stringify(deferredDocument));
    expect(getLayer(deck)).toBe(acceptedLayer);
    expect(deck.getViewports()[0].zoom).toBe(interactiveZoom);
    expect(mounted.onError).not.toHaveBeenCalled();

    const nextRows = [ROWS[1]];
    resolveSource(createBinding(nextRows));
    await vi.waitFor(() => expect(getLayer(deck).props.data).toBe(nextRows));
    expect(deck.getViewports()[0]).toMatchObject(
      selection === 'template' ? nextViewState : interactiveViewState
    );
    expect(mounted.host.querySelector('canvas')).toBe(canvas);
    const acceptedZoom = deck.getViewports()[0].zoom;
    zoomCanvas(canvas);
    await vi.waitFor(() => expect(deck.getViewports()[0].zoom).not.toBe(acceptedZoom));
    const updatedZoom = deck.getViewports()[0].zoom;
    addSource('later', createBinding());
    expect(getLayer(deck).props.data).toBe(ROWS);
    expect(deck.getViewports()[0].zoom).toBe(updatedZoom);
    expect(mounted.onError).not.toHaveBeenCalled();
  }, 20_000);

  it('discards a pending template camera reset when another document is accepted', async () => {
    addSource('points', createBinding());
    let resolveSource!: (binding: PlaygroundDataBinding) => void;
    addSource(
      'later',
      new Promise<PlaygroundDataBinding>(resolve => {
        resolveSource = resolve;
      })
    );
    const mounted = mountPlayground();
    const deck = await mounted.ready();
    mounted.playground.setTemplates({
      points: createDocument(),
      later: {
        ...createDocument('later', 9),
        initialViewState: {longitude: -96, latitude: 37, zoom: 3}
      }
    });
    mounted.playground.setTemplate('later');
    mounted.playground.setText(JSON.stringify(createDocument('points', 12)));
    const canvas = mounted.host.querySelector('canvas')!;
    zoomCanvas(canvas);
    await vi.waitFor(() => expect(deck.getViewports()[0].zoom).not.toBe(INITIAL_VIEW_STATE.zoom));
    const interactiveZoom = deck.getViewports()[0].zoom;
    resolveSource(createBinding([ROWS[1]]));
    await vi.waitFor(() =>
      expect(sources.listDataSources()).toContainEqual({dataSourceId: 'later', status: 'ready'})
    );
    expect(getLayer(deck).props.getRadius).toBe(12);
    expect(getLayer(deck).props.data).toBe(ROWS);
    expect(deck.getViewports()[0].zoom).toBe(interactiveZoom);
    expect(mounted.onError).not.toHaveBeenCalled();
  }, 20_000);

  it('imports and replaces shared rows through WebMCP without replacing the preview', async () => {
    const original = Object.getOwnPropertyDescriptor(document, 'modelContext');
    const tools = new Map<string, any>();
    Object.defineProperty(document, 'modelContext', {
      configurable: true,
      value: {
        async registerTool(tool, {signal}) {
          tools.set(tool.name, tool);
          signal.addEventListener('abort', () => tools.delete(tool.name), {once: true});
        }
      }
    });
    try {
      const mounted = mountPlayground();
      const unregister = await mounted.playground.registerWebMCP({
        templates: ['points'],
        dataSources: {manager: sources, read: ['points'], write: ['points']}
      });
      const set = tools.get('playground.set_source');
      await set.execute({id: 'points', format: 'json', data: JSON.stringify(ROWS)});
      const deck = await mounted.ready();
      const canvas = mounted.host.querySelector('canvas');
      expect(getLayer(deck).props.data).toEqual(ROWS);

      const bytes = tableToIPC(
        tableFromArrays({position: [[-122.2, 37.8]], label: ['@@=ignored']})
      );
      const data = btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
      await set.execute({id: 'points', format: 'arrow', data});
      expect(getLayer(deck).props.data).toEqual([{position: [-122.2, 37.8], label: '@@=ignored'}]);
      expect(mounted.host.querySelector('canvas')).toBe(canvas);
      expect(mounted.onLoad).toHaveBeenCalledTimes(1);
      expect(await tools.get('playground.inspect_source').execute({id: 'points'})).toMatchObject({
        rowCount: 1,
        sample: [{position: [-122.2, 37.8], label: '@@=ignored'}]
      });
      unregister!();
      expect(tools.size).toBe(0);
      expect(sources.listDataSources()).toEqual([{dataSourceId: 'points', status: 'ready'}]);
    } finally {
      if (original) Object.defineProperty(document, 'modelContext', original);
      else Reflect.deleteProperty(document, 'modelContext');
    }
  }, 20_000);

  it('shares source updates while preserving cameras and respecting local overrides', async () => {
    addSource('points', createBinding());
    const first = mountPlayground();
    const second = mountPlayground();
    const [firstDeck, secondDeck] = await Promise.all([first.ready(), second.ready()]);
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
    addSource('unrelated', createBinding());
    expect(setProps).not.toHaveBeenCalled();

    const filteredRows = [ROWS[1]];
    addSource('points', createBinding(filteredRows));
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
    addSource('points', createBinding());
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
    const mounted = mountPlayground();
    expect(mounted.host.querySelector('canvas')).toBeNull();
    expect(mounted.onError).toHaveBeenCalledWith(expect.any(Error));
    expect(mounted.onChange).not.toHaveBeenCalled();

    mounted.onError.mockClear();
    addSource('points', createBinding());
    const deck = await mounted.ready();
    expect(getLayer(deck).props.data).toBe(ROWS);
    expect(mounted.onChange).toHaveBeenCalledTimes(1);
    expect(mounted.onError).not.toHaveBeenCalled();
  }, 20_000);

  it('retains the preview and pending document until an edited source becomes ready', async () => {
    addSource('points', createBinding());
    const mounted = mountPlayground();
    const deck = await mounted.ready();
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
    mounted.onError.mockClear();
    addSource('later', pending);
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

    addSource('later', createBinding());
    expect(getLayer(deck).props.data).toBe(ROWS);
    expect(mounted.onChange).toHaveBeenCalledTimes(2);
  }, 20_000);

  it('retains the preview but suppresses source picks while unavailable or after loading failure', async () => {
    addSource('points', createBinding());
    const mounted = mountPlayground();
    const deck = await mounted.ready();
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

    sources.add({dataSourceId: 'points', dataSource: null, forceUpdate: true});
    expect(mounted.onError).toHaveBeenCalledTimes(1);
    expect(getLayer(deck)).toBe(acceptedLayer);
    pick();
    expect(mounted.onSelect).toHaveBeenLastCalledWith(null);

    addSource('points', Promise.reject(new Error('Source failed to load')));
    expect(mounted.onError).toHaveBeenCalledTimes(1);
    pick();
    expect(mounted.onSelect).toHaveBeenLastCalledWith(null);
    await vi.waitFor(() => expect(mounted.onError).toHaveBeenCalledTimes(2));
    expect(getLayer(deck)).toBe(acceptedLayer);
    expect(mounted.host.querySelector('canvas')).toBe(canvas);
    pick();
    expect(mounted.onSelect).toHaveBeenLastCalledWith(null);

    const nextRows = [ROWS[1]];
    addSource('points', createBinding(nextRows));
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
    let resolveSource!: (binding: PlaygroundDataBinding) => void;
    const pending = new Promise<PlaygroundDataBinding>(resolve => {
      resolveSource = resolve;
    });
    addSource('points', pending);
    const first = mountPlayground();
    const second = mountPlayground();
    for (const mounted of [first, second]) {
      expect(mounted.onError).not.toHaveBeenCalled();
      expect(mounted.onChange).not.toHaveBeenCalled();
    }
    first.playground.finalize();
    expect(sources.listDataSources()).toEqual([{dataSourceId: 'points', status: 'pending'}]);

    resolveSource(createBinding());
    const deck = await second.ready();
    expect(getLayer(deck).props.data).toBe(ROWS);
    expect(second.onChange).toHaveBeenCalledTimes(1);
    expect(first.host.children).toHaveLength(0);
    expect(first.onLoad).not.toHaveBeenCalled();

    const nextRows = [ROWS[0]];
    addSource('points', createBinding(nextRows));
    expect(getLayer(deck).props.data).toBe(nextRows);
    expect(second.onChange).toHaveBeenCalledTimes(1);
    expect(second.onError).not.toHaveBeenCalled();
    expect(first.onChange).not.toHaveBeenCalled();
    expect(first.onError).not.toHaveBeenCalled();
  }, 20_000);
});

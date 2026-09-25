// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  Deck,
  OrthographicViewport,
  WebMercatorViewport,
  type DeckProps,
  type PickingInfo
} from '@deck.gl/core';
import {ScatterplotLayer} from '@deck.gl/layers';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {DeckPlayground, Playground, ScatterplotLayerSchema} from '../src/index';

const ROWS = [
  {id: 'west', position: [-122.4, 37.8]},
  {id: 'east', position: [-122.3, 37.8]}
];
const INITIAL_VIEW_STATE = {longitude: -122.4, latitude: 37.8, zoom: 10};
const REGISTRY = {
  layers: {ScatterplotLayer: {type: ScatterplotLayer, schema: ScatterplotLayerSchema}}
};
const PLAYGROUNDS: {finalize: () => void}[] = [];
const HOSTS: HTMLElement[] = [];

function createHost(): HTMLDivElement {
  const host = document.createElement('div');
  host.style.width = '900px';
  host.style.height = '500px';
  document.body.append(host);
  HOSTS.push(host);
  return host;
}

function createDocument(radius = 4, initialViewState = INITIAL_VIEW_STATE) {
  return {
    initialViewState,
    controller: {scrollZoom: {smooth: false}},
    layers: [
      {
        '@@type': 'ScatterplotLayer',
        id: 'points',
        data: {'@@data': 'points'},
        getPosition: '@@=position',
        getRadius: radius,
        radiusUnits: 'pixels',
        pickable: true
      }
    ]
  };
}

function createBindings(rows = ROWS) {
  return {points: {data: rows, getRowId: (row: (typeof ROWS)[number]) => row.id}};
}

function mountDeck(options: Partial<ConstructorParameters<typeof DeckPlayground>[0]> = {}) {
  const host = createHost();
  const setProps = vi.spyOn(Deck.prototype, 'setProps');
  const callbacks = {
    onLoad: vi.fn(),
    onError: vi.fn(),
    onChange: vi.fn(),
    onSelect: vi.fn(),
    onViewStateChange: vi.fn()
  };
  const playground = new DeckPlayground({
    parentElement: host,
    templates: {points: createDocument()},
    registry: REGISTRY,
    bindings: createBindings(),
    ...callbacks,
    ...options
  });
  PLAYGROUNDS.push(playground);
  const ready = async () => {
    await vi.waitFor(() => expect(callbacks.onLoad).toHaveBeenCalledTimes(1), {timeout: 10_000});
    const deck = setProps.mock.contexts[0] as Deck;
    await vi.waitFor(() =>
      expect(deck.getViewports()[0]).toMatchObject({
        width: host.clientWidth,
        height: host.clientHeight
      })
    );
    return {deck, canvas: host.querySelector('canvas')!};
  };
  return {playground, host, setProps, ready, ...callbacks};
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
  for (const playground of PLAYGROUNDS.splice(0)) {
    playground.finalize();
  }
  for (const host of HOSTS.splice(0)) {
    host.remove();
  }
  vi.restoreAllMocks();
});

describe('Playground rendering lifecycle', () => {
  it('shows the example picker as a sidebar tab and returns to the JSON editor after selection', () => {
    const onChange = vi.fn();
    const playground = new Playground({
      parentElement: createHost(),
      templates: {
        first: {metadata: {title: 'First example'}, layers: []},
        second: {metadata: {title: 'Second example'}, layers: []}
      },
      onChange
    });
    PLAYGROUNDS.push(playground);

    const tabList = playground.parentElement.querySelector('[data-panel-tabs]')!;
    const tabs = Array.from(tabList.querySelectorAll<HTMLButtonElement>('button'));
    expect(tabs.map(tab => tab.textContent)).toEqual(['JSON', 'Examples']);
    const examplesTab = tabs[1];
    examplesTab.click();
    expect(playground.parentElement.querySelector('[data-template="second"]')).not.toBeNull();
    const pickerPanel = Array.from(tabList.parentElement?.children[1].children ?? []).find(
      child => child.getAttribute('aria-hidden') === 'false'
    );
    expect(pickerPanel?.querySelector('[data-template="second"]')).not.toBeNull();

    playground.parentElement.querySelector<HTMLElement>('[data-template="second"]')?.click();
    expect(onChange).toHaveBeenLastCalledWith({layers: []}, expect.stringContaining('"layers"'));
    const panelStack = tabList.parentElement?.children[1];
    const activePanel = Array.from(panelStack?.children ?? []).find(
      child => child.getAttribute('aria-hidden') === 'false'
    );
    expect(activePanel?.querySelector('[data-text-editor-root]')).not.toBeNull();
  });

  it('keeps simultaneously mounted editor models independent through edits and disposal', async () => {
    const {editor} = await import('monaco-editor');
    const originalModels = new Set(editor.getModels());
    const first = new Playground({
      parentElement: createHost(),
      templates: {first: {label: 'first'}}
    });
    const secondChange = vi.fn();
    const second = new Playground({
      parentElement: createHost(),
      templates: {second: {label: 'second'}},
      onChange: secondChange
    });
    PLAYGROUNDS.push(first, second);
    await vi.waitFor(() => {
      expect(editor.getModels().filter(model => !originalModels.has(model))).toHaveLength(2);
    });
    const models = editor.getModels().filter(model => !originalModels.has(model));
    const firstModel = models.find(model => JSON.parse(model.getValue()).label === 'first')!;
    const secondModel = models.find(model => JSON.parse(model.getValue()).label === 'second')!;
    expect(firstModel.uri.toString()).not.toBe(secondModel.uri.toString());

    first.setText('{"label":"updated-first"}');
    await vi.waitFor(() => expect(firstModel.getValue()).toBe('{"label":"updated-first"}'));
    expect(JSON.parse(secondModel.getValue())).toEqual({label: 'second'});

    first.finalize();
    expect(firstModel.isDisposed()).toBe(true);
    expect(secondModel.isDisposed()).toBe(false);
    secondModel.setValue('{"label":"edited-second"}');
    expect(secondChange).toHaveBeenLastCalledWith(
      {label: 'edited-second'},
      '{"label":"edited-second"}'
    );
    second.finalize();
    expect(secondModel.isDisposed()).toBe(true);
  });

  it('updates a persistent preview and retains it through invalid edits', () => {
    const host = createHost();
    const preview = document.createElement('output');
    const onError = vi.fn();
    const onChange = vi.fn();
    const finalize = vi.fn();
    const update = vi.fn((element: HTMLElement, value: unknown) => {
      if (!preview.parentElement) {
        element.append(preview);
      }
      preview.textContent = JSON.stringify(value);
    });
    const playground = new Playground({
      parentElement: host,
      templates: {first: {count: 1}},
      renderer: {update, finalize},
      onError,
      onChange
    });
    PLAYGROUNDS.push(playground);

    expect(update).toHaveBeenCalledTimes(1);
    expect(preview.textContent).toBe('{"count":1}');
    playground.setText('{');
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(update).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(playground.previewElement.firstChild).toBe(preview);

    playground.setText('{"count":2}');
    expect(update).toHaveBeenCalledTimes(2);
    expect(preview.textContent).toBe('{"count":2}');
    expect(playground.previewElement.firstChild).toBe(preview);
    expect(finalize).not.toHaveBeenCalled();

    playground.finalize();
    playground.finalize();
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(host.children).toHaveLength(0);
    expect(host.classList.contains('deckgl-playground')).toBe(false);
    expect(() => playground.setText('{}')).toThrow(/finalized/i);
    expect(() => playground.setTemplate('first')).toThrow(/finalized/i);
    expect(() => playground.setTemplates({next: {}})).toThrow(/finalized/i);
  });

  it('cleans up legacy render callbacks exactly once per successful replacement', () => {
    const cleanup = vi.fn();
    const render = vi.fn((element: HTMLElement, value: unknown) => {
      const preview = document.createElement('output');
      preview.textContent = JSON.stringify(value);
      element.append(preview);
      return cleanup;
    });
    const playground = new Playground({
      parentElement: createHost(),
      templates: {first: {count: 1}},
      render
    });
    PLAYGROUNDS.push(playground);
    const originalPreview = playground.previewElement.firstChild;

    playground.setText('{');
    expect(render).toHaveBeenCalledTimes(1);
    expect(cleanup).not.toHaveBeenCalled();
    playground.setText('{"count":2}');
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(playground.previewElement.children).toHaveLength(1);
    expect(playground.previewElement.firstChild).not.toBe(originalPreview);

    playground.finalize();
    playground.finalize();
    expect(cleanup).toHaveBeenCalledTimes(2);
  });
});

describe('DeckPlayground browser lifecycle', () => {
  it('reuses its canvas and preserves an interactive camera across edits and filtering', async () => {
    const finalize = vi.spyOn(Deck.prototype, 'finalize');
    const {playground, host, setProps, onLoad, onError, ready} = mountDeck();
    const {deck, canvas} = await ready();
    const getLayer = () => (deck.props.layers as ScatterplotLayer[])[0];
    await vi.waitFor(() => expect(getLayer().isLoaded).toBe(true));
    expect(getLayer().props.data).toBe(ROWS);

    zoomCanvas(canvas!);
    await vi.waitFor(() => expect(deck.getViewports()[0].zoom).not.toBe(INITIAL_VIEW_STATE.zoom));
    const interactiveZoom = deck.getViewports()[0].zoom;

    setProps.mockClear();
    const nextViewState = {...INITIAL_VIEW_STATE, zoom: 8};
    playground.setText(JSON.stringify(createDocument(9, nextViewState)));
    expect(host.querySelector('canvas')).toBe(canvas);
    expect(getLayer().props.getRadius).toBe(9);
    expect(deck.getViewports()[0].zoom).toBe(interactiveZoom);
    expect(setProps.mock.calls.every(([props]) => !('initialViewState' in props))).toBe(true);

    const filteredRows = [ROWS[1]];
    expect(playground.setBindings(createBindings(filteredRows))).toBe(true);
    expect(getLayer().props.data).toBe(filteredRows);
    expect(host.querySelector('canvas')).toBe(canvas);
    expect(deck.getViewports()[0].zoom).toBe(interactiveZoom);
    expect(onLoad).toHaveBeenCalledTimes(1);

    playground.resetView();
    expect(deck.getViewports()[0].zoom).toBe(nextViewState.zoom);

    zoomCanvas(canvas!);
    await vi.waitFor(() => expect(deck.getViewports()[0].zoom).not.toBe(nextViewState.zoom));
    playground.resetView();
    expect(deck.getViewports()[0].zoom).toBe(nextViewState.zoom);

    const topologyViewState = {...INITIAL_VIEW_STATE, zoom: 6};
    playground.setText(
      JSON.stringify({
        ...createDocument(9, topologyViewState),
        views: {'@@type': 'MapView', id: 'detail'}
      })
    );
    expect(deck.getViewports()[0].id).toBe('detail');
    expect(deck.getViewports()[0].zoom).toBe(topologyViewState.zoom);
    expect(host.querySelector('canvas')).toBe(canvas);
    expect(onError).not.toHaveBeenCalled();
    playground.finalize();
    playground.finalize();
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(canvas!.isConnected).toBe(false);
    expect(host.children).toHaveLength(0);
    expect(() => playground.setBindings(createBindings())).toThrow(/finalized/i);
    expect(() => playground.resetView()).toThrow(/finalized/i);
  }, 20_000);

  it('replaces incompatible view types and their camera state together', async () => {
    const orthographicDocument = {
      views: {'@@type': 'OrthographicView', id: 'main'},
      initialViewState: {target: [0, 0, 0], zoom: [1, 2]}
    };
    const {playground, host, onError, ready} = mountDeck({
      templates: {orthographic: orthographicDocument}
    });
    const {deck, canvas} = await ready();
    expect(deck.getViewports()[0]).toBeInstanceOf(OrthographicViewport);

    playground.setText(
      JSON.stringify({
        views: {'@@type': 'MapView', id: 'main'},
        initialViewState: INITIAL_VIEW_STATE,
        controller: {
          maxBounds: [
            [-123, 37],
            [-122, 38]
          ]
        }
      })
    );
    expect(deck.getViewports()[0]).toBeInstanceOf(WebMercatorViewport);
    expect(deck.getViewports()[0].zoom).toBe(INITIAL_VIEW_STATE.zoom);
    expect(host.querySelector('canvas')).toBe(canvas);
    expect(onError).not.toHaveBeenCalled();

    playground.setText(JSON.stringify(orthographicDocument));
    expect(deck.getViewports()[0]).toBeInstanceOf(OrthographicViewport);
    expect(onError).not.toHaveBeenCalled();
  }, 20_000);

  it('restores default interaction after removing controller and honors a disabled view', async () => {
    const documentWithoutController: Record<string, unknown> = createDocument();
    delete documentWithoutController.controller;
    const {playground, onViewStateChange, ready} = mountDeck({
      templates: {points: {...documentWithoutController, controller: false}}
    });
    const {deck, canvas} = await ready();
    expect(deck.props.controller).toBe(false);

    playground.setText(JSON.stringify(documentWithoutController));
    expect(deck.props.controller).toBe(true);
    zoomCanvas(canvas);
    await vi.waitFor(() => expect(deck.getViewports()[0].zoom).not.toBe(INITIAL_VIEW_STATE.zoom));

    playground.setText(
      JSON.stringify({
        ...documentWithoutController,
        views: {'@@type': 'MapView', id: 'fixed', controller: false}
      })
    );
    expect(deck.props.controller).toBeNull();
    expect(deck.getViewports()[0].zoom).toBe(INITIAL_VIEW_STATE.zoom);
    onViewStateChange.mockClear();
    zoomCanvas(canvas);
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    expect(onViewStateChange).not.toHaveBeenCalled();
    expect(deck.getViewports()[0].zoom).toBe(INITIAL_VIEW_STATE.zoom);

    playground.setText(
      JSON.stringify({
        ...documentWithoutController,
        views: {'@@type': 'MapView', id: 'fixed'}
      })
    );
    zoomCanvas(canvas);
    await vi.waitFor(() => expect(deck.getViewports()[0].zoom).not.toBe(INITIAL_VIEW_STATE.zoom));
  }, 20_000);

  it('recovers from invalid initial text and keeps the last valid rendering after errors', async () => {
    const {playground, host, onError, onChange, ready} = mountDeck({templates: {points: '{'}});
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(host.querySelector('canvas')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();

    playground.setText(JSON.stringify(createDocument()));
    const {deck, canvas} = await ready();
    const layers = deck.props.layers;

    const invalidDocument = createDocument();
    playground.setText(
      JSON.stringify({
        ...invalidDocument,
        layers: [{...invalidDocument.layers[0], radiusMinPixels: -1}]
      })
    );
    expect(onError).toHaveBeenCalledTimes(2);
    expect(deck.props.layers).toBe(layers);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(host.querySelector('canvas')).toBe(canvas);

    expect(playground.setBindings({})).toBe(false);
    expect(onError).toHaveBeenCalledTimes(3);
    expect(deck.props.layers).toBe(layers);
    playground.setText(JSON.stringify(createDocument(6)));
    expect(onChange).toHaveBeenCalledTimes(2);
    expect((deck.props.layers as ScatterplotLayer[])[0].props.data).toBe(ROWS);
    expect(host.querySelector('canvas')).toBe(canvas);
  }, 20_000);

  it('recovers an edited document when a missing local binding is supplied', async () => {
    const {playground, host, onError, onChange, ready} = mountDeck();
    const {deck, canvas} = await ready();
    const originalLayers = deck.props.layers;
    zoomCanvas(canvas);
    await vi.waitFor(() => expect(deck.getViewports()[0].zoom).not.toBe(INITIAL_VIEW_STATE.zoom));
    const interactiveZoom = deck.getViewports()[0].zoom;

    const edited = createDocument(9, {...INITIAL_VIEW_STATE, zoom: 6});
    edited.layers[0].data = {'@@data': 'replacement'};
    const text = JSON.stringify(edited);
    playground.setText(text);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({message: 'Missing playground data binding: replacement'})
    );
    expect(deck.props.layers).toBe(originalLayers);
    expect(onChange).toHaveBeenCalledTimes(1);

    const rows = [{id: 'replacement', position: [-122.2, 37.9]}];
    const bindings = {...createBindings(), replacement: {data: rows}};
    expect(playground.setBindings(bindings)).toBe(true);
    const layer = (deck.props.layers as ScatterplotLayer[])[0];
    expect(layer.props.getRadius).toBe(9);
    expect(layer.props.data).toBe(rows);
    expect(host.querySelector('canvas')).toBe(canvas);
    expect(deck.getViewports()[0].zoom).toBe(interactiveZoom);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith(edited, text);

    const refreshedRows = [...rows];
    expect(playground.setBindings({...bindings, replacement: {data: refreshedRows}})).toBe(true);
    expect((deck.props.layers as ScatterplotLayer[])[0].props.data).toBe(refreshedRows);
    expect(onChange).toHaveBeenCalledTimes(2);
  }, 20_000);

  it('reports stable bound row identities after filtering and clears background selection', async () => {
    const {playground, onSelect, ready} = mountDeck();
    const {deck} = await ready();
    const originalLayer = (deck.props.layers as ScatterplotLayer[])[0];

    playground.setBindings(createBindings([ROWS[1]]));
    const layer = (deck.props.layers as ScatterplotLayer[])[0];
    const onClick = deck.props.onClick as NonNullable<DeckProps['onClick']>;
    onClick({picked: true, index: 0, object: ROWS[1], layer} as PickingInfo, undefined!);
    expect(onSelect).toHaveBeenLastCalledWith({
      bindingId: 'points',
      layerId: 'points',
      rowId: 'east',
      index: 0,
      object: ROWS[1]
    });

    for (const info of [
      {picked: true, index: 0, object: {points: [ROWS[1]]}, layer},
      {picked: true, index: 0, object: ROWS[0], layer: originalLayer},
      {picked: false, index: -1, object: undefined, layer: null}
    ]) {
      onClick(info as PickingInfo, undefined!);
      expect(onSelect).toHaveBeenLastCalledWith(null);
    }

    playground.setBindings(createBindings([ROWS[1], ROWS[0]]));
    onClick(
      {picked: true, index: 0, object: ROWS[0], layer: originalLayer} as PickingInfo,
      undefined!
    );
    expect(onSelect).toHaveBeenLastCalledWith({
      bindingId: 'points',
      layerId: 'points',
      rowId: 'west',
      index: 1,
      object: ROWS[0]
    });
  }, 20_000);
});

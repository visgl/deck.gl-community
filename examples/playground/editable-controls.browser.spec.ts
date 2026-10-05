// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck} from '@deck.gl/core';
import {DeckPlayground} from '@deck.gl-community/playground';
import {
  type EditableGeoJsonLayer,
  DrawPointMode,
  DrawLineStringMode,
  type DrawPolygonMode,
  ModifyMode,
  TransformMode,
  ViewMode
} from '@deck.gl-community/editable-layers';
import {page} from 'vitest/browser';
import {afterEach, expect, test, vi} from 'vitest';
import {createEditablePlaygroundControls} from './editable-controls';
import {createPlaygroundRegistry} from './registry';
import template from './examples/15-editable-geojson.json';

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  vi.restoreAllMocks();
});

test('selects and edits features through the map and the edit-mode tray', async () => {
  await page.viewport(1200, 850);
  const host = document.createElement('div');
  host.style.cssText = 'width:1200px;height:800px';
  document.body.append(host);
  const controls = createEditablePlaygroundControls();
  const setProps = vi.spyOn(Deck.prototype, 'setProps');
  const onLoad = vi.fn();
  const onError = vi.fn(controls.suspend);
  const {metadata: _metadata, ...editable} = template;
  const playground = new DeckPlayground({
    parentElement: host,
    templates: {
      editable: {...editable, mapStyle: null},
      empty: {name: 'Empty', mapStyle: null, layers: []}
    },
    registry: createPlaygroundRegistry(controls.constants),
    onLoad,
    onError,
    onChange: controls.onChange
  });
  controls.connect(playground);
  cleanup = () => {
    playground.finalize();
    host.remove();
  };
  await vi.waitFor(() => expect(onLoad).toHaveBeenCalledOnce(), {timeout: 10_000});
  const deck = setProps.mock.contexts.at(-1) as Deck;
  const getLayer = () =>
    (deck.props.layers as EditableGeoJsonLayer[]).find(layer => layer.id === 'editable-area')!;
  const ready = () => vi.waitFor(() => expect(getLayer().isLoaded).toBe(true));
  await ready();
  expect(deck.props.widgets?.[0]).toBe(controls.constants.playgroundEditModeTray);
  const button = (title: string) =>
    page.elementLocator(host.querySelector<HTMLButtonElement>(`button[title="${title}"]`)!);
  const canvas = host.querySelector<HTMLCanvasElement>('.deckgl-playground-preview > canvas')!;
  canvas.id = 'editable-test-canvas';
  const trayBounds = host.querySelector('.deck-widget-edit-mode-tray')!.getBoundingClientRect();
  const canvasBounds = canvas.getBoundingClientRect();
  expect(trayBounds.right).toBeLessThanOrEqual(canvasBounds.right);
  expect(trayBounds.bottom).toBeLessThanOrEqual(canvasBounds.bottom);
  expect(trayBounds.width).toBeGreaterThan(200);
  const clickPosition = async (position: number[]) => {
    const [x, y] = deck.getViewports()[0].project(position);
    await page.elementLocator(canvas).click({position: {x, y}});
  };
  await clickPosition([-122.42, 37.77]);
  await vi.waitFor(() => expect(getLayer().props.selectedFeatureIndexes).toEqual([0]));
  await button('Edit vertices').click();
  expect(getLayer().props.mode).toBe(ModifyMode);
  await ready();
  await button('Move, rotate, and scale').click();
  expect(getLayer().props.mode).toBe(TransformMode);
  await ready();
  await button('Draw a point').click();
  expect(getLayer().props.mode).toBe(DrawPointMode);
  await ready();
  await clickPosition([-122.4, 37.79]);
  await vi.waitFor(() => expect(getLayer().props.data.features).toHaveLength(2));
  expect(getLayer().props.data.features[1].geometry.type).toBe('Point');
  await button('Select features').click();
  expect(getLayer().props.mode).toBe(ViewMode);
  await ready();
  await clickPosition([-122.4, 37.79]);
  await vi.waitFor(() => expect(getLayer().props.selectedFeatureIndexes).toEqual([1]));
  await clickPosition([-122.38, 37.8]);
  await vi.waitFor(() => expect(getLayer().props.selectedFeatureIndexes).toEqual([]));

  await button('Draw a line').click();
  await ready();
  await clickPosition([-122.4, 37.765]);
  await ready();
  expect(onError.mock.calls).toEqual([]);
  await vi.waitFor(() =>
    expect((getLayer().getActiveMode() as DrawLineStringMode).getClickSequence()).toHaveLength(1)
  );
  await clickPosition([-122.38, 37.765]);
  await ready();
  await vi.waitFor(() =>
    expect((getLayer().getActiveMode() as DrawLineStringMode).getClickSequence()).toHaveLength(2)
  );
  // Clicking the last handle finishes the line.
  await clickPosition([-122.38, 37.765]);
  await vi.waitFor(() => expect(getLayer().props.data.features).toHaveLength(3));
  expect(getLayer().props.data.features[2].geometry.type).toBe('LineString');

  await button('Draw a polygon').click();
  await ready();
  let polygonClicks = 0;
  for (const position of [
    [-122.395, 37.785],
    [-122.375, 37.785],
    [-122.38, 37.77],
    [-122.395, 37.785]
  ]) {
    await clickPosition(position);
    polygonClicks++;
    await vi.waitFor(() =>
      expect((getLayer().getActiveMode() as DrawPolygonMode).getClickSequence()).toHaveLength(
        polygonClicks < 4 ? polygonClicks : 0
      )
    );
    await ready();
  }
  await vi.waitFor(() => expect(getLayer().props.data.features).toHaveLength(4));
  expect(getLayer().props.data.features[3].geometry.type).toBe('Polygon');
  await button('Select features').click();

  // An invalid draft must not be replaced by clicks on the retained preview.
  playground.setText('{');
  await button('Draw a point').click();
  expect(getLayer().props.mode).toBe(ViewMode);
  expect(onError).toHaveBeenCalledOnce();
  onError.mockClear();
  playground.setTemplate('empty');
  await vi.waitFor(() => expect(host.querySelector('.deck-widget-edit-mode-tray')).toBeNull());
  playground.setTemplate('editable');
  await vi.waitFor(() =>
    expect(host.querySelectorAll('.deck-widget-edit-mode-tray')).toHaveLength(1)
  );
  await button('Draw a point').click();
  const nextDeck = setProps.mock.contexts.at(-1) as Deck;
  expect(
    (nextDeck.props.layers as EditableGeoJsonLayer[]).find(layer => layer.id === 'editable-area')
      ?.props.mode
  ).toBe(DrawPointMode);
  expect(onError).not.toHaveBeenCalled();
}, 60_000);

// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {expect, test, vi} from 'vitest';
import {userEvent} from 'vitest/browser';
import 'maplibre-gl';
import {MapboxOverlay} from '@deck.gl/mapbox';
import {EditableGeoJsonLayer} from '../../src/editable-layers/editable-geojson-layer';
import {SelectionLayer} from '../../src/editable-layers/selection-layer';
import {DrawPolygonMode} from '../../src/edit-modes/draw-polygon-mode';
import {DrawPolygonByDraggingMode} from '../../src/edit-modes/draw-polygon-by-dragging-mode';
import {ModifyMode} from '../../src/edit-modes/modify-mode';
import {ViewMode} from '../../src/edit-modes/view-mode';

const maplibre = (globalThis as any).maplibregl;

async function drag(canvas: HTMLCanvasElement, from: number[], to: number[], release = true) {
  const rect = canvas.getBoundingClientRect();
  const eventAt = (x: number, y: number, buttons: number) => ({
    clientX: rect.left + x,
    clientY: rect.top + y,
    button: 0,
    buttons,
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true
  });
  const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  canvas.dispatchEvent(new PointerEvent('pointerdown', eventAt(from[0], from[1], 1)));
  canvas.dispatchEvent(new MouseEvent('mousedown', eventAt(from[0], from[1], 1)));
  for (const fraction of [0.25, 0.5, 0.75, 1]) {
    const x = from[0] + (to[0] - from[0]) * fraction;
    const y = from[1] + (to[1] - from[1]) * fraction;
    canvas.dispatchEvent(new PointerEvent('pointermove', eventAt(x, y, 1)));
    canvas.dispatchEvent(new MouseEvent('mousemove', eventAt(x, y, 1)));
    await frame();
  }
  if (release) {
    canvas.dispatchEvent(new PointerEvent('pointerup', eventAt(to[0], to[1], 0)));
    canvas.dispatchEvent(new MouseEvent('mouseup', eventAt(to[0], to[1], 0)));
  }
  await frame();
}

async function clickWithSmallJitter(canvas: HTMLCanvasElement, position: number[]) {
  const rect = canvas.getBoundingClientRect();
  const eventAt = (x: number, y: number, buttons: number) => ({
    clientX: rect.left + x,
    clientY: rect.top + y,
    button: 0,
    buttons,
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true
  });
  const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  const [x, y] = position;
  canvas.dispatchEvent(new PointerEvent('pointerdown', eventAt(x, y, 1)));
  canvas.dispatchEvent(new MouseEvent('mousedown', eventAt(x, y, 1)));
  canvas.dispatchEvent(new PointerEvent('pointermove', eventAt(x + 2, y, 1)));
  canvas.dispatchEvent(new MouseEvent('mousemove', eventAt(x + 2, y, 1)));
  await frame();
  canvas.dispatchEvent(new PointerEvent('pointerup', eventAt(x + 2, y, 0)));
  canvas.dispatchEvent(new MouseEvent('mouseup', eventAt(x + 2, y, 0)));
  canvas.dispatchEvent(new MouseEvent('click', {...eventAt(x + 2, y, 0), detail: 1}));
  await frame();
}

test.each([
  false,
  true
])('drawing, modification, and navigation work with interleaved: %s', async interleaved => {
  const container = document.createElement('div');
  container.style.cssText = 'width:512px;height:384px;position:relative';
  document.body.append(container);
  const map = new maplibre.Map({
    container,
    style: {version: 8, sources: {}, layers: []},
    center: [0, 0],
    zoom: 3,
    pixelRatio: 1
  });
  const overlay = new MapboxOverlay({interleaved});
  let data: any = {type: 'FeatureCollection', features: []};
  let layer: EditableGeoJsonLayer;
  let mode = DrawPolygonMode;
  let selectedFeatureIndexes: number[] = [];
  let eventTarget = interleaved ? null : map.getCanvas();
  const actions: any[] = [];
  const updateLayer = () => {
    layer = new EditableGeoJsonLayer({
      id: 'editable',
      data,
      mode,
      eventTarget,
      selectedFeatureIndexes,
      onEdit: action => {
        actions.push(action);
        data = action.updatedData;
        updateLayer();
      }
    });
    overlay.setProps({layers: [layer]});
  };
  const ready = () =>
    vi.waitFor(
      () => {
        expect(layer.getCurrentLayer()?.state.mode).toBeInstanceOf(mode);
        expect(layer.getCurrentLayer()?.isLoaded).toBe(true);
      },
      {timeout: 10000}
    );
  try {
    await new Promise<void>((resolve, reject) => {
      map.once('load', () => resolve());
      map.once('error', event => reject(event.error));
    });
    map.addControl(overlay);
    map.dragRotate.disable();
    const originalTouchAction = map.getCanvas().style.touchAction;
    updateLayer();
    await ready();
    const canvas = map.getCanvas();
    for (const [index, position] of [
      {x: 140, y: 120},
      {x: 300, y: 120},
      {x: 300, y: 250}
    ].entries()) {
      // Vitest scales click options in place for its test iframe.
      const expectedPosition =
        !interleaved && index === 0 ? {...position, x: position.x + 2} : position;
      if (!interleaved && index === 0) {
        await clickWithSmallJitter(canvas, [position.x, position.y]);
      } else {
        await userEvent.click(canvas, {position: {...position}});
      }
      expect(actions.filter(action => action.editType === 'addTentativePosition')).toHaveLength(
        index + 1
      );
      const actual = actions.at(-1).editContext.position;
      const projected = map.project(actual);
      // Browser iframe scaling rounds physical pointer coordinates.
      expect(Math.abs(projected.x - expectedPosition.x)).toBeLessThanOrEqual(1.5);
      expect(Math.abs(projected.y - expectedPosition.y)).toBeLessThanOrEqual(1.5);
      await ready();
    }
    await userEvent.dblClick(canvas, {position: {x: 300, y: 250}});
    expect(actions.filter(action => action.editType === 'addFeature')).toHaveLength(1);
    expect(data.features).toHaveLength(1);
    expect(map.getCenter().lng).toBeCloseTo(0, 8);
    expect(map.getCenter().lat).toBeCloseTo(0, 8);
    mode = ModifyMode;
    selectedFeatureIndexes = [0];
    updateLayer();
    await ready();
    await vi.waitFor(() =>
      expect(
        overlay
          .pickMultipleObjects({x: 140, y: 120, radius: 5, depth: 4})
          .some(info => info.object?.properties?.editHandleType === 'existing')
      ).toBe(true)
    );
    await drag(canvas, [140, 120], [115, 95]);
    await vi.waitFor(() =>
      expect(actions.some(action => action.editType === 'movePosition')).toBe(true)
    );
    const movedPosition = data.features[0].geometry.coordinates[0][0];
    const expected = map.unproject([115, 95]);
    expect(movedPosition[0]).toBeCloseTo(expected.lng);
    expect(movedPosition[1]).toBeCloseTo(expected.lat);
    expect(map.getCenter().lng).toBeCloseTo(0, 8);
    expect(map.getCenter().lat).toBeCloseTo(0, 8);
    expect(map.dragPan.isEnabled()).toBe(true);
    expect(map.dragRotate.isEnabled()).toBe(false);

    if (!interleaved) {
      // Replacing the target detaches input from the old map canvas.
      const otherCanvas = document.createElement('canvas');
      document.body.append(otherCanvas);
      mode = DrawPolygonByDraggingMode;
      selectedFeatureIndexes = [];
      updateLayer();
      await ready();
      await drag(canvas, [400, 80], [440, 110], false);
      await ready();
      const cancellations = actions.filter(action => action.editType === 'cancelFeature').length;
      eventTarget = otherCanvas;
      updateLayer();
      await ready();
      expect(actions.filter(action => action.editType === 'cancelFeature')).toHaveLength(
        cancellations + 1
      );
      mode = DrawPolygonMode;
      updateLayer();
      await ready();
      const actionCount = actions.filter(
        action => action.editType === 'addTentativePosition'
      ).length;
      await userEvent.click(canvas, {position: {x: 400, y: 300}});
      expect(actions.filter(action => action.editType === 'addTentativePosition')).toHaveLength(
        actionCount
      );
      await userEvent.click(otherCanvas, {position: {x: 100, y: 80}});
      await vi.waitFor(() =>
        expect(actions.filter(action => action.editType === 'addTentativePosition')).toHaveLength(
          actionCount + 1
        )
      );
      const clickCancelCount = actions.filter(action => action.editType === 'cancelFeature').length;
      eventTarget = canvas;
      updateLayer();
      await ready();
      await vi.waitFor(() =>
        expect(actions.filter(action => action.editType === 'cancelFeature')).toHaveLength(
          clickCancelCount + 1
        )
      );
      expect(
        (layer.getCurrentLayer()?.state.mode as DrawPolygonMode).getClickSequence()
      ).toHaveLength(0);
      otherCanvas.remove();
      await userEvent.click(canvas, {position: {x: 400, y: 300}});
      expect(actions.filter(action => action.editType === 'addTentativePosition')).toHaveLength(
        actionCount + 2
      );
    }

    mode = ViewMode;
    updateLayer();
    await ready();
    const actionCount = actions.length;
    await drag(canvas, [100, 100], [180, 155]);
    await vi.waitFor(() => expect(Math.abs(map.getCenter().lng)).toBeGreaterThan(1));
    expect(actions).toHaveLength(actionCount);
    expect(map.dragPan.isEnabled()).toBe(true);
    expect(map.dragRotate.isEnabled()).toBe(false);

    overlay.setProps({layers: []});
    if (!interleaved) {
      await vi.waitFor(() => expect(canvas.style.touchAction).toBe(originalTouchAction));
    }
    await userEvent.click(canvas, {position: {x: 300, y: 200}});
    expect(actions).toHaveLength(actionCount);
  } finally {
    map.removeControl(overlay);
    overlay.finalize();
    map.remove();
    container.remove();
  }
}, 30000);

test('rectangle selection uses the map canvas in overlaid mode without panning the map', async () => {
  const container = document.createElement('div');
  container.style.cssText = 'width:512px;height:384px;position:relative';
  document.body.append(container);
  const map = new maplibre.Map({
    container,
    style: {version: 8, sources: {}, layers: []},
    center: [0, 0],
    zoom: 3,
    pixelRatio: 1
  });
  const overlay = new MapboxOverlay({interleaved: false});
  const target = new EditableGeoJsonLayer({
    id: 'target',
    data: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [-20, -20],
                [20, -20],
                [20, 20],
                [-20, 20],
                [-20, -20]
              ]
            ]
          },
          properties: {}
        }
      ]
    },
    pickable: true,
    mode: ViewMode
  });
  const selected: any[] = [];
  const selection = new SelectionLayer({
    id: 'selection',
    selectionType: 'rectangle',
    layerIds: ['target'],
    eventTarget: map.getCanvas(),
    onSelect: ({pickingInfos}) => selected.push(...pickingInfos)
  });
  try {
    await new Promise<void>((resolve, reject) => {
      map.once('load', () => resolve());
      map.once('error', event => reject(event.error));
    });
    overlay.setProps({layers: [target, selection]});
    map.addControl(overlay);
    map.dragRotate.disable();
    const center = map.getCenter();

    await vi.waitFor(() => {
      const layer = selection.getSubLayers()[0] as EditableGeoJsonLayer | undefined;
      expect(layer).toBeDefined();
      expect(layer?.isLoaded).toBe(true);
    });
    const innerEditableLayer = selection.getSubLayers()[0] as EditableGeoJsonLayer;
    await drag(map.getCanvas(), [150, 90], [360, 290]);

    expect.soft(innerEditableLayer).toBeDefined();
    expect.soft(innerEditableLayer?.props.eventTarget).toBe(map.getCanvas());
    expect.soft(innerEditableLayer?.state._editableLayerState.eventTarget).toBe(map.getCanvas());
    expect.soft(innerEditableLayer?._isEditing()).toBe(true);
    expect.soft(selected).toHaveLength(1);
    expect.soft(map.getCenter().lng).toBeCloseTo(center.lng, 8);
    expect.soft(map.getCenter().lat).toBeCloseTo(center.lat, 8);
    expect.soft(map.dragPan.isEnabled()).toBe(true);
  } finally {
    map.removeControl(overlay);
    overlay.finalize();
    map.remove();
    container.remove();
  }
}, 30000);

test.each([
  0, 1
])('shared input target keeps touch styles and editing alive when layer %i is removed first', async removedIndex => {
  const container = document.createElement('div');
  container.style.cssText = 'width:512px;height:384px;position:relative';
  document.body.append(container);
  const map = new maplibre.Map({
    container,
    style: {version: 8, sources: {}, layers: []},
    center: [0, 0],
    zoom: 3,
    pixelRatio: 1
  });
  const overlay = new MapboxOverlay({interleaved: false});
  const actions: string[] = [];
  try {
    await new Promise<void>((resolve, reject) => {
      map.once('load', () => resolve());
      map.once('error', event => reject(event.error));
    });
    map.addControl(overlay);
    const canvas = map.getCanvas();
    const originalTouchAction = canvas.style.touchAction;
    const layers = ['first', 'second'].map(
      id =>
        new EditableGeoJsonLayer({
          id,
          data: {type: 'FeatureCollection', features: []},
          eventTarget: canvas,
          mode: DrawPolygonMode,
          onEdit: action => actions.push(`${id}:${action.editType}`)
        })
    );
    overlay.setProps({layers});
    await vi.waitFor(() =>
      layers.forEach(layer => expect(layer.getCurrentLayer()?.isLoaded).toBe(true))
    );
    expect(canvas.style.touchAction).toBe('none');

    const removedLayer = layers[removedIndex];
    const remainingLayer = layers[1 - removedIndex];
    overlay.setProps({layers: [remainingLayer]});
    await vi.waitFor(() => expect(remainingLayer.getCurrentLayer()?.isLoaded).toBe(true));
    expect(canvas.style.touchAction).toBe('none');

    await userEvent.click(canvas, {position: {x: 200, y: 180}});
    await vi.waitFor(() =>
      expect(actions.some(action => action.startsWith(`${remainingLayer.id}:`))).toBe(true)
    );
    expect(actions.some(action => action.startsWith(`${removedLayer.id}:`))).toBe(false);

    overlay.setProps({layers: []});
    await vi.waitFor(() => expect(canvas.style.touchAction).toBe(originalTouchAction));
  } finally {
    map.removeControl(overlay);
    overlay.finalize();
    map.remove();
    container.remove();
  }
}, 30000);

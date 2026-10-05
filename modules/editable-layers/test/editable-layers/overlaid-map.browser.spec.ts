// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {expect, test, vi} from 'vitest';
import {userEvent} from 'vitest/browser';
import maplibregl from 'maplibre-gl';
import {MapboxOverlay} from '@deck.gl/mapbox';
import {EditableGeoJsonLayer} from '../../src/editable-layers/editable-geojson-layer';
import {DrawPolygonMode} from '../../src/edit-modes/draw-polygon-mode';
import {ModifyMode} from '../../src/edit-modes/modify-mode';
import {ViewMode} from '../../src/edit-modes/view-mode';

async function drag(canvas: HTMLCanvasElement, from: number[], to: number[]) {
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
  canvas.dispatchEvent(new PointerEvent('pointerup', eventAt(to[0], to[1], 0)));
  canvas.dispatchEvent(new MouseEvent('mouseup', eventAt(to[0], to[1], 0)));
  await frame();
}

test.each([
  false,
  true
])('drawing, modification, and navigation work with interleaved: %s', async interleaved => {
  const container = document.createElement('div');
  container.style.cssText = 'width:512px;height:384px;position:relative';
  document.body.append(container);
  const map = new maplibregl.Map({
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
      await userEvent.click(canvas, {position: {...position}});
      expect(actions.filter(action => action.editType === 'addTentativePosition')).toHaveLength(
        index + 1
      );
      const actual = actions.at(-1).editContext.position;
      const projected = map.project(actual);
      // Browser iframe scaling rounds physical pointer coordinates.
      expect(Math.abs(projected.x - position.x)).toBeLessThanOrEqual(1.5);
      expect(Math.abs(projected.y - position.y)).toBeLessThanOrEqual(1.5);
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
      eventTarget = otherCanvas;
      mode = DrawPolygonMode;
      selectedFeatureIndexes = [];
      updateLayer();
      await ready();
      const actionCount = actions.filter(
        action => action.editType === 'addTentativePosition'
      ).length;
      await userEvent.click(canvas, {position: {x: 400, y: 300}});
      expect(actions.filter(action => action.editType === 'addTentativePosition')).toHaveLength(
        actionCount
      );
      eventTarget = canvas;
      updateLayer();
      await ready();
      otherCanvas.remove();
      await userEvent.click(canvas, {position: {x: 400, y: 300}});
      expect(actions.filter(action => action.editType === 'addTentativePosition')).toHaveLength(
        actionCount + 1
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

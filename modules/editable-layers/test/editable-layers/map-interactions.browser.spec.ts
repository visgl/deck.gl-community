import {expect, test, vi} from 'vitest';
import 'maplibre-gl';
import {MapboxOverlay} from '@deck.gl/mapbox';
import {EditableGeoJsonLayer} from '../../src/editable-layers/editable-geojson-layer';
import {DrawRectangleMode} from '../../src/edit-modes/draw-rectangle-mode';
import {ModifyMode} from '../../src/edit-modes/modify-mode';
import {ViewMode} from '../../src/edit-modes/view-mode';

const maplibre = (globalThis as any).maplibregl;

test('interleaved editing preserves map controls, view navigation, and the application override', async () => {
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
  const overlay = new MapboxOverlay({interleaved: true});
  const actions: any[] = [];
  let layer: EditableGeoJsonLayer;
  let mode = DrawRectangleMode;
  let autoPreventMapInteractions = true;
  let data: any = {type: 'FeatureCollection', features: []};
  const updateLayer = () => {
    layer = new EditableGeoJsonLayer({
      id: 'editable',
      data,
      mode,
      modeConfig: {dragToDraw: true},
      autoPreventMapInteractions,
      selectedFeatureIndexes: [],
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
  const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  try {
    await new Promise<void>((resolve, reject) => {
      map.once('load', () => resolve());
      map.once('error', event => reject(event.error));
    });
    map.dragRotate.disable();
    map.addControl(overlay);
    updateLayer();
    await ready();
    const canvas = map.getCanvas();
    const bounds = canvas.getBoundingClientRect();
    const drag = async () => {
      const eventAt = (x, y, buttons) => ({
        clientX: bounds.left + x,
        clientY: bounds.top + y,
        button: 0,
        buttons,
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true
      });
      canvas.dispatchEvent(new PointerEvent('pointerdown', eventAt(100, 100, 1)));
      canvas.dispatchEvent(new MouseEvent('mousedown', eventAt(100, 100, 1)));
      for (const [x, y] of [
        [120, 115],
        [150, 135],
        [180, 155]
      ]) {
        canvas.dispatchEvent(new PointerEvent('pointermove', eventAt(x, y, 1)));
        canvas.dispatchEvent(new MouseEvent('mousemove', eventAt(x, y, 1)));
        await frame();
      }
      canvas.dispatchEvent(new PointerEvent('pointerup', eventAt(180, 155, 0)));
      canvas.dispatchEvent(new MouseEvent('mouseup', eventAt(180, 155, 0)));
      await frame();
    };
    await drag();
    await vi.waitFor(() =>
      expect(actions.filter(a => a.editType === 'addFeature')).toHaveLength(1)
    );
    expect(map.getCenter().lng).toBeCloseTo(0, 8);
    expect(map.getCenter().lat).toBeCloseTo(0, 8);
    expect(map.dragPan.isEnabled()).toBe(true);
    expect(map.dragRotate.isEnabled()).toBe(false);

    const finger = (identifier, x, y) =>
      new Touch({
        identifier,
        target: canvas,
        clientX: bounds.left + x,
        clientY: bounds.top + y
      });
    const sendTouch = async (type, touches, changedTouches) => {
      canvas.dispatchEvent(
        new TouchEvent(type, {
          touches,
          targetTouches: touches,
          changedTouches,
          bubbles: true,
          cancelable: true
        })
      );
      await frame();
    };
    for (const endType of ['touchend', 'touchcancel']) {
      map.stop();
      map.jumpTo({center: [0, 0], zoom: 3});
      let first = finger(1, 180, 140);
      let second = finger(2, 260, 140);
      await sendTouch('touchstart', [first], [first]);
      expect(map.dragPan.isActive()).toBe(false);
      await sendTouch('touchstart', [first, second], [second]);
      first = finger(1, 140, 140);
      second = finger(2, 300, 140);
      await sendTouch('touchmove', [first, second], [first, second]);
      await vi.waitFor(() => expect(map.getZoom()).toBeGreaterThan(3.5));
      await sendTouch(endType, [first], [second]);
      expect(map.touchZoomRotate.isActive()).toBe(false);
      await frame();
      map.stop();
      const center = map.getCenter();
      const zoom = map.getZoom();
      for (const [x, y] of [
        [180, 160],
        [220, 180],
        [260, 200]
      ]) {
        first = finger(1, x, y);
        await sendTouch('touchmove', [first], [first]);
      }
      expect(map.getCenter().lng).toBeCloseTo(center.lng, 8);
      expect(map.getCenter().lat).toBeCloseTo(center.lat, 8);
      expect(map.getZoom()).toBeCloseTo(zoom, 8);
      await sendTouch(endType, [], [first]);
      expect(map.dragPan.isActive()).toBe(false);
      expect(map.dragPan.isEnabled()).toBe(true);
      expect(map.dragRotate.isEnabled()).toBe(false);
    }
    map.stop();
    map.jumpTo({center: [0, 0], zoom: 3});

    mode = ViewMode;
    updateLayer();
    await ready();
    await drag();
    await vi.waitFor(() => expect(Math.abs(map.getCenter().lng)).toBeGreaterThan(1));
    expect(map.dragPan.isEnabled()).toBe(true);
    expect(map.dragRotate.isEnabled()).toBe(false);
    map.stop();
    map.jumpTo({center: [0, 0]});

    mode = DrawRectangleMode;
    autoPreventMapInteractions = false;
    updateLayer();
    await ready();
    await drag();
    await vi.waitFor(() => expect(Math.abs(map.getCenter().lng)).toBeGreaterThan(1));
    expect(map.dragRotate.isEnabled()).toBe(false);
  } finally {
    map.removeControl(overlay);
    overlay.finalize();
    map.remove();
    container.remove();
  }
}, 30000);

test('interleaved ModifyMode handle drag edits the feature without moving the map (#457)', async () => {
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
  const overlay = new MapboxOverlay({interleaved: true});
  const actions: any[] = [];
  const initialPosition = [-20, -15];
  let data: any = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [[initialPosition, [20, -15], [20, 15], [-20, 15], initialPosition]]
        }
      }
    ]
  };
  let layer: EditableGeoJsonLayer;
  const updateLayer = () => {
    layer = new EditableGeoJsonLayer({
      id: 'editable',
      data,
      mode: ModifyMode,
      selectedFeatureIndexes: [0],
      onEdit: action => {
        actions.push(action);
        data = action.updatedData;
        updateLayer();
      }
    });
    overlay.setProps({layers: [layer]});
  };
  const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  try {
    await new Promise<void>((resolve, reject) => {
      map.once('load', () => resolve());
      map.once('error', event => reject(event.error));
    });
    map.addControl(overlay);
    updateLayer();
    await vi.waitFor(() => {
      expect(layer.getCurrentLayer()?.state.mode).toBeInstanceOf(ModifyMode);
      expect(layer.getCurrentLayer()?.isLoaded).toBe(true);
    });

    const canvas = map.getCanvas();
    const bounds = canvas.getBoundingClientRect();
    const handle = map.project(initialPosition as [number, number]);
    const pick = overlay.pickObject({
      x: handle.x,
      y: handle.y,
      radius: 10,
      layerIds: ['editable']
    }) as any;
    expect(pick?.isGuide).toBe(true);

    const center = map.getCenter();
    const eventAt = (x: number, y: number, buttons: number) => ({
      clientX: bounds.left + x,
      clientY: bounds.top + y,
      button: 0,
      buttons,
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true
    });
    canvas.dispatchEvent(new PointerEvent('pointerdown', eventAt(handle.x, handle.y, 1)));
    canvas.dispatchEvent(new MouseEvent('mousedown', eventAt(handle.x, handle.y, 1)));
    for (const [x, y] of [
      [handle.x + 20, handle.y + 15],
      [handle.x + 40, handle.y + 30]
    ]) {
      canvas.dispatchEvent(new PointerEvent('pointermove', eventAt(x, y, 1)));
      canvas.dispatchEvent(new MouseEvent('mousemove', eventAt(x, y, 1)));
      await frame();
    }
    canvas.dispatchEvent(new PointerEvent('pointerup', eventAt(handle.x + 40, handle.y + 30, 0)));
    canvas.dispatchEvent(new MouseEvent('mouseup', eventAt(handle.x + 40, handle.y + 30, 0)));
    await frame();

    await vi.waitFor(() =>
      expect(actions.some(action => action.editType === 'movePosition')).toBe(true)
    );
    expect(data.features[0].geometry.coordinates[0][0]).not.toEqual(initialPosition);
    expect(map.getCenter().lng).toBeCloseTo(center.lng, 8);
    expect(map.getCenter().lat).toBeCloseTo(center.lat, 8);
  } finally {
    map.removeControl(overlay);
    overlay.finalize();
    map.remove();
    container.remove();
  }
}, 30000);

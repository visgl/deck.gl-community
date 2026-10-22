import {expect, test, vi} from 'vitest';
import 'maplibre-gl';
import {MapboxOverlay} from '@deck.gl/mapbox';
import {EditableGeoJsonLayer} from '../../src/editable-layers/editable-geojson-layer';
import {DrawPolygonMode} from '../../src/edit-modes/draw-polygon-mode';
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
      const pointerAt = (pointerId, isPrimary, x, y) =>
        new PointerEvent('pointerdown', {
          clientX: bounds.left + x,
          clientY: bounds.top + y,
          pointerId,
          pointerType: 'touch',
          isPrimary,
          button: 0,
          buttons: 1,
          bubbles: true,
          cancelable: true
        });
      canvas.dispatchEvent(pointerAt(1, true, 180, 140));
      const editableLayer = layer.getCurrentLayer() as EditableGeoJsonLayer;
      const editableState = editableLayer.state._editableLayerState;
      await sendTouch('touchstart', [first], [first]);
      expect(map.dragPan.isActive()).toBe(false);
      // The first finger is already moving an edit gesture when map navigation starts.
      editableState.didDrag = true;
      expect(editableState.didDrag).toBe(true);
      const primaryPress = editableState.pressScreenCoords;
      canvas.dispatchEvent(pointerAt(2, false, 260, 140));
      expect(editableState.didDrag).toBe(true);
      expect(editableState.pressScreenCoords).toBe(primaryPress);
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
      const currentLayer = layer.getCurrentLayer() as EditableGeoJsonLayer;
      const click = vi.spyOn(currentLayer, 'onLayerClick');
      canvas.dispatchEvent(
        new MouseEvent('click', {
          clientX: bounds.left + 260,
          clientY: bounds.top + 200,
          button: 0,
          detail: 1,
          bubbles: true,
          cancelable: true
        })
      );
      expect(click).not.toHaveBeenCalled();
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

test('interleaved ModifyMode handle drag edits the feature without moving the map', async () => {
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
  const initialPosition: [number, number] = [-20, -15];
  const data: any = {
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
  let editedData: any;
  const layer = new EditableGeoJsonLayer({
    id: 'editable',
    data,
    mode: ModifyMode,
    selectedFeatureIndexes: [0],
    onEdit: action => (editedData = action.updatedData)
  });
  try {
    await new Promise<void>(resolve => map.once('load', resolve));
    map.addControl(overlay);
    overlay.setProps({layers: [layer]});
    await vi.waitFor(() => expect(layer.getCurrentLayer()?.isLoaded).toBe(true));

    const canvas = map.getCanvas();
    const bounds = canvas.getBoundingClientRect();
    const handle = map.project(initialPosition);
    const center = map.getCenter();
    const frame = () => new Promise<void>(resolve => requestAnimationFrame(resolve));
    const dispatch = (type: string, x: number, y: number, buttons: number) => {
      const event = {
        clientX: bounds.left + x,
        clientY: bounds.top + y,
        button: 0,
        buttons,
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true
      };
      canvas.dispatchEvent(
        type.startsWith('pointer') ? new PointerEvent(type, event) : new MouseEvent(type, event)
      );
    };
    dispatch('pointerdown', handle.x, handle.y, 1);
    dispatch('mousedown', handle.x, handle.y, 1);
    dispatch('pointermove', handle.x + 40, handle.y + 30, 1);
    dispatch('mousemove', handle.x + 40, handle.y + 30, 1);
    await frame();
    dispatch('pointerup', handle.x + 40, handle.y + 30, 0);
    dispatch('mouseup', handle.x + 40, handle.y + 30, 0);
    await frame();

    await vi.waitFor(() => expect(editedData).toBeDefined());
    expect(editedData.features[0].geometry.coordinates[0][0]).not.toEqual(initialPosition);
    expect(map.getCenter().lng).toBeCloseTo(center.lng, 8);
    expect(map.getCenter().lat).toBeCloseTo(center.lat, 8);
  } finally {
    map.removeControl(overlay);
    overlay.finalize();
    map.remove();
    container.remove();
  }
}, 30000);

test('interleaved edit modes leave presses off their handles to the map', async () => {
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
  const corner: [number, number] = [-5, -5];
  let data: any = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {type: 'Polygon', coordinates: [[corner, [5, -5], [5, 5], [-5, 5], corner]]}
      }
    ]
  };
  const actions: any[] = [];
  // Pointer movement only refreshes the tentative guide.
  const edits = () => actions.filter(action => action.editType !== 'updateTentativeFeature');
  const mapClicks: any[] = [];
  let layer: EditableGeoJsonLayer;
  let mode: any = DrawPolygonMode;
  let selectedFeatureIndexes: number[] = [];
  const updateLayer = () => {
    layer = new EditableGeoJsonLayer({
      id: 'editable',
      data,
      mode,
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
  const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  try {
    await new Promise<void>(resolve => map.once('load', resolve));
    map.addControl(overlay);
    map.on('click', event => mapClicks.push(event));
    updateLayer();
    await ready();
    const canvas = map.getCanvas();
    const bounds = canvas.getBoundingClientRect();
    const dispatch = (type: string, [x, y]: number[], buttons: number) => {
      const init = {
        clientX: bounds.left + x,
        clientY: bounds.top + y,
        button: 0,
        buttons,
        detail: 1,
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true
      };
      canvas.dispatchEvent(
        type.startsWith('pointer') ? new PointerEvent(type, init) : new MouseEvent(type, init)
      );
    };
    const press = async (from: number[], to = from) => {
      dispatch('pointerdown', from, 1);
      dispatch('mousedown', from, 1);
      if (to !== from) {
        for (const t of [0.25, 0.5, 1]) {
          const at = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
          dispatch('pointermove', at, 1);
          dispatch('mousemove', at, 1);
          await frame();
        }
      }
      dispatch('pointerup', to, 0);
      dispatch('mouseup', to, 0);
      dispatch('click', to, 0);
      await frame();
    };
    const expectMapPan = async () => {
      await vi.waitFor(() => expect(Math.abs(map.getCenter().lng)).toBeGreaterThan(1));
      map.stop();
      map.jumpTo({center: [0, 0]});
      await ready();
    };

    // Click-to-draw: dragging empty map pans it, a click adds a vertex and reaches the map.
    await press([60, 60], [120, 100]);
    await expectMapPan();
    expect(edits()).toHaveLength(0);
    await press([80, 300]);
    await vi.waitFor(() =>
      expect(edits().map(action => action.editType)).toEqual(['addTentativePosition'])
    );
    // MapLibre ignores the click that ends the pan and receives the vertex click.
    expect(mapClicks).toHaveLength(1);

    mode = ModifyMode;
    selectedFeatureIndexes = [0];
    updateLayer();
    await ready();
    const editCount = edits().length;
    await press([60, 60], [120, 100]);
    await expectMapPan();
    expect(edits()).toHaveLength(editCount);
    const clickCount = mapClicks.length;

    // A vertex handle press edits without panning the map or clicking it.
    const handle = map.project(corner);
    await vi.waitFor(() =>
      expect(
        overlay
          .pickMultipleObjects({x: handle.x, y: handle.y, radius: 5, depth: 4})
          .some(info => info.object?.properties?.editHandleType === 'existing')
      ).toBe(true)
    );
    await press([handle.x, handle.y], [handle.x + 40, handle.y + 30]);
    await vi.waitFor(() =>
      expect(actions.some(a => a.editType === 'finishMovePosition')).toBe(true)
    );
    expect(data.features[0].geometry.coordinates[0][0]).not.toEqual(corner);
    expect(map.getCenter().lng).toBeCloseTo(0, 8);
    expect(map.getCenter().lat).toBeCloseTo(0, 8);
    expect(mapClicks).toHaveLength(clickCount);
    expect(map.dragPan.isEnabled()).toBe(true);
  } finally {
    map.removeControl(overlay);
    overlay.finalize();
    map.remove();
    container.remove();
  }
}, 30000);

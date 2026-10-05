import {expect, test, vi} from 'vitest';
import maplibregl from 'maplibre-gl';
import {MapboxOverlay} from '@deck.gl/mapbox';
import {EditableGeoJsonLayer} from '../../src/editable-layers/editable-geojson-layer';
import {DrawRectangleMode} from '../../src/edit-modes/draw-rectangle-mode';
import {ViewMode} from '../../src/edit-modes/view-mode';

test('interleaved editing preserves map controls, view navigation, and the application override', async () => {
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

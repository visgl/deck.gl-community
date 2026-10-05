import {test, expect, vi} from 'vitest';
import {EditableGeoJsonLayer} from '../../src/editable-layers/editable-geojson-layer';
import {DrawPointMode} from '../../src/edit-modes/draw-point-mode';
import {ViewMode} from '../../src/edit-modes/view-mode';
import {EditableH3ClusterLayer} from '../../src/editable-layers/editable-h3-cluster-layer';

test('Propagates update triggers to geojson layer', () => {
  const editableLayer = new EditableGeoJsonLayer({
    id: 'test',
    data: null,
    mode: DrawPointMode,
    selectedFeatureIndexes: [],
    updateTriggers: {
      getLineColor: ['lineColor'],
      getFillColor: ['fillColor'],
      getPointRadius: ['radius'],
      getLineWidth: ['width']
    }
  });
  // Avoid the need for deck.gl-initialized state
  editableLayer.createGuidesLayers = () => [];
  editableLayer.createTooltipsLayers = () => [];

  const [geoJsonLayer] = editableLayer.renderLayers();
  const {updateTriggers} = geoJsonLayer.props;
  expect(updateTriggers.getLineColor.flat()).toContain('lineColor');
  expect(updateTriggers.getFillColor.flat()).toContain('fillColor');
  expect(updateTriggers.getPointRadius.flat()).toContain('radius');
  expect(updateTriggers.getLineWidth.flat()).toContain('width');
});

test('active edit modes own primary map gestures while view mode and overrides allow navigation', () => {
  const layer = new EditableGeoJsonLayer({data: null, mode: DrawPointMode});
  layer.state = {_editableLayerState: {}, mode: new DrawPointMode()} as any;
  const press = (button = 0, type = 'mousedown') => ({type, button, stopPropagation: vi.fn()});
  const drawingPress = press();
  layer._onNativeMapInteraction(drawingPress as any);
  expect(drawingPress.stopPropagation).toHaveBeenCalledOnce();
  const secondaryPress = press(2);
  layer._onNativeMapInteraction(secondaryPress as any);
  expect(secondaryPress.stopPropagation).not.toHaveBeenCalled();
  const doubleClick = press(0, 'dblclick');
  layer._onNativeMapInteraction(doubleClick as any);
  expect(doubleClick.stopPropagation).toHaveBeenCalledOnce();

  const viewLayer = new EditableGeoJsonLayer({data: null, mode: ViewMode});
  viewLayer.state = {_editableLayerState: {}, mode: new ViewMode()} as any;
  const viewPress = press();
  viewLayer._onNativeMapInteraction(viewPress as any);
  expect(viewPress.stopPropagation).not.toHaveBeenCalled();

  const overrideLayer = new EditableGeoJsonLayer({
    data: null,
    mode: DrawPointMode,
    autoPreventMapInteractions: false
  });
  overrideLayer.state = layer.state;
  const overridePress = press();
  overrideLayer._onNativeMapInteraction(overridePress as any);
  expect(overridePress.stopPropagation).not.toHaveBeenCalled();
  const hiddenLayer = new EditableGeoJsonLayer({data: null, mode: DrawPointMode, visible: false});
  hiddenLayer.state = layer.state;
  const hiddenPress = press();
  hiddenLayer._onNativeMapInteraction(hiddenPress as any);
  expect(hiddenPress.stopPropagation).not.toHaveBeenCalled();
});

test('single-touch editing is isolated while a two-finger navigation gesture can finish', () => {
  const layer = new EditableGeoJsonLayer({data: null, mode: DrawPointMode});
  layer.state = {_editableLayerState: {}, mode: new DrawPointMode()} as any;
  const touch = (type, count) => ({type, touches: {length: count}, stopPropagation: vi.fn()});
  const single = touch('touchstart', 1);
  layer._onNativeMapInteraction(single as any);
  expect(single.stopPropagation).toHaveBeenCalledOnce();
  const secondFinger = touch('touchstart', 2);
  layer._onNativeMapInteraction(secondFinger as any);
  expect(secondFinger.stopPropagation).not.toHaveBeenCalled();
  const oneRemaining = touch('touchend', 1);
  layer._onNativeMapInteraction(oneRemaining as any);
  expect(oneRemaining.stopPropagation).not.toHaveBeenCalled();
  const navigationEnd = touch('touchend', 0);
  layer._onNativeMapInteraction(navigationEnd as any);
  expect(navigationEnd.stopPropagation).not.toHaveBeenCalled();
  const nextSingle = touch('touchstart', 1);
  layer._onNativeMapInteraction(nextSingle as any);
  const editEnd = touch('touchend', 0);
  layer._onNativeMapInteraction(editEnd as any);
  expect(editEnd.stopPropagation).toHaveBeenCalledOnce();
});

test('H3 editing forwards the application interaction override', () => {
  const layer = new EditableH3ClusterLayer({data: [], autoPreventMapInteractions: false});
  layer.state = {_editableLayerState: {}, tentativeHexagonIDs: []};
  expect(layer.renderLayers()[0].props.autoPreventMapInteractions).toBe(false);
});

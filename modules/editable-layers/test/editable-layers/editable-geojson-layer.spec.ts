import {test, expect, vi} from 'vitest';
import {EditableGeoJsonLayer} from '../../src/editable-layers/editable-geojson-layer';
import {DrawPointMode} from '../../src/edit-modes/draw-point-mode';
import {
  createClickEvent,
  createFeatureCollection,
  createStartDraggingEvent,
  createStopDraggingEvent
} from '../edit-modes/test-utils';

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

test('only forwards primary-button click and drag gestures to edit modes', () => {
  const mode = {
    getGuides: vi.fn(),
    getTooltips: vi.fn(),
    handleClick: vi.fn(),
    handleDoubleClick: vi.fn(),
    handlePointerMove: vi.fn(),
    handleStartDragging: vi.fn(),
    handleStopDragging: vi.fn(),
    handleDragging: vi.fn(),
    handleKeyUp: vi.fn()
  };
  const editableLayer = new EditableGeoJsonLayer({
    id: 'test',
    data: createFeatureCollection(),
    mode,
    selectedFeatureIndexes: []
  });
  editableLayer.state = {
    mode,
    cursor: null,
    lastPointerMoveEvent: null,
    selectedFeatures: [],
    editHandles: []
  } as any;

  const rightClickEvent = createClickEvent([0, 0]);
  rightClickEvent.sourceEvent = {button: 2};
  editableLayer.onLayerClick(rightClickEvent);
  expect(mode.handleClick).not.toHaveBeenCalled();

  const primaryClickEvent = createClickEvent([0, 0]);
  primaryClickEvent.sourceEvent = {button: 0};
  editableLayer.onLayerClick(primaryClickEvent);
  expect(mode.handleClick).toHaveBeenCalledOnce();

  const rightStartDragEvent = createStartDraggingEvent([0, 0], [0, 0]);
  rightStartDragEvent.sourceEvent = {button: 2};
  const rightStopDragEvent = createStopDraggingEvent([1, 1], [0, 0]);
  rightStopDragEvent.sourceEvent = {button: 2};
  editableLayer.onStartDragging(rightStartDragEvent);
  editableLayer.onDragging(rightStartDragEvent);
  editableLayer.onStopDragging(rightStopDragEvent);
  expect(mode.handleStartDragging).not.toHaveBeenCalled();
  expect(mode.handleDragging).not.toHaveBeenCalled();
  expect(mode.handleStopDragging).not.toHaveBeenCalled();

  const primaryStartDragEvent = createStartDraggingEvent([0, 0], [0, 0]);
  primaryStartDragEvent.sourceEvent = {button: 0};
  const primaryStopDragEvent = createStopDraggingEvent([1, 1], [0, 0]);
  primaryStopDragEvent.sourceEvent = {button: 0};
  editableLayer.onStartDragging(primaryStartDragEvent);
  editableLayer.onDragging(primaryStartDragEvent);
  editableLayer.onStopDragging(primaryStopDragEvent);
  expect(mode.handleStartDragging).toHaveBeenCalledOnce();
  expect(mode.handleDragging).toHaveBeenCalledOnce();
  expect(mode.handleStopDragging).toHaveBeenCalledOnce();
});

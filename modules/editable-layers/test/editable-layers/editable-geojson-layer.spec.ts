import {test, expect, vi} from 'vitest';
import {DrawPolygonByDraggingMode} from '../../src/edit-modes/draw-polygon-by-dragging-mode';
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

function createGestureLayer(mode = createGestureMode(), modeConfig = {}) {
  const layer = new EditableGeoJsonLayer({
    id: 'gesture-test',
    data: createFeatureCollection(),
    selectedFeatureIndexes: [],
    mode,
    modeConfig,
    onEdit: vi.fn()
  });
  layer.context = {
    deck: {
      eventManager: {on: vi.fn(), off: vi.fn()},
      pickMultipleObjects: () => []
    },
    layerManager: {getLayers: () => []},
    viewport: {unproject: coords => coords}
  } as any;
  layer.state = {mode} as any;
  layer.initializeState();
  return layer;
}

function createGestureMode() {
  return {
    getGuides: vi.fn(),
    getTooltips: vi.fn(),
    handleClick: vi.fn(),
    handleDoubleClick: vi.fn(),
    handlePointerMove: vi.fn(),
    handleStartDragging: vi.fn(),
    handleDragging: vi.fn(),
    handleStopDragging: vi.fn(),
    handleKeyUp: vi.fn()
  };
}

function createGestureEvent(type: string, srcEvent = {}) {
  return {
    type,
    offsetCenter: {x: 10, y: 20},
    srcEvent,
    stopImmediatePropagation: vi.fn()
  } as any;
}

test('accepted drag survives layer replacement and stops exactly once', () => {
  const mode = createGestureMode();
  const original = createGestureLayer(mode);
  original._onpanstart(createGestureEvent('panstart', {button: 0, buttons: 1}));

  // deck.gl transfers state, while instance fields belong to the new layer.
  const replacement = createGestureLayer(mode);
  replacement.state = original.state;
  replacement._onpanmove(createGestureEvent('panmove', {button: -1, buttons: 1}));
  replacement._onpanend(createGestureEvent('panend', {button: 0, buttons: 0}));
  replacement._onpanmove(createGestureEvent('panmove'));
  replacement._onpanend(createGestureEvent('panend'));

  expect(mode.handleStartDragging).toHaveBeenCalledOnce();
  expect(mode.handleDragging).toHaveBeenCalledOnce();
  expect(mode.handleStopDragging).toHaveBeenCalledOnce();
  expect(replacement.state._editableLayerState.pointerDownMapCoords).toBeNull();
});

test('touch drag survives replacement without mouse button metadata', () => {
  const mode = createGestureMode();
  const original = createGestureLayer(mode);
  original._onpanstart(createGestureEvent('panstart', {type: 'touchstart'}));
  const replacement = createGestureLayer(mode);
  replacement.state = original.state;
  replacement._onpanmove(createGestureEvent('panmove', {type: 'touchmove'}));
  replacement._onpanend(createGestureEvent('panend', {type: 'touchend'}));
  expect(mode.handleDragging).toHaveBeenCalledOnce();
  expect(mode.handleStopDragging).toHaveBeenCalledOnce();
});

test.each([
  {button: 1, buttons: 4},
  {button: 2, buttons: 2},
  {button: 3, buttons: 8},
  {button: 0, buttons: 3},
  {buttons: 4},
  {which: 3}
])('non-primary gestures remain rejected after replacement: %j', sourceEvent => {
  const mode = createGestureMode();
  const original = createGestureLayer(mode);
  const click = createClickEvent([0, 0]);
  click.sourceEvent = sourceEvent;
  original.onLayerClick(click);
  original.onLayerDoubleClick(click);
  original.onPointerMove(createStartDraggingEvent([0, 0], [0, 0]));
  mode.handlePointerMove.mockClear();
  original.onPointerMove({...createStartDraggingEvent([0, 0], [0, 0]), sourceEvent});
  expect(mode.handlePointerMove).not.toHaveBeenCalled();
  const start = createGestureEvent('panstart', sourceEvent);
  original._onpanstart(start);
  const replacement = createGestureLayer(mode);
  replacement.state = original.state;
  const move = createGestureEvent('panmove', {buttons: 0});
  replacement._onpanmove(move);
  replacement._onpanend(createGestureEvent('panend', {buttons: 0}));
  expect(mode.handleClick).not.toHaveBeenCalled();
  expect(mode.handleDoubleClick).not.toHaveBeenCalled();
  expect(mode.handleStartDragging).not.toHaveBeenCalled();
  expect(mode.handleDragging).not.toHaveBeenCalled();
  expect(mode.handleStopDragging).not.toHaveBeenCalled();
  expect(start.stopImmediatePropagation).not.toHaveBeenCalled();
  expect(move.stopImmediatePropagation).not.toHaveBeenCalled();
});

test('Escape cancels a drag across replacement and allows the next drag', () => {
  const mode = createGestureMode();
  const layer = createGestureLayer(mode);
  layer._onpanstart(createGestureEvent('panstart', {button: 0}));
  layer.onLayerKeyUp({key: 'Escape'} as KeyboardEvent);
  const replacement = createGestureLayer(mode);
  replacement.state = layer.state;
  replacement._onpanmove(createGestureEvent('panmove'));
  replacement._onpanend(createGestureEvent('panend'));
  expect(mode.handleDragging).not.toHaveBeenCalled();
  expect(mode.handleStopDragging).not.toHaveBeenCalled();
  replacement._onpanstart(createGestureEvent('panstart', {button: 0}));
  replacement._onpanmove(createGestureEvent('panmove', {buttons: 1}));
  replacement._onpanend(createGestureEvent('panend', {buttons: 0}));
  expect(mode.handleDragging).toHaveBeenCalledOnce();
  expect(mode.handleStopDragging).toHaveBeenCalledOnce();
});

test('pointer cancellation clears a drag without committing a polygon', () => {
  const mode = new DrawPolygonByDraggingMode();
  const layer = createGestureLayer(mode as any);
  layer._onpanstart(createGestureEvent('panstart', {button: 0}));
  layer.onDragging(createStartDraggingEvent([1, 0], [0, 0]));
  layer.onDragging(createStartDraggingEvent([1, 1], [0, 0]));
  layer._onpancancel(createGestureEvent('pancancel', {type: 'pointercancel'}));
  layer._onpanend(createGestureEvent('panend'));
  expect(layer.props.onEdit).toHaveBeenLastCalledWith(
    expect.objectContaining({editType: 'cancelFeature'})
  );
  expect(layer.props.onEdit).not.toHaveBeenCalledWith(
    expect.objectContaining({editType: 'addFeature'})
  );
  expect(layer.state._editableLayerState.pointerDownMapCoords).toBeNull();
  expect(mode.getClickSequence()).toEqual([]);
});

test('Escape cancels queued throttled polygon edits', () => {
  vi.useFakeTimers();
  try {
    const mode = new DrawPolygonByDraggingMode();
    const layer = createGestureLayer(mode as any, {throttleMs: 100});
    layer.onStartDragging(createStartDraggingEvent([0, 0], [0, 0]));
    layer.onDragging(createStartDraggingEvent([1, 0], [0, 0]));
    layer.onDragging(createStartDraggingEvent([1, 1], [0, 0]));
    layer.onLayerKeyUp({key: 'Escape'} as KeyboardEvent);
    const callCount = vi.mocked(layer.props.onEdit).mock.calls.length;
    vi.runAllTimers();
    expect(layer.props.onEdit).toHaveBeenCalledTimes(callCount);
    expect(mode.getClickSequence()).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});

test('a missed map coordinate at drag end cancels acceptance', () => {
  const mode = createGestureMode();
  const layer = createGestureLayer(mode);
  layer._onpanstart(createGestureEvent('panstart', {button: 0}));
  vi.spyOn(layer, 'getMapCoords').mockReturnValue(null);
  layer._onpanend(createGestureEvent('panend'));
  expect(layer.state.isDraggingWithPrimaryButton).toBe(false);
  expect(layer.state._editableLayerState.pointerDownMapCoords).toBeNull();
  expect(mode.handleStopDragging).not.toHaveBeenCalled();
  expect(mode.handleKeyUp).toHaveBeenCalledWith(
    expect.objectContaining({key: 'Escape'}),
    expect.anything()
  );
});

test('non-primary movement and release cannot finish an accepted drag', () => {
  const mode = createGestureMode();
  const layer = createGestureLayer(mode);
  layer._onpanstart(createGestureEvent('panstart', {button: 0, buttons: 1}));
  layer._onpanmove(createGestureEvent('panmove', {button: -1, buttons: 3}));
  layer._onpanend(createGestureEvent('panend', {button: 2, buttons: 0}));
  expect(mode.handleDragging).not.toHaveBeenCalled();
  expect(mode.handleStopDragging).not.toHaveBeenCalled();
  expect(layer.state.isDraggingWithPrimaryButton).toBe(false);
});

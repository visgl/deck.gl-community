import {test, expect, vi} from 'vitest';
import {EditableGeoJsonLayer} from '../../src/editable-layers/editable-geojson-layer';
import {DrawPointMode} from '../../src/edit-modes/draw-point-mode';
import {
  createClickEvent,
  createFeatureCollection,
  createStartDraggingEvent
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

function createGestureLayer() {
  const mode = {
    handleClick: vi.fn(),
    handleDoubleClick: vi.fn(),
    handlePointerMove: vi.fn(),
    handleStartDragging: vi.fn(),
    handleStopDragging: vi.fn(),
    handleDragging: vi.fn(),
    handleKeyUp: vi.fn()
  };
  const layer = new EditableGeoJsonLayer({
    id: 'gesture-test',
    data: createFeatureCollection(),
    selectedFeatureIndexes: [],
    mode
  });
  layer.context = {
    deck: {eventManager: {on: vi.fn(), off: vi.fn()}, pickMultipleObjects: () => []},
    layerManager: {getLayers: () => []},
    viewport: {unproject: coords => coords}
  } as any;
  layer.state = {mode} as any;
  layer.initializeState();
  return {layer, mode};
}

function createGestureEvent(srcEvent = {}) {
  return {offsetCenter: {x: 10, y: 20}, srcEvent, stopImmediatePropagation: vi.fn()} as any;
}

test.each([
  [{button: 0, buttons: 1}, true],
  [{}, true], // Touch events may have no mouse button metadata.
  [{button: 1, buttons: 4}, false],
  [{button: 2, buttons: 2}, false],
  [{button: 3, buttons: 8}, false],
  [{button: 0, buttons: 3}, false],
  [{buttons: 4}, false],
  [{which: 3}, false]
])('forwards only primary gestures: %j', (sourceEvent, accepted) => {
  const {layer, mode} = createGestureLayer();
  const click = {...createClickEvent([0, 0]), sourceEvent};
  layer.onLayerClick(click);
  layer.onLayerDoubleClick(click);
  layer.onPointerMove({...createStartDraggingEvent([0, 0], [0, 0]), sourceEvent});
  layer._onpanstart(createGestureEvent(sourceEvent));
  layer._onpanmove(createGestureEvent(sourceEvent));
  layer._onpanend(createGestureEvent());
  // Extra move/end events must not continue or commit a completed/rejected drag.
  layer._onpanmove(createGestureEvent());
  layer._onpanend(createGestureEvent());
  for (const [name, callback] of Object.entries(mode)) {
    if (name !== 'handleKeyUp') expect(callback).toHaveBeenCalledTimes(accepted ? 1 : 0);
  }
});

test.each([
  'Escape',
  'pointercancel',
  'missing coordinate'
])('%s cancels the drag and allows another', reason => {
  const {layer, mode} = createGestureLayer();
  layer._onpanstart(createGestureEvent());
  if (reason === 'Escape') layer.onLayerKeyUp({key: 'Escape'} as KeyboardEvent);
  else if (reason === 'pointercancel') layer._onpancancel(createGestureEvent());
  else {
    const spy = vi.spyOn(layer, 'getMapCoords').mockReturnValue(null);
    layer._onpanend(createGestureEvent());
    spy.mockRestore();
  }
  layer._onpanmove(createGestureEvent());
  layer._onpanend(createGestureEvent());
  expect(mode.handleDragging).not.toHaveBeenCalled();
  expect(mode.handleStopDragging).not.toHaveBeenCalled();
  expect(mode.handleKeyUp).toHaveBeenCalledWith(
    expect.objectContaining({key: 'Escape'}),
    expect.anything()
  );
  expect(layer.state._editableLayerState.pointerDownMapCoords).toBeNull();
  layer._onpanstart(createGestureEvent());
  layer._onpanmove(createGestureEvent());
  layer._onpanend(createGestureEvent());
  expect(mode.handleDragging).toHaveBeenCalledOnce();
  expect(mode.handleStopDragging).toHaveBeenCalledOnce();
});

test.each([0, 3])('movement with buttons=%i and non-primary release cannot edit', buttons => {
  const {layer, mode} = createGestureLayer();
  layer._onpanstart(createGestureEvent({button: 0, buttons: 1}));
  layer._onpanmove(createGestureEvent({button: -1, buttons}));
  layer._onpanend(createGestureEvent({button: 2, buttons: 0}));
  expect(mode.handleDragging).not.toHaveBeenCalled();
  expect(mode.handleStopDragging).not.toHaveBeenCalled();
  expect(layer.state.isDraggingWithPrimaryButton).toBe(false);
});

test('drag completion clears pointer-down picks from cached move props without another move', () => {
  const {layer} = createGestureLayer();
  layer._onpanstart(createGestureEvent());
  layer._onpointermove(createGestureEvent());
  const previousMove = layer.state.lastPointerMoveEvent;
  expect(previousMove.pointerDownPicks).not.toBeNull();
  layer._onpanend(createGestureEvent());
  expect(layer.state.lastPointerMoveEvent.pointerDownPicks).toBeNull();
  expect(layer.state.lastPointerMoveEvent.pointerDownMapCoords).toBeNull();
  expect(previousMove.pointerDownPicks).not.toBeNull();
});

test('fresh drag gestures update the raw pointer cache used by snap guides', () => {
  const {layer, mode} = createGestureLayer();
  const start = createStartDraggingEvent([1, 2], [3, 4]);
  const dragging = {...start, screenCoords: [5, 6] as [number, number], mapCoords: [7, 8]};
  layer.onStartDragging(start);
  expect(layer.state.lastPointerMoveEvent.screenCoords).toEqual(start.screenCoords);
  expect(layer.state.lastPointerMoveEvent.pointerDownPicks).toEqual(start.pointerDownPicks);
  layer.onDragging(dragging);
  expect(layer.state.lastPointerMoveEvent.screenCoords).toEqual(dragging.screenCoords);
  expect(layer.state.lastPointerMoveEvent.mapCoords).toEqual(dragging.mapCoords);
  expect(mode.handleDragging.mock.calls[0][1].lastPointerMoveEvent.mapCoords).toEqual(
    dragging.mapCoords
  );
});

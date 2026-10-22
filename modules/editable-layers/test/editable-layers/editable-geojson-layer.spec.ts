import {test, expect, vi} from 'vitest';
import {EditableGeoJsonLayer} from '../../src/editable-layers/editable-geojson-layer';
import {EditableH3ClusterLayer} from '../../src/editable-layers/editable-h3-cluster-layer';
import {DrawPointMode} from '../../src/edit-modes/draw-point-mode';
import {DrawPolygonMode} from '../../src/edit-modes/draw-polygon-mode';
import {DrawPolygonByDraggingMode} from '../../src/edit-modes/draw-polygon-by-dragging-mode';
import {DrawRectangleMode} from '../../src/edit-modes/draw-rectangle-mode';
import {ModifyMode} from '../../src/edit-modes/modify-mode';
import {ViewMode} from '../../src/edit-modes/view-mode';
import {TransformMode} from '../../src/edit-modes/transform-mode';
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

test('instantiates legacy string mode names before using them', () => {
  const layer = new EditableGeoJsonLayer({
    id: 'legacy-mode-test',
    data: createFeatureCollection(),
    mode: 'transform',
    selectedFeatureIndexes: []
  });
  layer.context = {
    deck: {eventManager: {on: vi.fn(), off: vi.fn()}, pickMultipleObjects: () => []},
    layerManager: {getLayers: () => []},
    viewport: {unproject: coords => coords}
  } as any;
  layer.state = {mode: null} as any;
  layer.initializeState();
  layer.updateState({
    props: layer.props,
    oldProps: {},
    changeFlags: {propsOrDataChanged: true},
    context: layer.context
  } as any);

  expect(layer.getActiveMode()).toBeInstanceOf(TransformMode);
  layer.finalizeState();
});

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

let pressPicks = 0;

const EDIT_HANDLE_PICK = {
  index: 0,
  isGuide: true,
  featureType: 'points',
  object: {properties: {guideType: 'editHandle', editHandleType: 'existing', featureIndex: 0}}
};

function createPressLayer(props: Record<string, any> = {}, picks: any[] = []) {
  const {mode = DrawPolygonMode} = props;
  const layer = new EditableGeoJsonLayer({
    id: 'press-test',
    data: createFeatureCollection(),
    selectedFeatureIndexes: [],
    ...props,
    mode
  });
  const canvas = {
    offsetWidth: 100,
    offsetHeight: 100,
    clientLeft: 0,
    clientTop: 0,
    getBoundingClientRect: () => ({left: 0, top: 0, width: 100, height: 100})
  };
  layer.context = {
    deck: {pickMultipleObjects: vi.fn(() => picks)},
    layerManager: {getLayers: () => []},
    viewport: {unproject: coords => coords}
  } as any;
  layer.state = {
    _editableLayerState: {canvas},
    mode: typeof mode === 'function' ? new mode() : mode
  } as any;
  vi.spyOn(layer, 'onLayerClick').mockImplementation(() => {});
  return layer;
}

/** Dispatches one mouse press and reports which events the layer kept from the parent map. */
function pressMouse(layer: EditableGeoJsonLayer, button = 0) {
  const event = (type: string) => ({
    type,
    button,
    clientX: 10,
    clientY: 20,
    stopPropagation: vi.fn()
  });
  const [pointerDown, mouseDown, click] = ['pointerdown', 'mousedown', 'click'].map(event);
  layer._onNativeClick(pointerDown as any);
  const pick = layer.context.deck.pickMultipleObjects as ReturnType<typeof vi.fn>;
  pick.mockClear();
  layer._onNativeMapInteraction(mouseDown as any);
  pressPicks = pick.mock.calls.length;
  layer._onNativeClick(click as any);
  return {
    mousedown: mouseDown.stopPropagation.mock.calls.length > 0,
    click: click.stopPropagation.mock.calls.length > 0
  };
}

test('edit modes keep only the presses they own from the parent map', () => {
  // Click-to-draw: the map pans and clicks from empty space while vertices still land.
  const drawLayer = createPressLayer();
  expect(pressMouse(drawLayer)).toEqual({mousedown: false, click: false});
  expect(drawLayer.onLayerClick).toHaveBeenCalledOnce();
  expect(drawLayer.state._editableLayerState.pressOwner).toBe('map');
  // A press on an edit handle, and the click it produces, stay with editing.
  const handleLayer = createPressLayer({}, [EDIT_HANDLE_PICK]);
  expect(pressMouse(handleLayer)).toEqual({mousedown: true, click: true});
  expect(handleLayer.state._editableLayerState.pressOwner).toBe('edit');
  expect(pressMouse(handleLayer, 2)).toEqual({mousedown: false, click: false});
  // Each press is decided anew.
  (handleLayer.context.deck.pickMultipleObjects as ReturnType<typeof vi.fn>).mockReturnValue([]);
  expect(pressMouse(handleLayer)).toEqual({mousedown: false, click: false});
  const doubleClick = {type: 'dblclick', button: 0, stopPropagation: vi.fn()};
  drawLayer._onNativeMapInteraction(doubleClick as any);
  expect(doubleClick.stopPropagation).toHaveBeenCalledOnce();

  // Drag-to-draw modes own every press.
  expect(pressMouse(createPressLayer({mode: DrawPolygonByDraggingMode}))).toEqual({
    mousedown: true,
    click: true
  });
  expect(
    pressMouse(createPressLayer({mode: DrawRectangleMode, modeConfig: {dragToDraw: true}}))
  ).toEqual({mousedown: true, click: true});
  expect(pressMouse(createPressLayer({mode: ModifyMode, selectedFeatureIndexes: [0]}))).toEqual({
    mousedown: false,
    click: false
  });
});

test.each([
  ['ViewMode', {mode: ViewMode}],
  [
    'autoPreventMapInteractions: false',
    {mode: DrawPolygonByDraggingMode, autoPreventMapInteractions: false}
  ],
  ['a hidden layer', {mode: DrawPolygonByDraggingMode, visible: false}]
])('%s leaves every press to the map', (_name, props) => {
  const layer = createPressLayer(props, [EDIT_HANDLE_PICK]);
  expect(pressMouse(layer)).toEqual({mousedown: false, click: false});
  expect(pressPicks).toBe(0);
});

test('modes without ownsPointerDown keep every press without picking', () => {
  const mode = {handleClick: vi.fn(), handlePointerMove: vi.fn(), getGuides: vi.fn()};
  const layer = createPressLayer({mode});
  expect(pressMouse(layer)).toEqual({mousedown: true, click: true});
  expect(pressPicks).toBe(0);
});

test('presses without map coordinates stay with the map', () => {
  const layer = createPressLayer({mode: DrawPolygonByDraggingMode});
  vi.spyOn(layer, 'getMapCoords').mockReturnValue(null);
  expect(pressMouse(layer)).toEqual({mousedown: false, click: false});
});

test('a press left to the map pans it without also dragging in the edit mode', () => {
  const {layer, mode} = createGestureLayer();
  const ownsPointerDown = vi.fn(() => false);
  Object.assign(mode, {ownsPointerDown});
  layer.state._editableLayerState.canvas = {
    offsetWidth: 100,
    offsetHeight: 100,
    clientLeft: 0,
    clientTop: 0,
    getBoundingClientRect: () => ({left: 0, top: 0, width: 100, height: 100})
  };
  const drag = () => {
    const press = {button: 0, clientX: 10, clientY: 20, stopPropagation: vi.fn()};
    layer._onNativeClick({...press, type: 'pointerdown'} as any);
    layer._onNativeMapInteraction({...press, type: 'mousedown'} as any);
    layer._onpanstart(createGestureEvent({button: 0, buttons: 1}));
    layer._onpanmove(createGestureEvent({button: 0, buttons: 1}));
    layer._onpanend(createGestureEvent({button: 0, buttons: 0}));
    layer._onNativeClick({...press, type: 'click', detail: 1} as any);
    return press.stopPropagation.mock.calls.length;
  };
  expect(drag()).toBe(0);
  expect(mode.handleStartDragging).not.toHaveBeenCalled();
  expect(mode.handleDragging).not.toHaveBeenCalled();
  expect(mode.handleStopDragging).not.toHaveBeenCalled();
  expect(mode.handleClick).not.toHaveBeenCalled();

  ownsPointerDown.mockReturnValue(true);
  expect(drag()).toBe(2);
  expect(mode.handleStartDragging).toHaveBeenCalledOnce();
  expect(mode.handleDragging).toHaveBeenCalledOnce();
  expect(mode.handleStopDragging).toHaveBeenCalledOnce();
  expect(mode.handleClick).not.toHaveBeenCalled();
});

test.each([
  'touchend',
  'touchcancel'
])('single-touch editing resumes while two-finger navigation can finish with %s', endType => {
  const layer = new EditableGeoJsonLayer({data: null, mode: DrawPointMode});
  layer.state = {_editableLayerState: {}, mode: new DrawPointMode()} as any;
  const touch = (type, count) => ({type, touches: {length: count}, stopPropagation: vi.fn()});
  const single = touch('touchstart', 1);
  layer._onNativeMapInteraction(single as any);
  expect(single.stopPropagation).toHaveBeenCalledOnce();
  const secondFinger = touch('touchstart', 2);
  layer._onNativeMapInteraction(secondFinger as any);
  expect(secondFinger.stopPropagation).not.toHaveBeenCalled();
  const twoMoving = touch('touchmove', 2);
  layer._onNativeMapInteraction(twoMoving as any);
  expect(twoMoving.stopPropagation).not.toHaveBeenCalled();
  const oneRemaining = touch(endType, 1);
  layer._onNativeMapInteraction(oneRemaining as any);
  expect(oneRemaining.stopPropagation).not.toHaveBeenCalled();
  const resumedEdit = touch('touchmove', 1);
  layer._onNativeMapInteraction(resumedEdit as any);
  expect(resumedEdit.stopPropagation).toHaveBeenCalledOnce();
  const navigationEnd = touch(endType, 0);
  layer._onNativeMapInteraction(navigationEnd as any);
  expect(navigationEnd.stopPropagation).not.toHaveBeenCalled();
  const nextSingle = touch('touchstart', 1);
  layer._onNativeMapInteraction(nextSingle as any);
  const editEnd = touch(endType, 0);
  layer._onNativeMapInteraction(editEnd as any);
  expect(editEnd.stopPropagation).toHaveBeenCalledOnce();
});

test('entering an edit mode keeps the release of an existing map touch gesture available', () => {
  const layer = new EditableGeoJsonLayer({data: null, mode: ViewMode});
  layer.state = {_editableLayerState: {}, mode: new ViewMode()} as any;
  const start = {type: 'touchstart', touches: {length: 1}, stopPropagation: vi.fn()};
  layer._onNativeMapInteraction(start as any);
  expect(start.stopPropagation).not.toHaveBeenCalled();
  layer.state.mode = new DrawPointMode();
  const move = {type: 'touchmove', touches: {length: 1}, stopPropagation: vi.fn()};
  layer._onNativeMapInteraction(move as any);
  expect(move.stopPropagation).toHaveBeenCalledOnce();
  const end = {type: 'touchend', touches: {length: 0}, stopPropagation: vi.fn()};
  layer._onNativeMapInteraction(end as any);
  expect(end.stopPropagation).not.toHaveBeenCalled();
});

test('H3 editing forwards the application interaction override', () => {
  const layer = new EditableH3ClusterLayer({data: [], autoPreventMapInteractions: false});
  layer.state = {_editableLayerState: {}, tentativeHexagonIDs: []};
  expect(layer.renderLayers()[0].props.autoPreventMapInteractions).toBe(false);
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

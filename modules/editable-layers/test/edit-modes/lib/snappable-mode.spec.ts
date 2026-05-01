// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {beforeEach, test, expect, vi, describe} from 'vitest';
import {SnappableMode} from '../../../src/edit-modes/snappable-mode';
import {DrawPointMode} from '../../../src/edit-modes/draw-point-mode';
import {
  createFeatureCollectionProps,
  createClickEvent,
  createPointerMoveEvent,
  createStartDraggingEvent
} from '../test-utils';
import {viewport} from '../../mocks';
import {SimpleFeatureCollection, FeatureCollection} from '../../../src/utils/geojson-types';
import {TranslateMode} from '../../../src/edit-modes/translate-mode';
import {EditHandleFeature, ModeProps, Pick} from '../../../src/edit-modes/types';
import {GeoJsonEditMode} from '../../../src/edit-modes/geojson-edit-mode';
import {DrawLineStringMode} from '../../../src/edit-modes/draw-line-string-mode';
import {DrawRectangleMode} from '../../../src/edit-modes/draw-rectangle-mode';
import {ModifyMode} from '../../../src/edit-modes/modify-mode';
import {toWebMercatorViewport} from '../../../src/edit-modes/utils';

const pickingRadius = 10;
const webMercatorViewport = toWebMercatorViewport(viewport);

const pointAScreenCoords: [number, number] = [0, 0];
const pointAMapCoords = webMercatorViewport.unproject(pointAScreenCoords) as [number, number];
const snapToAScreenCoords: [number, number] = [1, 1];
const snapToAMapCoords = toWebMercatorViewport(viewport).unproject(snapToAScreenCoords) as [
  number,
  number
];

const pointBScreenCoords: [number, number] = [20, 20];
const pointBMapCoords = webMercatorViewport.unproject(pointBScreenCoords) as [number, number];
const snapToBScreenCoords: [number, number] = [21, 21];

const pointCScreenCoords = [30, 30];
const pointCMapCoords = webMercatorViewport.unproject(pointCScreenCoords) as [number, number];
const snapToCScreenCoords: [number, number] = [31, 31];
const snapToCMapCoords = webMercatorViewport.unproject(snapToCScreenCoords) as [number, number];

const pointDScreenCoords: [number, number] = [100, 100];
const pointDMapCoords = webMercatorViewport.unproject(pointDScreenCoords) as [number, number];

const snapTargetHandle: EditHandleFeature = {
  type: 'Feature',
  properties: {
    guideType: 'editHandle',
    editHandleType: 'snap-target',
    featureIndex: 1,
    positionIndexes: [1]
  },
  geometry: {type: 'Point', coordinates: pointCMapCoords}
};
const targetPick = {index: 1, isGuide: true, object: snapTargetHandle};

const simulateDrag = (
  mode: GeoJsonEditMode,
  props: ModeProps<SimpleFeatureCollection>,
  startMapCoords: [number, number],
  currentMapCoords: [number, number],
  pointerDownPicks?: Pick[],
  draggingPicks?: Pick[]
): void => {
  mode.handlePointerMove(createPointerMoveEvent(startMapCoords, pointerDownPicks), props);
  mode.handleStartDragging(
    createStartDraggingEvent(startMapCoords, startMapCoords, pointerDownPicks),
    props
  );
  mode.handleDragging(
    {
      ...createStartDraggingEvent(currentMapCoords, startMapCoords, draggingPicks),
      pointerDownPicks: pointerDownPicks
    },
    {
      ...props,
      lastPointerMoveEvent: {
        ...createPointerMoveEvent(currentMapCoords, draggingPicks),
        pointerDownPicks: pointerDownPicks,
        isDragging: true
      }
    }
  );
};

const modeConfig = {
  enableSnapping: true,
  viewport
};

const defaultProps: ModeProps<SimpleFeatureCollection> = {
  ...createFeatureCollectionProps(),
  data: {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {type: 'LineString', coordinates: [pointAMapCoords, pointBMapCoords]}
      },
      {type: 'Feature', properties: {}, geometry: {type: 'Point', coordinates: pointCMapCoords}}
    ]
  },
  modeConfig,
  pickingRadius
};

describe('translate mode', () => {
  let mode: GeoJsonEditMode;

  const snapSourceHandle: EditHandleFeature = {
    type: 'Feature',
    properties: {
      guideType: 'editHandle',
      editHandleType: 'snap-source',
      featureIndex: 0,
      positionIndexes: [0]
    },
    geometry: {type: 'Point', coordinates: pointAMapCoords}
  };
  const sourcePick = {index: 0, isGuide: true, object: snapSourceHandle};

  beforeEach(() => {
    mode = new SnappableMode(new TranslateMode());
  });

  test('when no pointer down picks renders snap source handles on selected feature', () => {
    const props = {
      ...defaultProps,
      selectedIndexes: [0],
      lastPointerMoveEvent: createPointerMoveEvent()
    };

    const guides = mode.getGuides(props);

    expect(guides.features.length).toBe(2);
    expect(guides.features[0].properties.guideType).toBe('editHandle');
    expect((guides.features[0] as EditHandleFeature).properties.editHandleType).toBe('snap-source');
    expect(guides.features[0].geometry.type).toEqual('Point');
    expect(guides.features[0].geometry.coordinates).toEqual(pointAMapCoords);

    expect(guides.features[1].properties.guideType).toBe('editHandle');
    expect((guides.features[1] as EditHandleFeature).properties.editHandleType).toBe('snap-source');
    expect(guides.features[1].geometry.type).toEqual('Point');
    expect(guides.features[1].geometry.coordinates).toEqual(pointBMapCoords);
  });

  test('when no pointer down picks renders no snap targets', () => {
    const props = {
      ...defaultProps,
      lastPointerMoveEvent: createPointerMoveEvent(snapToAMapCoords)
    };

    const guides = mode.getGuides(props);
    expect(guides.features.length).toBe(0);
  });

  test('dragging snap source onto snap target calls onEdit with snapped coordinates', () => {
    const mockOnEdit = vi.fn();
    const props = {
      ...defaultProps,
      selectedIndexes: [0],
      onEdit: mockOnEdit
    };

    simulateDrag(mode, props, pointAMapCoords, snapToCMapCoords, [sourcePick], [targetPick]);

    expect(mockOnEdit).toHaveBeenCalledTimes(1);
    const movedFeature = mockOnEdit.mock.calls[0][0].updatedData.features[0];
    expect(movedFeature.geometry.coordinates[0][0]).toBeCloseTo(pointCMapCoords[0], 10);
    expect(movedFeature.geometry.coordinates[0][1]).toBeCloseTo(pointCMapCoords[1], 10);
  });

  test('during active drag shows snap target handles and snap source handle as guides', () => {
    const props = {
      ...defaultProps,
      selectedIndexes: [0],
      lastPointerMoveEvent: {
        ...createPointerMoveEvent(snapToCMapCoords, [targetPick]),
        pointerDownPicks: [sourcePick],
        isDragging: true
      }
    };

    const guides = mode.getGuides(props);

    expect(guides.features.length).toBe(2);

    const firstHandle = guides.features[0] as EditHandleFeature;
    expect(firstHandle.properties.guideType).toBe('editHandle');
    expect(firstHandle.geometry.type).toEqual('Point');
    expect(firstHandle.geometry.coordinates).toEqual(pointCMapCoords);
    expect(firstHandle.properties.editHandleType).toBe('snap-target');
    expect(firstHandle.properties.featureIndex).toBe(1);

    // The snap source shows its original position since onEdit is mocked
    const lastHandle = guides.features[1] as EditHandleFeature;
    expect(lastHandle.properties.guideType).toBe('editHandle');
    expect(lastHandle.geometry.type).toEqual('Point');
    expect(lastHandle.geometry.coordinates).toEqual(pointAMapCoords);
    expect(lastHandle.properties.editHandleType).toBe('snap-source');
  });

  test('when edge snapping enabled, snap target is rendered if edge within radius', () => {
    const snapToEdgeScreenCoords: [number, number] = [10.1, 9.9];
    const snapToEdgeMapCoords = webMercatorViewport.unproject(snapToEdgeScreenCoords);
    const expectedSnapMapCoords = webMercatorViewport.unproject([10, 10]);

    const pointSnapSourceHandle: EditHandleFeature = {
      type: 'Feature',
      properties: {
        guideType: 'editHandle',
        editHandleType: 'snap-source',
        featureIndex: 1,
        positionIndexes: []
      },
      geometry: {type: 'Point', coordinates: pointCMapCoords}
    };
    const pointSourcePick = {index: 1, isGuide: true, object: pointSnapSourceHandle};

    const props = {
      ...defaultProps,
      selectedIndexes: [1],
      lastPointerMoveEvent: {
        ...createPointerMoveEvent(snapToEdgeMapCoords, [], snapToEdgeScreenCoords),
        pointerDownPicks: [pointSourcePick],
        isDragging: true
      },
      modeConfig: {
        ...modeConfig,
        edgeSnapping: true
      }
    };

    const guides = mode.getGuides(props);

    expect(guides.features.length).toBe(4);

    const edgeSnapTarget = guides.features[2] as EditHandleFeature;
    expect(edgeSnapTarget.properties.guideType).toBe('editHandle');
    expect(edgeSnapTarget.geometry.type).toEqual('Point');
    expect(edgeSnapTarget.properties.editHandleType).toBe('snap-target');
    expect(edgeSnapTarget.properties.featureIndex).toBe(0);
    // Verify snapping actually moved the point: the result must differ from the cursor position
    expect(edgeSnapTarget.geometry.coordinates).not.toEqual(snapToEdgeMapCoords);
    // ...and must instead be close to the perpendicular foot on the line at [10, 10]
    expect(edgeSnapTarget.geometry.coordinates[0]).toBeCloseTo(expectedSnapMapCoords[0], 4);
    expect(edgeSnapTarget.geometry.coordinates[1]).toBeCloseTo(expectedSnapMapCoords[1], 4);

    // The snap source shows its original position since onEdit is mocked
    const lastHandle = guides.features[3] as EditHandleFeature;
    expect(lastHandle.properties.guideType).toBe('editHandle');
    expect(lastHandle.geometry.type).toEqual('Point');
    expect(lastHandle.geometry.coordinates).toEqual(pointCMapCoords);
    expect(lastHandle.properties.editHandleType).toBe('snap-source');
  });
});

describe('draw point mode', () => {
  let mode: GeoJsonEditMode;

  beforeEach(() => {
    mode = new SnappableMode(new DrawPointMode());
  });

  test('when snapping disabled, exact click location is used', () => {
    const mockOnEdit = vi.fn();
    const props = createFeatureCollectionProps({
      onEdit: mockOnEdit
    });

    mode.handleClick(createClickEvent(snapToAMapCoords, [targetPick]), props);

    expect(mockOnEdit).toHaveBeenCalledTimes(1);
    const addedFeature = mockOnEdit.mock.calls[0][0].updatedData.features.at(-1);
    expect(addedFeature.geometry.coordinates).toEqual(snapToAMapCoords);
  });

  test('draw point snaps to snap targets', () => {
    const mockOnEdit = vi.fn();
    const props = {...defaultProps, onEdit: mockOnEdit};

    // Click slightly off the snap target — picks contain the snap-target handle
    mode.handleClick(createClickEvent(snapToAMapCoords, [targetPick]), props);

    expect(mockOnEdit).toHaveBeenCalledTimes(1);
    const addedFeature = mockOnEdit.mock.calls[0][0].updatedData.features.at(-1);
    expect(addedFeature.geometry.coordinates).toBe(pointCMapCoords);
  });

  test('renders no snap targets when cursor is outside picking radius', () => {
    const props = {
      ...defaultProps,
      lastPointerMoveEvent: createPointerMoveEvent(pointDMapCoords, [], pointDScreenCoords)
    };

    const guides = mode.getGuides(props);
    expect(guides.features.length).toBe(0);
  });

  test('in draw modes renders no snap sources when features are selected', () => {
    const props = {
      ...defaultProps,
      selectedIndexes: [0],
      lastPointerMoveEvent: createPointerMoveEvent(pointDMapCoords, [], pointDScreenCoords)
    };

    const guides = mode.getGuides(props);
    expect(guides.features.length).toBe(0);
  });

  test('snap guide tracks real cursor via screenCoords, not stale snapped mapCoords', () => {
    // _getSnappedMouseEvent mutates event.mapCoords (via Object.assign) to the snap
    // target coords so we need to check that screenCoords are used to build guides instead.
    const staleEvent = createPointerMoveEvent(pointAMapCoords, [], snapToBScreenCoords);

    const guides = mode.getGuides({...defaultProps, lastPointerMoveEvent: staleEvent});

    expect(guides.features.length).toBe(1);
    const snapGuide = guides.features[0] as EditHandleFeature;
    expect(snapGuide.properties.editHandleType).toBe('snap-target');
    expect(snapGuide.geometry.coordinates).toEqual(pointBMapCoords);
  });

  test('renders nearest snap target when cursor is within picking radius', () => {
    const props = {
      ...defaultProps,
      lastPointerMoveEvent: createPointerMoveEvent(snapToCMapCoords, [], snapToCScreenCoords)
    };

    const guides = mode.getGuides(props);
    expect(guides.features.length).toBe(1);
    const handle = guides.features[0] as EditHandleFeature;
    expect(handle.properties.guideType).toBe('editHandle');
    expect(handle.geometry.type).toEqual('Point');
    expect(handle.geometry.coordinates).toEqual(pointCMapCoords);
    expect(handle.properties.editHandleType).toBe('snap-target');
  });
});

describe('draw line string mode', () => {
  let mode: GeoJsonEditMode;
  const mockOnEdit = vi.fn();
  let props: ModeProps<FeatureCollection>;

  beforeEach(() => {
    mode = new SnappableMode(new DrawLineStringMode());
    props = {...defaultProps, onEdit: mockOnEdit};
    mode.handleClick(createClickEvent(pointDMapCoords), props);
  });

  test('when tentative, calls on edit when snap handle selected', () => {
    mode.handleClick(createClickEvent(snapToCMapCoords, [targetPick]), props);

    expect(mockOnEdit).toHaveBeenCalledTimes(2);
    const snappedCall = mockOnEdit.mock.calls[1][0];
    expect(snappedCall.editType).toBe('addTentativePosition');
    expect(snappedCall.editContext.position).toEqual(pointCMapCoords);
  });

  test('tentative feature is updated to picked snap handle', () => {
    const pointerMoveEvent = createPointerMoveEvent(snapToCMapCoords, [targetPick]);
    mode.handlePointerMove(pointerMoveEvent, props);

    const updatedProps = {...props, lastPointerMoveEvent: pointerMoveEvent};
    const guides = mode.getGuides(updatedProps);

    const tentative = guides.features.find(guide => guide.properties.guideType === 'tentative');
    expect(tentative).toBeDefined();
    expect(tentative.geometry.type).toBe('LineString');
    expect(tentative.geometry.coordinates).toEqual([pointDMapCoords, pointCMapCoords]);
  });
});

describe('draw rectangle mode', () => {
  let mode: GeoJsonEditMode;
  const mockOnEdit = vi.fn();
  let props: ModeProps<FeatureCollection>;

  beforeEach(() => {
    mode = new SnappableMode(new DrawRectangleMode());
    props = {
      ...defaultProps,
      lastPointerMoveEvent: createPointerMoveEvent(pointDMapCoords),
      onEdit: mockOnEdit
    };
    mode.handleClick(createClickEvent(pointDMapCoords), props);
  });

  test('tentative rectangle snaps second corner to snap target on pointer move', () => {
    const pointerMoveEvent = createPointerMoveEvent(pointCMapCoords, [targetPick]);
    mode.handlePointerMove(pointerMoveEvent, props);

    const updatedProps = {...props, lastPointerMoveEvent: pointerMoveEvent};
    const guides = mode.getGuides(updatedProps);

    const tentative = guides.features.find(f => f.properties?.guideType === 'tentative');
    expect(tentative).toBeDefined();
    expect(tentative.geometry.type).toBe('Polygon');
    expect(tentative.geometry.coordinates).toEqual([
      [
        pointDMapCoords,
        [pointCMapCoords[0], pointDMapCoords[1]],
        pointCMapCoords,
        [pointDMapCoords[0], pointCMapCoords[1]],
        pointDMapCoords
      ]
    ]);
  });
});

describe('modify mode', () => {
  let mode: GeoJsonEditMode;

  const modifyEditHandle: EditHandleFeature = {
    type: 'Feature',
    properties: {
      guideType: 'editHandle',
      editHandleType: 'existing',
      featureIndex: 0,
      positionIndexes: []
    },
    geometry: {type: 'Point', coordinates: pointAMapCoords}
  };

  beforeEach(() => {
    mode = new SnappableMode(new ModifyMode());
  });

  test('adds guide if there is an existing handle picked even if feature is selected', () => {
    const editHandlePick = {index: 0, isGuide: true, object: modifyEditHandle};

    const props = {
      ...defaultProps,
      lastPointerMoveEvent: {
        ...createPointerMoveEvent(snapToCMapCoords, [], snapToCScreenCoords),
        pointerDownPicks: [editHandlePick]
      },
      selectedIndexes: [0, 1]
    };

    const guides = mode.getGuides(props);

    expect(guides.features.length).toBe(4);
    expect(guides.features[3].properties.guideType).toBe('editHandle');
    expect((guides.features[3] as EditHandleFeature).properties.editHandleType).toBe('snap-target');
    expect(guides.features[3].geometry.type).toEqual('Point');
    expect(guides.features[3].geometry.coordinates).toEqual(pointCMapCoords);
  });

  test('does not add guides to picked feature', () => {
    const editHandlePick = {index: 0, isGuide: true, object: modifyEditHandle};

    const props = {
      ...defaultProps,
      lastPointerMoveEvent: {
        ...createPointerMoveEvent(snapToAMapCoords, [], snapToAScreenCoords),
        pointerDownPicks: [editHandlePick]
      },
      selectedIndexes: [0]
    };

    const guides = mode.getGuides(props);

    expect(guides.features.length).toBe(2);
    for (const feature of guides.features) {
      const editHandle = feature as EditHandleFeature;
      expect(editHandle.properties.editHandleType).not.toBe('snap-target');
    }
  });

  test('dragging edit handle near snap target only updates picked vertex', () => {
    const mockOnEdit = vi.fn();
    const props = {
      ...defaultProps,
      onEdit: mockOnEdit,
      selectedIndexes: [0]
    };

    simulateDrag(
      mode,
      props,
      pointAMapCoords,
      snapToCMapCoords,
      [{index: 0, isGuide: true, object: modifyEditHandle}],
      [targetPick]
    );

    // Should call onEdit once
    expect(mockOnEdit).toHaveBeenCalledTimes(1);
    const updatedCoords = mockOnEdit.mock.calls[0][0].updatedData.features[0].geometry.coordinates;
    // Only the picked vertex (index 0) should be snapped to offset
    expect(updatedCoords).toEqual(pointCMapCoords);
  });

  test('no target guides if there is no pointerDownPick', () => {
    const props = {
      ...defaultProps,
      lastPointerMoveEvent: {
        ...createPointerMoveEvent(snapToCMapCoords, [], snapToCScreenCoords)
      },
      selectedIndexes: [0]
    };

    const guides = mode.getGuides(props);

    expect(guides.features.length).toBe(2);
    for (const feature of guides.features) {
      const editHandle = feature as EditHandleFeature;
      expect(editHandle.properties.editHandleType).not.toBe('snap-target');
    }
  });
});

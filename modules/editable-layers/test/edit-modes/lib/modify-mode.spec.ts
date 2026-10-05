// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {beforeEach, describe, test, it, expect, vi} from 'vitest';
import {ModifyMode} from '../../../src/edit-modes/modify-mode';
import {DrawRectangleUsingThreePointsMode} from '../../../src/edit-modes/draw-rectangle-using-three-points-mode';
import {Pick, ModeProps} from '../../../src/edit-modes/types';
import {
  createFeatureCollectionProps,
  createClickEvent,
  createPointerMoveEvent,
  createStartDraggingEvent,
  createStopDraggingEvent
} from '../test-utils';
import {
  FeatureCollection,
  Position,
  Point,
  Polygon,
  LineString,
  Feature
} from '../../../src/utils/geojson-types';

let pointFeature: Feature<Point>;
let lineStringFeature: Feature<LineString>;
let polygonFeature;
let polygonRectangleFeature;
let multiPointFeature;
let multiLineStringFeature;
let multiPolygonFeature;

beforeEach(() => {
  pointFeature = {
    type: 'Feature',
    properties: {},
    geometry: {type: 'Point', coordinates: [1, 2]}
  };

  lineStringFeature = {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates: [
        [1, 2],
        [2, 3],
        [3, 4]
      ]
    }
  };

  polygonFeature = {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [
        // exterior ring
        [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
          [-1, -1]
        ],
        // hole
        [
          [-0.5, -0.5],
          [-0.5, 0.5],
          [0.5, 0.5],
          [0.5, -0.5],
          [-0.5, -0.5]
        ]
      ]
    }
  };

  polygonRectangleFeature = {
    type: 'Feature',
    properties: {shape: 'Rectangle'},
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-100, -100],
          [100, -100],
          [100, 100],
          [-100, 100],
          [-100, -100]
        ]
      ]
    }
  };

  multiPointFeature = {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'MultiPoint',
      coordinates: [
        [1, 2],
        [3, 4]
      ]
    }
  };

  multiLineStringFeature = {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'MultiLineString',
      coordinates: [
        [
          [1, 2],
          [2, 3],
          [3, 4]
        ],
        [
          [5, 6],
          [6, 7],
          [7, 8]
        ]
      ]
    }
  };

  multiPolygonFeature = {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'MultiPolygon',
      coordinates: [
        [
          // exterior ring polygon 1
          [
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
            [-1, -1]
          ],
          // hole  polygon 1
          [
            [-0.5, -0.5],
            [-0.5, 0.5],
            [0.5, 0.5],
            [0.5, -0.5],
            [-0.5, -0.5]
          ]
        ],
        [
          // exterior ring polygon 2
          [
            [2, -1],
            [4, -1],
            [4, 1],
            [2, 1],
            [2, -1]
          ]
        ]
      ]
    }
  };
});

const mockMove = (mode, picks: Pick[], props: ModeProps<FeatureCollection>) => {
  const moveEvent = createPointerMoveEvent([100, 100], picks);
  mode.handlePointerMove(moveEvent, props);

  const startDragEvent = createStartDraggingEvent([100, 100], [100, 100], picks);
  mode.handleStartDragging(startDragEvent, props);

  const stopDragEvent = createStopDraggingEvent([110, 115], [100, 100], picks, picks);
  mode.handleStopDragging(stopDragEvent, props);
};

test('Rectangular polygon feature preserves shape', () => {
  const mockOnEdit = vi.fn();
  const props = createFeatureCollectionProps({
    data: {
      type: 'FeatureCollection',
      features: [polygonRectangleFeature]
    } as FeatureCollection,
    selectedIndexes: [0],
    onEdit: mockOnEdit
  });

  const mode = new ModifyMode();
  const guides = mode.getGuides(props);
  expect(guides).toMatchSnapshot();

  const guideFeature = guides.features[2];
  mockMove(mode, [{index: 2, isGuide: true, object: guideFeature}], {
    ...props,
    modeConfig: {lockRectangles: true}
  });

  expect(mockOnEdit).toHaveBeenCalledTimes(1);
  const movedFeature = mockOnEdit.mock.calls[0][0].updatedData.features[0];
  expect(movedFeature).toMatchSnapshot();
  expect(props.data.features[0]).not.toEqual(movedFeature);
});

test('lockRectangles allows width to change independently of height', () => {
  const rectangle: Feature<Polygon> = {
    type: 'Feature',
    properties: {shape: 'Rectangle'},
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [6, 0],
          [6, 4],
          [0, 4],
          [0, 0]
        ]
      ]
    }
  };
  const props = createFeatureCollectionProps({
    data: {type: 'FeatureCollection', features: [rectangle]},
    selectedIndexes: [0],
    modeConfig: {lockRectangles: true},
    onEdit: vi.fn()
  });
  const mode = new ModifyMode();
  const picks = [{index: 2, isGuide: true, object: mode.getGuides(props).features[2]}];
  mode.handleStartDragging(createStartDraggingEvent([6, 4], [6, 4], picks), props);
  mode.handleStopDragging(createStopDraggingEvent([8, 4], [6, 4], picks, picks), props);

  const resized = vi.mocked(props.onEdit).mock.lastCall[0].updatedData.features[0];
  expect(resized.geometry.coordinates).toEqual([
    [
      [0, 0],
      [8, 0],
      [8, 4],
      [0, 4],
      [0, 0]
    ]
  ]);
});

describe.each(['clockwise', 'counterclockwise'])('locked rotated rectangle (%s)', winding => {
  test.each([0, 1, 2, 3])('preserves geometry throughout dragging corner %i', cornerIndex => {
    const angle = Math.PI / 5;
    const corners = [
      [-3, -2],
      [3, -2],
      [3, 2],
      [-3, 2]
    ].map(([x, y]) => [
      x * Math.cos(angle) - y * Math.sin(angle),
      x * Math.sin(angle) + y * Math.cos(angle)
    ]);
    if (winding === 'clockwise') {
      corners.reverse();
    }
    const rectangle: Feature<Polygon> = {
      type: 'Feature',
      properties: {shape: 'Rectangle'},
      geometry: {type: 'Polygon', coordinates: [[...corners, corners[0]]]}
    };
    const originalData: FeatureCollection = {
      type: 'FeatureCollection',
      features: [rectangle, pointFeature]
    };
    const mode = new ModifyMode();
    const props = createFeatureCollectionProps({
      data: originalData,
      selectedIndexes: [0],
      modeConfig: {lockRectangles: true},
      onEdit: vi.fn(({updatedData}) => {
        props.data = updatedData;
      })
    });
    const cornerHandle = mode.getGuides(props).features[cornerIndex];
    const dragStart = corners[cornerIndex];
    const opposite = corners[(cornerIndex + 2) % 4];
    const picks = [{index: cornerIndex, isGuide: true, object: cornerHandle}];
    mode.handleStartDragging(createStartDraggingEvent(dragStart, dragStart, picks), props);
    expect(props.onEdit).not.toHaveBeenCalled();

    const checkGeometry = (dragPosition: Position) => {
      expect(props.data.features).toHaveLength(2);
      expect(props.data.features[1]).toBe(pointFeature);
      const ring = (props.data.features[0].geometry as Polygon).coordinates[0];
      expect(ring).toHaveLength(5);
      expect(ring[4]).toEqual(ring[0]);
      expect(ring[cornerIndex]).toEqual(dragPosition);
      expect(ring[(cornerIndex + 2) % 4]).toEqual(opposite);
      for (let i = 0; i < 4; i++) {
        const edge = [ring[(i + 1) % 4][0] - ring[i][0], ring[(i + 1) % 4][1] - ring[i][1]];
        const nextEdge = [
          ring[(i + 2) % 4][0] - ring[(i + 1) % 4][0],
          ring[(i + 2) % 4][1] - ring[(i + 1) % 4][1]
        ];
        const originalEdge = [
          corners[(i + 1) % 4][0] - corners[i][0],
          corners[(i + 1) % 4][1] - corners[i][1]
        ];
        expect(edge[0] * nextEdge[0] + edge[1] * nextEdge[1]).toBeCloseTo(0, 10);
        expect(edge[0] * originalEdge[1] - edge[1] * originalEdge[0]).toBeCloseTo(0, 10);
      }
      // Hovering the resized edge must not introduce an intermediate vertex handle.
      props.lastPointerMoveEvent = createPointerMoveEvent(
        [(ring[0][0] + ring[1][0]) / 2, (ring[0][1] + ring[1][1]) / 2],
        [{index: 0, isGuide: false, object: props.data.features[0]}]
      );
      const guides = mode.getGuides(props);
      expect(guides.features).toHaveLength(4);
      expect(guides.features.every(guide => guide.properties.editHandleType === 'existing')).toBe(
        true
      );
    };

    let dragPosition = dragStart;
    for (let step = 1; step <= 10; step++) {
      dragPosition = [dragStart[0] + step * 0.08, dragStart[1] - step * 0.11];
      mode.handleDragging(
        {...createStopDraggingEvent(dragPosition, dragStart, picks, picks), cancelPan: vi.fn()},
        props
      );
      checkGeometry(dragPosition);
    }
    mode.handleStopDragging(createStopDraggingEvent(dragPosition, dragStart, picks, picks), props);
    checkGeometry(dragPosition);
    expect(props.onEdit).toHaveBeenCalledTimes(11);
    expect(vi.mocked(props.onEdit).mock.calls.map(([edit]) => edit.editType)).toEqual([
      ...Array(10).fill('movePosition'),
      'finishMovePosition'
    ]);
    expect(rectangle.geometry.coordinates[0]).toEqual([...corners, corners[0]]);
  });
});

test.each([
  0, 1, 2, 3
])('preserves a drawn geographic rectangle while dragging corner %i', cornerIndex => {
  const rectangle = new DrawRectangleUsingThreePointsMode().getThreeClickPolygon(
    [-122.47, 37.78],
    [-122.39, 37.75],
    [-122.42, 37.7],
    {}
  );
  const originalRing = rectangle.geometry.coordinates[0];
  const mode = new ModifyMode();
  const props = createFeatureCollectionProps({
    data: {type: 'FeatureCollection', features: [rectangle]},
    selectedIndexes: [0],
    modeConfig: {lockRectangles: true},
    onEdit: vi.fn(({updatedData}) => {
      props.data = updatedData;
    })
  });
  const cornerHandle = mode.getGuides(props).features[cornerIndex];
  const dragStart = originalRing[cornerIndex];
  const opposite = originalRing[(cornerIndex + 2) % 4];
  const picks = [{index: cornerIndex, isGuide: true, object: cornerHandle}];
  mode.handleStartDragging(createStartDraggingEvent(dragStart, dragStart, picks), props);
  let dragPosition = dragStart;
  for (let step = 1; step <= 12; step++) {
    dragPosition = [dragStart[0] - step * 0.001, dragStart[1] + step * 0.0005];
    mode.handleDragging(
      {...createStopDraggingEvent(dragPosition, dragStart, picks, picks), cancelPan: vi.fn()},
      props
    );
    const ring = (props.data.features[0].geometry as Polygon).coordinates[0];
    expect(props.data.features).toHaveLength(1);
    expect(ring).toHaveLength(5);
    expect(ring[4]).toEqual(ring[0]);
    expect(ring[cornerIndex]).toEqual(dragPosition);
    expect(ring[(cornerIndex + 2) % 4]).toEqual(opposite);
    // These axes are perpendicular on the map, not in raw longitude/latitude.
    // Both adjacent corners must stay on the original axes from the fixed corner.
    for (const adjacentIndex of [(cornerIndex + 1) % 4, (cornerIndex + 3) % 4]) {
      const originalAxis = [
        originalRing[adjacentIndex][0] - opposite[0],
        originalRing[adjacentIndex][1] - opposite[1]
      ];
      const axis = [ring[adjacentIndex][0] - opposite[0], ring[adjacentIndex][1] - opposite[1]];
      expect(axis[0] * originalAxis[1] - axis[1] * originalAxis[0]).toBeCloseTo(0, 12);
    }
    for (let axis = 0; axis < 2; axis++) {
      expect(ring[(cornerIndex + 1) % 4][axis] + ring[(cornerIndex + 3) % 4][axis]).toBeCloseTo(
        ring[cornerIndex][axis] + opposite[axis],
        8
      );
    }
  }
  mode.handleStopDragging(createStopDraggingEvent(dragPosition, dragStart, picks, picks), props);
  expect(vi.mocked(props.onEdit).mock.lastCall[0].editType).toBe('finishMovePosition');
});

test('lockRectangles prevents removing rectangle corner on click', () => {
  const mockOnEdit = vi.fn();
  const props = createFeatureCollectionProps({
    data: {
      type: 'FeatureCollection',
      features: [polygonRectangleFeature]
    } as FeatureCollection,
    selectedIndexes: [0],
    modeConfig: {lockRectangles: true},
    onEdit: mockOnEdit
  });

  const mode = new ModifyMode();
  const guides = mode.getGuides(props);

  // Find an existing edit handle (corner of the rectangle)
  const existingHandle = guides.features.find(
    ({properties}) =>
      properties.guideType === 'editHandle' && properties.editHandleType === 'existing'
  );
  expect(existingHandle).toBeDefined();

  // Click on the existing handle — should NOT trigger removePosition
  const clickEvent = createClickEvent(existingHandle?.geometry.coordinates as Position, [
    {index: 0, isGuide: true, object: existingHandle}
  ]);
  mode.handleClick(clickEvent, props);

  expect(mockOnEdit).not.toHaveBeenCalled();
});

test('clicking rectangle corner removes it when lockRectangles is not set', () => {
  const mockOnEdit = vi.fn();
  const props = createFeatureCollectionProps({
    data: {
      type: 'FeatureCollection',
      features: [polygonRectangleFeature]
    } as FeatureCollection,
    selectedIndexes: [0],
    onEdit: mockOnEdit
  });

  const mode = new ModifyMode();
  const guides = mode.getGuides(props);

  const existingHandle = guides.features.find(
    ({properties}) =>
      properties.guideType === 'editHandle' && properties.editHandleType === 'existing'
  );
  expect(existingHandle).toBeDefined();

  const clickEvent = createClickEvent(existingHandle?.geometry.coordinates as Position, [
    {index: 0, isGuide: true, object: existingHandle}
  ]);
  mode.handleClick(clickEvent, props);

  expect(mockOnEdit).toHaveBeenCalledTimes(1);
  expect(mockOnEdit.mock.calls[0][0].editType).toBe('removePosition');
});

test('Correct coordinate edited when stopping near another guide', () => {
  const mockOnEdit = vi.fn();
  const props = createFeatureCollectionProps({
    data: {
      type: 'FeatureCollection',
      features: [lineStringFeature]
    } as FeatureCollection,
    selectedIndexes: [0],
    onEdit: mockOnEdit
  });

  const mode = new ModifyMode();
  const guides = mode.getGuides(props);
  expect(guides).toMatchSnapshot();

  const dragStart = [1, 2];
  const dragEnd = [3.1, 4.1];

  const pointerDownPicks = [
    {index: 0, isGuide: true, object: guides.features[0]},
    {index: 0, object: lineStringFeature}
  ];

  const stopDragPicks = [
    {index: 2, isGuide: true, object: guides.features[2]}, // simulate another guide being picked
    {index: 0, isGuide: true, object: guides.features[0]},
    {index: 0, object: lineStringFeature}
  ];

  const startDragEvent = createStartDraggingEvent(dragStart, dragStart, pointerDownPicks);
  mode.handleStartDragging(startDragEvent, props);

  const stopDragEvent = createStopDraggingEvent(
    dragEnd,
    dragStart,
    stopDragPicks,
    pointerDownPicks
  );
  mode.handleStopDragging(stopDragEvent, props);

  expect(mockOnEdit).toHaveBeenCalledTimes(1);

  const editedFeature = mockOnEdit.mock.calls[0][0].updatedData.features[0];
  expect(editedFeature).toMatchSnapshot();
});

describe('getGuides()', () => {
  it('gets edit handles for Point', () => {
    const mode = new ModifyMode();
    const props = createFeatureCollectionProps({
      data: {
        type: 'FeatureCollection',
        features: [pointFeature]
      } as FeatureCollection,
      selectedIndexes: [0]
    });

    const guides = mode.getGuides(props);

    expect(guides).toMatchSnapshot();
  });

  it('gets edit handles for LineString', () => {
    const mode = new ModifyMode();
    const props = createFeatureCollectionProps({
      data: {
        type: 'FeatureCollection',
        features: [lineStringFeature]
      },
      selectedIndexes: [0]
    });

    const guides = mode.getGuides(props);

    expect(guides).toMatchSnapshot();
  });

  it('gets edit handles for Polygon', () => {
    const mode = new ModifyMode();
    const props = createFeatureCollectionProps({
      data: {
        type: 'FeatureCollection',
        features: [polygonFeature]
      },
      selectedIndexes: [0]
    });

    const guides = mode.getGuides(props);

    expect(guides).toMatchSnapshot();
  });

  it('gets edit handles for MultiPoint', () => {
    const mode = new ModifyMode();
    const props = createFeatureCollectionProps({
      data: {
        type: 'FeatureCollection',
        features: [multiPointFeature]
      },
      selectedIndexes: [0]
    });

    const guides = mode.getGuides(props);

    expect(guides).toMatchSnapshot();
  });

  it('gets edit handles for MultiLineString', () => {
    const mode = new ModifyMode();
    const props = createFeatureCollectionProps({
      data: {
        type: 'FeatureCollection',
        features: [multiLineStringFeature]
      },
      selectedIndexes: [0]
    });

    const guides = mode.getGuides(props);

    expect(guides).toMatchSnapshot();
  });

  it('gets edit handles for MultiPolygon', () => {
    const mode = new ModifyMode();
    const props = createFeatureCollectionProps({
      data: {
        type: 'FeatureCollection',
        features: [multiPolygonFeature]
      },
      selectedIndexes: [0]
    });

    const guides = mode.getGuides(props);

    expect(guides).toMatchSnapshot();
  });

  it('gets edit handles for all selected features in collection', () => {
    const mode = new ModifyMode();
    const props = createFeatureCollectionProps({
      data: {
        type: 'FeatureCollection',
        features: [lineStringFeature, pointFeature, multiPointFeature]
      } as FeatureCollection,
      selectedIndexes: [0, 2]
    });

    const guides = mode.getGuides(props);

    expect(guides).toMatchSnapshot();
  });

  const lineString: Feature<LineString> = {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: [
        [-122.40880966186523, 37.783536601521924],
        [-122.43893623352051, 37.779669924659004],
        [-122.43515968322752, 37.7624370109886],
        [-122.42348670959471, 37.77180027337861],
        [-122.4250316619873, 37.778584505321376],
        [-122.42314338684082, 37.778652344496926],
        [-122.42357254028322, 37.77987343901049],
        [-122.41198539733887, 37.78109451335266]
      ]
    }
  };

  const point = {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [-122.40880966186523, 37.783536601521924]
    }
  };
  const pick = {
    object: lineString,
    isGuide: false,
    index: 0
  };

  const mapCoords: Position = [-122.43862233312133, 37.77767798407437];

  it('includes an intermediate edit handle', () => {
    const mode = new ModifyMode();
    const props = createFeatureCollectionProps({
      data: {
        type: 'FeatureCollection',
        features: [lineString]
      } as FeatureCollection,
      selectedIndexes: [0],
      lastPointerMoveEvent: {
        picks: [pick],
        mapCoords,
        screenCoords: [42, 42],
        cancelPan: vi.fn(),
        sourceEvent: null
      },
      modeConfig: {
        viewport: {
          width: 800,
          height: 600,
          latitude: 37.8,
          longitude: -122.4,
          zoom: 10,
          project: (x: number) => x,
          unproject: (x: number) => x
        }
      }
    });

    const guides = mode.getGuides(props);

    const intermediate = guides.features.find(
      ({properties}) =>
        properties.guideType === 'editHandle' && properties.editHandleType === 'intermediate'
    );

    expect(intermediate).toMatchSnapshot();
  });

  it('does not add intermeidate edit handle when no picks provided', () => {
    const mode = new ModifyMode();
    const props = createFeatureCollectionProps({
      data: {
        type: 'FeatureCollection',
        features: [lineString]
      },
      selectedIndexes: [0]
    });

    const guides = mode.getGuides(props);

    const intermediate = guides.features.find(
      ({properties}) =>
        properties.guideType === 'editHandle' && properties.editHandleType === 'intermediate'
    );
    expect(intermediate).toBeUndefined();
  });

  it('does not add intermeidate edit handle when too close to existing edit handle', () => {
    const mode = new ModifyMode();
    const props = createFeatureCollectionProps({
      data: {
        type: 'FeatureCollection',
        features: [lineString]
      } as FeatureCollection,
      selectedIndexes: [0],
      lastPointerMoveEvent: {
        picks: [
          pick,
          {
            isGuide: true,
            index: 42,
            object: {
              properties: {guideType: 'editHandle', editHandleType: 'existing', featureIndex: 0},
              geometry: {coordinates: []}
            }
          }
        ],
        mapCoords,
        screenCoords: [42, 42],
        cancelPan: vi.fn(),
        sourceEvent: null
      }
    });

    const guides = mode.getGuides(props);

    const intermediate = guides.features.find(
      ({properties}) =>
        properties.guideType === 'editHandle' && properties.editHandleType === 'intermediate'
    );
    expect(intermediate).toBeUndefined();
  });

  it('does not add intermeidate edit handle when pick is not a selected feature', () => {
    const mode = new ModifyMode();
    const props = createFeatureCollectionProps({
      data: {
        type: 'FeatureCollection',
        features: [lineString]
      } as FeatureCollection
    });

    const guides = mode.getGuides(props);

    const intermediate = guides.features.find(
      ({properties}) =>
        properties.guideType === 'editHandle' && properties.editHandleType === 'intermediate'
    );
    expect(intermediate).toBeUndefined();
  });

  it('does not add intermeidate edit handle when pick is a Point / MultiPoint', () => {
    const mode = new ModifyMode();
    const props = createFeatureCollectionProps({
      data: {
        type: 'FeatureCollection',
        features: [point]
      } as FeatureCollection,
      selectedIndexes: [0],
      lastPointerMoveEvent: {
        picks: [
          {
            isGuide: false,
            index: 0,
            object: point
          }
        ],
        mapCoords,
        screenCoords: [42, 42],
        cancelPan: vi.fn(),
        sourceEvent: null
      }
    });
    const guides = mode.getGuides(props);
    const intermediate = guides.features.find(
      ({properties}) =>
        properties.guideType === 'editHandle' && properties.editHandleType === 'intermediate'
    );
    expect(intermediate).toBeUndefined();
  });
});

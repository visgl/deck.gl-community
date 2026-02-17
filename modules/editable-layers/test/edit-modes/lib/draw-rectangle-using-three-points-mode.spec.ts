// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {beforeEach, describe, it, expect} from 'vitest';
import {Position} from 'geojson';

import {DrawRectangleUsingThreePointsMode} from '../../../src/edit-modes/draw-rectangle-using-three-points-mode';
import {
  createFeatureCollectionProps,
  createClickEvent,
  createPointerMoveEvent,
  createKeyboardEvent
} from '../test-utils';

let mode;
let props;

beforeEach(() => {
  mode = new DrawRectangleUsingThreePointsMode();
  props = {
    ...createFeatureCollectionProps({
      data: {
        type: 'FeatureCollection',
        features: []
      }
    })
  };
});

describe('after clicking once and moving pointer', () => {
  beforeEach(() => {
    simulate.moveAndClick([1, 1]);
    simulate.move([1, 2]);
  });
  it('getGuides returns line', () => {
    expect(mode.getGuides(props).features).toEqual([
      {
        type: 'Feature',
        properties: {
          guideType: 'tentative'
        },
        geometry: {
          type: 'LineString',
          coordinates: [
            [1, 1],
            [1, 2]
          ]
        }
      }
    ]);
  });
  it('does not call onEdit', () => {
    expect(props.onEdit).toHaveBeenCalledTimes(0);
  });
});

describe('after clicking twice and moving pointer', () => {
  beforeEach(() => {
    simulate.moveAndClick([1, 1]);
    simulate.moveAndClick([1, 2]);
    simulate.move([2, 2]);
  });

  it('getGuides returns polygon', () => {
    expect(mode.getGuides(props).features).toEqual([
      expect.objectContaining({
        type: 'Feature',
        properties: expect.objectContaining({
          shape: 'Rectangle',
          guideType: 'tentative'
        }),
        geometry: expect.objectContaining({
          type: 'Polygon',
          coordinates: [
            coordinatesCloseTo([
              [1, 1],
              [1, 2],
              [2, 2],
              [2, 1],
              [1, 1]
            ])
          ]
        })
      })
    ]);
  });

  it('calls onEdit with tentative feature', () => {
    expect(props.onEdit).toHaveBeenCalledTimes(1);
    const lastCall = props.onEdit.mock.calls[props.onEdit.mock.calls.length - 1][0];
    expect(lastCall.editType).toEqual('updateTentativeFeature');
    expect(lastCall.editContext.feature).toEqual(
      expect.objectContaining({
        type: 'Feature',
        properties: expect.objectContaining({
          shape: 'Rectangle'
        }),
        geometry: expect.objectContaining({
          type: 'Polygon',
          coordinates: [
            coordinatesCloseTo([
              [1, 1],
              [1, 2],
              [2, 2],
              [2, 1],
              [1, 1]
            ])
          ]
        })
      })
    );
  });
});

describe('after clicking three times', () => {
  beforeEach(() => {
    simulate.moveAndClick([1, 1]);
    simulate.moveAndClick([1, 2]);
    simulate.moveAndClick([2, 2]);
  });

  it('calls onEdit with addFeature feature event', () => {
    expect(props.onEdit).toHaveBeenCalledTimes(2);
    expect(props.onEdit.mock.calls[0][0].editType).toEqual('updateTentativeFeature');
    const lastCall = props.onEdit.mock.calls[1][0];
    expect(lastCall.editType).toEqual('addFeature');
    expect(lastCall.updatedData.features).toEqual([
      expect.objectContaining({
        type: 'Feature',
        properties: expect.objectContaining({
          shape: 'Rectangle'
        }),
        // note - geometry has been rewound to be counterclockwise
        geometry: expect.objectContaining({
          type: 'Polygon',
          coordinates: [
            coordinatesCloseTo([
              [1, 1],
              [2, 1],
              [2, 2],
              [1, 2],
              [1, 1]
            ])
          ]
        })
      })
    ]);
  });
});

describe('after hitting escape', () => {
  beforeEach(() => {
    mode.handleKeyUp(createKeyboardEvent('Escape'), props);
  });

  it('calls onEdit with cancelFeature', () => {
    expect(props.onEdit).toHaveBeenCalled();
    const lastCall = props.onEdit.mock.calls[props.onEdit.mock.calls.length - 1][0];
    expect(lastCall.editType).toEqual('cancelFeature');
  });

  it("doesn't change the data", () => {
    const expectedData = {
      type: 'FeatureCollection',
      features: []
    };
    const lastCall = props.onEdit.mock.calls[props.onEdit.mock.calls.length - 1][0];
    expect(lastCall.updatedData).toEqual(expectedData);
  });

  it('resets the click sequence', () => {
    expect(mode.getClickSequence()).toEqual([]);
  });
});

/*
 * Regression test for getGuides receiving no pointer move event the first time it's called
 * after a click, which caused an error when it tried to access the mapCoords of the pointer
 * move event.
 *
 * See https://github.com/visgl/deck.gl-community/issues/462
 *
 * Most commonly happens as a result of mjolnir.js firing events in click -> pointermove
 * order when using a touchscreen, but can occur in the uncommon situation where the mouse
 * pointer is never moved across the map before the first click occurs.
 */
describe('after clicking once before pointer move', () => {
  beforeEach(() => {
    simulate.click([1, 1]);
  });
  it('getGuides returns empty array', () => {
    expect(
      mode.getGuides({
        ...props,
        lastPointerMoveEvent: undefined
      }).features
    ).toEqual([]);
  });
});

/*
 * Regression test ensures rectangle drawing works when events fire in click -> pointermove order.
 *
 * See https://github.com/visgl/deck.gl-community/issues/462
 */
describe('after clicking three times, but click event occurs before pointer move event', () => {
  beforeEach(() => {
    simulate.click([1, 1]);
    simulate.move([1, 1]);
    simulate.click([1, 2]);
    simulate.move([1, 2]);
    simulate.click([2, 2]);
    simulate.move([2, 2]);
  });

  it('calls onEdit with addFeature feature event', () => {
    expect(props.onEdit).toHaveBeenCalledTimes(2);
    expect(props.onEdit.mock.calls[0][0].editType).toEqual('updateTentativeFeature');
    const lastCall = props.onEdit.mock.calls[1][0];
    expect(lastCall.editType).toEqual('addFeature');

    expect(lastCall.updatedData.features).toEqual([
      expect.objectContaining({
        type: 'Feature',
        properties: expect.objectContaining({
          shape: 'Rectangle'
        }),
        // note - geometry has been rewound to be counterclockwise
        geometry: expect.objectContaining({
          type: 'Polygon',
          coordinates: [
            coordinatesCloseTo([
              [1, 1],
              [2, 1],
              [2, 2],
              [1, 2],
              [1, 1]
            ])
          ]
        })
      })
    ]);
  });
});

/**
 * Simulates user interactions by calling the appropriate event handlers on the mode with generated events.
 */
const simulate = {
  move: (coords: [number, number]) => {
    const event = createPointerMoveEvent(coords);
    props.lastPointerMoveEvent = event;
    mode.handlePointerMove(event, props);
  },
  click: (coords: [number, number]) => {
    mode.handleClick(createClickEvent(coords), props);
  },
  moveAndClick: (coords: [number, number]) => {
    simulate.move(coords);
    simulate.click(coords);
  }
};

/**
 * Wraps expectCoordinatesCloseTo in an asymmetric matcher.
 */
const coordinatesCloseTo = (expected: Position[][] | Position[] | Position, numDigits = 2) => ({
  asymmetricMatch: (actual: any) => {
    expectCoordinatesCloseTo(actual, expected, numDigits);
    return true;
  },
  toString: () => `CoordinatesCloseTo(${JSON.stringify(expected)})`
});

/**
 * Recursively asserts that coordinates arrays match with the specified precision.
 */
const expectCoordinatesCloseTo = (
  actual: Position[][] | Position[] | Position | number,
  expected: Position[][] | Position[] | Position | number,
  numDigits: number = 2,
  path: string = 'root'
): void => {
  if (Array.isArray(actual) && Array.isArray(expected)) {
    expect(actual.length, `${path} length`).toBe(expected.length);
    actual.forEach((val, i) =>
      expectCoordinatesCloseTo(val, expected[i], numDigits, `${path}[${i}]`)
    );
  } else if (typeof actual === 'number' && typeof expected === 'number') {
    try {
      expect(actual).toBeCloseTo(expected, numDigits);
    } catch (e: any) {
      e.message = `At ${path}: ${e.message}`;
      throw e;
    }
  }
};

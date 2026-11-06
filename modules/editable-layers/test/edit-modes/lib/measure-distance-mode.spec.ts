// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {beforeEach, describe, it, expect, vi} from 'vitest';
import {MeasureDistanceMode} from '../../../src/edit-modes/measure-distance-mode';
import {
  GeoCoordinateSystem,
  cartesianCoordinateSystem,
  geoCoordinateSystem
} from '../../../src/edit-modes/coordinate-system';
import type {EditModeCoordinateSystem} from '../../../src/edit-modes/coordinate-system';
import type {ModeProps} from '../../../src/edit-modes/types';
import type {SimpleFeatureCollection} from '../../../src/utils/geojson-types';
import {
  createFeatureCollectionProps,
  createClickEvent,
  createPointerMoveEvent,
  createKeyboardEvent
} from '../test-utils';

const expectToBeCloseToArray = (actual: number[], expected: number[]) => {
  expect(actual.length).toBe(expected.length);
  actual.forEach((x, index) => expect(x).toBeCloseTo(expected[index], 1));
};

describe('double click', () => {
  let mode: MeasureDistanceMode;
  let props: ModeProps<SimpleFeatureCollection>;

  beforeEach(() => {
    mode = new MeasureDistanceMode();
    props = {
      ...createFeatureCollectionProps({modeConfig: {measurementCallback: vi.fn()}}),
      data: {type: 'FeatureCollection', features: []}
    };
  });

  it.each([true, false])('finishes the measured line (endpoint picked: %s)', picksEndpoint => {
    const positions = [
      [1, 2],
      [3, 4],
      [4, 5]
    ];
    for (const position of positions) {
      mode.handleClick(createClickEvent(position), props);
    }
    const tooltips = mode.getTooltips({...props, lastPointerMoveEvent: null});
    const endpoint = mode.getGuides(props).features[positions.length];
    const event = createClickEvent(
      positions[positions.length - 1],
      picksEndpoint ? [{index: -1, isGuide: true, object: endpoint}] : []
    );

    // A recognized double click is dispatched separately from handleClick.
    mode.handleDoubleClick(event, props);

    expect(props.onUpdateCursor).toHaveBeenCalledExactlyOnceWith('cell');
    props.lastPointerMoveEvent = createPointerMoveEvent([6, 7]);
    mode.handlePointerMove(props.lastPointerMoveEvent, props);
    expect(mode.getGuides(props).features[0].geometry.coordinates).toEqual(positions);
    expect(mode.getTooltips(props)).toEqual(tooltips);
    expect(mode.getClickSequence()).toEqual(positions);
    expect(props.modeConfig.measurementCallback).toHaveBeenCalledTimes(2);
    expect(props.onEdit).toHaveBeenCalledTimes(3);
  });

  it.each([0, 1])('ignores double clicks with %s committed positions', pointCount => {
    if (pointCount) {
      mode.handleClick(createClickEvent([1, 2]), props);
    }

    mode.handleDoubleClick(createClickEvent([3, 4]), props);

    expect(mode._isMeasuringSessionFinished).toBe(false);
    expect(mode.getClickSequence()).toEqual(pointCount ? [[1, 2]] : []);
    expect(props.onUpdateCursor).not.toHaveBeenCalled();
    expect(props.onEdit).toHaveBeenCalledTimes(pointCount);
  });

  it('refreshes the line when a native endpoint click precedes the double click', () => {
    mode.handleClick(createClickEvent([1, 2]), props);
    mode.handleClick(createClickEvent([3, 4]), props);
    const endpoint = mode.getGuides(props).features[2];
    const event = createClickEvent([3, 4], [{index: -1, isGuide: true, object: endpoint}]);

    // Native input sends the first click immediately, then the double click.
    mode.handleClick(event, props);
    mode.handleDoubleClick(event, props);

    expect(props.onUpdateCursor).toHaveBeenCalledExactlyOnceWith('cell');
    props.lastPointerMoveEvent = createPointerMoveEvent([6, 7]);
    expect(mode.getGuides(props).features[0].geometry.coordinates).toEqual([
      [1, 2],
      [3, 4]
    ]);
    expect(props.onEdit).toHaveBeenCalledTimes(2);
  });

  it('ignores double clicks after the measurement has finished', () => {
    mode.handleClick(createClickEvent([1, 2]), props);
    mode.handleClick(createClickEvent([3, 4]), props);
    const event = createClickEvent([3, 4]);
    mode.handleDoubleClick(event, props);
    const guides = mode.getGuides(props);
    const tooltips = mode.getTooltips(props);

    mode.handleDoubleClick(event, props);

    expect(mode.getGuides(props)).toEqual(guides);
    expect(mode.getTooltips(props)).toEqual(tooltips);
    expect(props.onUpdateCursor).toHaveBeenCalledExactlyOnceWith('cell');
    expect(props.onEdit).toHaveBeenCalledTimes(2);
  });

  it('starts a fresh measurement on the next click', () => {
    mode.handleClick(createClickEvent([1, 2]), props);
    mode.handleClick(createClickEvent([3, 4]), props);
    mode.handleDoubleClick(createClickEvent([3, 4]), props);

    mode.handleClick(createClickEvent([10, 11]), props);
    props.lastPointerMoveEvent = createPointerMoveEvent([10, 11]);

    expect(mode._isMeasuringSessionFinished).toBe(false);
    expect(mode.getClickSequence()).toEqual([[10, 11]]);
    expect(mode.getTooltips(props)).toEqual([{position: [10, 11], text: '0.00 kilometers'}]);
    expect(props.onEdit).toHaveBeenCalledTimes(3);
  });
});

describe('measurement units', () => {
  // One degree along the equator, using Turf's mean Earth radius.
  const DISTANCE_KILOMETERS = 111.1950802335329;

  function createMeasurementProps(
    overrides: Partial<ModeProps<SimpleFeatureCollection>> = {}
  ): ModeProps<SimpleFeatureCollection> {
    return {
      ...createFeatureCollectionProps(),
      data: {type: 'FeatureCollection', features: []},
      ...overrides
    };
  }

  it.each([
    {units: undefined, label: 'kilometers', expected: DISTANCE_KILOMETERS},
    {units: 'kilometers', label: 'kilometers', expected: DISTANCE_KILOMETERS},
    {units: 'meters', label: 'meters', expected: 111195.0802335329},
    {units: 'miles', label: 'miles', expected: 69.09341957563635}
  ])('uses $label for clicked and live measurements (units=$units)', ({units, label, expected}) => {
    const mode = new MeasureDistanceMode();
    const measurementCallback = vi.fn();
    const modeConfig = {turfOptions: {units}, measurementCallback};
    const props = createMeasurementProps({modeConfig, lastPointerMoveEvent: null});

    mode.handleClick(createClickEvent([0, 0]), props);
    mode.handleClick(createClickEvent([1, 0]), props);

    expect(measurementCallback).toHaveBeenCalledExactlyOnceWith(expect.closeTo(expected, 8));
    expect(mode.getTooltips(props)[0].text).toBe(`${expected.toFixed(2)} ${label}`);

    const liveProps = {...props, lastPointerMoveEvent: createPointerMoveEvent([2, 0])};
    const liveTooltips = mode.getTooltips(liveProps);
    expect(liveTooltips[liveTooltips.length - 1].text).toBe(
      `${(expected * 2).toFixed(2)} ${label}`
    );
    // The callback retains its existing per-segment semantics.
    expect(measurementCallback).toHaveBeenLastCalledWith(expect.closeTo(expected, 8));

    const formatTooltip = vi.fn((distance: number) => `distance=${distance}`);
    const customTooltips = mode.getTooltips({
      ...liveProps,
      modeConfig: {...modeConfig, formatTooltip}
    });
    expect(formatTooltip).toHaveBeenLastCalledWith(expect.closeTo(expected * 2, 8));
    expect(customTooltips[customTooltips.length - 1].text).toBe(
      `distance=${formatTooltip.mock.calls[0][0]}`
    );
  });

  it('rejects unsupported geographic output units', () => {
    const mode = new MeasureDistanceMode();
    const props = createMeasurementProps({modeConfig: {turfOptions: {units: 'unsupported'}}});
    mode.handleClick(createClickEvent([0, 0]), props);

    expect(() => mode.handleClick(createClickEvent([1, 0]), props)).toThrow(/invalid/);
  });

  it('accumulates clicked and live distances in the configured units', () => {
    const mode = new MeasureDistanceMode();
    const measurementCallback = vi.fn();
    const props = createMeasurementProps({
      modeConfig: {turfOptions: {units: 'meters'}, measurementCallback},
      lastPointerMoveEvent: null
    });
    mode.handleClick(createClickEvent([0, 0]), props);
    mode.handleClick(createClickEvent([1, 0]), props);
    mode.handleClick(createClickEvent([2, 0]), props);

    expect(mode.getTooltips(props).map(tooltip => tooltip.text)).toEqual([
      '111195.08 meters',
      '222390.16 meters'
    ]);
    expect(measurementCallback).toHaveBeenCalledTimes(2);
    expect(measurementCallback).toHaveBeenLastCalledWith(expect.closeTo(111195.0802335329, 8));

    const formatTooltip = vi.fn((distance: number) => `${distance.toFixed(2)} meters total`);
    const liveTooltips = mode.getTooltips({
      ...props,
      modeConfig: {...props.modeConfig, formatTooltip},
      lastPointerMoveEvent: createPointerMoveEvent([3, 0])
    });
    expect(liveTooltips[liveTooltips.length - 1].text).toBe('333585.24 meters total');
    expect(formatTooltip).toHaveBeenCalledExactlyOnceWith(expect.closeTo(333585.2407005987, 8));
    expect(measurementCallback).toHaveBeenCalledTimes(3);
    expect(measurementCallback).toHaveBeenLastCalledWith(expect.closeTo(111195.0802335329, 8));
  });

  it('refreshes cached and live totals when geographic units change', () => {
    const mode = new MeasureDistanceMode();
    const measurementCallback = vi.fn();
    const formatTooltip = vi.fn((distance: number) => `${distance.toFixed(2)} total`);
    const props = createMeasurementProps({
      modeConfig: {turfOptions: {units: 'kilometers'}, measurementCallback, formatTooltip},
      lastPointerMoveEvent: null
    });
    mode.handleClick(createClickEvent([0, 0]), props);
    mode.handleClick(createClickEvent([1, 0]), props);
    mode.handleClick(createClickEvent([2, 0]), props);
    expect(measurementCallback).toHaveBeenCalledTimes(2);
    formatTooltip.mockClear();

    const meterProps = {
      ...props,
      modeConfig: {...props.modeConfig, turfOptions: {units: 'meters'}},
      lastPointerMoveEvent: createPointerMoveEvent([3, 0])
    };
    const tooltips = mode.getTooltips(meterProps);

    expect(tooltips.map(tooltip => tooltip.text)).toEqual([
      '111195.08 total',
      '222390.16 total',
      '333585.24 total'
    ]);
    expect(formatTooltip.mock.calls.map(([distance]) => distance)).toEqual([
      expect.closeTo(111195.0802335329, 8),
      expect.closeTo(222390.1604670658, 8),
      expect.closeTo(333585.2407005987, 8)
    ]);
    // Recalculating historical segments must not replay their measurement callbacks.
    expect(measurementCallback).toHaveBeenCalledTimes(3);
    expect(measurementCallback).toHaveBeenLastCalledWith(expect.closeTo(111195.0802335329, 8));
    mode.getTooltips({...meterProps, lastPointerMoveEvent: null});
    expect(measurementCallback).toHaveBeenCalledTimes(3);
  });

  it('refreshes cached totals before a click using newly selected geographic units', () => {
    const mode = new MeasureDistanceMode();
    const measurementCallback = vi.fn();
    const props = createMeasurementProps({
      modeConfig: {turfOptions: {units: 'kilometers'}, measurementCallback},
      lastPointerMoveEvent: null
    });
    mode.handleClick(createClickEvent([0, 0]), props);
    mode.handleClick(createClickEvent([1, 0]), props);
    mode.handleClick(createClickEvent([2, 0]), props);
    const meterProps = {
      ...props,
      modeConfig: {...props.modeConfig, turfOptions: {units: 'meters'}}
    };

    // No tooltip read occurs between changing the units and committing the next segment.
    mode.handleClick(createClickEvent([3, 0]), meterProps);

    expect(mode.getTooltips(meterProps).map(tooltip => tooltip.text)).toEqual([
      '111195.08 meters',
      '222390.16 meters',
      '333585.24 meters'
    ]);
    expect(measurementCallback).toHaveBeenCalledTimes(3);
    expect(measurementCallback).toHaveBeenLastCalledWith(expect.closeTo(111195.0802335329, 8));
  });

  const legacyCustomCoordinateSystem: EditModeCoordinateSystem = {
    distance: (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]),
    bearing: (a, b) => cartesianCoordinateSystem.bearing(a, b),
    destination: (origin, distance, bearing) =>
      cartesianCoordinateSystem.destination(origin, distance, bearing),
    midpoint: (a, b) => cartesianCoordinateSystem.midpoint(a, b)
  };

  it.each([
    {name: 'Cartesian', coordinateSystem: cartesianCoordinateSystem},
    {name: 'legacy custom', coordinateSystem: legacyCustomCoordinateSystem}
  ])('keeps $name totals native when the geographic unit option changes', ({coordinateSystem}) => {
    const mode = new MeasureDistanceMode();
    const measurementCallback = vi.fn();
    const props = createMeasurementProps({
      coordinateSystem,
      modeConfig: {turfOptions: {units: 'kilometers'}, measurementCallback},
      lastPointerMoveEvent: null
    });
    mode.handleClick(createClickEvent([0, 0]), props);
    mode.handleClick(createClickEvent([3, 4]), props);
    const meterProps = {
      ...props,
      modeConfig: {...props.modeConfig, turfOptions: {units: 'meters'}},
      lastPointerMoveEvent: createPointerMoveEvent([6, 8])
    };

    expect(mode.getTooltips(meterProps).map(tooltip => tooltip.text)).toEqual([
      '5.00 units',
      '10.00 units'
    ]);
    expect(measurementCallback).toHaveBeenCalledTimes(2);
    expect(measurementCallback).toHaveBeenLastCalledWith(5);

    mode.handleClick(createClickEvent([6, 8]), meterProps);
    expect(
      mode.getTooltips({...meterProps, lastPointerMoveEvent: null}).map(tooltip => tooltip.text)
    ).toEqual(['5.00 units', '10.00 units']);
    expect(measurementCallback).toHaveBeenCalledTimes(3);
    expect(measurementCallback).toHaveBeenLastCalledWith(5);
  });

  class NativeGeoCoordinateSystem extends GeoCoordinateSystem {
    override readonly distanceUnits = 'native';

    override distance(a: number[], b: number[]): number {
      return cartesianCoordinateSystem.distance(a, b);
    }
  }

  it.each([
    {name: 'Cartesian', coordinateSystem: cartesianCoordinateSystem, units: undefined},
    {name: 'Cartesian', coordinateSystem: cartesianCoordinateSystem, units: 'miles'},
    {
      name: 'custom without unit metadata',
      coordinateSystem: legacyCustomCoordinateSystem,
      units: undefined
    },
    {
      name: 'custom without unit metadata',
      coordinateSystem: legacyCustomCoordinateSystem,
      units: 'miles'
    },
    {
      name: 'geographic subclass with native unit metadata',
      coordinateSystem: new NativeGeoCoordinateSystem(),
      units: 'miles'
    }
  ])('keeps $name measurements in native units (units=$units)', ({coordinateSystem, units}) => {
    const mode = new MeasureDistanceMode();
    const measurementCallback = vi.fn();
    const props = createMeasurementProps({
      coordinateSystem,
      modeConfig: {turfOptions: {units}, measurementCallback},
      lastPointerMoveEvent: null
    });
    mode.handleClick(createClickEvent([0, 0]), props);
    mode.handleClick(createClickEvent([3, 4]), props);

    expect(measurementCallback).toHaveBeenCalledExactlyOnceWith(5);
    expect(mode.getTooltips(props)[0].text).toBe('5.00 units');

    const formatTooltip = vi.fn((distance: number) => `${distance} local units`);
    const tooltips = mode.getTooltips({
      ...props,
      modeConfig: {...props.modeConfig, formatTooltip},
      lastPointerMoveEvent: createPointerMoveEvent([6, 8])
    });
    expect(formatTooltip).toHaveBeenLastCalledWith(10);
    expect(tooltips[tooltips.length - 1].text).toBe('10 local units');
    expect(measurementCallback).toHaveBeenLastCalledWith(5);
  });

  it('forwards configured units through custom geographic implementations', () => {
    const coordinateSystem: EditModeCoordinateSystem = {
      distanceUnits: 'kilometers',
      distance: (a, b, options) => geoCoordinateSystem.distance(a, b, options),
      bearing: (a, b) => geoCoordinateSystem.bearing(a, b),
      destination: (origin, distance, bearing) =>
        geoCoordinateSystem.destination(origin, distance, bearing),
      midpoint: (a, b) => geoCoordinateSystem.midpoint(a, b)
    };
    const mode = new MeasureDistanceMode();
    const measurementCallback = vi.fn();
    const props = createMeasurementProps({
      coordinateSystem,
      modeConfig: {turfOptions: {units: 'meters'}, measurementCallback},
      lastPointerMoveEvent: null
    });
    mode.handleClick(createClickEvent([0, 0]), props);
    mode.handleClick(createClickEvent([1, 0]), props);

    expect(mode.getTooltips(props)[0].text).toBe('111195.08 meters');
    expect(measurementCallback).toHaveBeenCalledExactlyOnceWith(
      expect.closeTo(111195.0802335329, 8)
    );
  });
});

describe('move without click', () => {
  let mode: MeasureDistanceMode;
  beforeEach(() => {
    mode = new MeasureDistanceMode();
    mode.handlePointerMove(createPointerMoveEvent(), createFeatureCollectionProps());
  });

  it('guides are empty', () => {
    const guides = mode.getGuides(createFeatureCollectionProps());
    expect(guides).toEqual({type: 'FeatureCollection', features: []});
  });

  it('tooltips are empty', () => {
    const tooltips = mode.getTooltips(createFeatureCollectionProps());
    expect(tooltips).toEqual([]);
  });
});

describe('one click', () => {
  let mode: MeasureDistanceMode;
  beforeEach(() => {
    mode = new MeasureDistanceMode();
    mode.handleClick(createClickEvent([1, 2]), createFeatureCollectionProps());
  });

  it('guides are a single point', () => {
    const guides = mode.getGuides(createFeatureCollectionProps());
    expect(guides).toMatchSnapshot();
  });

  it('tooltips are 0.00', () => {
    const tooltips = mode.getTooltips(createFeatureCollectionProps());
    expect(tooltips[0].text).toContain('0.00');
  });
});

describe('one click - centerTooltipsOnLine = true', () => {
  let mode: MeasureDistanceMode;
  const props = {modeConfig: {centerTooltipsOnLine: true}};
  beforeEach(() => {
    mode = new MeasureDistanceMode();
    mode.handleClick(createClickEvent([1, 2]), createFeatureCollectionProps(props));
  });

  it('tooltip is placed at [1,2]', () => {
    const tooltips = mode.getTooltips(createFeatureCollectionProps(props));
    expect(tooltips[0].position).toEqual([1, 2]);
  });
});

describe('one click + pointer move', () => {
  let mode: MeasureDistanceMode;
  beforeEach(() => {
    mode = new MeasureDistanceMode();
    mode.handleClick(createClickEvent([1, 2]), createFeatureCollectionProps());
    mode.handlePointerMove(createPointerMoveEvent([3, 4]), createFeatureCollectionProps());
  });

  it('guides are two points + line string', () => {
    const guides = mode.getGuides(createFeatureCollectionProps());
    expect(guides).toMatchSnapshot();
  });

  it('tooltip contains distance', () => {
    const tooltips = mode.getTooltips(createFeatureCollectionProps());
    expect(tooltips).toMatchSnapshot();
  });
});

describe('one click + pointer move - centerTooltipsOnLine = true', () => {
  let mode: MeasureDistanceMode;
  const props = {modeConfig: {centerTooltipsOnLine: true}};
  beforeEach(() => {
    mode = new MeasureDistanceMode();
    mode.handleClick(createClickEvent([1, 2]), createFeatureCollectionProps(props));
    mode.handlePointerMove(createPointerMoveEvent([1, 4]), createFeatureCollectionProps(props));
  });

  it('tooltips are on center of their respective line', () => {
    const tooltips = mode.getTooltips(createFeatureCollectionProps(props));
    expect(tooltips[0].position).toEqual([1, 3]);
  });
});

describe('two clicks', () => {
  let mode: MeasureDistanceMode;
  beforeEach(() => {
    mode = new MeasureDistanceMode();
    mode.handleClick(createClickEvent([1, 2]), createFeatureCollectionProps());
    mode.handleClick(createClickEvent([3, 4]), createFeatureCollectionProps());
  });

  it('guides are two points + line string', () => {
    const guides = mode.getGuides(createFeatureCollectionProps());
    expect(guides).toMatchSnapshot();
  });

  it('tooltip contains distance', () => {
    const tooltips = mode.getTooltips(createFeatureCollectionProps());
    expect(tooltips).toMatchSnapshot();
  });

  it('can measure kilometers', () => {
    const tooltips = mode.getTooltips(createFeatureCollectionProps());
    expect(tooltips[0].text).toContain('kilometers');
  });

  it('can measure miles', () => {
    const tooltips = mode.getTooltips(
      createFeatureCollectionProps({modeConfig: {turfOptions: {units: 'miles'}}})
    );
    expect(tooltips[tooltips.length - 1].text).toContain('miles');
  });

  it('can format distance', () => {
    const tooltips = mode.getTooltips(
      createFeatureCollectionProps({modeConfig: {formatTooltip: String}})
    );
    expect(tooltips[tooltips.length - 1].text).toEqual('314.28368918020476');
  });
});

describe('two clicks - centerTooltipsOnLine = true', () => {
  let mode: MeasureDistanceMode;
  const props = {modeConfig: {centerTooltipsOnLine: true}};

  beforeEach(() => {
    mode = new MeasureDistanceMode();
    mode.handleClick(createClickEvent([1, 2]), createFeatureCollectionProps(props));
    mode.handleClick(createClickEvent([1, 4]), createFeatureCollectionProps(props));
  });

  it('tooltips are on center of their respective line', () => {
    const tooltips = mode.getTooltips(createFeatureCollectionProps(props));
    expect(tooltips[0].position).toEqual([1, 3]);
    expect(tooltips[1].position).toEqual([1, 4]);
  });
});

describe('two clicks + pointer move', () => {
  let mode: MeasureDistanceMode;
  beforeEach(() => {
    mode = new MeasureDistanceMode();
    mode.handleClick(createClickEvent([1, 2]), createFeatureCollectionProps());
    mode.handleClick(createClickEvent([3, 4]), createFeatureCollectionProps());
    mode.handlePointerMove(createPointerMoveEvent([4, 5]), createFeatureCollectionProps());
  });

  it('ending point is clicked point not hovered point', () => {
    const guides = mode.getGuides(createFeatureCollectionProps());
    expect(guides.features[2].geometry.coordinates).toEqual([3, 4]);
  });

  it('tooltip contains distance', () => {
    const tooltips = mode.getTooltips(createFeatureCollectionProps());
    expect(tooltips).toMatchSnapshot();
  });
});

describe('two clicks + pointer move - centerTooltipsOnLine = true', () => {
  let mode: MeasureDistanceMode;
  const props = {modeConfig: {centerTooltipsOnLine: true}};

  beforeEach(() => {
    mode = new MeasureDistanceMode();
    mode.handleClick(createClickEvent([1, 2]), createFeatureCollectionProps(props));
    mode.handleClick(createClickEvent([1, 4]), createFeatureCollectionProps(props));
    mode.handlePointerMove(createPointerMoveEvent([5, 4]), createFeatureCollectionProps(props));
  });

  it('tooltips are on center of their respective line', () => {
    const tooltips = mode.getTooltips(createFeatureCollectionProps(props));
    expect(tooltips[0].position).toEqual([1, 3]);
    expectToBeCloseToArray(tooltips[1].position, [3, 4]);
  });
});

describe('three clicks + pointer move', () => {
  let mode: MeasureDistanceMode;
  beforeEach(() => {
    mode = new MeasureDistanceMode();
    mode.handleClick(createClickEvent([1, 2]), createFeatureCollectionProps());
    mode.handleClick(createClickEvent([3, 4]), createFeatureCollectionProps());
    mode.handleClick(createClickEvent([4, 5]), createFeatureCollectionProps());
    mode.handlePointerMove(createPointerMoveEvent([6, 7]), createFeatureCollectionProps());
  });

  it('first feature is a tentative line that contains 4 points', () => {
    const guides = mode.getGuides(createFeatureCollectionProps());
    expect(guides.features[0].properties.guideType).toEqual('tentative');
    expect(guides.features[0].geometry.type).toEqual('LineString');
    expect(guides.features[0].geometry.coordinates.length).toEqual(4);
    expect(guides.features[0].geometry.coordinates[3]).toEqual([6, 7]);
  });

  it('Second feature is a editHandle point with coordinates [1,2]', () => {
    const guides = mode.getGuides(createFeatureCollectionProps());
    expect(guides.features[1].properties.guideType).toEqual('editHandle');
    expect(guides.features[1].geometry.type).toEqual('Point');
    expect(guides.features[1].geometry.coordinates).toEqual([1, 2]);
  });

  it('tooltip contains distance', () => {
    const tooltips = mode.getTooltips(createFeatureCollectionProps());
    expect(tooltips).toMatchSnapshot();
  });
});

describe('three clicks + pointer move - centerTooltipsOnLine = true', () => {
  let mode: MeasureDistanceMode;
  const props = {modeConfig: {centerTooltipsOnLine: true}};

  beforeEach(() => {
    mode = new MeasureDistanceMode();
    mode.handleClick(createClickEvent([1, 2]), createFeatureCollectionProps(props));
    mode.handleClick(createClickEvent([1, 4]), createFeatureCollectionProps(props));
    mode.handleClick(createClickEvent([5, 4]), createFeatureCollectionProps(props));
    mode.handlePointerMove(createPointerMoveEvent([11, 8]), createFeatureCollectionProps(props));
  });

  it('tooltips are on center of their respective line', () => {
    const tooltips = mode.getTooltips(createFeatureCollectionProps(props));
    expect(tooltips[0].position).toEqual([1, 3]);
    expectToBeCloseToArray(tooltips[1].position, [3, 4]);
    expectToBeCloseToArray(tooltips[2].position, [8, 6]);
  });
});

describe('three clicks + pointer move + press Escape', () => {
  let mode: MeasureDistanceMode;
  beforeEach(() => {
    mode = new MeasureDistanceMode();
    mode.handleClick(createClickEvent([1, 2]), createFeatureCollectionProps());
    mode.handleClick(createClickEvent([3, 4]), createFeatureCollectionProps());
    mode.handleClick(createClickEvent([4, 5]), createFeatureCollectionProps());
    mode.handlePointerMove(createPointerMoveEvent([6, 7]), createFeatureCollectionProps());
    mode.handleKeyUp(createKeyboardEvent('Escape'), createFeatureCollectionProps());
  });

  it('first feature is a tentative line that contains 3 points', () => {
    const guides = mode.getGuides(createFeatureCollectionProps());
    expect(guides.features[0].properties.guideType).toEqual('tentative');
    expect(guides.features[0].geometry.type).toEqual('LineString');
    expect(guides.features[0].geometry.coordinates.length).toEqual(3);
    expect(guides.features[0].geometry.coordinates[2]).toEqual([4, 5]);
  });

  it('tooltip contains distance', () => {
    const tooltips = mode.getTooltips(createFeatureCollectionProps());
    expect(tooltips).toMatchSnapshot();
  });
});

describe('three clicks + pointer move + press Enter', () => {
  let mode: MeasureDistanceMode;
  beforeEach(() => {
    mode = new MeasureDistanceMode();
    mode.handleClick(createClickEvent([1, 2]), createFeatureCollectionProps());
    mode.handleClick(createClickEvent([3, 4]), createFeatureCollectionProps());
    mode.handleClick(createClickEvent([4, 5]), createFeatureCollectionProps());
    mode.handlePointerMove(createPointerMoveEvent([6, 7]), createFeatureCollectionProps());
    mode.handleKeyUp(createKeyboardEvent('Enter'), createFeatureCollectionProps());
  });

  it('first feature is a tentative line that contains 3 points', () => {
    const guides = mode.getGuides(createFeatureCollectionProps());
    expect(guides.features[0].properties.guideType).toEqual('tentative');
    expect(guides.features[0].geometry.type).toEqual('LineString');
    expect(guides.features[0].geometry.coordinates.length).toEqual(4);
    expect(guides.features[0].geometry.coordinates[3]).toEqual([6, 7]);
  });

  it('tooltip contains distance', () => {
    const tooltips = mode.getTooltips(createFeatureCollectionProps());
    expect(tooltips).toMatchSnapshot();
  });
});

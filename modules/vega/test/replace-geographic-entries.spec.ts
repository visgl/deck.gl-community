import {expect, it} from 'vitest';
import {
  replaceGeographicEntries,
  normalizeGeographicEntries
} from '../src/replace-geographic-entries';
import type {Polygon, Path, Stage} from '../src/interfaces';
const polygon: Polygon = {
  isGeographic: true,
  datum: {},
  positions: [
    [0, 0],
    [1, 0],
    [1, 1]
  ],
  fillColor: [1, 2, 3, 255],
  strokeColor: [0, 0, 0, 255],
  strokeWidth: 1,
  depth: 0
};
const grid: Path = {
  isGeographic: true,
  datum: {},
  positions: [
    [0, 0],
    [1, 1]
  ],
  strokeColor: [0, 0, 0, 255],
  strokeWidth: 1
};
const route: Path = {...grid, datum: {route: true}};
const previous: Stage = {
  polygonData: [polygon],
  pathData: [grid, route],
  geographicData: [
    {type: 'path', data: grid},
    {type: 'polygon', data: polygon},
    {type: 'path', data: route}
  ]
};
it('retains interleaved paint order when color and geometry entries are replaced', () => {
  const updatedPolygon = {
    ...polygon,
    fillColor: [20, 30, 40, 255] as [number, number, number, number]
  };
  const updatedRoute = {
    ...route,
    positions: [
      [0, 1],
      [1, 0]
    ]
  };
  expect(
    replaceGeographicEntries(
      {polygonData: [updatedPolygon], pathData: [grid, updatedRoute]},
      previous
    )
  ).toEqual([
    {type: 'path', data: grid},
    {type: 'polygon', data: updatedPolygon},
    {type: 'path', data: updatedRoute}
  ]);
  expect(replaceGeographicEntries({}, previous)).toBe(previous.geographicData);
});
it('requires explicit order when projected shapes are added or removed', () => {
  expect(() => replaceGeographicEntries({polygonData: []}, previous)).toThrow(
    'explicit geographicData'
  );
  const order = [{type: 'path' as const, data: route}];
  expect(
    replaceGeographicEntries({polygonData: [], pathData: [route], geographicData: order}, previous)
  ).toBe(order);
  expect(replaceGeographicEntries({polygonData: [polygon]}, {polygonData: []})).toBeUndefined();
});

it('synchronizes explicit batches so later replacements update the currently drawn objects', () => {
  const replacement = {
    ...polygon,
    positions: [
      [2, 2],
      [3, 2],
      [3, 3]
    ]
  };
  const stage: Stage = {
    ...previous,
    geographicData: [
      {type: 'path', data: grid},
      {type: 'polygon', data: replacement},
      {type: 'path', data: route}
    ]
  };
  normalizeGeographicEntries(stage);
  expect(stage.polygonData).toEqual([replacement]);
  const recolored = {
    ...replacement,
    fillColor: [40, 50, 60, 255] as [number, number, number, number]
  };
  expect(replaceGeographicEntries({polygonData: [recolored]}, stage)[1].data).toBe(recolored);
});
it('tags explicit entries that omit geographic flags and retains legacy geometry', () => {
  const plain = {...polygon, isGeographic: undefined};
  const legacy = {...polygon, isGeographic: false};
  const stage: Stage = {polygonData: [legacy], geographicData: [{type: 'polygon', data: plain}]};
  normalizeGeographicEntries(stage);
  expect(stage.polygonData).toHaveLength(2);
  expect(stage.polygonData[1].isGeographic).toBe(true);
  expect(stage.geographicData[0].data).toBe(stage.polygonData[1]);
});

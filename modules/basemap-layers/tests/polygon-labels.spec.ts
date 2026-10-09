import {expect, test} from 'vitest';
import {MVTLabelLayer} from '../src/mvt-label-layer';
import {getPoleOfInaccessibility} from '../src/polylabel';

// A U shape in tile-local units: a thin base and two long arms, 0.2 wide. Its centroid,
// (0.5, 0.46), falls in the notch, outside the polygon.
const U_SHAPE = [
  [
    [0.1, 0.1],
    [0.9, 0.1],
    [0.9, 0.9],
    [0.7, 0.9],
    [0.7, 0.2],
    [0.3, 0.2],
    [0.3, 0.9],
    [0.1, 0.9],
    [0.1, 0.1]
  ]
];

function square(x: number, y: number, size: number): number[][] {
  return [
    [x, y],
    [x + size, y],
    [x + size, y + size],
    [x, y + size],
    [x, y]
  ];
}

/** Even-odd point-in-polygon over all rings. */
function isInside([x, y]: number[], polygon: number[][][]): boolean {
  let inside = false;
  for (const ring of polygon) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[i];
      const [bx, by] = ring[j];
      if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) {
        inside = !inside;
      }
    }
  }
  return inside;
}

function createLayer(layout: Record<string, unknown> = {}) {
  return new MVTLabelLayer({
    id: 'polygon-labels',
    config: {labels: true},
    zoom: 14,
    styleLayer: {layout: {'text-field': '{name}', ...layout}}
  });
}

test('labels a concave polygon inside it, not at its centroid', () => {
  const anchors = createLayer().getLabelAnchors(
    {geometry: {type: 'Polygon', coordinates: U_SHAPE}},
    false
  );
  expect(isInside([0.5, 0.46], U_SHAPE)).toBe(false);
  expect(anchors).toHaveLength(1);
  expect(isInside(anchors[0], U_SHAPE)).toBe(true);
  // The farthest points from the outline lie on an arm's center line, 0.1 from its sides.
  expect(Math.min(Math.abs(anchors[0][0] - 0.2), Math.abs(anchors[0][0] - 0.8))).toBeLessThan(0.01);
});

test('labels each polygon of a MultiPolygon', () => {
  const left = [square(0.1, 0.1, 0.2)];
  const right = [square(0.6, 0.6, 0.3)];
  const anchors = createLayer().getLabelAnchors(
    {geometry: {type: 'MultiPolygon', coordinates: [left, right]}},
    false
  );
  expect(anchors).toHaveLength(2);
  expect(anchors[0][0]).toBeCloseTo(0.2, 2);
  expect(anchors[0][1]).toBeCloseTo(0.2, 2);
  expect(anchors[1][0]).toBeCloseTo(0.75, 2);
  expect(anchors[1][1]).toBeCloseTo(0.75, 2);
});

test('keeps a polygon label out of the polygon holes', () => {
  const withHole = [square(0, 0, 1), square(0.3, 0.3, 0.4).reverse()];
  const [anchor] = createLayer().getLabelAnchors(
    {geometry: {type: 'Polygon', coordinates: withHole}},
    false
  );
  expect(isInside(anchor, withHole)).toBe(true);
});

test('finds the pole to within the tile precision', () => {
  // A 1 x 0.5 rectangle: the pole is its center, 0.25 from the long sides.
  const pole = getPoleOfInaccessibility(
    [
      [
        [0, 0],
        [1, 0],
        [1, 0.5],
        [0, 0.5],
        [0, 0]
      ]
    ],
    16 / 8192
  );
  expect(pole?.[1]).toBeCloseTo(0.25, 3);
});

test('labels longitude/latitude polygons on globe tiles', () => {
  const polygon = U_SHAPE.map(ring => ring.map(([x, y]) => [x - 0.5 + 13.4, y + 52.3]));
  const [anchor] = createLayer().getLabelAnchors(
    {geometry: {type: 'Polygon', coordinates: polygon}},
    true
  );
  expect(isInside(anchor, polygon)).toBe(true);
  expect(Math.min(Math.abs(anchor[0] - 13.1), Math.abs(anchor[0] - 13.7))).toBeLessThan(0.01);
});

test('searches globe polygons in ground distance, not raw degrees', () => {
  // An L shape at 60 degrees north. In degrees the vertical arm (0.4 wide) is wider than the
  // horizontal arm (0.3 tall), but a degree of longitude there spans half a degree of latitude,
  // so on the ground the horizontal arm is wider and holds the pole.
  const polygon = [
    [
      [0, 60],
      [3, 60],
      [3, 60.3],
      [0.4, 60.3],
      [0.4, 62],
      [0, 62],
      [0, 60]
    ]
  ];
  const [anchor] = createLayer().getLabelAnchors(
    {geometry: {type: 'Polygon', coordinates: polygon}},
    true
  );
  // Searched in raw degrees, the pole would be up the vertical arm, above 60.3.
  expect(anchor[1]).toBeLessThan(60.3);
});

test('does not place polygon labels along outlines', () => {
  for (const placement of ['line', 'line-center']) {
    const anchors = createLayer({'symbol-placement': placement}).getLabelAnchors(
      {geometry: {type: 'Polygon', coordinates: U_SHAPE}},
      false
    );
    expect(anchors).toEqual([]);
  }
});

test('keeps point and line anchors unchanged', () => {
  const layer = createLayer();
  expect(
    layer.getLabelAnchors({geometry: {type: 'Point', coordinates: [0.4, 0.6]}}, false)
  ).toEqual([[0.4, 0.6]]);
  expect(
    layer.getLabelAnchors(
      {
        geometry: {
          type: 'LineString',
          coordinates: [
            [0, 0],
            [0.5, 0.5],
            [1, 1]
          ]
        }
      },
      false
    )
  ).toEqual([[0.5, 0.5]]);
});

import {describe, expect, test} from 'vitest';
import {clipLine, getLineAnchors, getUprightAngle, MIN_LABEL_GAP} from '../src/line-placement';
import {MVTLabelLayer} from '../src/mvt-label-layer';

const STRAIGHT = [
  [0, 0],
  [1000, 0]
];

const OPTIONS = {
  placement: 'line' as const,
  spacing: 250,
  maxAngle: 45,
  labelLength: 50,
  textSize: 10,
  isContinued: false
};

/** Distances along a line, in pixels, of anchors on a line along the x axis from x = 0. */
function distances(anchors: {segment: number; t: number}[], line: number[][]): number[] {
  return anchors.map(({segment, t}) => {
    const [a, b] = [line[segment], line[segment + 1]];
    return Math.round(a[0] + (b[0] - a[0]) * t);
  });
}

describe('getLineAnchors', () => {
  test('repeats labels every symbol-spacing pixels, starting past the label', () => {
    // The first label is half its length plus two ems in: 25 + 2 * 10.
    expect(distances(getLineAnchors(STRAIGHT, OPTIONS), STRAIGHT)).toEqual([45, 295, 545, 795]);
  });

  test('starts half a spacing in on a line that continues from a neighbouring tile', () => {
    expect(distances(getLineAnchors(STRAIGHT, {...OPTIONS, isContinued: true}), STRAIGHT)).toEqual([
      125, 375, 625, 875
    ]);
  });

  test('widens a spacing that is not much longer than the label', () => {
    // 250 - 240 < 250 / 4, so the spacing becomes 240 + 62.5.
    const anchors = getLineAnchors(STRAIGHT, {...OPTIONS, labelLength: 240});
    expect(distances(anchors, STRAIGHT)).toEqual([140, 443, 745]);
  });

  test('falls back to the middle of a short line, unless it continues', () => {
    const line = [
      [0, 0],
      [100, 0]
    ];
    const options = {...OPTIONS, labelLength: 80, textSize: 20};
    expect(getLineAnchors(line, options)).toEqual([{segment: 0, t: 0.5, angle: 0}]);
    expect(getLineAnchors(line, {...options, isContinued: true})).toEqual([]);
    // A label longer than the line is not placed.
    expect(getLineAnchors(line, {...options, labelLength: 120})).toEqual([]);
  });

  test('gives the line direction counter-clockwise on screen, with y pointing down', () => {
    const upRight = [
      [0, 0],
      [100, -100]
    ];
    const down = [
      [0, 0],
      [0, 100]
    ];
    const short = {...OPTIONS, placement: 'line-center' as const, labelLength: 10};
    expect(getLineAnchors(upRight, short)[0].angle).toBeCloseTo(45, 6);
    expect(getLineAnchors(down, short)[0].angle).toBeCloseTo(-90, 6);
  });

  test('places line-center labels at the middle of the line by length', () => {
    // 10 px east, then 190 px north: the middle is 90 px up the second segment.
    const line = [
      [0, 0],
      [10, 0],
      [10, -190]
    ];
    const [anchor] = getLineAnchors(line, {...OPTIONS, placement: 'line-center', labelLength: 10});
    expect(anchor.segment).toBe(1);
    expect(anchor.t).toBeCloseTo(90 / 190, 6);
    expect(anchor.angle).toBeCloseTo(90, 6);
  });

  test('skips a placement where the line bends more than text-max-angle under the label', () => {
    const bend = (degrees: number) => {
      const radians = (degrees * Math.PI) / 180;
      return [
        [0, 0],
        [100, 0],
        [100 + 100 * Math.cos(radians), -100 * Math.sin(radians)]
      ];
    };
    const options = {...OPTIONS, placement: 'line-center' as const};
    expect(getLineAnchors(bend(60), options)).toEqual([]);
    expect(getLineAnchors(bend(60), {...options, maxAngle: 70})).toHaveLength(1);
    expect(getLineAnchors(bend(30), options)).toHaveLength(1);
    // Along the line too: the 60 degree corner at 100 px rules out the label there.
    expect(getLineAnchors(bend(60), {...OPTIONS, spacing: 1000, isContinued: true})).toEqual([]);
  });

  test('ignores degenerate and non-finite lines', () => {
    expect(getLineAnchors([[0, 0]], OPTIONS)).toEqual([]);
    expect(
      getLineAnchors(
        [
          [0, 0],
          [Number.NaN, 0]
        ],
        OPTIONS
      )
    ).toEqual([]);
  });
});

describe('getUprightAngle', () => {
  test('turns a label that would read upside down', () => {
    expect(getUprightAngle(170, 0, true)).toBe(350);
    expect(getUprightAngle(-100, 0, true)).toBe(80);
    expect(getUprightAngle(10, 0, true)).toBe(10);
    expect(getUprightAngle(90, 0, true)).toBe(90);
    expect(getUprightAngle(-90, 0, true)).toBe(90);
  });

  test('accounts for the map bearing', () => {
    // On a map rotated by 120 degrees, a label at 10 degrees is at 130 on screen.
    expect(getUprightAngle(10, 120, true)).toBe(190);
    expect(getUprightAngle(170, 120, true)).toBe(170);
  });

  test('leaves the angle alone without text-keep-upright', () => {
    expect(getUprightAngle(170, 0, false)).toBe(170);
  });
});

function lineLayer(props: Record<string, unknown> = {}, layout: Record<string, unknown> = {}) {
  return new MVTLabelLayer({
    id: 'line-labels',
    config: {labels: true},
    zoom: 14,
    tileZoom: 14,
    tileSize: 512,
    styleLayer: {
      layout: {'text-field': '{name}', 'symbol-placement': 'line', 'text-size': 10, ...layout}
    },
    ...props
  });
}

// Crosses the tile from edge to edge, so it continues in the neighbouring tiles.
const ACROSS_TILE = {
  geometry: {
    type: 'LineString',
    coordinates: [
      [-0.1, 0.5],
      [1.1, 0.5]
    ]
  },
  properties: {name: 'Main'}
};

describe('MVTLabelLayer line placement', () => {
  test('places rows along the line in pixels at the tile zoom, with the line direction', () => {
    const rows = lineLayer().getLabelData([ACROSS_TILE], false) as any[];
    // Clipped to the tile, as in MapLibre, the line starts at its edge and continues beyond it:
    // labels at 125 and 375 px.
    expect(rows.map(row => row.position[0])).toEqual([
      expect.closeTo(125 / 512, 9),
      expect.closeTo(375 / 512, 9)
    ]);
    expect(rows.every(row => row.position[1] === 0.5 && row.angle === 0)).toBe(true);
  });

  test('keeps the anchors while the map zooms within a tile', () => {
    const at = (zoom: number) =>
      (lineLayer({zoom, tileZoom: 15}).getLabelData([ACROSS_TILE], false) as any[]).map(
        row => row.position
      );
    expect(at(14.75)).toEqual(at(15.25));
  });

  test('spaces an overzoomed tile at the map zoom and drops anchors outside the tile', () => {
    // At zoom 16 the zoom-14 tile is 2048 px wide: anchors every 250 px from 125.
    const rows = lineLayer({zoom: 16}).getLabelData([ACROSS_TILE], false) as any[];
    expect(rows).toHaveLength(8);
    expect(rows.every(row => row.position[0] >= 0 && row.position[0] < 1)).toBe(true);
  });

  test('evaluates symbol-spacing', () => {
    // Every 100 px from 50 px along the clipped line, up to 450 px.
    const rows = lineLayer({}, {'symbol-spacing': 100}).getLabelData([ACROSS_TILE], false);
    expect(rows).toHaveLength(5);
  });

  test('places line-center labels once, at the middle', () => {
    const rows = lineLayer({}, {'symbol-placement': 'line-center'}).getLabelData(
      [ACROSS_TILE],
      false
    ) as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].position[0]).toBeCloseTo(0.5, 9);
  });

  test('measures longitude/latitude lines in Web Mercator pixels', () => {
    const feature = (coordinates: number[][]) => ({
      geometry: {type: 'LineString', coordinates},
      properties: {name: 'Main'}
    });
    const layer = lineLayer({tileZoom: 8, zoom: 8});
    // 2 degrees of longitude at zoom 8 is 728.2 px: labels at 32, 282 and 532 px.
    const east = layer.getLabelData(
      [
        feature([
          [-1, 0],
          [1, 0]
        ])
      ],
      true
    ) as any[];
    const pixels = (2 / 360) * 512 * 2 ** 8;
    expect(east.map(row => row.position[0])).toEqual(
      [32, 282, 532].map(distance => expect.closeTo(-1 + (2 * distance) / pixels, 6))
    );
    const [north] = layer.getLabelData(
      [
        feature([
          [0, 0],
          [0, 1]
        ])
      ],
      true
    ) as any[];
    expect(north.angle).toBeCloseTo(90, 6);
  });

  test('keeps point placement on lines at the middle vertex', () => {
    const rows = lineLayer({}, {'symbol-placement': 'point'}).getLabelData(
      [ACROSS_TILE],
      false
    ) as any[];
    expect(rows.map(row => [row.position, row.angle])).toEqual([[[1.1, 0.5], undefined]]);
  });

  test('changes the anchor key with the inputs of the placement', () => {
    const key = lineLayer().getAnchorKey(false);
    expect(lineLayer({tileZoom: 13}).getAnchorKey(false)).not.toBe(key);
    expect(lineLayer({}, {'symbol-spacing': 100}).getAnchorKey(false)).not.toBe(key);
    expect(lineLayer({}, {'text-max-angle': 10}).getAnchorKey(false)).not.toBe(key);
    expect(lineLayer({}, {'text-size': 12}).getAnchorKey(false)).not.toBe(key);
    expect(lineLayer({zoom: 14.5}).getAnchorKey(false)).toBe(key);
  });
});

describe('MVTLabelLayer line label rendering', () => {
  function renderText(layer: MVTLabelLayer, bearing = 0): any {
    layer.state = {labelData: [{position: [0.5, 0.5], angle: 170} as any]};
    layer.context = {viewport: {bearing}} as any;
    layer.internalState = {subLayers: []} as any;
    return layer.renderLayers().at(-1);
  }

  test('draws line labels in the map plane, turned upright', () => {
    const text = renderText(lineLayer());
    expect(text.props.billboard).toBe(false);
    expect(text.props.getAngle({angle: 170})).toBe(350);
    expect(renderText(lineLayer(), 120).props.getAngle({angle: 170})).toBe(170);
  });

  test('honours text-keep-upright: false', () => {
    const text = renderText(lineLayer({}, {'text-keep-upright': false}));
    expect(text.props.getAngle({angle: 170})).toBe(170);
  });

  test('leaves point labels as unrotated billboards', () => {
    const text = renderText(lineLayer({}, {'symbol-placement': 'point'}));
    expect(text.props.billboard).toBe(true);
    expect(typeof text.props.getAngle).not.toBe('function');
  });

  test('updates when the bearing crosses a step, for line labels only', () => {
    const update = (layer: MVTLabelLayer, bearing: number) => {
      layer.state = {bearingStep: 0} as any;
      return layer.shouldUpdateState({
        changeFlags: {propsOrDataChanged: false, viewportChanged: true},
        context: {viewport: {bearing}}
      } as any);
    };
    expect(update(lineLayer(), 7)).toBe(true);
    expect(update(lineLayer(), 2)).toBe(false);
    expect(update(lineLayer({}, {'symbol-placement': 'point'}), 90)).toBe(false);
  });
});

describe('line placement on hostile input', () => {
  test('keeps a gap between labels when symbol-spacing is 1 and the label is tiny', () => {
    const bent = [
      [0, 0],
      [500, 0],
      [1000, 0]
    ];
    expect(getLineAnchors(bent, {...OPTIONS, spacing: 1, labelLength: 0})).toEqual([]);
    const anchors = getLineAnchors(STRAIGHT, {...OPTIONS, spacing: 1, labelLength: 0.01});
    const placed = distances(anchors, STRAIGHT);
    expect(placed.length).toBeLessThanOrEqual(1000 / MIN_LABEL_GAP + 1);
    expect(placed.slice(1).every((distance, i) => distance - placed[i] >= MIN_LABEL_GAP)).toBe(
      true
    );
  });

  test('gives labels with empty text no rows', () => {
    const rows = lineLayer({}, {'symbol-spacing': 1}).getLabelData(
      [{...ACROSS_TILE, properties: {name: ''}}],
      false
    );
    expect(rows).toEqual([]);
  });

  test('stops placing once the budget is spent', () => {
    const line = [
      [0, 0],
      [1e7, 0]
    ];
    const budget = {steps: 1000};
    const anchors = getLineAnchors(line, {...OPTIONS, spacing: 1, labelLength: 0.01, budget});
    expect(anchors.length).toBeGreaterThan(0);
    expect(anchors.length).toBeLessThanOrEqual(1000);
    // It stops at once, rather than walking the rest of the line.
    expect(budget.steps).toBeLessThanOrEqual(0);
    expect(budget.steps).toBeGreaterThan(-10);
  });

  test('clips a huge line to the tile before placing labels along it', () => {
    const huge = {
      ...ACROSS_TILE,
      geometry: {
        type: 'LineString',
        coordinates: [
          [-1e9, 0.5],
          [1e9, 0.5]
        ]
      }
    };
    const rows = lineLayer().getLabelData([huge], false) as any[];
    expect(rows.map(row => row.position[0])).toEqual([
      expect.closeTo(125 / 512, 9),
      expect.closeTo(375 / 512, 9)
    ]);
  });

  test('shares one budget across the features of a tile', () => {
    const layer = lineLayer({tileZoom: 8, zoom: 8}, {'symbol-spacing': 1});
    // Longitude/latitude without a tile box is not clipped: 360 degrees is 131072 px at zoom 8.
    const world = {
      geometry: {
        type: 'LineString',
        coordinates: [
          [-180, 0],
          [180, 0]
        ]
      },
      properties: {name: 'Main'}
    };
    const budget = {steps: 500};
    const rows = layer.getLineLabelPlacements(world, true, 'line', budget);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(500);
    expect(budget.steps).toBeLessThanOrEqual(0);
    expect(layer.getLineLabelPlacements(world, true, 'line', budget)).toEqual([]);
  });

  test('places nothing for non-finite spacing, size, angle or coordinates', () => {
    const center = {...OPTIONS, placement: 'line-center' as const};
    expect(getLineAnchors(STRAIGHT, {...center, maxAngle: Number.NaN})).toEqual([]);
    expect(getLineAnchors(STRAIGHT, {...center, textSize: Number.NaN})).toEqual([]);
    expect(getLineAnchors(STRAIGHT, {...center, labelLength: Number.NaN})).toEqual([]);
    expect(getLineAnchors(STRAIGHT, {...OPTIONS, spacing: Number.POSITIVE_INFINITY})).toEqual([]);
    expect(
      getLineAnchors(
        [
          [0, 0],
          [Number.POSITIVE_INFINITY, 0]
        ],
        OPTIONS
      )
    ).toEqual([]);
  });

  test('clipLine keeps the parts of a line inside the box', () => {
    const parts = clipLine(
      [
        [-1, 0.5],
        [0.5, 0.5],
        [0.5, 2],
        [0.7, 2],
        [0.7, 0.2]
      ],
      [0, 0, 1, 1]
    );
    expect(parts).toEqual([
      [
        [0, 0.5],
        [0.5, 0.5],
        [0.5, 1]
      ],
      [
        [0.7, 1],
        [0.7, expect.closeTo(0.2, 9)]
      ]
    ]);
  });
});

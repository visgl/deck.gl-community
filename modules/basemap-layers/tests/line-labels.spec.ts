import {afterEach, describe, expect, test, vi} from 'vitest';
// MapLibre GL JS's own functions, from the source its package ships, to compare against.
import {mergeLines as mapLibreMergeLines} from '../node_modules/maplibre-gl/src/symbol/merge_lines.ts';
import {
  clipLine,
  getLineAnchors,
  getUprightAngle,
  mergeLines,
  MIN_LABEL_GAP
} from '../src/line-placement';
import {getTextLengthEms, MVTLabelLayer, rotatePixelOffset} from '../src/mvt-label-layer';
import {GlobeLineAngleExtension} from '../src/globe-line-angle-extension';
import {getSpriteIconMapping, type SpriteAtlas} from '../src/sprite';
import {getTextLayerFontWeight} from '../src/text-font';
import {getCharacterWidthMeasurer} from '../src/text-layout';

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

  test('spaces an overzoomed globe tile at the map zoom', () => {
    // A zoom-8 tile at map zoom 10: 2 degrees of longitude is 2912.7 px, labels every 250 px.
    const rows = lineLayer({tileZoom: 8, zoom: 10}).getLabelData(
      [
        {
          geometry: {
            type: 'LineString',
            coordinates: [
              [-1, 0],
              [1, 0]
            ]
          },
          properties: {name: 'Main'}
        }
      ],
      true
    ) as any[];
    const pixels = (2 / 360) * 512 * 2 ** 10;
    expect(rows).toHaveLength(12);
    rows.slice(1).forEach((row, i) => {
      expect(row.position[0] - rows[i].position[0]).toBeCloseTo((2 * 250) / pixels, 6);
    });
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
    // Upper-casing can lengthen the text ('ß' becomes 'SS').
    expect(lineLayer({}, {'text-transform': 'uppercase'}).getAnchorKey(false)).not.toBe(key);
    expect(lineLayer({zoom: 14.5}).getAnchorKey(false)).toBe(key);
    // Text is measured in the label font, whether it comes from `text-font` or an override.
    expect(lineLayer({}, {'text-font': ['Noto Sans Bold']}).getAnchorKey(false)).not.toBe(key);
    expect(lineLayer({fontFamily: () => 'Other'}).getAnchorKey(false)).not.toBe(
      lineLayer({fontFamily: () => 'Another'}).getAnchorKey(false)
    );
  });
  test('places labels hidden at the map zoom but sized at the tile zoom', () => {
    // A zoom-15 tile shown at zoom 14.75, where the text is 0 pixels tall; it shows from zoom 15
    // on, with the same anchors.
    const layer = lineLayer(
      {data: [ACROSS_TILE], zoom: 14.75, tileZoom: 15},
      {'text-size': ['step', ['zoom'], 0, 15, 10]}
    );
    layer.state = {};
    layer.updateState({changeFlags: {dataChanged: true}} as any);
    expect(layer.getLabel(ACROSS_TILE as any)).toBeUndefined();
    expect(layer.state.labelData?.length).toBeGreaterThan(0);
  });

  test('places labels with the new text when text-field changes', () => {
    const layer = lineLayer({data: [ACROSS_TILE]});
    const layout = layer.props.styleLayer!.layout as Record<string, unknown>;
    layer.state = {};
    layer.updateState({changeFlags: {dataChanged: true}} as any);
    // Labels of 'Main' fit twice; a label too long for the spacing widens it, as in MapLibre.
    expect(layer.state.labelData).toHaveLength(2);
    // The text layer reads the label, which caches it for the current text trigger.
    expect(layer.getLabel(ACROSS_TILE as any)).toBe('Main');
    layout['text-field'] = 'x'.repeat(60);
    layer.updateState({changeFlags: {}} as any);
    const expected = lineLayer({}, {...layout}).getLabelData([ACROSS_TILE], false);
    expect(expected).toHaveLength(1);
    const positions = (rows: any) => rows.map((row: any) => row.position);
    expect(positions(layer.state.labelData)).toEqual(positions(expected));
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

  test('offsets text across the line on the side MapLibre does, whichever way it reads', () => {
    // A bending line drawn westward: its labels are turned around to read upright.
    const line = [
      [0.9, 0.55],
      [0.7, 0.5],
      [0.5, 0.42],
      [0.3, 0.3],
      [0.15, 0.15]
    ];
    const feature = {geometry: {type: 'LineString', coordinates: line}, properties: {name: 'Quai'}};
    const layer = lineLayer({}, {'text-offset': [0.5, -1], 'symbol-spacing': 60});
    const rows = layer.getLabelData([feature], false) as any[];
    expect(rows.length).toBeGreaterThan(1);
    layer.state = {labelData: rows};
    layer.context = {viewport: {bearing: 0}} as any;
    layer.internalState = {subLayers: []} as any;
    const text = layer.renderLayers().at(-1) as any;
    const pixels = line.map(([x, y]) => [x * 512, y * 512]);
    for (const [index, row] of rows.entries()) {
      // MapLibre's `placeGlyphAlongLine`: `text-offset` y across the segment the anchor lies on,
      // along its normal (`transformToOffsetNormal`), and x along it, both in the line's own
      // direction, whether or not the text is turned to read upright.
      const [px, py] = [row.position[0] * 512, row.position[1] * 512];
      const k = pixels.findIndex(
        ([ax, ay], i) =>
          i < pixels.length - 1 &&
          Math.abs((pixels[i + 1][0] - ax) * (py - ay) - (pixels[i + 1][1] - ay) * (px - ax)) < 1e-6
      );
      const [dx, dy] = [pixels[k + 1][0] - pixels[k][0], pixels[k + 1][1] - pixels[k][1]];
      const length = Math.hypot(dx, dy);
      const [ux, uy] = [dx / length, dy / length];
      // 0.5 and -1 ems of the 10 px text.
      const expected = [5 * ux - -10 * uy, 5 * uy + -10 * ux];
      const [x, y] = text.props.getPixelOffset(row, {index});
      expect(x).toBeCloseTo(expected[0], 6);
      expect(y).toBeCloseTo(expected[1], 6);
      // A negative y offset is above an eastward line, so below this westward one.
      expect(y).toBeGreaterThan(0);
    }
  });

  test('refreshes the text offsets when the alignment that turns them changes', () => {
    // deck.gl keeps an attribute while its trigger is the same, so the trigger names every style
    // value that decides whether the offset is turned by the line.
    const text = (layout: Record<string, unknown>) =>
      renderText(lineLayer({}, {'text-offset': [0, 1], ...layout}));
    const turned = text({'text-rotation-alignment': 'map'});
    const upright = text({'text-rotation-alignment': 'viewport'});
    const row = {position: [0.5, 0.5], angle: 170};
    expect(turned.props.getPixelOffset(row, {index: 0})[0]).not.toBeCloseTo(0);
    expect(upright.props.getPixelOffset(row, {index: 0})).toEqual([0, 10]);
    expect(upright.props.updateTriggers.getPixelOffset).not.toEqual(
      turned.props.updateTriggers.getPixelOffset
    );
    // The default `auto` alignment turns text along lines, not point labels.
    expect(text({'symbol-placement': 'point'}).props.updateTriggers.getPixelOffset).not.toEqual(
      text({}).props.updateTriggers.getPixelOffset
    );
  });

  test('leaves point labels as unrotated billboards', () => {
    const text = renderText(lineLayer({}, {'symbol-placement': 'point'}));
    expect(text.props.billboard).toBe(true);
    expect(typeof text.props.getAngle).not.toBe('function');
  });

  test('turns line labels to their lines on a globe in the shader', () => {
    const onGlobe = (layer: MVTLabelLayer, bearing: number) => {
      layer.state = {labelData: [{position: [0.5, 0.5], angle: 170} as any]};
      layer.context = {viewport: {bearing, projectionMode: 2}} as any;
      layer.internalState = {subLayers: []} as any;
      return layer.renderLayers().at(-1);
    };
    const getLineAngle = (text: any) =>
      text.props.extensions.find((extension: any) => extension instanceof GlobeLineAngleExtension);
    const text = onGlobe(lineLayer(), 120);
    expect(text.props.billboard).toBe(true);
    // The angle is taken from north up, whatever the bearing: the shader turns it on screen, and
    // keeps it upright there, without turning its text-offset around.
    expect(text.props.getAngle({angle: 170})).toBe(350);
    expect(getLineAngle(text)?.opts).toEqual({keepUpright: true, keepOffsetSide: true});
    const free = onGlobe(lineLayer({}, {'text-keep-upright': false}), 120);
    expect(getLineAngle(free)?.opts).toEqual({keepUpright: false});
    expect(getLineAngle(renderText(lineLayer(), 120))).toBeUndefined();
    expect(
      getLineAngle(onGlobe(lineLayer({}, {'symbol-placement': 'point'}), 120))
    ).toBeUndefined();
    const flat = onGlobe(lineLayer({billboard: false}), 120);
    expect(getLineAngle(flat)).toBeUndefined();
  });

  /** Updates `layer` at `bearing`, then asks whether a pan to `panBearing` updates it again. */
  function updatesOnPan(layer: MVTLabelLayer, bearing: number, panBearing: number): boolean {
    layer.state = {};
    layer.context = {viewport: {bearing}} as any;
    layer.updateState({changeFlags: {dataChanged: true}} as any);
    return layer.shouldUpdateState({
      changeFlags: {propsOrDataChanged: false, viewportChanged: true},
      context: {viewport: {bearing: panBearing}}
    } as any);
  }

  test('updates when the bearing crosses a step, for line labels only', () => {
    const layer = (layout: Record<string, unknown> = {}, props: Record<string, unknown> = {}) =>
      lineLayer({data: [ACROSS_TILE], ...props}, layout);
    expect(updatesOnPan(layer(), 0, 7)).toBe(true);
    // The bearing is recorded by the update, before any text layer renders.
    expect(updatesOnPan(layer(), 0, 2)).toBe(false);
    expect(updatesOnPan(layer(), 0, 0)).toBe(false);
    expect(updatesOnPan(layer({'symbol-placement': 'point'}), 0, 90)).toBe(false);
    // Viewport-aligned text without icons does not turn, whatever `icon-rotation-alignment` is.
    const viewportText = {'text-rotation-alignment': 'viewport'};
    expect(updatesOnPan(layer(viewportText), 0, 90)).toBe(false);
    expect(updatesOnPan(layer({...viewportText, 'icon-rotation-alignment': 'map'}), 0, 90)).toBe(
      false
    );
    // Map-aligned icons turn once the sprites have loaded; a pan within a step does not update.
    const icons = {...viewportText, 'icon-image': 'arrow'};
    expect(updatesOnPan(layer(icons), 0, 90)).toBe(false);
    expect(updatesOnPan(layer(icons, {spriteAtlases: [ARROWS]}), 0, 90)).toBe(true);
    expect(updatesOnPan(layer(icons, {spriteAtlases: [ARROWS]}), 0, 1)).toBe(false);
    // An icon-only layer whose sprites have not loaded has nothing to turn.
    expect(updatesOnPan(layer({'text-field': undefined, 'icon-image': 'arrow'}), 0, 90)).toBe(
      false
    );
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

  test('checks the bends under a label in time linear in its vertices', () => {
    // 90,000 vertices within one bend window under the first label, then a vertex that moves
    // them all out of the window at once.
    const line = [[0, 0]];
    for (let i = 0; i < 9e4; i++) {
      line.push([46 + (5 * i) / 9e4, 0]);
    }
    line.push([60, 0], [1000, 0]);
    const start = performance.now();
    const anchors = getLineAnchors(line, {...OPTIONS, budget: {steps: 1e6}});
    expect(performance.now() - start).toBeLessThan(300);
    expect(anchors[0].segment).toBe(0);
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

  test('clipLine puts a clipped end exactly on the edge', () => {
    // Computed from the segment, this crossing lands at x = 1.1e-16, just inside the box.
    const line = [
      [-0.872, 0.569],
      [0.409, 0.634]
    ];
    const [[start]] = clipLine(line, [0, 0, 1, 1]);
    expect(start[0]).toBe(0);
    // So the line still counts as continuing from the neighbouring tile.
    const rows = (coordinates: number[][]) =>
      (
        lineLayer().getLabelData(
          [{geometry: {type: 'LineString', coordinates}, properties: {name: 'Main'}}],
          false
        ) as any[]
      ).map(row => row.position.map((value: number) => value.toFixed(9)));
    expect(rows(line)).toEqual(rows([[0, start[1]], line[1]]));
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

const ARROWS: SpriteAtlas = {
  id: 'default',
  image: 'https://example.com/sprite.png',
  mapping: getSpriteIconMapping({
    arrow: {x: 0, y: 0, width: 40, height: 20, pixelRatio: 1},
    shield: {x: 40, y: 0, width: 240, height: 20, pixelRatio: 1}
  })
};

describe('icons along lines', () => {
  const arrows = (layout: Record<string, unknown> = {}, props: Record<string, unknown> = {}) =>
    new MVTLabelLayer({
      id: 'arrows',
      config: {labels: true},
      zoom: 14,
      tileZoom: 14,
      tileSize: 512,
      spriteAtlases: [ARROWS],
      styleLayer: {layout: {'icon-image': 'arrow', 'symbol-placement': 'line', ...layout}},
      ...props
    });

  test('places a symbol with an icon and no text', () => {
    const rows = arrows().getLabelData([ACROSS_TILE], false) as any[];
    expect(rows.map(row => row.position[0])).toEqual([
      expect.closeTo(125 / 512, 9),
      expect.closeTo(375 / 512, 9)
    ]);
    // Until the sprites load, the icon has no size and nothing is placed.
    expect(arrows({}, {spriteAtlases: null}).getLabelData([ACROSS_TILE], false)).toEqual([]);
  });

  test('measures a symbol by the longer of its text and its icon', () => {
    const shield = {'icon-image': 'shield', 'text-field': '{name}', 'text-size': 10};
    const name = {...ACROSS_TILE, properties: {name: 'A'}};
    // A 240 px icon widens the 250 px spacing to 302.5 px: one label fits in the tile, at 151 px.
    expect(arrows(shield).getLabelData([name], false)).toHaveLength(1);
    expect(
      arrows({'text-field': '{name}', 'text-size': 10, 'icon-image': ''}).getLabelData(
        [name],
        false
      )
    ).toHaveLength(2);
  });

  test('changes the anchor key when the sprites load', () => {
    expect(arrows().getAnchorKey(false)).not.toBe(
      arrows({}, {spriteAtlases: null}).getAnchorKey(false)
    );
  });

  function renderIcons(layer: MVTLabelLayer, angle: number): any {
    const feature = {...ACROSS_TILE, properties: {}};
    layer.state = {labelData: [{position: [0.5, 0.5], angle, __source: {object: feature}} as any]};
    layer.context = {viewport: {bearing: 0}} as any;
    layer.internalState = {subLayers: []} as any;
    return layer.renderIconLayers()[0];
  }

  test('turns icons to the line, plus icon-rotate, without keeping them upright', () => {
    const icons = renderIcons(arrows(), 170);
    expect(icons.props.billboard).toBe(false);
    expect(icons.props.getAngle(icons.props.data[0])).toBe(170);
    const rotated = renderIcons(arrows({'icon-rotate': 90}), 30);
    // `icon-rotate` is clockwise.
    expect(rotated.props.getAngle(rotated.props.data[0])).toBe(-60);
    const upright = renderIcons(arrows({'icon-keep-upright': true}), 170);
    expect(upright.props.getAngle(upright.props.data[0])).toBe(350);
  });

  test('turns icons along lines on a globe in the shader, upright when they follow the line', () => {
    const onGlobe = (layer: MVTLabelLayer) => {
      const feature = {...ACROSS_TILE, properties: {}};
      layer.state = {
        labelData: [{position: [0.5, 0.5], angle: 170, __source: {object: feature}} as any]
      };
      layer.context = {viewport: {bearing: 120, projectionMode: 2}} as any;
      layer.internalState = {subLayers: []} as any;
      const icons = layer.renderIconLayers()[0];
      return icons.props.extensions.find(
        (extension: any) => extension instanceof GlobeLineAngleExtension
      )?.opts;
    };
    expect(onGlobe(arrows())).toEqual({keepUpright: false});
    expect(onGlobe(arrows({'icon-keep-upright': true}))).toEqual({keepUpright: true});
    // An angle turned by `icon-rotate` is not the line's direction: it stays upright from north up.
    expect(onGlobe(arrows({'icon-keep-upright': true, 'icon-rotate': 180}))).toEqual({
      keepUpright: false
    });
    expect(onGlobe(arrows({'icon-rotation-alignment': 'viewport'}))).toBeUndefined();
  });

  test('keeps viewport-aligned icons upright billboards', () => {
    const icons = renderIcons(arrows({'icon-rotation-alignment': 'viewport'}), 30);
    expect(icons.props.billboard).toBe(true);
    expect(typeof icons.props.getAngle).not.toBe('function');
  });

  test('turns viewport-aligned icons by icon-rotate only, on screen', () => {
    const icons = renderIcons(
      arrows({'icon-rotation-alignment': 'viewport', 'icon-rotate': 45}),
      30
    );
    expect(icons.props.billboard).toBe(true);
    expect(icons.props.getAngle(icons.props.data[0])).toBe(-45);
  });

  test('turns the icon offset with the icon', () => {
    // A 40 x 20 px arrow anchored at its left edge is centred 20 px right of the anchor.
    const icons = renderIcons(arrows({'icon-anchor': 'left'}), 90);
    const [x, y] = icons.props.getPixelOffset(icons.props.data[0], {index: 0});
    expect(x).toBeCloseTo(0, 9);
    // Turned 90 degrees counter-clockwise, the center is 20 px above the anchor (y points down).
    expect(y).toBeCloseTo(-20, 9);
  });
});

describe('icon-rotate at points', () => {
  const pin = (layout: Record<string, unknown> = {}, viewport: Record<string, unknown> = {}) => {
    const layer = new MVTLabelLayer({
      id: 'pins',
      config: {labels: true},
      zoom: 14,
      tileZoom: 14,
      tileSize: 512,
      spriteAtlases: [ARROWS],
      styleLayer: {layout: {'icon-image': 'arrow', ...layout}}
    });
    const feature = {type: 'Feature', geometry: {type: 'Point', coordinates: [0.5, 0.5]}};
    layer.state = {
      labelData: [{position: [0.5, 0.5], __source: {object: {...feature, properties: {turn: 30}}}}]
    } as any;
    layer.context = {viewport: {bearing: 0, ...viewport}} as any;
    layer.internalState = {subLayers: []} as any;
    return layer.renderIconLayers()[0];
  };

  test('leaves icons unturned without icon-rotate', () => {
    const icons = pin();
    expect(icons.props.billboard).toBe(true);
    expect(typeof icons.props.getAngle).not.toBe('function');
  });

  test('turns viewport-aligned (auto) icons clockwise on screen, per feature', () => {
    for (const alignment of [undefined, 'auto', 'viewport']) {
      const icons = pin({
        'icon-rotate': ['get', 'turn'],
        ...(alignment ? {'icon-rotation-alignment': alignment} : {})
      });
      expect(icons.props.billboard).toBe(true);
      expect(icons.props.getAngle(icons.props.data[0])).toBe(-30);
    }
  });

  test('draws map-aligned icons flat on the map, turned from north, not by the bearing', () => {
    const icons = pin({'icon-rotate': 90, 'icon-rotation-alignment': 'map'}, {bearing: 40});
    expect(icons.props.billboard).toBe(false);
    expect(icons.props.getAngle(icons.props.data[0])).toBe(-90);
    expect(pin({'icon-rotation-alignment': 'map'}).props.billboard).toBe(false);
    // On a globe they stay billboards.
    const globe = pin({'icon-rotate': 90, 'icon-rotation-alignment': 'map'}, {projectionMode: 2});
    expect(globe.props.billboard).toBe(true);
  });

  test('turns icon-anchor and icon-offset with the icon, about the anchor, as in MapLibre', () => {
    // The 40 x 20 px arrow's bottom edge sits on the point, 2 px further down by `icon-offset`:
    // its center is 8 px above the anchor. `icon-rotate: 90` turns that to 8 px right of it.
    const icons = pin({'icon-rotate': 90, 'icon-anchor': 'bottom', 'icon-offset': [0, 2]});
    const [x, y] = icons.props.getPixelOffset(icons.props.data[0], {index: 0});
    expect(x).toBeCloseTo(8, 9);
    expect(y).toBeCloseTo(0, 9);
  });

  test('rotatePixelOffset turns counter-clockwise on screen, with y pointing down', () => {
    const [x, y] = rotatePixelOffset([10, 0], 90);
    expect(x).toBeCloseTo(0, 9);
    expect(y).toBeCloseTo(-10, 9);
    expect(rotatePixelOffset([3, 4], 0)).toEqual([3, 4]);
  });

  test('updates the icon angle and offset when icon-rotate changes', () => {
    const layout: Record<string, unknown> = {'icon-image': 'arrow', 'icon-rotate': 0};
    const layer = new MVTLabelLayer({
      id: 'pins',
      config: {labels: true},
      zoom: 14,
      spriteAtlases: [ARROWS],
      styleLayer: {layout}
    });
    const before = layer.getIconUpdateTriggers();
    layout['icon-rotate'] = 45;
    const after = layer.getIconUpdateTriggers();
    expect(after.getAngle).not.toEqual(before.getAngle);
    expect(after.getPixelOffset).not.toEqual(before.getPixelOffset);
  });
});

describe('text-rotation-alignment', () => {
  function renderText(layout: Record<string, unknown>): any {
    const layer = lineLayer({}, layout);
    layer.state = {labelData: [{position: [0.5, 0.5], angle: 30} as any]};
    layer.context = {viewport: {bearing: 0}} as any;
    layer.internalState = {subLayers: []} as any;
    return layer.renderLayers().at(-1);
  }

  test('keeps viewport-aligned text an upright billboard along a line', () => {
    const text = renderText({'text-rotation-alignment': 'viewport'});
    expect(text.props.billboard).toBe(true);
    expect(typeof text.props.getAngle).not.toBe('function');
  });

  test('turns map-aligned and auto-aligned text to the line', () => {
    for (const alignment of ['map', 'auto']) {
      const text = renderText({'text-rotation-alignment': alignment});
      expect(text.props.billboard).toBe(false);
      expect(text.props.getAngle({angle: 30})).toBe(30);
    }
  });
});

describe('label length estimate', () => {
  test('counts wide characters as about one em and others as 0.6', () => {
    expect(getTextLengthEms('東京')).toBe(2);
    expect(getTextLengthEms('서울')).toBe(2);
    expect(getTextLengthEms('ab')).toBeCloseTo(1.2, 9);
    expect(getTextLengthEms('Ｎ1')).toBeCloseTo(1.6, 9);
  });
});

describe('mergeLines', () => {
  const a = [
    [0, 0],
    [1, 0]
  ];
  const b = [
    [1, 0],
    [2, 1]
  ];
  const c = [
    [2, 1],
    [3, 1]
  ];

  test('joins lines with the same text whose ends meet, in any input order', () => {
    const joined = [
      [0, 0],
      [1, 0],
      [2, 1],
      [3, 1]
    ];
    // Appended, prepended, and a line that joins two chains.
    expect(mergeLines([a, b, c].map(line => ({text: 'Main', line})))).toEqual([joined, null, null]);
    expect(mergeLines([c, b, a].map(line => ({text: 'Main', line})))).toEqual([joined, null, null]);
    expect(mergeLines([a, c, b].map(line => ({text: 'Main', line})))).toEqual([joined, null, null]);
  });

  test('keeps lines apart that have other text, no text or ends that do not meet', () => {
    expect(
      mergeLines([
        {text: 'Main', line: a},
        {text: 'High', line: b}
      ])
    ).toEqual([a, b]);
    expect(
      mergeLines([
        {text: '', line: a},
        {text: '', line: b}
      ])
    ).toEqual([a, b]);
    expect(
      mergeLines([
        {text: 'Main', line: a},
        {text: 'Main', line: c}
      ])
    ).toEqual([a, c]);
  });

  test('places a label along a street split into pieces shorter than the label', () => {
    // 'Main Street' is about 66 px at text-size 10; each piece is 51.2 px, inside the tile.
    const piece = (x0: number, x1: number) => ({
      geometry: {
        type: 'LineString',
        coordinates: [
          [x0, 0.5],
          [x1, 0.5]
        ]
      },
      properties: {name: 'Main Street'}
    });
    const pieces = [piece(0.2, 0.3), piece(0.3, 0.4)];
    for (const features of [pieces, [...pieces].reverse()]) {
      const rows = lineLayer().getLabelData(features, false) as any[];
      expect(rows).toHaveLength(1);
      // Placed as on one line from x = 0.2: half the label plus two ems in, at about 53 px.
      expect(rows[0].position[0] * 512).toBeCloseTo(0.2 * 512 + 33 + 20, 0);
    }
    // Each piece alone is too short for the label.
    expect(lineLayer().getLabelData([pieces[0]], false)).toHaveLength(0);
  });

  /** A feature with label text `name` and `lines`: a `MultiLineString` when there are several. */
  const feature = (name: string, ...lines: number[][][]) => ({
    geometry:
      lines.length > 1
        ? {type: 'MultiLineString', coordinates: lines}
        : {type: 'LineString', coordinates: lines[0]},
    properties: {name}
  });

  /** The lines of each feature left to label, in input order, as `getMergedLines` leaves them. */
  function getMergedGeometry(features: any[]): number[][][][] {
    return lineLayer()
      .getMergedLines(features)
      .flatMap((merged, index) => {
        if (merged === null) {
          return [];
        }
        const {type, coordinates} = (merged || features[index]).geometry;
        return [type === 'MultiLineString' ? coordinates : [coordinates]];
      });
  }

  /** The same, from MapLibre GL JS's own `mergeLines`, given each feature's text and lines. */
  function getMapLibreMergedGeometry(features: any[]): number[][][][] {
    const symbolFeatures = features.map(({geometry, properties}) => ({
      text: properties.name,
      geometry: (geometry.type === 'MultiLineString'
        ? geometry.coordinates
        : [geometry.coordinates]
      ).map((line: number[][]) => line.map(([x, y]) => ({x, y})))
    }));
    return mapLibreMergeLines(symbolFeatures as any).map(({geometry}) =>
      geometry.map(line => line.map(({x, y}) => [x, y]))
    );
  }

  // The first line of `multi` continues `single`; its second line lies apart from both.
  const single = feature('Main', [
    [0.1, 0.5],
    [0.3, 0.5]
  ]);
  const multi = feature(
    'Main',
    [
      [0.3, 0.5],
      [0.5, 0.5]
    ],
    [
      [0.1, 0.8],
      [0.9, 0.8]
    ]
  );

  test('joins a MultiLineString by its first line, and drops a feature joined into another', () => {
    // MapLibre keeps the feature of the chain a line joins: `single` takes `multi`'s first line,
    // and `multi`, with its other line, is not labelled.
    for (const features of [
      [single, multi],
      [multi, single]
    ]) {
      expect(getMergedGeometry(features)).toEqual(getMapLibreMergedGeometry(features));
    }
    const rows = lineLayer().getLabelData([single, multi], false) as any[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(row => row.position[1] === 0.5)).toBe(true);
  });

  test('joins a MultiLineString whose first line is a single vertex', () => {
    // MapLibre joins the vertex to the line ending there, and drops the feature it belongs to.
    const point = feature(
      'Main',
      [[0.3, 0.5]],
      [
        [0.1, 0.8],
        [0.9, 0.8]
      ]
    );
    const features = [single, point];
    expect(getMergedGeometry(features)).toEqual(getMapLibreMergedGeometry(features));
    expect(getMergedGeometry(features)).toEqual([single.geometry.coordinates].map(line => [line]));
  });

  test('keeps the other lines of a MultiLineString that a line joins', () => {
    const owner = feature(
      'Main',
      [
        [0.1, 0.2],
        [0.3, 0.2]
      ],
      [
        [0.1, 0.8],
        [0.9, 0.8]
      ]
    );
    const piece = feature('Main', [
      [0.3, 0.2],
      [0.6, 0.2]
    ]);
    const features = [owner, piece];
    expect(getMergedGeometry(features)).toEqual(getMapLibreMergedGeometry(features));
    expect(getMergedGeometry(features)).toEqual([
      [
        [
          [0.1, 0.2],
          [0.3, 0.2],
          [0.6, 0.2]
        ],
        [
          [0.1, 0.8],
          [0.9, 0.8]
        ]
      ]
    ]);
  });
});

describe('placement text size', () => {
  test('places labels whose text-size is 0 at the tile zoom, sized at zoom 18', () => {
    // A zoom-14 tile shown at zoom 14.5, where the text is 6 px tall; at zoom 14 it is 0.
    const layer = lineLayer(
      {data: [ACROSS_TILE], zoom: 14.5, tileZoom: 14},
      {'text-size': ['interpolate', ['linear'], ['zoom'], 14, 0, 15, 12]}
    );
    layer.state = {};
    layer.updateState({changeFlags: {dataChanged: true}} as any);
    expect(layer.getLabel(ACROSS_TILE as any)).toBe('Main');
    expect(layer.state.labelData?.length).toBeGreaterThan(0);
  });

  test('measures the label, its bend window and first offset at text-size zoom 18', () => {
    const inside = {
      geometry: {
        type: 'LineString',
        coordinates: [
          [0.1, 0.5],
          [0.9, 0.5]
        ]
      },
      properties: {name: 'Main'}
    };
    const rows = lineLayer(
      {},
      {'text-size': ['interpolate', ['linear'], ['zoom'], 14, 5, 18, 20]}
    ).getLabelData([inside], false) as any[];
    // 'Main' is 2.4 ems, 48 px at 20 px: the first label is 24 + 2 * 20 px from the start.
    expect(rows[0].position[0] * 512).toBeCloseTo(0.1 * 512 + 64, 6);
  });

  test('measures the letter spacing at the tile zoom, not the map zoom', () => {
    const inside = {
      geometry: {
        type: 'LineString',
        coordinates: [
          [0.1, 0.5],
          [0.9, 0.5]
        ]
      },
      properties: {name: 'Main Street'}
    };
    const firstAnchor = (props: Record<string, unknown>, spacing: unknown) =>
      (lineLayer(props, {'text-letter-spacing': spacing}).getLabelData([inside], false) as any[])[0]
        .position[0] * 512;
    // A zoom-14 tile shown at zoom 14.9: MapLibre lays it out at zoom 14, without spacing.
    const zoomed = {zoom: 14.9, tileZoom: 14};
    const spacing = ['interpolate', ['linear'], ['zoom'], 14, 0, 15, 1];
    expect(firstAnchor(zoomed, spacing)).toBe(firstAnchor(zoomed, 0));
    // The spacing does move the first label: half of 10 gaps of 0.5 em at 10 px further in.
    expect(firstAnchor(zoomed, 0.5)).toBeCloseTo(firstAnchor(zoomed, 0) + 25, 6);
  });

  test('falls back to the tile zoom where text-size is 0 at zoom 18', () => {
    const rows = lineLayer({}, {'text-size': ['step', ['zoom'], 10, 17, 0]}).getLabelData(
      [ACROSS_TILE],
      false
    );
    expect(rows).toHaveLength(2);
  });
});

describe('measured label length', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * A canvas whose text is 0.25 em per character, at the 64 px the measurer uses, or `width()`
   * ems when given.
   */
  function stubCanvas(width = () => 0.25) {
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        getContext() {
          return {font: '', measureText: (text: string) => ({width: 64 * width() * text.length})};
        }
      }
    );
  }

  // 'Main Street' is 11 characters: 27.5 px measured at 10 px, 66 px estimated.
  const street = {
    geometry: {
      type: 'LineString',
      coordinates: [
        [0.4, 0.5],
        [0.4 + 40 / 512, 0.5]
      ]
    },
    properties: {name: 'Main Street'}
  };

  test('places a label by the width of its text in the label font', () => {
    stubCanvas();
    const layer = lineLayer({fontFamily: 'Measured One'}, {'symbol-placement': 'line-center'});
    expect(layer.getLabelData([street], false)).toHaveLength(1);
  });

  test('estimates the width while the label font loads, and places again once it has', async () => {
    stubCanvas();
    let loaded = false;
    let finishLoading = () => {};
    const load = vi.fn(
      () =>
        new Promise<void>(resolve => {
          finishLoading = () => {
            loaded = true;
            resolve();
          };
        })
    );
    vi.stubGlobal('document', {fonts: {check: () => loaded, load}});
    const layer = lineLayer(
      {data: [street], fontFamily: 'Measured Two'},
      {'symbol-placement': 'line-center'}
    );
    layer.state = {};
    const setNeedsUpdate = vi.spyOn(layer, 'setNeedsUpdate').mockImplementation(() => {});
    layer.updateState({changeFlags: {dataChanged: true}} as any);
    // At 66 px the estimate does not fit the 40 px line; the font is requested once.
    expect(layer.state.labelData).toEqual([]);
    layer.updateState({changeFlags: {}} as any);
    expect(load).toHaveBeenCalledTimes(1);

    const calls = setNeedsUpdate.mock.calls.length;
    finishLoading();
    await Promise.resolve();
    await Promise.resolve();
    expect(setNeedsUpdate).toHaveBeenCalledTimes(calls + 1);
    layer.updateState({changeFlags: {}} as any);
    expect(layer.state.labelData).toHaveLength(1);
  });

  test('measures again the widths measured while the font loaded', async () => {
    let loaded = false;
    // A fallback font 0.6 em per character wide while loading; the label font is 0.25.
    stubCanvas(() => (loaded ? 0.25 : 0.6));
    let finishLoading = () => {};
    const load = () =>
      new Promise<void>(resolve => {
        finishLoading = () => {
          loaded = true;
          resolve();
        };
      });
    vi.stubGlobal('document', {fonts: {check: () => loaded, load}});
    const layer = lineLayer(
      {data: [street], fontFamily: 'Measured Four'},
      {'symbol-placement': 'line-center'}
    );
    layer.state = {};
    vi.spyOn(layer, 'setNeedsUpdate').mockImplementation(() => {});
    layer.updateState({changeFlags: {dataChanged: true}} as any);
    // Wrapping, say, measures the fallback font meanwhile.
    const font = layer.getFont();
    const measure = getCharacterWidthMeasurer(getTextLayerFontWeight(font), font.fontFamily);
    expect(Array.from('Main Street', measure)).toEqual(Array(11).fill(0.6));
    finishLoading();
    await Promise.resolve();
    await Promise.resolve();
    layer.updateState({changeFlags: {}} as any);
    expect(layer.state.labelData).toHaveLength(1);
  });

  test('does not update a layer finalized before its font loaded', async () => {
    stubCanvas();
    let finishLoading = () => {};
    const load = () =>
      new Promise<void>(resolve => {
        finishLoading = resolve;
      });
    vi.stubGlobal('document', {fonts: {check: () => false, load}});
    const layer = lineLayer({data: [street], fontFamily: 'Measured Three'});
    layer.state = {};
    const setNeedsUpdate = vi.spyOn(layer, 'setNeedsUpdate').mockImplementation(() => {});
    layer.updateState({changeFlags: {dataChanged: true}} as any);
    layer.context = {resourceManager: {unsubscribe: () => {}}} as any;
    layer.finalizeState(layer.context);
    // Updates of the layer's own state may ask for one; the font load must not.
    const calls = setNeedsUpdate.mock.calls.length;
    finishLoading();
    await Promise.resolve();
    await Promise.resolve();
    expect(setNeedsUpdate).toHaveBeenCalledTimes(calls);
  });

  test('spends a budget step per character measured', () => {
    const budget = {steps: 5};
    expect(
      lineLayer().getLineLabelPlacements(ACROSS_TILE as any, false, 'line', budget)
    ).toHaveLength(0);
    expect(budget.steps).toBeLessThanOrEqual(1);
  });
});

describe('symbols with an icon and no text', () => {
  const corner = [
    [0, 0],
    [100, 0],
    [100, -100]
  ];

  test('are not checked for bends, as they have no bend window', () => {
    const options = {...OPTIONS, placement: 'line-center' as const, labelLength: 20};
    // The middle is at the corner: text there is too bent, an icon is not.
    expect(getLineAnchors(corner, options)).toEqual([]);
    expect(getLineAnchors(corner, {...options, hasText: false})).toEqual([
      {segment: 1, t: 0, angle: 90}
    ]);
    // Nor for fit, as in MapLibre's `getCenterAnchor`.
    expect(getLineAnchors(corner, {...options, hasText: false, labelLength: 201})).toHaveLength(1);
    // Along the line too, a continued line puts a candidate on the corner.
    const along = {...OPTIONS, spacing: 200, labelLength: 20, isContinued: true};
    expect(distances(getLineAnchors(corner, along), corner)).toEqual([]);
    expect(getLineAnchors(corner, {...along, hasText: false})).toEqual([
      {segment: 1, t: 0, angle: 90}
    ]);
  });

  test('are placed at a corner along a line', () => {
    const layer = new MVTLabelLayer({
      id: 'arrows',
      config: {labels: true},
      zoom: 14,
      tileZoom: 14,
      tileSize: 512,
      spriteAtlases: [ARROWS],
      styleLayer: {layout: {'icon-image': 'arrow', 'symbol-placement': 'line-center'}}
    });
    const feature = {
      geometry: {
        type: 'LineString',
        coordinates: corner.map(([x, y]) => [0.3 + x / 512, 0.6 + y / 512])
      },
      properties: {}
    };
    const rows = layer.getLabelData([feature], false) as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].position[0] * 512).toBeCloseTo(0.3 * 512 + 100, 6);
  });
});

describe('labels of the same text', () => {
  const parallel = (y: number, name = 'Main') => ({
    geometry: {
      type: 'LineString',
      coordinates: [
        [-0.1, y],
        [1.1, y]
      ]
    },
    properties: {name}
  });

  test('are not repeated within half a symbol-spacing on a tile', () => {
    const near = [parallel(0.5), parallel(0.5 + 10 / 512)];
    expect(lineLayer().getLabelData(near, false)).toHaveLength(2);
    // An anchor on the tile's far edge belongs to the next tile, and does not count here.
    const edge = (x: number) => ({
      geometry: {
        type: 'LineString',
        coordinates: [
          [x, 0.2],
          [x, 0.8]
        ]
      },
      properties: {name: 'Main'}
    });
    expect(lineLayer().getLabelData([edge(1), edge(1 - 10 / 512)], false)).toHaveLength(2);
    // Also across the edge of the 125 px cells anchors are looked up in.
    const across = [parallel(245 / 512), parallel(255 / 512)];
    expect(lineLayer().getLabelData(across, false)).toHaveLength(2);
    // Other text, or lines further apart than 125 px, keep their labels.
    expect(
      lineLayer().getLabelData([parallel(0.5), parallel(0.5 + 10 / 512, 'High')], false)
    ).toHaveLength(4);
    expect(
      lineLayer().getLabelData([parallel(0.2), parallel(0.2 + 130 / 512)], false)
    ).toHaveLength(4);
  });

  test('keep one label per neighbourhood among many close lines', () => {
    // 2000 lines a quarter pixel apart across the tile, each with two candidates.
    const lines = Array.from({length: 2000}, (_, i) => parallel(i / 2000));
    const rows = lineLayer().getLabelData(lines, false) as any[];
    // At most one label per 125 px of the tile's 512 px height, per column.
    expect(rows.length).toBeLessThanOrEqual(2 * Math.ceil(512 / 125) + 2);
  });
});

describe('line placement bounds', () => {
  test('reads no line once the tile budget is spent', () => {
    let reads = 0;
    const coordinates = new Proxy(
      Array.from({length: 1e4}, (_, i) => [i / 1e4, 0.5]),
      {
        get(target, property, receiver) {
          if (typeof property === 'string' && /^\d+$/.test(property)) {
            reads++;
          }
          return Reflect.get(target, property, receiver);
        }
      }
    );
    const feature = {geometry: {type: 'LineString', coordinates}, properties: {name: 'Main'}};
    expect(lineLayer().getLineLabelPlacements(feature, false, 'line', {steps: 0})).toEqual([]);
    expect(reads).toBe(0);
  });

  test('measures the whole line for line-center, not only the part near the tile', () => {
    const layer = lineLayer({}, {'symbol-placement': 'line-center'});
    const line = (coordinates: number[][]) => ({
      geometry: {type: 'LineString', coordinates},
      properties: {name: 'Main'}
    });
    // The middle of this line is at x = -1.5, in another tile.
    expect(
      layer.getLabelData(
        [
          line([
            [-4, 0.5],
            [1, 0.5]
          ])
        ],
        false
      )
    ).toEqual([]);
    const [row] = layer.getLabelData(
      [
        line([
          [-3, 0.5],
          [3.5, 0.5]
        ])
      ],
      false
    ) as any[];
    expect(row.position[0]).toBeCloseTo(0.25, 9);
  });

  test('interpolates geographic anchors in Web Mercator', () => {
    const layer = lineLayer({tileZoom: 2, zoom: 2}, {'symbol-placement': 'line-center'});
    const [row] = layer.getLabelData(
      [
        {
          geometry: {
            type: 'LineString',
            coordinates: [
              [0, 0],
              [0, 60]
            ]
          },
          properties: {name: 'Main'}
        }
      ],
      true
    ) as any[];
    // Halfway in Web Mercator y between the equator and 60 degrees north.
    const mercatorY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
    const middle = mercatorY(60) / 2;
    const latitude = ((2 * Math.atan(Math.exp(middle)) - Math.PI / 2) * 180) / Math.PI;
    expect(row.position[1]).toBeCloseTo(latitude, 6);
    expect(row.position[1]).toBeGreaterThan(33);
  });

  test('sizes 256 px tiles at their own zoom, also when overzoomed', () => {
    // A zoom-15 256 px tile at map zoom 14 is 256 px wide: one label, half a spacing in.
    const rows = lineLayer({tileZoom: 15, tileSize: 256}).getLabelData(
      [ACROSS_TILE],
      false
    ) as any[];
    expect(rows.map(row => row.position[0])).toEqual([expect.closeTo(125 / 256, 9)]);
    // A zoom-14 256 px tile is 2048 px wide at map zoom 16, as a 512 px one is.
    const overzoomed = lineLayer({zoom: 16, tileZoom: 14, tileSize: 256}).getLabelData(
      [ACROSS_TILE],
      false
    ) as any[];
    expect(overzoomed).toHaveLength(8);
  });
});

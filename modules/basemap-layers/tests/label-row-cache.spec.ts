/* eslint-disable import/no-extraneous-dependencies */
import {describe, expect, test, vi} from 'vitest';
import {_MultiIconLayer as MultiIconLayer} from '@deck.gl/layers';
import {MVTLabelLayer} from '../src/mvt-label-layer.ts';
import {LabelTextLayer} from '../src/label-text-layer.ts';
import {getCompiledStyleProperty} from '../src/style-expression.ts';

/** Runs `updateState` outside deck.gl, carrying state over as deck.gl does between updates. */
function update(props: Record<string, any>, state: Record<string, any>): void {
  const layer = new MVTLabelLayer({
    id: 'labels',
    config: {labels: true},
    zoom: 10,
    styleLayer: {layout: {'text-field': '{name}'}},
    ...props
  } as any);
  (layer as any).context = {viewport: {}};
  (layer as any).state = state;
  (layer as any).setState = (partial: Record<string, any>) => Object.assign(state, partial);
  layer.updateState({changeFlags: {}} as any);
}

function pointFeature(x: number, y: number, name: string): any {
  return {geometry: {type: 'Point', coordinates: [x, y]}, properties: {name}};
}

function labelTile(x: number, name: string, tileObject: unknown = {id: `${x}-0-1`}): any {
  return {index: {x, y: 0, z: 1}, features: [pointFeature(0.5, 0.5, name)], tile: tileObject};
}

const names = (state: Record<string, any>) =>
  state.labelData.map((row: any) => row.__source.object.properties.name);

describe('the rows of a label layer of several tiles', () => {
  test('a tile hidden and shown again keeps its rows', () => {
    const a = labelTile(0, 'a');
    const b = labelTile(1, 'b');
    const state: Record<string, any> = {};
    update({tiles: [a, b]}, state);
    const rowsOfB = state.tileRows.get('1,0,1').rows;
    update({tiles: [a]}, state);
    expect(names(state)).toEqual(['a']);
    update({tiles: [a, b]}, state);
    expect(names(state)).toEqual(['a', 'b']);
    expect(state.tileRows.get('1,0,1').rows).toBe(rowsOfB);
    expect(state.labelData[1]).toBe(rowsOfB[0]);
  });

  test('a tile added and removed changes the rows, in tile order', () => {
    const a = labelTile(0, 'a');
    const b = labelTile(1, 'b');
    const c = labelTile(2, 'c');
    const state: Record<string, any> = {};
    update({tiles: [a, c]}, state);
    expect(names(state)).toEqual(['a', 'c']);
    update({tiles: [a, b, c]}, state);
    expect(names(state)).toEqual(['a', 'b', 'c']);
    update({tiles: [b, c]}, state);
    expect(names(state)).toEqual(['b', 'c']);
    update({tiles: [c, a]}, state);
    expect(names(state)).toEqual(['c', 'a']);
  });

  test('a tile replaced at the same index is placed again, whether it was drawn or hidden', () => {
    const a = labelTile(0, 'a');
    const b = labelTile(1, 'b');
    const state: Record<string, any> = {};
    update({tiles: [a, b]}, state);
    const rowsOfB = state.tileRows.get('1,0,1').rows;

    // Replaced while drawn: another tile object with the same features.
    const replaced = {...b, tile: {id: '1-0-1'}};
    update({tiles: [a, replaced]}, state);
    const rowsOfReplaced = state.tileRows.get('1,0,1').rows;
    expect(rowsOfReplaced).not.toBe(rowsOfB);
    expect(rowsOfReplaced[0].__tile).toBe(replaced.tile);

    // Replaced while hidden: the kept rows are not those of the new tile.
    update({tiles: [a]}, state);
    const reloaded = labelTile(1, 'b2');
    update({tiles: [a, reloaded]}, state);
    expect(names(state)).toEqual(['a', 'b2']);
    expect(state.labelData[1].__tile).toBe(reloaded.tile);
    expect(state.tileRows.get('1,0,1').rows).not.toBe(rowsOfReplaced);
  });

  test('keeps the rows of at most as many hidden tiles as are drawn', () => {
    const tiles = [0, 1, 2, 3].map(x => labelTile(x, `t${x}`));
    const state: Record<string, any> = {};
    update({tiles}, state);
    update({tiles: [tiles[0]]}, state);
    expect(state.tileRows.size).toBe(2);
    update({tiles: [tiles[2], tiles[3]]}, state);
    expect(state.tileRows.size).toBe(4);
    expect(names(state)).toEqual(['t2', 't3']);
  });
});

describe('style values of label features', () => {
  const styleLayer = {
    layout: {'text-field': '{name}', 'text-size': ['get', 'size']}
  };

  function labelLayer(zoom: number, state: Record<string, any>, layer = styleLayer): any {
    const result = new MVTLabelLayer({
      id: 'labels',
      config: {labels: true},
      zoom,
      styleLayer: layer
    });
    (result as any).state = state;
    return result;
  }

  test('are evaluated once per feature and zoom step', () => {
    const property = getCompiledStyleProperty(styleLayer, 'text-size')!;
    const evaluate = vi.spyOn(property, 'evaluate');
    const state = {};
    const a = {properties: {size: 12}};
    const b = {properties: {size: 14}};
    expect(labelLayer(10, state).getLabelSize(a)).toBe(12);
    expect(labelLayer(10, state).getLabelSize(a)).toBe(12);
    expect(labelLayer(10, state).getLabelSize(b)).toBe(14);
    expect(evaluate).toHaveBeenCalledTimes(2);
    // Another zoom step evaluates again.
    expect(labelLayer(11, state).getLabelSize(a)).toBe(12);
    expect(evaluate).toHaveBeenCalledTimes(3);
    evaluate.mockRestore();
  });

  test('are evaluated again when the property changes', () => {
    const state = {};
    const feature = {properties: {size: 12}};
    expect(labelLayer(10, state).getLabelSize(feature)).toBe(12);
    const edited = {layout: {...styleLayer.layout, 'text-size': ['*', 2, ['get', 'size']]}};
    expect(labelLayer(10, state, edited).getLabelSize(feature)).toBe(24);
  });

  test('match the values of a layer without the cache', () => {
    const state = {};
    const features = [12, 14, 16].map(size => ({properties: {size, name: `n${size}`}}));
    const cached = labelLayer(10, state);
    const uncached = new MVTLabelLayer({id: 'u', config: {labels: true}, zoom: 10, styleLayer});
    for (const feature of [...features, ...features]) {
      expect(cached.getLabelSize(feature)).toBe(uncached.getLabelSize(feature));
      expect(cached.getLabel(feature)).toBe(uncached.getLabel(feature));
    }
  });
});

/** A font atlas mapping of `characters`, each 10 atlas pixels wide. */
function getMapping(characters: string): Record<string, any> {
  return Object.fromEntries(
    Array.from(characters).map((character, i) => [
      character,
      {x: i * 20, y: 0, width: 10, height: 16, advance: 10, anchorX: 5, anchorY: 12}
    ])
  );
}

describe('label layouts', () => {
  function textLayer(props: Record<string, unknown> = {}, atlas = {baselineOffset: 2}): any {
    const layer: any = new LabelTextLayer({id: 'text', ...props} as any);
    layer.state = {
      getText: (row: any) => row.text,
      fontAtlasManager: {mapping: getMapping('abc '), atlas, props: {fontSize: 64}}
    };
    return layer;
  }
  const info = {index: 0, data: [], target: []} as any;

  test('are kept while the text and layout inputs do not change', () => {
    const layer = textLayer();
    const row = {text: 'ab'};
    const layout = layer.transformParagraph(row, info);
    expect(layer.transformParagraph(row, info)).toBe(layout);
    // The layout of a layer without a cache.
    expect(textLayer().transformParagraph({text: 'ab'}, info)).toEqual(layout);
  });

  test('are made again when an input changes', () => {
    const layer = textLayer();
    const row = {text: 'ab'};
    const layout = layer.transformParagraph(row, info);
    row.text = 'abc';
    const longer = layer.transformParagraph(row, info);
    expect(longer).not.toBe(layout);
    expect(longer.x).toHaveLength(3);

    const atlas = {baselineOffset: 2};
    const spaced = textLayer({getLetterSpacing: 0.5}, atlas);
    const unspaced = textLayer({}, atlas);
    spaced.state.layouts = unspaced.state.layouts = new WeakMap();
    const plain = unspaced.transformParagraph(row, info);
    expect(spaced.transformParagraph(row, info).size[0]).toBeGreaterThan(plain.size[0]);

    // Each layer below differs from `unspaced`, which laid the row out last, in one input only.
    const otherAtlas = textLayer({}, {baselineOffset: 4});
    otherAtlas.state.layouts = unspaced.state.layouts;
    expect(unspaced.transformParagraph(row, info)).toEqual(plain);
    expect(otherAtlas.transformParagraph(row, info).y[0]).not.toBe(plain.y[0]);

    const taller = textLayer({lineHeight: 2}, atlas);
    taller.state.layouts = unspaced.state.layouts;
    unspaced.transformParagraph(row, info);
    expect(taller.transformParagraph(row, info).size[1]).toBe(2 * plain.size[1]);
  });

  // Each input on its own: the row is laid out with `base` first, then with the input changed.
  const lines = {text: 'ab\nc'};
  const words = {text: 'abc ab'};
  for (const [input, row, base, changed] of [
    ['justification', lines, {getTextJustify: 'left'}, {getTextJustify: 'right'}],
    [
      'anchor',
      lines,
      {getTextJustify: 'left', getTextAnchor: 'start'},
      {getTextJustify: 'left', getTextAnchor: 'end'}
    ],
    ['maximum width', words, {}, {maxWidth: 0.4}],
    ['word break', {text: 'a abc'}, {maxWidth: 0.6}, {maxWidth: 0.6, wordBreak: 'break-all'}]
  ] as const) {
    test(`are made again when the ${input} changes`, () => {
      const atlas = {baselineOffset: 2};
      const before = textLayer(base, atlas);
      const after = textLayer(changed, atlas);
      before.state.layouts = after.state.layouts = new WeakMap();
      const kept = {...row};
      const first = before.transformParagraph(kept, info);
      const fresh = textLayer(changed, atlas).transformParagraph({...row}, info);
      expect(fresh).not.toEqual(first);
      expect(after.transformParagraph(kept, info)).toEqual(fresh);
    });
  }
});

describe('label characters', () => {
  const CharactersLayer = new LabelTextLayer({id: 'text'} as any).getSubLayerClass(
    'characters',
    MultiIconLayer
  );
  const mapping = getMapping('abc');

  function charactersLayer(LayerClass: any, rows: any[], props: Record<string, unknown> = {}) {
    const layer: any = new LayerClass({
      id: 'characters',
      data: rows,
      getIcon: (row: any) => row.text,
      getIconOffsets: (row: any) => row.offsets,
      iconAtlas: 'atlas',
      iconMapping: mapping,
      ...props
    });
    layer.state = {iconManager: {getIconMapping: (character: string) => mapping[character]}};
    return layer;
  }

  /** The `instanceIconDefs` of `rows` as `layer` packs them. */
  function pack(layer: any, rows: any[]): Float32Array {
    layer.props = {...layer.props, data: rows};
    const starts = [0];
    for (const row of rows) {
      starts.push(starts[starts.length - 1] + Array.from(row.text).length);
    }
    const attribute = {
      size: 7,
      value: new Float32Array(starts[starts.length - 1] * 7),
      getVertexOffset: (row: number) => starts[row] * 7
    };
    layer.calculateInstanceIconDefs(attribute, {startRow: 0, endRow: rows.length});
    return attribute.value;
  }

  const getRows = () => [
    {text: 'ab', offsets: [0, 1, 10, 1]},
    {text: 'c', offsets: [3, 4]}
  ];

  test('are packed as by MultiIconLayer', () => {
    const rows = getRows();
    expect(CharactersLayer).not.toBe(MultiIconLayer);
    expect(Array.from(pack(charactersLayer(CharactersLayer, rows), rows))).toEqual(
      Array.from(pack(charactersLayer(MultiIconLayer, rows), rows))
    );
  });

  test("keep each label's packed values while its text, offsets and atlas do not change", () => {
    const rows = getRows();
    const layer = charactersLayer(CharactersLayer, rows);
    const first = pack(layer, rows);
    const getDef = vi.spyOn(layer, 'getInstanceIconDef');
    expect(pack(layer, rows)).toEqual(first);
    expect(getDef).not.toHaveBeenCalled();

    // A label moved within its box is packed again; the other label is kept.
    const moved = [rows[0], {...rows[1]}];
    pack(layer, moved);
    getDef.mockClear();
    moved[1].offsets = [5, 4];
    const expected = pack(charactersLayer(MultiIconLayer, moved), moved);
    expect(pack(layer, moved)).toEqual(expected);
    expect(getDef).toHaveBeenCalledTimes(1);

    // A new atlas packs every label again.
    layer.props = {...layer.props, iconAtlas: 'atlas-2'};
    pack(layer, moved);
    expect(getDef).toHaveBeenCalledTimes(4);

    // So does new text of the same label.
    moved[0].text = 'ba';
    expect(pack(layer, moved)).toEqual(pack(charactersLayer(MultiIconLayer, moved), moved));
  });
});

import {describe, expect, test, vi} from 'vitest';
import {BasemapLayer} from '../src/basemap-layer.ts';
import {MVTLabelLayer} from '../src/mvt-label-layer.ts';
import {getSpriteIconMapping} from '../src/sprite.ts';
import {getSymbolCollision} from '../src/symbol-collision.ts';
import type {SymbolCollisionLayout} from '../src/symbol-collision.ts';

const DEFAULTS: SymbolCollisionLayout = {
  hasText: true,
  hasIcon: true,
  textAllowOverlap: false,
  iconAllowOverlap: false,
  textIgnorePlacement: false,
  iconIgnorePlacement: false,
  textOptional: false,
  iconOptional: false
};

/** `[text tested, icon tested]` for a layout. */
function tested(layout: Partial<SymbolCollisionLayout>): [boolean, boolean] {
  const {text, icon} = getSymbolCollision({...DEFAULTS, ...layout});
  return [text.tested, icon.tested];
}

describe('getSymbolCollision', () => {
  test('by default, text and icon are tested and block other symbols', () => {
    expect(getSymbolCollision(DEFAULTS)).toEqual({
      text: {tested: true, blocks: true},
      icon: {tested: true, blocks: true}
    });
  });

  test('without optional parts, a symbol is always placed only when both parts allow overlap', () => {
    expect(tested({iconAllowOverlap: true})).toEqual([true, true]);
    expect(tested({textAllowOverlap: true})).toEqual([true, true]);
    expect(tested({iconAllowOverlap: true, textAllowOverlap: true})).toEqual([false, false]);
  });

  test('an optional text lets an icon that allows overlap be placed on its own', () => {
    expect(tested({iconAllowOverlap: true, textOptional: true})).toEqual([true, false]);
    // The text still needs the icon.
    expect(tested({textAllowOverlap: true, textOptional: true})).toEqual([true, true]);
  });

  test('an optional icon lets text that allows overlap be placed on its own', () => {
    expect(tested({textAllowOverlap: true, iconOptional: true})).toEqual([false, true]);
    expect(tested({iconAllowOverlap: true, iconOptional: true})).toEqual([true, true]);
  });

  test('with both parts optional, each part follows its own allow-overlap', () => {
    const optional = {textOptional: true, iconOptional: true};
    expect(tested({...optional, textAllowOverlap: true})).toEqual([false, true]);
    expect(tested({...optional, iconAllowOverlap: true})).toEqual([true, false]);
  });

  test('a part without text or icon follows only the other part', () => {
    expect(tested({hasText: false, iconAllowOverlap: true})).toEqual([true, false]);
    expect(tested({hasIcon: false, textAllowOverlap: true})).toEqual([false, true]);
  });

  test('ignore-placement stops a part from blocking other symbols', () => {
    const {text, icon} = getSymbolCollision({...DEFAULTS, iconIgnorePlacement: true});
    expect(text.blocks).toBe(true);
    expect(icon.blocks).toBe(false);
    expect(getSymbolCollision({...DEFAULTS, textIgnorePlacement: true}).text.blocks).toBe(false);
  });

  test('a layer without text only marks anchors with its text sublayer', () => {
    expect(getSymbolCollision({...DEFAULTS, hasText: false, textAllowOverlap: true}).text).toEqual({
      tested: true,
      blocks: false
    });
  });
});

const ATLAS = {
  id: 'default',
  image: 'https://example.com/sprite.png',
  mapping: getSpriteIconMapping({dot: {x: 0, y: 0, width: 8, height: 8}})
};

function symbolLayer(
  layout: Record<string, unknown>,
  zoom = 8,
  props: Record<string, unknown> = {}
): any {
  const layer: any = new MVTLabelLayer({
    id: 'labels',
    config: {labels: true},
    styleLayer: {layout, paint: {}},
    zoom,
    spriteAtlases: [ATLAS],
    ...props
  } as any);
  layer.state = {
    labelData: [
      {
        position: [0, 0],
        __source: {object: {geometry: {type: 'Point', coordinates: [0, 0]}, properties: {}}}
      }
    ]
  };
  layer.context = {} as any;
  layer.internalState = {subLayers: []} as any;
  return layer;
}

/** `layer` with one point row per entry of `properties`. */
function withRows(layer: any, properties: Record<string, unknown>[]): any {
  layer.state = {
    labelData: properties.map((props, index) => ({
      position: [index, 0],
      __source: {
        object: {geometry: {type: 'Point', coordinates: [index, 0]}, properties: props},
        index
      }
    }))
  };
  return layer;
}

/**
 * Per row, whether a text sublayer draws it: text, and a priority inside the collision pass. The
 * sublayers hold the rows in reverse (see `getRows`); the result is in the order of the rows.
 */
function groupRows(sublayer: any): boolean[] {
  const {data, getText, getCollisionPriority} = sublayer.props;
  return data
    .map((row: any, index: number) => {
      const info = {index, data, target: []};
      const drawn = getCollisionPriority(row, info) >= -1000;
      // A row outside the group draws no text either.
      expect(drawn || !getText(row, info)).toBe(true);
      return drawn;
    })
    .reverse();
}

/** Per row, whether an icon sublayer draws it, in the order of the rows (see `groupRows`). */
function iconRows(sublayer: any): boolean[] {
  const {data, getIcon} = sublayer.props;
  return data
    .map((row: any, index: number) => getIcon(row, {index, data, target: []}) !== null)
    .reverse();
}

/** `[id, collisionEnabled, opacity, collisionTestProps.sizeScale]` per sublayer. */
function describeSublayers(layer: any) {
  return layer
    .renderLayers()
    .map((sublayer: any) => [
      sublayer.id,
      sublayer.props.collisionEnabled,
      sublayer.props.opacity,
      sublayer.props.collisionTestProps.sizeScale
    ]);
}

describe('MVTLabelLayer symbol collision', () => {
  test('reads the placement properties at the stepped zoom', () => {
    const layout = {
      'icon-image': 'dot',
      'text-field': 'A',
      'icon-allow-overlap': ['step', ['zoom'], false, 10, true],
      'text-allow-overlap': true
    };
    expect(symbolLayer(layout, 8).getSymbolCollision().icon.tested).toBe(true);
    expect(symbolLayer(layout, 10).getSymbolCollision().icon.tested).toBe(false);
  });

  test('*-overlap takes precedence over *-allow-overlap', () => {
    const base = {'icon-image': 'dot', 'text-field': 'A', 'text-allow-overlap': true};
    const always = {...base, 'icon-allow-overlap': false, 'icon-overlap': 'always'};
    const never = {...base, 'icon-allow-overlap': true, 'icon-overlap': 'never'};
    expect(symbolLayer(always).getSymbolCollision().icon.tested).toBe(false);
    expect(symbolLayer(never).getSymbolCollision().icon.tested).toBe(true);
  });

  test('by default, icons and text are drawn collision-tested', () => {
    expect(describeSublayers(symbolLayer({'icon-image': 'dot', 'text-field': 'A'}))).toEqual([
      ['labels-icons-default', true, 1, undefined],
      ['labels-text', true, 1, undefined]
    ]);
  });

  test('parts that ignore placement draw nothing but their anchor in the collision pass', () => {
    const layer = symbolLayer({
      'icon-image': 'dot',
      'text-field': 'A',
      'icon-ignore-placement': true,
      'text-ignore-placement': true
    });
    // The text draws a zero-size box; the anchors layer marks its anchor.
    expect(describeSublayers(layer)).toEqual([
      ['labels-icons-default', true, 1, 0],
      ['labels-text', true, 1, 0],
      ['labels-anchors', true, 0, undefined]
    ]);
    const [, text, anchors] = layer.renderLayers();
    expect(text.props.collisionTestProps.padding).toEqual([0, 0, 0, 0]);
    // A 4-pixel box on each side of the anchor, with no pixel offset.
    expect(anchors.props.padding).toEqual([4, 4, 4, 4]);
    expect(anchors.props.getPixelOffset).toEqual([0, 0]);
    expect(anchors.props.getBoundingRect).toEqual([0, 0, 0, 0]);
    expect(anchors.props.pickable).toBe(false);
  });

  test('text that blocks keeps its padded box and needs no anchors layer', () => {
    const layer = symbolLayer({'text-field': 'A', 'text-offset': [2, 0]});
    const sublayers = layer.renderLayers();
    expect(sublayers.map((sublayer: any) => sublayer.id)).toEqual(['labels-text']);
    // Padded by the 32-pixel offset plus the sample radius, so the box reaches the anchor.
    expect(sublayers[0].props.collisionTestProps).toEqual({padding: [36, 4, 4, 4]});
  });

  test('the anchors layer shares the text rows, priorities and identity', () => {
    const layout = {
      'icon-image': ['get', 'icon'],
      'text-field': ['get', 'name'],
      'text-allow-overlap': true,
      'text-ignore-placement': true,
      'symbol-sort-key': ['get', 'rank']
    };
    // Row 1 has no icon, so it is in the text's own group, masked out of the paired layers.
    const rows = [
      {icon: 'dot', name: 'A', rank: 1},
      {name: 'B', rank: 2}
    ];
    const layer = withRows(symbolLayer(layout), rows);
    const sublayers = layer.renderLayers();
    const byId = (id: string) => sublayers.find((sublayer: any) => sublayer.id === id);
    const data = layer.state.labelData;
    const priorities = (sublayer: any) =>
      data.map((row: any, index: number) =>
        sublayer.props.getCollisionPriority(row, {index, data, target: []})
      );
    // Row 0's text waits for its icon; row 1's is placed regardless, by the overlap copy.
    expect(sublayers.map((sublayer: any) => sublayer.id)).toEqual([
      'labels-icons-default',
      'labels-text',
      'labels-anchors',
      'labels-text-alone-overlap',
      'labels-anchors-alone'
    ]);
    for (const [textId, anchorsId] of [
      ['labels-text', 'labels-anchors'],
      ['labels-text-alone-overlap', 'labels-anchors-alone']
    ]) {
      const text = byId(textId);
      const anchors = byId(anchorsId);
      expect(anchors.props.data).toBe(text.props.data);
      expect(priorities(anchors)).toEqual(priorities(text));
      expect(anchors.props.updateTriggers.all).toEqual(text.props.updateTriggers.all);
    }
  });

  test('a part placed regardless of collisions is drawn untested, and still blocks unless it ignores placement', () => {
    const layout = {
      'icon-image': 'dot',
      'text-field': 'A',
      'icon-allow-overlap': true,
      'text-allow-overlap': true
    };
    expect(describeSublayers(symbolLayer(layout))).toEqual([
      ['labels-icons-default-overlap', false, 1, undefined],
      ['labels-icons-default', true, 0, undefined],
      ['labels-text-overlap', false, 1, undefined],
      ['labels-text', true, 0, undefined]
    ]);
    const ignoring = {...layout, 'icon-ignore-placement': true, 'text-ignore-placement': true};
    expect(describeSublayers(symbolLayer(ignoring))).toEqual([
      ['labels-icons-default-overlap', false, 1, 0],
      ['labels-text-overlap', false, 1, 0]
    ]);
  });

  test('invisible collision sublayers are never highlighted', () => {
    const layout = {
      'icon-image': 'dot',
      'text-field': 'A',
      'icon-allow-overlap': true,
      'text-optional': true,
      'text-ignore-placement': true
    };
    const layer = symbolLayer(layout, 8, {autoHighlight: true, highlightedObjectIndex: 0});
    const highlights = layer
      .renderLayers()
      .map((sublayer: any) => [
        sublayer.id,
        sublayer.props.autoHighlight,
        sublayer.props.highlightedObjectIndex
      ]);
    expect(highlights).toEqual([
      ['labels-icons-default-overlap', true, 0],
      ['labels-icons-default', false, -1],
      ['labels-text', true, 0],
      ['labels-anchors', false, -1]
    ]);
  });

  test('collision footprints of always-placed parts are not pickable', () => {
    const layout = {
      'icon-image': 'dot',
      'text-field': 'A',
      'icon-allow-overlap': true,
      'text-allow-overlap': true
    };
    const layer = symbolLayer(layout, 8, {pickable: true});
    const pickable = layer
      .renderLayers()
      .map((sublayer: any) => [sublayer.id, sublayer.props.pickable]);
    expect(pickable).toEqual([
      ['labels-icons-default-overlap', true],
      ['labels-icons-default', false],
      ['labels-text-overlap', true],
      ['labels-text', false]
    ]);
  });

  test('symbols with one part follow that part rules, in their own sublayers', () => {
    // Row 0 has text and an icon, row 1 only text, row 2 only an icon.
    const layout = {
      'icon-image': ['get', 'icon'],
      'text-field': ['get', 'name'],
      'icon-allow-overlap': true,
      'text-allow-overlap': true,
      'text-optional': false
    };
    const rows = [{icon: 'dot', name: 'A'}, {name: 'B'}, {icon: 'dot', name: ''}];
    const layer = withRows(symbolLayer({...layout, 'icon-allow-overlap': false}), rows);
    // The text of row 1 is placed without waiting for an icon; row 0's waits for its icon.
    expect(describeSublayers(layer)).toEqual([
      ['labels-icons-default', true, 1, undefined],
      ['labels-text', true, 1, undefined],
      ['labels-text-alone-overlap', false, 1, undefined],
      ['labels-text-alone', true, 0, undefined]
    ]);
    const [, paired, alone] = layer.renderLayers();
    expect(groupRows(paired)).toEqual([true, false, true]);
    expect(groupRows(alone)).toEqual([false, true, false]);

    const icons = withRows(symbolLayer({...layout, 'text-allow-overlap': false}), rows);
    // The icon of row 2 is placed without waiting for text; row 0's waits for its text.
    expect(describeSublayers(icons)).toEqual([
      ['labels-icons-default', true, 1, undefined],
      ['labels-icons-default-alone-overlap', false, 1, undefined],
      ['labels-icons-default-alone', true, 0, undefined],
      ['labels-text', true, 1, undefined]
    ]);
    const [iconsPaired, iconsAlone] = icons.renderLayers();
    expect(iconRows(iconsPaired)).toEqual([true, false, false]);
    expect(iconRows(iconsAlone)).toEqual([false, false, true]);
  });

  test('symbols that all have both parts, or rules that do not depend on it, keep one sublayer per part', () => {
    const layout = {
      'icon-image': ['get', 'icon'],
      'text-field': ['get', 'name'],
      'text-allow-overlap': true
    };
    const both = withRows(symbolLayer(layout), [
      {icon: 'dot', name: 'A'},
      {icon: 'dot', name: 'B'}
    ]);
    expect(describeSublayers(both)).toEqual([
      ['labels-icons-default', true, 1, undefined],
      ['labels-text', true, 1, undefined]
    ]);
    // By default each part is tested with or without the other, so rows are not split.
    const defaults = withRows(symbolLayer({'icon-image': ['get', 'icon'], 'text-field': 'A'}), [
      {icon: 'dot'},
      {}
    ]);
    const getLabel = vi.spyOn(defaults, 'getLabel');
    expect(describeSublayers(defaults)).toEqual([
      ['labels-icons-default', true, 1, undefined],
      ['labels-text', true, 1, undefined]
    ]);
    // No per-row text evaluation for the icons beyond the text layer's own.
    expect(getLabel).not.toHaveBeenCalled();
  });

  test('while the sprites load, text is placed as if each symbol had its icon', () => {
    const layout = {'icon-image': 'dot', 'text-field': 'A', 'text-allow-overlap': true};
    // Loading: the text waits for the icon, as it will once the sprites arrive.
    expect(describeSublayers(symbolLayer(layout, 8, {spriteAtlases: null}))).toEqual([
      ['labels-text', true, 1, undefined]
    ]);
    // No sprites: the symbol has no icon, so its text follows only text-allow-overlap.
    expect(describeSublayers(symbolLayer(layout, 8, {spriteAtlases: []}))).toEqual([
      ['labels-text-overlap', false, 1, undefined],
      ['labels-text', true, 0, undefined]
    ]);
  });

  test('a style without sprites has no sprites to wait for', () => {
    const layer: any = new BasemapLayer({id: 'basemap', style: null} as any);
    layer.setState = vi.fn();
    layer.loadSprites({layers: []}, null, null, 1);
    expect(layer.setState).toHaveBeenCalledWith({spriteAtlases: []});
  });

  test('a change between split and unsplit groups refreshes every accessor', () => {
    const layout = {
      'icon-image': ['get', 'icon'],
      'text-field': ['get', 'name'],
      'text-allow-overlap': true
    };
    const rows = [{icon: 'dot', name: 'A'}, {name: 'B'}];
    const split = withRows(symbolLayer(layout), rows).renderLayers();
    const unsplit = withRows(symbolLayer(layout), [rows[0]]).renderLayers();
    const triggers = (layers: any[], id: string) =>
      layers.find(sublayer => sublayer.id === id).props.updateTriggers;
    // `all` differs, so deck.gl refreshes the rows the split layer masked out.
    expect(triggers(split, 'labels-text').all).not.toBeNull();
    expect(triggers(unsplit, 'labels-text')).toHaveProperty('all', null);
    // Icons: the sprite's priority accessor depends on which rows its sprite draws.
    expect(triggers(unsplit, 'labels-icons-default').getCollisionPriority).not.toEqual(
      triggers(
        withRows(symbolLayer({...layout, 'icon-image': 'dot'}), [rows[0]]).renderLayers(),
        'labels-icons-default'
      ).getCollisionPriority
    );
  });

  test('collision priorities refresh with collisionPriorityRange, icons with the sprite list', () => {
    const layout = {'icon-image': 'dot', 'text-field': 'A'};
    const render = (props: Record<string, unknown>) => symbolLayer(layout, 8, props).renderLayers();
    const triggers = (layers: any[], id: string) =>
      layers.find(sublayer => sublayer.id === id).props.updateTriggers;
    // The style's layer order moves a layer to another band; the tile data stays the same.
    const first = render({collisionPriorityRange: [-1000, 0]});
    const second = render({collisionPriorityRange: [0, 1000]});
    for (const id of ['labels-icons-default', 'labels-text']) {
      expect(triggers(first, id).getCollisionPriority).not.toEqual(
        triggers(second, id).getCollisionPriority
      );
    }
    // A sprite added beside the same atlas can take rows from it (`coalesce` over the sprites).
    const other = {...ATLAS, id: 'other'};
    expect(triggers(render({spriteAtlases: [ATLAS]}), 'labels-icons-default').all).not.toEqual(
      triggers(render({spriteAtlases: [ATLAS, other]}), 'labels-icons-default').all
    );
  });

  test('icon sublayer ids stay unique whatever the sprite ids', () => {
    const layout = {
      'icon-image': ['get', 'icon'],
      'text-field': ['get', 'name'],
      'icon-allow-overlap': true
    };
    // Sprite `default-alone` in the paired group, and sprite `default` in the alone group.
    const atlases = [ATLAS, {...ATLAS, id: 'default-alone'}, {...ATLAS, id: 'default-overlap'}];
    const rows = [
      {icon: 'dot', name: 'A'},
      {icon: 'default-alone:dot', name: 'B'},
      {icon: 'default-overlap:dot', name: 'C'},
      {icon: 'dot', name: ''}
    ];
    const layer = withRows(symbolLayer(layout, 8, {spriteAtlases: atlases}), rows);
    const ids = layer.renderLayers().map((sublayer: any) => sublayer.id);
    expect(ids).toContain('labels-icons-default-alone');
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('which rows have text is evaluated once per text update, not on every render', () => {
    const layout = {
      'icon-image': ['get', 'icon'],
      'text-field': ['get', 'name'],
      'text-allow-overlap': false,
      'icon-allow-overlap': true
    };
    const layer = withRows(symbolLayer(layout), [{icon: 'dot', name: 'A'}, {icon: 'dot'}]);
    layer.state.labelText = {key: ['', undefined], budget: {steps: 1e6}, labels: new WeakMap()};
    const getLabel = vi.spyOn(layer, 'getLabel');
    const first = layer.renderLayers().map((sublayer: any) => sublayer.id);
    expect(first).toContain('labels-icons-default-alone-overlap');
    expect(getLabel).toHaveBeenCalledTimes(2);
    getLabel.mockClear();
    expect(layer.renderLayers().map((sublayer: any) => sublayer.id)).toEqual(first);
    expect(getLabel).not.toHaveBeenCalled();
  });

  test('untested text keeps its anchor in the collision pass while the icon is tested', () => {
    const layout = {
      'icon-image': 'dot',
      'text-field': 'A',
      'text-allow-overlap': true,
      'text-ignore-placement': true,
      'icon-optional': true
    };
    expect(describeSublayers(symbolLayer(layout))).toEqual([
      ['labels-icons-default', true, 1, undefined],
      ['labels-text-overlap', false, 1, 0],
      ['labels-anchors', true, 0, undefined]
    ]);
  });
});

describe('MVTLabelLayer symbol row order', () => {
  /**
   * A layer over three points: A and B have an icon, C has none, and A's halo differs from the
   * others'. Text ignores placement, so its anchor is marked by the anchors sublayer.
   */
  function renderSymbols(): {layer: any; sublayers: any[]; features: any[]} {
    const features = [
      {name: 'A', icon: 'dot', halo: '#ff0000'},
      {name: 'B', icon: 'dot', halo: '#0000ff'},
      {name: 'C', halo: '#0000ff'}
    ].map((properties, index) => ({
      type: 'Feature',
      geometry: {type: 'Point', coordinates: [index, 0]},
      properties
    }));
    const layer: any = new MVTLabelLayer({
      id: 'labels',
      config: {labels: true},
      styleLayer: {
        layout: {
          'icon-image': ['get', 'icon'],
          'text-field': ['get', 'name'],
          'text-ignore-placement': true
        },
        paint: {'text-halo-color': ['get', 'halo'], 'text-halo-width': 1}
      },
      zoom: 8,
      spriteAtlases: [ATLAS],
      data: features
    } as any);
    layer.context = {} as any;
    layer.internalState = {subLayers: []} as any;
    layer.state = {};
    layer.setState = (partial: Record<string, unknown>) => Object.assign(layer.state, partial);
    layer.updateState({changeFlags: {dataChanged: true}} as any);
    return {layer, sublayers: layer.renderLayers(), features};
  }

  test('icons, texts, halos and anchor marks hold the same rows, so a symbol has one row index', () => {
    const {layer, sublayers} = renderSymbols();
    const ids = sublayers.map((sublayer: any) => sublayer.id);
    expect(ids).toEqual([
      'labels-icons-default',
      'labels-text',
      'labels-text-1',
      'labels-text-2',
      'labels-anchors'
    ]);
    for (const sublayer of sublayers) {
      expect(sublayer.props.data, sublayer.id).toBe(layer.getRows());
    }
  });

  test('at each row index, every sublayer draws the same feature', () => {
    const {layer, sublayers, features} = renderSymbols();
    const rows = layer.getRows();
    const [icons, , ...rest] = sublayers;
    const halos = rest.filter((sublayer: any) => sublayer.id !== 'labels-anchors');
    rows.forEach((row: any, index: number) => {
      const info = {index, data: rows, target: []};
      const properties = row.__source.object.properties;
      expect(features.map(f => f.properties)).toContain(properties);
      // The icon drawn at this index is this row's own.
      expect(icons.props.getIcon(row, info), properties.name).toBe(properties.icon ?? null);
      // Exactly one halo sublayer draws this row's text.
      const texts = halos
        .map((halo: any) => halo.props.getText(row, info))
        .filter((text: unknown) => text !== undefined);
      expect(texts, properties.name).toEqual([properties.name]);
    });
    // Of labels with equal priority, the first one wins: the rows are held in reverse.
    expect(rows.map((row: any) => row.__source.object.properties.name)).toEqual(['C', 'B', 'A']);
  });
});

import {describe, expect, test} from 'vitest';
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
    expect(describeSublayers(layer)).toEqual([
      ['labels-icons-default', true, 1, 0],
      ['labels-text', true, 1, 0]
    ]);
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
      ['labels-text', true, 0, 0]
    ]);
  });
});

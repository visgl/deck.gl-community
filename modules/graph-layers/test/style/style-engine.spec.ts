// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, it, expect, expectTypeOf} from 'vitest';

import {StyleEngine, type DeckGLAccessorMap, type DeckGLUpdateTriggers} from '../../src/style/style-engine';
import {GraphStyleEngine, type GraphStylesheet} from '../../src/style/graph-style-engine';

const TEST_ACCESSOR_MAP: DeckGLAccessorMap = {
  Foo: {
    getColor: 'color',
    getWidth: 'width'
  }
};

const TEST_UPDATE_TRIGGERS: DeckGLUpdateTriggers = {
  Foo: ['getColor', 'getWidth']
};

describe('StyleEngine', () => {
  it('normalizes static and stateful values into Deck.gl accessors', () => {
    const stylesheet = new StyleEngine(
      {
        type: 'Foo',
        color: '#ffffff',
        width: {
          default: 1,
          hover: 2
        }
      },
      {
        deckglAccessorMap: TEST_ACCESSOR_MAP,
        deckglUpdateTriggers: TEST_UPDATE_TRIGGERS,
        stateUpdateTrigger: 'latest-interaction'
      }
    );

    const getColor = stylesheet.getDeckGLAccessor('getColor');
    const getWidth = stylesheet.getDeckGLAccessor('getWidth');

    expect(getColor({state: 'default'})).toEqual([255, 255, 255]);
    expect(getWidth({state: 'default'})).toBe(1);
    expect(getWidth({state: 'hover'})).toBe(2);

    const triggers = stylesheet.getDeckGLUpdateTriggers();
    expect(triggers.getColor).toBe(false);
    expect(triggers.getWidth).toBe('latest-interaction');
  });

  it('throws when instantiated with an unknown style type', () => {
    expect(
      () =>
        new StyleEngine(
          {type: 'Bar'},
          {
            deckglAccessorMap: TEST_ACCESSOR_MAP
          }
        )
    ).toThrow(/illegal type/i);
  });

  it('accepts graph stylesheet definitions with state selectors', () => {
    const circleStylesheet: GraphStylesheet<'circle'> = {
      type: 'circle',
      fill: '#ffffff',
      ':hover': {
        fill: '#000000',
        stroke: '#64748B'
      }
    };

    expectTypeOf(circleStylesheet).toMatchTypeOf<GraphStylesheet<'circle'>>();

    const graphEngine = new GraphStyleEngine(circleStylesheet);
    const accessors = graphEngine.getDeckGLAccessors();

    expect(accessors.getFillColor({state: 'default'})).toEqual([255, 255, 255]);
    expect(accessors.getFillColor({state: 'hover'})).toEqual([0, 0, 0]);
  });
});

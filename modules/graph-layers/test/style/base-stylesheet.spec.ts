// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, it, expect} from 'vitest';

import {
  BaseStylesheet,
  type DeckGLAccessorMap,
  type DeckGLUpdateTriggers
} from '../../src/style/style-sheet';

const TEST_ACCESSOR_MAP: DeckGLAccessorMap = {
  Foo: {
    getColor: 'color',
    getWidth: 'width'
  }
};

const TEST_UPDATE_TRIGGERS: DeckGLUpdateTriggers = {
  Foo: ['getColor', 'getWidth']
};

describe('BaseStylesheet', () => {
  it('normalizes static and stateful values into Deck.gl accessors', () => {
    const stylesheet = new BaseStylesheet(
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
        new BaseStylesheet(
          {type: 'Bar'},
          {
            deckglAccessorMap: TEST_ACCESSOR_MAP
          }
        )
    ).toThrow(/illegal type/i);
  });
});

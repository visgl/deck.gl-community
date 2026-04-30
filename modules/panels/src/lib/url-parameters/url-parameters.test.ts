import {describe, expect, it} from 'vitest';

import {URLManager} from './url-manager';
import {
  getRecognizedUrlParameterKeys,
  parseUrlParametersIntoState,
  serializeUrlParameters,
  serializeUrlSearchParams
} from './url-parameters';

import type {URLParameter} from './url-parameters';

type TestState = {
  id?: string;
  tags?: string[];
  flag?: boolean;
};

const parameters: URLParameter<TestState>[] = [
  {
    name: 'id',
    description: 'Selected id.',
    legacyNames: ['selectedId'],
    serialize: state => state.id,
    deserialize: (value, state) => {
      state.id = Array.isArray(value) ? value[0] : (value ?? undefined);
    }
  },
  {
    name: 'tags',
    description: 'Selected tags.',
    serialize: state => state.tags,
    deserialize: (value, state) => {
      state.tags = Array.isArray(value) ? [...value] : value ? [value] : [];
    }
  },
  {
    name: 'flag',
    description: 'Boolean flag.',
    serialize: state => (state.flag ? '' : undefined),
    deserialize: (_value, state) => {
      state.flag = true;
    }
  }
];

describe('URL parameter helpers', () => {
  it('returns canonical and legacy keys without duplicates', () => {
    expect(getRecognizedUrlParameterKeys(parameters)).toEqual(['id', 'selectedId', 'tags', 'flag']);
  });

  it('parses canonical values before legacy aliases and repeated values as arrays', () => {
    const state: TestState = {};
    const parsedKeys: string[] = [];

    const parsed = parseUrlParametersIntoState(
      state,
      parameters,
      '?selectedId=legacy&id=current&tags=a&tags=b&flag',
      {
        onParsedParameter: (_name, _value, usedKey) => {
          parsedKeys.push(usedKey);
        }
      }
    );

    expect(state).toEqual({id: 'current', tags: ['a', 'b'], flag: true});
    expect(parsed).toEqual({id: 'current', tags: ['a', 'b'], flag: ''});
    expect(parsedKeys).toEqual(['id', 'tags', 'flag']);
  });

  it('serializes state into canonical parameters', () => {
    expect(serializeUrlParameters({id: 'x', tags: ['a', 'b'], flag: true}, parameters)).toEqual({
      id: 'x',
      tags: ['a', 'b'],
      flag: ''
    });
  });

  it('serializes bare query keys without trailing equals signs', () => {
    const params = new URLSearchParams();
    params.set('flag', '');
    params.set('id', 'x');

    expect(serializeUrlSearchParams(params)).toBe('flag&id=x');
  });
});

describe('URLManager', () => {
  it('wraps parse and serialize workflows', () => {
    const manager = new URLManager(parameters);
    const state: TestState = {};

    manager.parseIntoState(state, {selectedId: 'legacy', tags: ['a', 'b']});

    expect(state).toEqual({id: 'legacy', tags: ['a', 'b']});
    expect(manager.serialize({id: 'current', tags: ['c']})).toEqual({
      id: 'current',
      tags: ['c']
    });
  });

  it('creates search params while optionally preserving unknown base params', () => {
    const manager = new URLManager(parameters);

    expect(
      manager.serializeSearchParams(
        {id: 'current', tags: ['a', 'b']},
        {baseParams: '?selectedId=old&unrelated=keep', preserveUnknownParams: true}
      )
    ).toBe('unrelated=keep&id=current&tags=a&tags=b');

    expect(
      manager.serializeSearchParams(
        {id: 'current'},
        {baseParams: '?selectedId=old&unrelated=drop', preserveUnknownParams: false}
      )
    ).toBe('id=current');
  });
});

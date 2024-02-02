import {describe, it, expect} from 'vitest';
import {add} from '@deck.gl-community/template';

describe('add', () => {
  it('adds', () => {
    expect(add(1, 2)).toBe(3);
  });
});

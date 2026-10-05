import {describe, it, expect} from 'vitest';
import {TreeLayer as LegacyImport} from '../src';
import {TreeLayer} from '../../layers/src';
describe('legacy TreeLayer import', () => {
  it('re-exports the exact native constructor', () => {
    expect(LegacyImport).toBe(TreeLayer);
  });
});

import {describe, it, expect} from 'vitest';
import {TileSourceLayer, DataDrivenTile3DLayer, colorizeTile, filterTile} from '../src';

describe('exports', () => {
  it('exports TileSourceLayer', () => {
    expect(TileSourceLayer).toBeTruthy();
  });

  it('exports DataDrivenTile3DLayer', () => {
    expect(DataDrivenTile3DLayer).toBeTruthy();
  });

  it('exports colorizeTile', () => {
    expect(colorizeTile).toBeTruthy();
  });

  it('exports filterTile', () => {
    expect(filterTile).toBeTruthy();
  });
});

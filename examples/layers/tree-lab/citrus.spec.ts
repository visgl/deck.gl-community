import {describe, it, expect} from 'vitest';
import {getCitrusCrop, CITRUS_PRESETS} from './citrus';
import {getCrop, SPECIES, DEFAULT_OPTIONS} from './scene';

describe('Species and crop relationships', () => {
  it('uses cones, acorns, catkins, figs, coconuts and propagules instead of generic red fruit', () => {
    const expected = {
      pine: 'cone',
      oak: 'acorn',
      palm: 'fruit',
      birch: 'catkin',
      cherry: 'fruit',
      banyan: 'fruit',
      mangrove: 'propagule',
      citrus: 'fruit'
    };
    for (const species of SPECIES)
      expect(getCrop(species, DEFAULT_OPTIONS)?.kind).toBe(expected[species]);
    expect(getCrop('banyan', DEFAULT_OPTIONS)!.radius).toBeLessThan(
      getCrop('palm', DEFAULT_OPTIONS)!.radius
    );
    expect(getCrop('cherry', {...DEFAULT_OPTIONS, season: 'spring'})!.kind).toBe('flower');
    expect(getCrop('cherry', {...DEFAULT_OPTIONS, season: 'spring'})!.droppedCount).toBe(0);
    for (const species of ['oak', 'birch', 'cherry'] as const)
      expect(getCrop(species, {...DEFAULT_OPTIONS, season: 'winter'})!.count).toBe(0);
    expect(getCrop('citrus', {...DEFAULT_OPTIONS, season: 'winter'})!.count).toBe(32);
  });
  it('keeps citrus variety, bloom and fruit maturity independent from foliage season', () => {
    expect(getCitrusCrop(CITRUS_PRESETS.patio)!.kind).toBe('lemon');
    expect(getCitrusCrop({...CITRUS_PRESETS.orchard, stage: 'bloom'})!.kind).toBe('flower');
    expect(getCitrusCrop({...CITRUS_PRESETS.orchard, stage: 'none'})).toBeNull();
    const green = getCitrusCrop({...CITRUS_PRESETS.orchard, stage: 'green'})!;
    const ripe = getCitrusCrop(CITRUS_PRESETS.orchard)!;
    expect(green.color).not.toEqual(ripe.color);
    expect(green.radius).toBeLessThan(ripe.radius);
  });
});

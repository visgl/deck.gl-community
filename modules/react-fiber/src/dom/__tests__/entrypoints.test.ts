import {describe, expect, it} from 'vitest';
import * as dom from '../index';
import * as mapbox from '../mapbox';
import * as maplibre from '../maplibre';
import packageJson from '../../../package.json';

describe('native entrypoint export matrix', () => {
  it('exports standalone APIs from the package root entrypoint', () => {
    // package.json maps `.` to this module.
    expect(Object.keys(dom).sort()).toEqual(['DeckCanvas', 'DeckGL', 'createDeckGL']);
    expect(dom).not.toHaveProperty('Deckgl');
  });

  it('exports provider-bound roots without adding them to the default module', () => {
    expect(Object.keys(mapbox).sort()).toEqual(['DeckGL']);
    expect(Object.keys(maplibre).sort()).toEqual(['DeckGL']);
    expect(mapbox.DeckGL).not.toBe(dom.DeckGL);
    expect(maplibre.DeckGL).not.toBe(dom.DeckGL);
  });

  it('publishes only the public entry points and requires only deck.gl core and React', () => {
    expect(Object.keys(packageJson.exports)).toEqual([
      '.',
      './mapbox',
      './maplibre',
      './compat',
      './compat/mapbox',
      './compat/maplibre',
      './compat/layers',
      './compat/geo-layers',
      './compat/aggregation-layers',
      './compat/mesh-layers',
      './reconciler',
      './package.json'
    ]);

    const optionalPeers = Object.keys(packageJson.peerDependenciesMeta);
    const requiredPeers = Object.keys(packageJson.peerDependencies).filter(
      name => !optionalPeers.includes(name)
    );
    expect(requiredPeers).toEqual(['@deck.gl/core', 'react', 'react-dom']);
  });
});

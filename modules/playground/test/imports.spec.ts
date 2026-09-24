import {describe, expect, it} from 'vitest';

import * as Playground from '../src/index';

describe('@deck.gl-community/playground', () => {
  it('exports the standalone playground and panel primitives', () => {
    expect(Playground.Playground).toBeDefined();
    expect(Playground.PanelManager).toBeDefined();
    expect(Playground.TextEditorPanel).toBeDefined();
  });

  it('exports GeoJSON schemas and inferred type runtime values', () => {
    expect(Playground.GeoJSONSchema.safeParse({type: 'Point', coordinates: [0, 1]}).success).toBe(
      true
    );
    expect(
      Playground.FeatureCollectionSchema.safeParse({type: 'FeatureCollection', features: []})
        .success
    ).toBe(true);
  });
});

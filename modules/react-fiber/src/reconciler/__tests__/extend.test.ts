import {ScatterplotLayer} from '@deck.gl/layers';
import {beforeEach, describe, expect, it} from 'vitest';

import {catalogue, extend} from '../extend';

describe('extend module', () => {
  beforeEach(() => {
    // Clear catalogue before each test
    for (const key of Object.keys(catalogue)) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete catalogue[key];
    }
  });

  describe('extend()', () => {
    it('should add objects to catalogue', () => {
      const customLayer = {CustomLayer: ScatterplotLayer as never};
      extend(customLayer);

      expect(catalogue).toHaveProperty('CustomLayer');
      expect(catalogue.CustomLayer).toBe(ScatterplotLayer);
    });

    it('should merge with existing catalogue', () => {
      const layer1 = {Layer1: ScatterplotLayer as never};
      const layer2 = {Layer2: ScatterplotLayer as never};

      extend(layer1);
      extend(layer2);

      expect(catalogue).toHaveProperty('Layer1');
      expect(catalogue).toHaveProperty('Layer2');
    });

    it('should overwrite existing keys', () => {
      const originalLayer = {CustomLayer: ScatterplotLayer as never};
      const newLayer = {CustomLayer: ScatterplotLayer as never};

      extend(originalLayer);
      extend(newLayer);

      expect(catalogue.CustomLayer).toBe(ScatterplotLayer);
    });
  });

  describe('catalogue object', () => {
    it('should be initially empty', () => {
      expect(Object.keys(catalogue)).toHaveLength(0);
    });

    it('should be populated by extend()', () => {
      expect(Object.keys(catalogue)).toHaveLength(0);

      extend({TestLayer: ScatterplotLayer as never});

      expect(Object.keys(catalogue)).toHaveLength(1);
      expect(catalogue.TestLayer).toBe(ScatterplotLayer);
    });
  });
});

import {MapView} from '@deck.gl/core';
import {ScatterplotLayer} from '@deck.gl/layers';
import {describe, expect, it} from 'vitest';

import {
  getChildHostContext,
  getPublicInstance,
  getRootHostContext,
  shouldSetTextContent
} from '../config';
import type {Container} from '../types';
import {createMockHostContext, createMockInstance} from './test-utils';

describe('config-host-context', () => {
  describe('getRootHostContext()', () => {
    it('should return rootContainer as context', () => {
      // Arrange
      const rootContainer = {
        store: {} as never
      } as Container;

      // Act
      const result = getRootHostContext(rootContainer);

      // Assert
      expect(result).toBe(rootContainer);
    });

    it('should provide context that contains store', () => {
      // Arrange
      const mockStore = {} as never;
      const rootContainer = {
        store: mockStore
      } as Container;

      // Act
      const result = getRootHostContext(rootContainer);

      // Assert
      expect(result).toHaveProperty('store');
      expect(result.store).toBe(mockStore);
    });
  });

  describe('getChildHostContext()', () => {
    it('should set insideView=true for View elements', () => {
      // Arrange
      const parentContext = createMockHostContext({insideView: false});
      const type = 'mapView';

      // Act
      const result = getChildHostContext(parentContext, type);

      // Assert
      expect(result.insideView).toBeTruthy();
    });

    it('should preserve insideView=true in nested Views', () => {
      // Arrange
      const parentContext = createMockHostContext({insideView: true});
      const type = 'mapView';

      // Act
      const result = getChildHostContext(parentContext, type);

      // Assert
      expect(result.insideView).toBeTruthy();
    });

    it('should return parent context for non-View elements', () => {
      // Arrange
      const parentContext = createMockHostContext({insideView: false});
      const type = 'layer';

      // Act
      const result = getChildHostContext(parentContext, type);

      // Assert
      expect(result).toBe(parentContext);
    });

    it('should avoid allocation when insideView already true', () => {
      // Arrange
      const parentContext = createMockHostContext({insideView: true});
      const type = 'layer'; // Non-view type

      // Act
      const result = getChildHostContext(parentContext, type);

      // Assert
      expect(result).toBe(parentContext);
    });

    it('should detect View by case-insensitive regex', () => {
      // Arrange
      const parentContext = createMockHostContext({insideView: false});

      // Act & Assert
      expect(getChildHostContext(parentContext, 'mapView').insideView).toBeTruthy();
      expect(getChildHostContext(parentContext, 'MapView').insideView).toBeTruthy();
      expect(getChildHostContext(parentContext, 'MAPVIEW').insideView).toBeTruthy();
      expect(getChildHostContext(parentContext, 'view').insideView).toBeTruthy();
    });

    it('should not detect View in layer elements', () => {
      // Arrange
      const parentContext = createMockHostContext({insideView: false});

      // Act & Assert
      expect(getChildHostContext(parentContext, 'layer').insideView).toBeFalsy();
      expect(getChildHostContext(parentContext, 'scatterplotLayer').insideView).toBeFalsy();
    });

    it('should create new context object when setting insideView', () => {
      // Arrange
      const parentContext = createMockHostContext({insideView: false});
      const type = 'mapView';

      // Act
      const result = getChildHostContext(parentContext, type);

      // Assert
      expect(result).not.toBe(parentContext);
      expect(result.store).toBe(parentContext.store);
    });
  });

  describe('getPublicInstance()', () => {
    it('should return instance.node for Layer', () => {
      // Arrange
      const layer = new ScatterplotLayer({data: [], id: 'test'});
      const instance = createMockInstance(layer);

      // Act
      const result = getPublicInstance(instance);

      // Assert
      expect(result).toBe(layer);
    });

    it('should return instance.node for View', () => {
      // Arrange
      const view = new MapView({id: 'test'});
      const instance = createMockInstance(view);

      // Act
      const result = getPublicInstance(instance);

      // Assert
      expect(result).toBe(view);
    });
  });

  describe('shouldSetTextContent()', () => {
    it('should always return false', () => {
      // Act & Assert
      expect(shouldSetTextContent('layer', {})).toBeFalsy();
      expect(shouldSetTextContent('view', {})).toBeFalsy();
      expect(shouldSetTextContent('scatterplotLayer', {})).toBeFalsy();
    });
  });
});

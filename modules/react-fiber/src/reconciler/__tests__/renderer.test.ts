import {ScatterplotLayer} from '@deck.gl/layers';
import * as fc from 'fast-check';
import React from 'react';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {createRoot, roots, unmountAtNode} from '../renderer';
import type {RootElement} from '../types';
import {createTestRoot} from './test-renderer';

/**
 * Creates a lightweight RootElement for testing renderer API
 * Use createTestRoot() when you need full deck.gl integration
 */
function createTestRootElement(): RootElement {
  return {} as RootElement;
}

describe('renderer', () => {
  afterEach(() => {
    // Clean up all roots after each test to prevent worker teardown issues
    const allRoots = [...roots.keys()];
    for (const node of allRoots) {
      try {
        unmountAtNode(node);
      } catch {
        // Ignore errors during cleanup
      }
    }
  });

  describe('createRoot()', () => {
    it('calling createRoot twice on same node returns same root', () => {
      // Arrange
      const node = createTestRootElement();

      // Act
      const root1 = createRoot(node);
      const root2 = createRoot(node);

      // Assert
      expect(root2).toBe(root1);
    });

    it('root reuse preserves store and container', () => {
      // Arrange
      const node = createTestRootElement();

      // Act
      const root1 = createRoot(node);
      const root2 = createRoot(node);

      // Assert
      expect(root2.store).toBe(root1.store);
      expect(root2.container).toBe(root1.container);
    });

    it('different nodes get different roots', () => {
      // Arrange
      const node1 = createTestRootElement();
      const node2 = createTestRootElement();

      // Act
      const root1 = createRoot(node1);
      const root2 = createRoot(node2);

      // Assert
      expect(root2).not.toBe(root1);
      expect(root2.container).not.toBe(root1.container);
    });
  });

  describe('configure', () => {
    it('should set _passedLayers when layers prop is provided', () => {
      // Arrange
      const {root} = createTestRoot();
      const passedLayers = [
        new ScatterplotLayer({data: [], id: 'passed-1'}),
        new ScatterplotLayer({data: [], id: 'passed-2'})
      ];

      // Act
      root.configure({
        layers: passedLayers
      });

      // Assert
      const state = root.store.getState();
      expect(state._passedLayers).toStrictEqual(passedLayers);
    });

    it('should not reconfigure when called multiple times', () => {
      // Arrange
      const {root} = createTestRoot();

      // Act
      root.configure({});
      const firstDeckgl = root.store.getState().deckgl;

      root.configure({});
      const secondDeckgl = root.store.getState().deckgl;

      // Assert
      expect(secondDeckgl).toBe(firstDeckgl);
    });

    it('should update _passedLayers even when already configured', () => {
      // Arrange
      const {root} = createTestRoot();
      const newLayers = [new ScatterplotLayer({data: [], id: 'new-layer'})];

      // Act
      root.configure({
        layers: newLayers
      });

      // Assert
      const state = root.store.getState();
      expect(state._passedLayers).toStrictEqual(newLayers);
    });

    it('should create MapboxOverlay when interleaved prop is present', () => {
      // Arrange
      const node = createTestRootElement();
      const root = createRoot(node);

      // Act
      root.configure({
        interleaved: true
      });

      // Assert
      const state = root.store.getState();
      expect(state.deckgl).not.toBeNull();
      expect(state.deckgl).toBeTypeOf('object');
      expect(state.deckgl).toHaveProperty('setProps');
      expect(state.deckgl).toHaveProperty('finalize');
    });
  });

  describe('unmountAtNode()', () => {
    it('should finalize deckgl and remove root from map', () => {
      // Arrange
      const {root, deck} = createTestRoot();
      const rootElement = [...roots.keys()].find(k => roots.get(k) === root);
      if (!rootElement) {
        throw new Error('Root element not found');
      }

      expect(roots.has(rootElement)).toBeTruthy();

      // Act
      unmountAtNode(rootElement);

      // Assert
      expect(deck.finalize).toHaveBeenCalledOnce();
      expect(roots.has(rootElement)).toBeFalsy();
      expect(root.store.getState().deckgl).toBeUndefined();
    });

    it('should handle unmounting non-existent node gracefully', () => {
      // Arrange
      const node = createTestRootElement();

      // Act & Assert
      expect(() => unmountAtNode(node)).not.toThrow();
      expect(roots.has(node)).toBeFalsy();
    });
  });

  describe('render', () => {
    it('should update container with provided children', () => {
      // Arrange
      const {root} = createTestRoot();
      const children = React.createElement('div', null, 'test content');

      // Act & Assert
      expect(() => root.render(children)).not.toThrow();
    });
  });

  describe('property: createRoot idempotency', () => {
    it('property: returns same root for same node regardless of call count', () => {
      fc.assert(
        fc.property(fc.integer({max: 10, min: 2}), callCount => {
          // Arrange
          const node = createTestRootElement();

          // Act
          const allRoots = Array.from({length: callCount}, () => createRoot(node));

          // Assert
          const [firstRoot] = allRoots;
          if (firstRoot === undefined) {
            throw new Error('Expected at least one root');
          }
          return (
            allRoots.every(root => root === firstRoot) &&
            allRoots.every(root => root.store === firstRoot.store) &&
            allRoots.every(root => root.container === firstRoot.container)
          );
        })
      );
    });
  });

  describe('edge cases', () => {
    it('should handle render before configure gracefully', () => {
      // Arrange
      const node = createTestRootElement();
      const root = createRoot(node);
      const children = React.createElement('div', null, 'test');

      // Act & Assert
      expect(() => root.render(children)).not.toThrow();
    });

    it('should complete cleanup even when finalize throws', () => {
      // Arrange
      const {root, deck} = createTestRoot();
      const rootElement = [...roots.keys()].find(k => roots.get(k) === root);
      if (!rootElement) {
        throw new Error('Root element not found');
      }

      // Make finalize throw
      deck.finalize.mockImplementation(() => {
        throw new Error('Finalize failed');
      });

      // Suppress console errors during this test to avoid worker teardown issues
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        // Act & Assert
        // Error propagates to caller
        expect(() => unmountAtNode(rootElement)).toThrow('Finalize failed');

        // But cleanup still completes (try-finally ensures this)
        // Root IS removed even when finalize throws
        expect(roots.has(rootElement)).toBeFalsy();
      } finally {
        consoleErrorSpy.mockRestore();
      }
    });
  });
});

import {PolygonLayer, ScatterplotLayer} from '@deck.gl/layers';
import * as fc from 'fast-check';
import React from 'react';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {PolygonLayer as CompatPolygonLayer} from '../../compat/layers';
import {createRoot, roots, unmountAtNode} from '../renderer';
import type {ReconcilerRoot, RootElement} from '../types';
import {createTestRoot} from './test-renderer';

/**
 * Creates a lightweight RootElement for testing renderer API
 * Use createTestRoot() when you need full deck.gl integration
 */
function createTestRootElement(): RootElement {
  return {} as RootElement;
}

function getRootElement(root: ReconcilerRoot): RootElement {
  const entry = [...roots.entries()].find(([, candidate]) => candidate === root);
  if (!entry) {
    throw new Error('Root element not found');
  }
  return entry[0];
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

    it('different nodes get isolated stores', () => {
      const node1 = createTestRootElement();
      const node2 = createTestRootElement();

      const root1 = createRoot(node1);
      const root2 = createRoot(node2);

      root1.store.setState({_passedLayers: [new ScatterplotLayer({id: 'one', data: []})]});

      expect(root1.store).not.toBe(root2.store);
      expect(root2.store.getState()._passedLayers).toStrictEqual([]);
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

    it('should forward updated props after initial configuration', () => {
      const {root, deck} = createTestRoot();
      const layers = [new ScatterplotLayer({data: [], id: 'updated-layer'})];

      root.configure({layers});

      expect(deck.setProps).toHaveBeenCalledWith({layers});
    });

    it('should forward replacement controlled view state and callback', () => {
      const {root, deck} = createTestRoot();
      const firstViewState = {latitude: 0, longitude: 0, zoom: 1};
      const secondViewState = {latitude: 10, longitude: 10, zoom: 2};
      const firstHandler = vi.fn();
      const secondHandler = vi.fn();

      root.configure({viewState: firstViewState, onViewStateChange: firstHandler});
      root.configure({viewState: secondViewState, onViewStateChange: secondHandler});

      expect(deck.setProps).toHaveBeenLastCalledWith({
        viewState: secondViewState,
        onViewStateChange: secondHandler
      });
    });

    it('should clear passed layers when the prop is removed', () => {
      const {root} = createTestRoot();
      const layers = [new ScatterplotLayer({data: [], id: 'stale-layer'})];

      root.configure({layers});
      root.configure({});

      expect(root.store.getState()._passedLayers).toStrictEqual([]);
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
      expect(root.store.getState().deckgl).toBeNull();
    });

    it('does not finalize another root’s deckgl instance', () => {
      const first = createTestRoot();
      const second = createTestRoot();
      const firstNode = getRootElement(first.root);
      const secondNode = getRootElement(second.root);

      unmountAtNode(firstNode);

      expect(first.deck.finalize).toHaveBeenCalledOnce();
      expect(second.deck.finalize).not.toHaveBeenCalled();
      expect(roots.has(firstNode)).toBe(false);
      expect(roots.get(secondNode)).toBe(second.root);
      expect(second.root.store.getState().deckgl).toBe(second.deck);
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

    it('keeps committed layers and cleanup isolated between two roots', async () => {
      const first = createTestRoot();
      const second = createTestRoot();
      const firstNode = getRootElement(first.root);
      const secondNode = getRootElement(second.root);
      const firstLayer = new ScatterplotLayer({data: [], id: 'first-layer'});
      const secondLayer = new ScatterplotLayer({data: [], id: 'second-layer'});

      await React.act(async () => {
        first.root.render(React.createElement('layer', {layer: firstLayer}));
        second.root.render(React.createElement('layer', {layer: secondLayer}));
        await Promise.all([first.flush(), second.flush()]);
      });

      expect(first.root).not.toBe(second.root);
      expect(first.root.store).not.toBe(second.root.store);
      expect(first.deck).not.toBe(second.deck);
      expect(first.deck.getLayerIds()).toStrictEqual(['first-layer']);
      expect(second.deck.getLayerIds()).toStrictEqual(['second-layer']);

      const updatedFirstLayer = new ScatterplotLayer({data: [], id: 'updated-first-layer'});
      await React.act(async () => {
        first.root.render(React.createElement('layer', {layer: updatedFirstLayer}));
        await first.flush();
      });

      expect(first.deck.getLayerIds()).toStrictEqual(['updated-first-layer']);
      expect(second.deck.getLayerIds()).toStrictEqual(['second-layer']);

      unmountAtNode(firstNode);

      expect(first.deck.finalize).toHaveBeenCalledOnce();
      expect(first.root.store.getState().deckgl).toBeNull();
      expect(roots.has(firstNode)).toBe(false);
      expect(roots.get(secondNode)).toBe(second.root);
      expect(second.root.store.getState().deckgl).toBe(second.deck);
      expect(second.deck.getLayerIds()).toStrictEqual(['second-layer']);

      const additionalSecondLayer = new ScatterplotLayer({data: [], id: 'additional-second-layer'});
      await React.act(async () => {
        second.root.render(
          React.createElement(
            React.Fragment,
            null,
            React.createElement('layer', {layer: secondLayer}),
            React.createElement('layer', {layer: additionalSecondLayer})
          )
        );
        await second.flush();
      });

      expect(second.deck.getLayerIds()).toStrictEqual(['second-layer', 'additional-second-layer']);

      unmountAtNode(secondNode);
      expect(second.deck.finalize).toHaveBeenCalledOnce();
    });

    it('renders native layer primitives and compat layer wrappers together', async () => {
      const {deck, flush, root} = createTestRoot();
      const nativePoints = new ScatterplotLayer({data: [], id: 'native-points'});

      await React.act(async () => {
        root.render(
          React.createElement(
            React.Fragment,
            null,
            React.createElement('layer', {layer: nativePoints}),
            React.createElement(CompatPolygonLayer, {data: [], id: 'compat-polygons'})
          )
        );
        await flush();
      });

      expect(deck.getLayerIds()).toStrictEqual(['native-points', 'compat-polygons']);
      expect(deck.layers[0]).toBe(nativePoints);
      expect(deck.layers[1]).toBeInstanceOf(PolygonLayer);
      expect(deck.layers[1]?.id).toBe('compat-polygons');
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

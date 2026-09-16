import {MapView} from '@deck.gl/core';
import {ScatterplotLayer} from '@deck.gl/layers';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {
  appendChildToContainerChildSet,
  appendChildToSet,
  appendInitialChild,
  createContainerChildSet,
  finalizeContainerChildren,
  finalizeInitialChildren,
  replaceContainerChildren
} from '../config';
import type {ChildSet, Container, Instance} from '../types';
import {flattenTree, organizeList} from '../utils';
import {createMockInstance, setupConsoleSpy} from './test-utils';

describe('config-tree-operations', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.NODE_ENV;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.NODE_ENV = originalEnv;
    }
    vi.restoreAllMocks();
  });

  describe('createContainerChildSet()', () => {
    it('should return empty array', () => {
      // Act
      const result = createContainerChildSet();

      // Assert
      expect(result).toStrictEqual([]);
      expect(Array.isArray(result)).toBeTruthy();
    });
  });

  describe('appendChildToContainerChildSet()', () => {
    it('should mutate childSet by pushing child', () => {
      // Arrange
      const childSet: ChildSet = [];
      const layer = new ScatterplotLayer({data: [], id: 'child'});
      const child = createMockInstance(layer);

      // Act
      appendChildToContainerChildSet(childSet, child);

      // Assert
      expect(childSet).toHaveLength(1);
      expect(childSet[0]).toBe(child);
    });

    it('should handle multiple appends', () => {
      // Arrange
      const childSet: ChildSet = [];
      const layer1 = new ScatterplotLayer({data: [], id: 'child1'});
      const layer2 = new ScatterplotLayer({data: [], id: 'child2'});
      const child1 = createMockInstance(layer1);
      const child2 = createMockInstance(layer2);

      // Act
      appendChildToContainerChildSet(childSet, child1);
      appendChildToContainerChildSet(childSet, child2);

      // Assert
      expect(childSet).toHaveLength(2);
      expect(childSet[0]).toBe(child1);
      expect(childSet[1]).toBe(child2);
    });
  });

  describe('appendChildToSet()', () => {
    it('should return new array (immutable)', () => {
      // Arrange
      const layer1 = new ScatterplotLayer({data: [], id: 'existing'});
      const layer2 = new ScatterplotLayer({data: [], id: 'new'});
      const existingChild = createMockInstance(layer1);
      const newChild = createMockInstance(layer2);
      const childSet: ChildSet = [existingChild];

      // Act
      const result = appendChildToSet(childSet, newChild);

      // Assert
      expect(result).not.toBe(childSet);
      expect(result).toStrictEqual([existingChild, newChild]);
    });

    it('should not modify original array', () => {
      // Arrange
      const layer1 = new ScatterplotLayer({data: [], id: 'existing'});
      const layer2 = new ScatterplotLayer({data: [], id: 'new'});
      const existingChild = createMockInstance(layer1);
      const newChild = createMockInstance(layer2);
      const childSet: ChildSet = [existingChild];

      // Act
      appendChildToSet(childSet, newChild);

      // Assert
      expect(childSet).toHaveLength(1);
      expect(childSet[0]).toBe(existingChild);
    });

    it('should contain all old items plus new child', () => {
      // Arrange
      const layer1 = new ScatterplotLayer({data: [], id: 'child1'});
      const layer2 = new ScatterplotLayer({data: [], id: 'child2'});
      const layer3 = new ScatterplotLayer({data: [], id: 'child3'});
      const child1 = createMockInstance(layer1);
      const child2 = createMockInstance(layer2);
      const child3 = createMockInstance(layer3);
      const childSet: ChildSet = [child1, child2];

      // Act
      const result = appendChildToSet(childSet, child3);

      // Assert
      expect(result).toHaveLength(3);
      expect(result).toStrictEqual([child1, child2, child3]);
    });
  });

  describe('appendInitialChild()', () => {
    it('should push child to parent.children array', () => {
      // Arrange
      const parentLayer = new ScatterplotLayer({data: [], id: 'parent'});
      const childLayer = new ScatterplotLayer({data: [], id: 'child'});
      const parent = createMockInstance(parentLayer);
      const child = createMockInstance(childLayer);

      // Act
      appendInitialChild(parent, child);

      // Assert
      expect(parent.children).toHaveLength(1);
      expect(parent.children[0]).toBe(child);
    });

    it('should mutate parent instance', () => {
      // Arrange
      const parentLayer = new ScatterplotLayer({data: [], id: 'parent'});
      const childLayer = new ScatterplotLayer({data: [], id: 'child'});
      const parent = createMockInstance(parentLayer);
      const child = createMockInstance(childLayer);
      const originalChildren = parent.children;

      // Act
      appendInitialChild(parent, child);

      // Assert
      expect(parent.children).toBe(originalChildren);
    });
  });

  describe('finalizeInitialChildren()', () => {
    it('should return false (no commitMount needed)', () => {
      // Arrange
      const layer = new ScatterplotLayer({data: [], id: 'test'});
      const instance = createMockInstance(layer);

      // Act
      const result = finalizeInitialChildren(instance, 'layer', {layer}, {} as never, {} as never);

      // Assert
      expect(result).toBeFalsy();
    });
  });

  describe('finalizeContainerChildren()', () => {
    it('should warn for duplicate layer IDs in dev mode', () => {
      // Arrange
      process.env.NODE_ENV = 'development';
      const {errorSpy} = setupConsoleSpy();

      const layer1 = new ScatterplotLayer({data: [], id: 'duplicate'});
      const layer2 = new ScatterplotLayer({data: [], id: 'duplicate'});
      const child1 = createMockInstance(layer1);
      const child2 = createMockInstance(layer2);
      const newChildren: ChildSet = [child1, child2];

      const container = {
        store: {} as never
      } as Container;

      // Act
      finalizeContainerChildren(container, newChildren);

      // Assert
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Duplicate layer IDs detected: duplicate')
      );
    });

    it('should not warn for unique layer IDs', () => {
      // Arrange
      process.env.NODE_ENV = 'development';
      const {errorSpy} = setupConsoleSpy();

      const layer1 = new ScatterplotLayer({data: [], id: 'layer1'});
      const layer2 = new ScatterplotLayer({data: [], id: 'layer2'});
      const child1 = createMockInstance(layer1);
      const child2 = createMockInstance(layer2);
      const newChildren: ChildSet = [child1, child2];

      const container = {
        store: {} as never
      } as Container;

      // Act
      finalizeContainerChildren(container, newChildren);

      // Assert
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('should ignore View IDs', () => {
      // Arrange
      process.env.NODE_ENV = 'development';
      const {errorSpy} = setupConsoleSpy();

      const view1 = new MapView({id: 'duplicate'});
      const view2 = new MapView({id: 'duplicate'});
      const child1 = createMockInstance(view1);
      const child2 = createMockInstance(view2);
      const newChildren: ChildSet = [child1, child2];

      const container = {
        store: {} as never
      } as Container;

      // Act
      finalizeContainerChildren(container, newChildren);

      // Assert
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('should handle nested layers correctly', () => {
      // Arrange
      process.env.NODE_ENV = 'development';
      const {errorSpy} = setupConsoleSpy();

      const layer1 = new ScatterplotLayer({data: [], id: 'parent'});
      const layer2 = new ScatterplotLayer({data: [], id: 'child1'});
      const layer3 = new ScatterplotLayer({data: [], id: 'child1'}); // Duplicate with layer2
      const child2 = createMockInstance(layer2);
      const child3 = createMockInstance(layer3);
      const parent = createMockInstance(layer1, [child2, child3]);
      const newChildren: ChildSet = [parent];

      const container = {
        store: {} as never
      } as Container;

      // Act
      finalizeContainerChildren(container, newChildren);

      // Assert
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Duplicate layer IDs detected: child1')
      );
    });

    it('should not warn in production mode', () => {
      // Arrange
      process.env.NODE_ENV = 'production';
      const {errorSpy} = setupConsoleSpy();

      const layer1 = new ScatterplotLayer({data: [], id: 'duplicate'});
      const layer2 = new ScatterplotLayer({data: [], id: 'duplicate'});
      const child1 = createMockInstance(layer1);
      const child2 = createMockInstance(layer2);
      const newChildren: ChildSet = [child1, child2];

      const container = {
        store: {} as never
      } as Container;

      // Act
      finalizeContainerChildren(container, newChildren);

      // Assert
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  describe('replaceContainerChildren()', () => {
    it('should flatten tree and call deckgl.setProps', () => {
      // Arrange
      const layer1 = new ScatterplotLayer({data: [], id: 'layer1'});
      const layer2 = new ScatterplotLayer({data: [], id: 'layer2'});
      const child1 = createMockInstance(layer1);
      const child2 = createMockInstance(layer2);
      const newChildren: ChildSet = [child1, child2];

      const mockDeckgl = {
        setProps: vi.fn<(props: {layers: unknown[]; views?: unknown[]}) => void>()
      };

      const container = {
        store: {
          getState: vi.fn<
            () => {
              _passedLayers: unknown[];
              deckgl: {setProps: (props: {layers: unknown[]; views?: unknown[]}) => void};
            }
          >(() => ({
            _passedLayers: [],
            deckgl: mockDeckgl
          }))
        }
      } as unknown as Container;

      // Act
      replaceContainerChildren(container, newChildren);

      // Assert
      expect(mockDeckgl.setProps).toHaveBeenCalledExactlyOnceWith({
        layers: [layer1, layer2],
        views: []
      });
    });

    it('should combine _passedLayers with JSX layers', () => {
      // Arrange
      const passedLayer = new ScatterplotLayer({data: [], id: 'passed'});
      const jsxLayer = new ScatterplotLayer({data: [], id: 'jsx'});
      const child = createMockInstance(jsxLayer);
      const newChildren: ChildSet = [child];

      const mockDeckgl = {
        setProps: vi.fn<(props: {layers: unknown[]; views?: unknown[]}) => void>()
      };

      const container = {
        store: {
          getState: vi.fn<
            () => {
              _passedLayers: unknown[];
              deckgl: {setProps: (props: {layers: unknown[]; views?: unknown[]}) => void};
            }
          >(() => ({
            _passedLayers: [passedLayer],
            deckgl: mockDeckgl
          }))
        }
      } as unknown as Container;

      // Act
      replaceContainerChildren(container, newChildren);

      // Assert
      expect(mockDeckgl.setProps).toHaveBeenCalledWith({
        layers: [passedLayer, jsxLayer],
        views: []
      });
    });

    it('should include views in setProps when present', () => {
      // Arrange
      const layer = new ScatterplotLayer({data: [], id: 'layer'});
      const view = new MapView({id: 'view'});
      const layerChild = createMockInstance(layer);
      const viewChild = createMockInstance(view);
      const newChildren: ChildSet = [viewChild, layerChild];

      const mockDeckgl = {
        setProps: vi.fn<(props: {layers: unknown[]; views?: unknown[]}) => void>()
      };

      const container = {
        store: {
          getState: vi.fn<
            () => {
              _passedLayers: unknown[];
              deckgl: {setProps: (props: {layers: unknown[]; views?: unknown[]}) => void};
            }
          >(() => ({
            _passedLayers: [],
            deckgl: mockDeckgl
          }))
        }
      } as unknown as Container;

      // Act
      replaceContainerChildren(container, newChildren);

      // Assert
      expect(mockDeckgl.setProps).toHaveBeenCalledWith({
        layers: [layer],
        views: [view]
      });
    });

    it('should reset views prop if empty', () => {
      // Arrange
      const layer = new ScatterplotLayer({data: [], id: 'layer'});
      const child = createMockInstance(layer);
      const newChildren: ChildSet = [child];

      const mockDeckgl = {
        setProps: vi.fn<(props: {layers: unknown[]; views?: unknown[]}) => void>()
      };

      const container = {
        store: {
          getState: vi.fn<
            () => {
              _passedLayers: unknown[];
              deckgl: {setProps: (props: {layers: unknown[]; views?: unknown[]}) => void};
            }
          >(() => ({
            _passedLayers: [],
            deckgl: mockDeckgl
          }))
        }
      } as unknown as Container;

      // Act
      replaceContainerChildren(container, newChildren);

      // Assert
      expect(mockDeckgl.setProps).toHaveBeenCalledWith({
        layers: [layer],
        views: []
      });
    });

    it('should no-op if deckgl is undefined (already cleaned up)', () => {
      // Arrange
      const layer = new ScatterplotLayer({data: [], id: 'layer'});
      const child = createMockInstance(layer);
      const newChildren: ChildSet = [child];

      const container = {
        store: {
          getState: vi.fn<() => {_passedLayers: unknown[]; deckgl: undefined}>(() => ({
            _passedLayers: [],
            deckgl: undefined
          }))
        }
      } as unknown as Container;

      // Act & Assert
      expect(() => replaceContainerChildren(container, newChildren)).not.toThrow();
    });
  });

  describe('organizeList()', () => {
    it('should separate views and layers correctly', () => {
      // Arrange
      const view = new MapView({id: 'view-1'});
      const layer1 = new ScatterplotLayer({data: [], id: 'layer-1'});
      const layer2 = new ScatterplotLayer({data: [], id: 'layer-2'});
      const mixedList = [view, layer1, layer2];

      // Act
      const result = organizeList(mixedList);

      // Assert
      expect(result.views).toStrictEqual([view]);
      expect(result.layers).toStrictEqual([layer1, layer2]);
    });

    it('should handle list with only views', () => {
      // Arrange
      const view1 = new MapView({id: 'view-1'});
      const view2 = new MapView({id: 'view-2'});
      const viewsList = [view1, view2];

      // Act
      const result = organizeList(viewsList);

      // Assert
      expect(result.views).toStrictEqual([view1, view2]);
      expect(result.layers).toStrictEqual([]);
    });

    it('should handle list with only layers', () => {
      // Arrange
      const layer1 = new ScatterplotLayer({data: [], id: 'layer-1'});
      const layer2 = new ScatterplotLayer({data: [], id: 'layer-2'});
      const layersList = [layer1, layer2];

      // Act
      const result = organizeList(layersList);

      // Assert
      expect(result.views).toStrictEqual([]);
      expect(result.layers).toStrictEqual([layer1, layer2]);
    });

    it('should handle empty list', () => {
      // Act
      const result = organizeList([]);

      // Assert
      expect(result.views).toStrictEqual([]);
      expect(result.layers).toStrictEqual([]);
    });
  });

  describe('flattenTree()', () => {
    it('should flatten single-level tree', () => {
      // Arrange
      const layer1 = new ScatterplotLayer({data: [], id: 'layer-1'});
      const layer2 = new ScatterplotLayer({data: [], id: 'layer-2'});
      const instances: Instance[] = [createMockInstance(layer1), createMockInstance(layer2)];

      // Act
      const result = flattenTree(instances);

      // Assert
      expect(result).toStrictEqual([layer1, layer2]);
    });

    it('should flatten three-level nested hierarchy', () => {
      // Arrange
      const layer1 = new ScatterplotLayer({data: [], id: 'level-1'});
      const layer2 = new ScatterplotLayer({data: [], id: 'level-2'});
      const layer3 = new ScatterplotLayer({data: [], id: 'level-3'});

      const level3Instance = createMockInstance(layer3, []);
      const level2Instance = createMockInstance(layer2, [level3Instance]);
      const level1Instance = createMockInstance(layer1, [level2Instance]);

      // Act
      const result = flattenTree([level1Instance]);

      // Assert
      expect(result).toHaveLength(3);
      expect(result).toStrictEqual([layer1, layer2, layer3]);
    });

    it('should handle empty array', () => {
      // Act
      const result = flattenTree([]);

      // Assert
      expect(result).toStrictEqual([]);
    });

    it('should preserve depth-first traversal order', () => {
      // Arrange
      const layer1 = new ScatterplotLayer({data: [], id: 'parent-1'});
      const layer2 = new ScatterplotLayer({data: [], id: 'child-1'});
      const layer3 = new ScatterplotLayer({data: [], id: 'parent-2'});
      const layer4 = new ScatterplotLayer({data: [], id: 'child-2'});

      const instances: Instance[] = [
        createMockInstance(layer1, [createMockInstance(layer2)]),
        createMockInstance(layer3, [createMockInstance(layer4)])
      ];

      // Act
      const result = flattenTree(instances);

      // Assert
      expect(result).toStrictEqual([layer1, layer2, layer3, layer4]);
    });
  });
});

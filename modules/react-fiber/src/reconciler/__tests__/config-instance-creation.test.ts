import {MapView} from '@deck.gl/core';
import {ScatterplotLayer} from '@deck.gl/layers';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {
  cloneHiddenInstance,
  cloneHiddenTextInstance,
  cloneInstance,
  createInstance,
  createTextInstance
} from '../config';
import type {Instance, Props, Type} from '../types';
import {createMockHostContext, setupConsoleSpy} from './test-utils';

describe('config-instance-creation', () => {
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

  describe('createInstance()', () => {
    it('should create instance for <layer> element', () => {
      // Arrange
      const layer = new ScatterplotLayer({data: [], id: 'test-layer'});
      const type: Type = 'layer';
      const props: Props = {layer};
      const hostContext = createMockHostContext();

      // Act
      const instance = createInstance(type, props, {} as never, hostContext, {} as never);

      // Assert
      expect(instance).toHaveProperty('node');
      expect(instance).toHaveProperty('children');
      expect(instance.node).toBe(layer);
      expect(instance.children).toStrictEqual([]);
    });

    it('should create instance for <view> element', () => {
      // Arrange
      const view = new MapView({id: 'test-view'});
      const type: Type = 'view';
      const props: Props = {view};
      const hostContext = createMockHostContext();

      // Act
      const instance = createInstance(type, props, {} as never, hostContext, {} as never);

      // Assert
      expect(instance).toHaveProperty('node');
      expect(instance).toHaveProperty('children');
      expect(instance.node).toBe(view);
      expect(instance.children).toStrictEqual([]);
    });

    it('should throw if <layer> element missing layer prop', () => {
      // Arrange
      const type: Type = 'layer';
      const props: Props = {};
      const hostContext = createMockHostContext();

      // Act & Assert
      expect(() => createInstance(type, props, {} as never, hostContext, {} as never)).toThrow(
        "<layer> element requires a 'layer' prop"
      );
    });

    it('should throw if <view> element missing view prop', () => {
      // Arrange
      const type: Type = 'view';
      const props: Props = {};
      const hostContext = createMockHostContext();

      // Act & Assert
      expect(() => createInstance(type, props, {} as never, hostContext, {} as never)).toThrow(
        "<view> element requires a 'view' prop"
      );
    });

    it('should warn in dev mode for missing layer ID', () => {
      // Arrange
      process.env.NODE_ENV = 'development';
      const {warnSpy} = setupConsoleSpy();

      const layer = new ScatterplotLayer({data: [], id: 'unknown'}); // "unknown" ID triggers warning
      const type: Type = 'layer';
      const props: Props = {layer};
      const hostContext = createMockHostContext();

      // Act
      createInstance(type, props, {} as never, hostContext, {} as never);

      // Assert
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Layer missing explicit "id" prop')
      );
    });

    it('should warn in dev mode for missing view ID', () => {
      // Arrange
      process.env.NODE_ENV = 'development';
      const {warnSpy} = setupConsoleSpy();

      const view = new MapView({id: 'unknown'}); // "unknown" ID triggers warning
      const type: Type = 'view';
      const props: Props = {view};
      const hostContext = createMockHostContext();

      // Act
      createInstance(type, props, {} as never, hostContext, {} as never);

      // Assert
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('View missing explicit "id" prop')
      );
    });

    it('should error in dev mode when View passed to <layer>', () => {
      // Arrange
      process.env.NODE_ENV = 'development';
      const {errorSpy} = setupConsoleSpy();

      const view = new MapView({id: 'test-view'});
      const type: Type = 'layer';
      const props: Props = {layer: view as never}; // Wrong type
      const hostContext = createMockHostContext();

      // Act
      createInstance(type, props, {} as never, hostContext, {} as never);

      // Assert
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('View instance passed to <layer> element')
      );
    });

    it('should not warn in production mode for missing IDs', () => {
      // Arrange
      process.env.NODE_ENV = 'production';
      const {warnSpy} = setupConsoleSpy();

      const layer = new ScatterplotLayer({data: []}); // No ID
      const type: Type = 'layer';
      const props: Props = {layer};
      const hostContext = createMockHostContext();

      // Act
      createInstance(type, props, {} as never, hostContext, {} as never);

      // Assert
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('should return instance with node and empty children array', () => {
      // Arrange
      const layer = new ScatterplotLayer({data: [], id: 'test'});
      const type: Type = 'layer';
      const props: Props = {layer};
      const hostContext = createMockHostContext();

      // Act
      const instance = createInstance(type, props, {} as never, hostContext, {} as never);

      // Assert
      expect(instance).toHaveProperty('node', layer);
      expect(instance).toHaveProperty('children');
      expect(Array.isArray(instance.children)).toBeTruthy();
      expect(instance.children).toHaveLength(0);
    });
  });

  describe('createTextInstance()', () => {
    it('should always throw error for text nodes', () => {
      // Act & Assert
      expect(() => createTextInstance()).toThrow('Text nodes are not supported');
    });
  });

  describe('cloneInstance()', () => {
    it('should return undefined if instance is undefined', () => {
      // Arrange
      const instance = undefined;
      const type = 'layer';
      const oldProps: Props = {};
      const newProps: Props = {};

      // Act
      const result = cloneInstance(instance, type, oldProps, newProps, true, null);

      // Assert
      expect(result).toBeUndefined();
    });

    it('should create new instance with new props', () => {
      // Arrange
      const oldLayer = new ScatterplotLayer({
        data: [],
        getRadius: 5,
        id: 'test'
      });
      const newLayer = new ScatterplotLayer({
        data: [],
        getRadius: 10,
        id: 'test'
      });
      const instance: Instance = {
        children: [],
        node: oldLayer
      };
      const type = 'layer';
      const oldProps: Props = {layer: oldLayer};
      const newProps: Props = {layer: newLayer};

      // Act
      const result = cloneInstance(instance, type, oldProps, newProps, true, null);

      // Assert
      expect(result).toBeDefined();
      expect(result?.node).toBe(newLayer);
      expect(result?.node).not.toBe(oldLayer);
    });

    it('should keep children if keepChildren=true', () => {
      // Arrange
      const layer = new ScatterplotLayer({data: [], id: 'test'});
      const newLayer = new ScatterplotLayer({data: [], id: 'test'});
      const childInstance: Instance = {
        children: [],
        node: new ScatterplotLayer({data: [], id: 'child'})
      };
      const instance: Instance = {
        children: [childInstance],
        node: layer
      };
      const type = 'layer';
      const oldProps: Props = {layer};
      const newProps: Props = {layer: newLayer};

      // Act
      const result = cloneInstance(
        instance,
        type,
        oldProps,
        newProps,
        true, // keepChildren
        null
      );

      // Assert
      expect(result?.children).toBe(instance.children);
      expect(result?.children).toHaveLength(1);
      expect(result?.children[0]).toBe(childInstance);
    });

    it('should use recyclableInstance children if keepChildren=false', () => {
      // Arrange
      const layer = new ScatterplotLayer({data: [], id: 'test'});
      const newLayer = new ScatterplotLayer({data: [], id: 'test'});
      const recyclableChild: Instance = {
        children: [],
        node: new ScatterplotLayer({data: [], id: 'recyclable-child'})
      };
      const recyclableInstance: Instance = {
        children: [recyclableChild],
        node: layer
      };
      const instance: Instance = {
        children: [],
        node: layer
      };
      const type = 'layer';
      const oldProps: Props = {layer};
      const newProps: Props = {layer: newLayer};

      // Act
      const result = cloneInstance(
        instance,
        type,
        oldProps,
        newProps,
        false, // keepChildren=false
        recyclableInstance
      );

      // Assert
      expect(result?.children).toBe(recyclableInstance.children);
      expect(result?.children).toHaveLength(1);
      expect(result?.children[0]).toBe(recyclableChild);
    });

    it('should use empty children if keepChildren=false and no recyclable', () => {
      // Arrange
      const layer = new ScatterplotLayer({data: [], id: 'test'});
      const newLayer = new ScatterplotLayer({data: [], id: 'test'});
      const childInstance: Instance = {
        children: [],
        node: new ScatterplotLayer({data: [], id: 'child'})
      };
      const instance: Instance = {
        children: [childInstance],
        node: layer
      };
      const type = 'layer';
      const oldProps: Props = {layer};
      const newProps: Props = {layer: newLayer};

      // Act
      const result = cloneInstance(
        instance,
        type,
        oldProps,
        newProps,
        false, // keepChildren=false
        null // no recyclable
      );

      // Assert
      expect(result?.children).not.toBe(instance.children);
      expect(result?.children).toStrictEqual([]);
    });
  });

  describe('cloneHiddenInstance()', () => {
    it('should return instance with same node and children', () => {
      // Arrange
      const layer = new ScatterplotLayer({data: [], id: 'test'});
      const childInstance: Instance = {
        children: [],
        node: new ScatterplotLayer({data: [], id: 'child'})
      };
      const instance: Instance = {
        children: [childInstance],
        node: layer
      };
      const type: Type = 'layer';
      const props: Props = {layer};

      // Act
      const result = cloneHiddenInstance(instance, type, props);

      // Assert
      expect(result.node).toBe(instance.node);
      expect(result.children).toBe(instance.children);
    });
  });

  describe('cloneHiddenTextInstance()', () => {
    it('should always throw error for text nodes', () => {
      // Act & Assert
      expect(() => cloneHiddenTextInstance()).toThrow(
        'Text nodes are not supported in deck.gl renderer'
      );
    });
  });
});

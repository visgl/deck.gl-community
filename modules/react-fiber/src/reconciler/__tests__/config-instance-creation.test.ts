import {LightingEffect, MapView} from '@deck.gl/core';
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
import {createMockHostContext, setupLogSpy} from './test-utils';
import {TestWidget} from './test-widget';

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

    it('should create instance for <widget> element', () => {
      const widget = new TestWidget({id: 'test-widget'});

      const instance = createInstance(
        'widget',
        {widget},
        {} as never,
        createMockHostContext(),
        {} as never
      );

      expect(instance.node).toBe(widget);
      expect(instance.children).toStrictEqual([]);
    });

    it('should create instance for <effect> element', () => {
      const effect = new LightingEffect();

      const instance = createInstance(
        'effect',
        {effect},
        {} as never,
        createMockHostContext(),
        {} as never
      );

      expect(instance.node).toBe(effect);
      expect(instance.children).toStrictEqual([]);
    });

    it('throws when an element is missing its descriptor or gets another kind', () => {
      const hostContext = createMockHostContext();
      const layer = new ScatterplotLayer({data: [], id: 'points'});
      const view = new MapView({id: 'main'});
      const widget = new TestWidget({id: 'widget'});
      const cases: [Type, Props, string][] = [
        ['layer', {}, '<layer> needs a Layer, got undefined'],
        ['layer', {layer: null as never}, '<layer> needs a Layer, got null'],
        ['layer', {layer: view as never}, '<layer> needs a Layer, got MapView'],
        ['layer', {layer: widget as never}, '<layer> needs a Layer, got TestWidget'],
        ['layer', {layer: {id: 'plain'} as never}, '<layer> needs a Layer, got Object'],
        ['view', {}, '<view> needs a View, got undefined'],
        ['view', {view: layer as never}, '<view> needs a View, got ScatterplotLayer'],
        ['widget', {}, '<widget> needs a Widget, got undefined'],
        ['widget', {widget: layer as never}, '<widget> needs a Widget, got ScatterplotLayer'],
        ['effect', {}, '<effect> needs a deck.gl effect, got undefined'],
        [
          'effect',
          {effect: layer as never},
          '<effect> needs a deck.gl effect, got ScatterplotLayer'
        ],
        ['effect', {effect: widget as never}, '<effect> needs a deck.gl effect, got TestWidget'],
        ['effect', {effect: {id: 'plain'} as never}, '<effect> needs a deck.gl effect, got Object'],
        [
          'layer',
          {layer: new LightingEffect() as never},
          '<layer> needs a Layer, got LightingEffect'
        ]
      ];

      // The check runs in every build, not only in development.
      for (const env of ['development', 'production']) {
        process.env.NODE_ENV = env;
        for (const [type, props, message] of cases) {
          expect(() => createInstance(type, props, {} as never, hostContext, {} as never)).toThrow(
            message
          );
        }
      }
    });

    it('throws when an update swaps in another kind of descriptor', () => {
      const layer = new ScatterplotLayer({data: [], id: 'points'});
      const view = new MapView({id: 'main'});
      const instance = createInstance(
        'layer',
        {layer},
        {} as never,
        createMockHostContext(),
        {} as never
      );

      expect(() =>
        cloneInstance(instance, 'layer', {layer}, {layer: view as never}, false, null)
      ).toThrow('<layer> needs a Layer, got MapView');
    });

    it('should reject unsupported element types', () => {
      const hostContext = createMockHostContext();

      expect(() =>
        createInstance('unsupported', {}, {} as never, hostContext, {} as never)
      ).toThrow('Unsupported element <unsupported>');
    });

    it('should warn in dev mode for missing layer ID', () => {
      // Arrange
      process.env.NODE_ENV = 'development';
      const {warnSpy} = setupLogSpy();

      const layer = new ScatterplotLayer({data: [], id: 'unknown'}); // "unknown" ID triggers warning
      const type: Type = 'layer';
      const props: Props = {layer};
      const hostContext = createMockHostContext();

      // Act
      createInstance(type, props, {} as never, hostContext, {} as never);

      // Assert
      expect(warnSpy).toHaveBeenCalledWith('ScatterplotLayer needs a stable id');
    });

    it('should warn in dev mode for missing view ID', () => {
      // Arrange
      process.env.NODE_ENV = 'development';
      const {warnSpy} = setupLogSpy();

      const view = new MapView({id: 'unknown'}); // "unknown" ID triggers warning
      const type: Type = 'view';
      const props: Props = {view};
      const hostContext = createMockHostContext();

      // Act
      createInstance(type, props, {} as never, hostContext, {} as never);

      // Assert
      expect(warnSpy).toHaveBeenCalledWith('MapView needs a stable id');
    });

    it('warns about default ids in every build except production, as deck.gl does', () => {
      const {warnSpy} = setupLogSpy();
      const hostContext = createMockHostContext();

      for (const env of ['test', 'staging']) {
        process.env.NODE_ENV = env;
        warnSpy.mockClear();
        createInstance(
          'layer',
          {layer: new ScatterplotLayer({data: [], id: 'unknown'})},
          {} as never,
          hostContext,
          {} as never
        );
        expect(warnSpy).toHaveBeenCalledWith('ScatterplotLayer needs a stable id');
      }
    });

    it('should not warn in production mode for missing IDs', () => {
      // Arrange
      process.env.NODE_ENV = 'production';
      const {warnSpy} = setupLogSpy();

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
    it('asserts, because text instances are never created', () => {
      expect(() => cloneHiddenTextInstance()).toThrow();
    });
  });
});

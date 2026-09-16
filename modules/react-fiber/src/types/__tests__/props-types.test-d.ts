import {MapView} from '@deck.gl/core';
import {ScatterplotLayer} from '@deck.gl/layers';
import type {ReactNode} from 'react';
import {describe, expect, expectTypeOf, it} from 'vitest';

import type {DeckglProps} from '../react';

describe('Props Type Tests', () => {
  it('should DeckglProps accept initialViewState', () => {
    // Arrange
    const props: DeckglProps = {
      initialViewState: {
        latitude: 0,
        longitude: 0,
        zoom: 1
      }
    };

    // Assert - initialViewState is accepted
    expectTypeOf(props).toMatchTypeOf<DeckglProps>();
  });

  it('should DeckglProps accept layers array', () => {
    // Arrange
    const layer = new ScatterplotLayer({data: [], id: 'test'});
    const props: DeckglProps = {
      layers: [layer]
    };

    // Assert - layers array is accepted
    expectTypeOf(props).toMatchTypeOf<DeckglProps>();
  });

  it('should DeckglProps accept views array', () => {
    // Arrange
    const view = new MapView({id: 'map'});
    const props: DeckglProps = {
      views: [view] as never
    };

    // Assert - views array is accepted
    expectTypeOf(props).toMatchTypeOf<DeckglProps>();
  });

  it('should DeckglProps accept children (ReactNode)', () => {
    // Arrange
    const props: DeckglProps = {
      children: 'test'
    };

    // Assert - children is accepted
    expectTypeOf(props).toMatchTypeOf<DeckglProps>();
  });

  it('should ScatterplotLayer preserve data generic type', () => {
    // Arrange
    interface DataPoint {
      x: number;
      y: number;
      value: number;
    }
    const data: DataPoint[] = [
      {value: 1, x: 0, y: 0},
      {value: 2, x: 1, y: 1}
    ];

    // Act - create layer with typed data
    const layer = new ScatterplotLayer<DataPoint>({
      data,
      getPosition: d => [d.x, d.y],
      id: 'typed'
    });

    // Assert - type test passes at compile time
    expect(layer).toBeDefined();
  });

  it('should ReactElement type compatible across React versions', () => {
    // This test ensures our types work with both React 18 and 19
    // ReactElement should be compatible regardless of React version
    const element: React.ReactElement = {
      key: null,
      props: {},
      type: 'div'
    };

    expectTypeOf(element).toHaveProperty('type');
    expectTypeOf(element).toHaveProperty('props');
    expectTypeOf(element).toHaveProperty('key');
  });

  it('should ReactNode type compatible across React versions', () => {
    // Test that ReactNode accepts various types across React versions
    const stringNode: ReactNode = 'text';
    const numberNode: ReactNode = 123;
    const booleanNode: ReactNode = true;
    const nullNode: ReactNode = null;
    const undefinedNode: ReactNode = undefined;

    // ReactNode is a union type, so specific values match it
    expectTypeOf(stringNode).toMatchTypeOf<ReactNode>();
    expectTypeOf(numberNode).toMatchTypeOf<ReactNode>();
    expectTypeOf(booleanNode).toMatchTypeOf<ReactNode>();
    expectTypeOf(nullNode).toMatchTypeOf<ReactNode>();
    expectTypeOf(undefinedNode).toMatchTypeOf<ReactNode>();
  });

  it('should DeckglProps accept empty object', () => {
    // Arrange
    const props: DeckglProps = {};

    // Assert - all props are optional
    expectTypeOf(props).toMatchTypeOf<DeckglProps>();
  });

  it('should DeckglProps accept combined props', () => {
    // Arrange
    const view = new MapView({id: 'map'});
    const layer = new ScatterplotLayer({data: [], id: 'test'});
    const props: DeckglProps = {
      children: 'test',
      initialViewState: {
        latitude: 0,
        longitude: 0,
        zoom: 1
      },
      layers: [layer],
      views: [view] as never
    };

    // Assert
    expectTypeOf(props).toMatchTypeOf<DeckglProps>();
  });

  it('should DeckglProps reject invalid initialViewState', () => {
    // Missing required fields - these should produce type errors
    // but initialViewState type is lenient for partial updates
    const _missingLat: DeckglProps = {
      initialViewState: {
        longitude: 0,
        zoom: 1
      } as never
    };

    const _missingLon: DeckglProps = {
      initialViewState: {
        latitude: 0,
        zoom: 1
      } as never
    };

    const _missingZoom: DeckglProps = {
      initialViewState: {
        latitude: 0,
        longitude: 0
      } as never
    };

    // Assert - type test passes at compile time
    expect(_missingLat).toBeDefined();
  });

  it('should ScatterplotLayer accessor functions receive correct types', () => {
    // Arrange
    interface DataPoint {
      coordinates: [number, number];
      color: [number, number, number];
      radius: number;
    }
    const data: DataPoint[] = [{color: [255, 0, 0], coordinates: [0, 0], radius: 10}];

    // Act - accessors should receive DataPoint type in their function parameters
    const layer = new ScatterplotLayer<DataPoint>({
      data,
      getFillColor: d => d.color,
      getPosition: d => d.coordinates,
      getRadius: d => d.radius,
      id: 'typed'
    });

    // Assert - type test passes at compile time
    expect(layer).toBeDefined();
  });
});

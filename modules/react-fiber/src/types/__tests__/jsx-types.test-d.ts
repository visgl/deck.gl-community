import {type Layer, MapView} from '@deck.gl/core';
import {PolygonLayer, ScatterplotLayer, type ScatterplotLayerProps} from '@deck.gl/layers';
import {createElement} from 'react';
import {describe, expect, it} from 'vitest';

import type {DeckGLElements} from '../jsx';

describe('JSX type tests', () => {
  it('should expose native layer and view elements', () => {
    const layer = new ScatterplotLayer({data: [], id: 'points'});
    const view = new MapView({id: 'main'});
    const validLayer: DeckGLElements['layer'] = {layer};
    const validView: DeckGLElements['view'] = {view};
    const classicLayer: import('react').JSX.IntrinsicElements['layer'] = validLayer;
    const automaticLayer: import('react/jsx-runtime').JSX.IntrinsicElements['layer'] = validLayer;
    const developmentLayer: import('react/jsx-dev-runtime').JSX.IntrinsicElements['layer'] =
      validLayer;
    const layerElement = createElement('layer', validLayer);
    const viewElement = createElement('view', validView);

    expect(layerElement).toBeDefined();
    expect(viewElement).toBeDefined();
    expect(classicLayer).toBeDefined();
    expect(automaticLayer).toBeDefined();
    expect(developmentLayer).toBeDefined();
  });

  it('should reject removed typed intrinsic declarations', () => {
    // @ts-expect-error Legacy typed layer intrinsics are not supported.
    const _removedLayer: keyof DeckGLElements = 'scatterplotLayer';
    // @ts-expect-error Legacy typed view intrinsics are not supported.
    const _removedView: keyof DeckGLElements = 'mapView';
  });

  it('should type the migration guide layer component recipe', () => {
    // Mirrors the "Keep the old JSX syntax" recipe in the migration guide.
    function createLayerComponent<PropsT extends {id?: string}>(
      LayerClass: new (props: PropsT) => Layer
    ) {
      return function LayerComponent(props: PropsT) {
        return createElement('layer', {layer: new LayerClass(props)});
      };
    }

    type Point = {position: [number, number]};
    // Name the props type to keep typed accessors; inference alone gives `unknown` data.
    const JsxScatterplotLayer =
      createLayerComponent<ScatterplotLayerProps<Point>>(ScatterplotLayer);
    const JsxPolygonLayer = createLayerComponent(PolygonLayer);
    const points = createElement(JsxScatterplotLayer, {
      data: [{position: [0, 0]}],
      getPosition: d => d.position,
      getRadius: 10,
      id: 'points'
    });
    const polygons = createElement(JsxPolygonLayer, {data: [], id: 'polygons'});
    // @ts-expect-error Layer props are checked against the wrapped layer class.
    const _invalid = createElement(JsxScatterplotLayer, {getRadius: 'large', id: 'points'});

    expect(points).toBeDefined();
    expect(polygons).toBeDefined();
  });
});

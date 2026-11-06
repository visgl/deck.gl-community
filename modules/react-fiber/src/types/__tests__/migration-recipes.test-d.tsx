// The "Keep the old JSX syntax" helpers from the migration guide, written as the guide shows them.
import {MapView as DeckMapView, type Layer, type View} from '@deck.gl/core';
import {
  PolygonLayer as DeckPolygonLayer,
  ScatterplotLayer as DeckScatterplotLayer
} from '@deck.gl/layers';
import {createElement, type ReactNode} from 'react';
import {describe, expect, it} from 'vitest';

import '../jsx';

function createLayerComponent<PropsT extends {id?: string}>(
  LayerClass: new (props: PropsT) => Layer
) {
  return function LayerComponent(props: PropsT) {
    return <layer layer={new LayerClass(props)} />;
  };
}

function createViewComponent<PropsT extends {id?: string}>(ViewClass: new (props: PropsT) => View) {
  return function ViewComponent({children, ...props}: PropsT & {children?: ReactNode}) {
    // `createElement` because @types/react already declares an SVG `<view>` intrinsic element.
    return createElement('view', {view: new ViewClass(props as PropsT)}, children);
  };
}

const ScatterplotLayer = createLayerComponent(DeckScatterplotLayer);
const PolygonLayer = createLayerComponent(DeckPolygonLayer);
const MapView = createViewComponent(DeckMapView);

type Point = {position: [number, number]};
const points: Point[] = [{position: [0, 0]}];

describe('migration guide recipes', () => {
  it('keeps the layer type parameters on the wrapped component', () => {
    const typed = (
      <ScatterplotLayer<Point> id="points" data={points} getPosition={d => d.position} />
    );
    // @ts-expect-error Accessors are checked against the data type argument.
    const _wrongField = <ScatterplotLayer<Point> id="points" getPosition={d => d.missing} />;
    // @ts-expect-error Other props are checked against the wrapped layer's props.
    const _wrongProp = <ScatterplotLayer id="points" getRadius="large" />;

    expect(typed).toBeDefined();
  });

  it('wraps views with nested children', () => {
    const tree = (
      <MapView id="main">
        <PolygonLayer id="regions" data={[]} />
      </MapView>
    );

    expect(tree).toBeDefined();
  });
});

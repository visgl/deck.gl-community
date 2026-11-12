// The DeckGL.Layer, DeckGL.View, DeckGL.Widget and DeckGL.Effect components on every root.
import {
  type Layer,
  LightingEffect,
  MapView,
  OrthographicView,
  Widget,
  type WidgetPlacement
} from '@deck.gl/core';
import {PathLayer, ScatterplotLayer} from '@deck.gl/layers';
import {createRef} from 'react';
import {describe, expect, it} from 'vitest';

import {createDeckGL, DeckGL, DeckGL as D} from '../../dom/index';
import {DeckGL as MapboxDeckGL} from '../../dom/mapbox';
import {DeckGL as MapLibreDeckGL} from '../../dom/maplibre';

class TestWidget extends Widget {
  className = 'test-widget';
  placement: WidgetPlacement = 'top-left';
  onRenderHTML(): void {}
}

type Airport = {coordinates: [number, number]};

describe('DeckGL element components', () => {
  it('type their props and refs from the instance', () => {
    const airportsRef = createRef<ScatterplotLayer<Airport>>();
    const layerRef = createRef<Layer>();
    const viewRef = createRef<MapView>();
    const airports = new ScatterplotLayer<Airport>({
      id: 'airports',
      getPosition: d => d.coordinates
    });

    const elements = (
      <DeckGL<MapView[]> initialViewState={{main: {latitude: 0, longitude: 0, zoom: 1}}}>
        <DeckGL.View ref={viewRef} view={new MapView({id: 'main'})}>
          <DeckGL.Layer ref={airportsRef} layer={airports} />
          <DeckGL.Layer ref={layerRef} layer={airports} />
        </DeckGL.View>
        <DeckGL.Widget widget={new TestWidget({id: 'test'})} />
        <DeckGL.Effect effect={new LightingEffect()} />
      </DeckGL>
    );

    // @ts-expect-error A layer is not a view.
    const _layerAsView = <DeckGL.View view={airports} />;
    // @ts-expect-error The ref is for another view class.
    const _wrongViewRef = <DeckGL.View ref={viewRef} view={new OrthographicView({id: 'o'})} />;
    // @ts-expect-error The ref is for a ScatterplotLayer.
    const _wrongLayerRef = <DeckGL.Layer ref={airportsRef} layer={new PathLayer({id: 'p'})} />;
    // @ts-expect-error Widgets have no children.
    const _widgetChildren = <DeckGL.Widget widget={new TestWidget({id: 'test'})}>x</DeckGL.Widget>;
    // @ts-expect-error The layer prop is required.
    const _missingLayer = <DeckGL.Layer />;

    expect(elements).toBeDefined();
  });

  it('accept a key, for lists', () => {
    const views = [new MapView({id: 'left'}), new MapView({id: 'right'})];
    const elements = views.map(view => <DeckGL.View key={view.id} view={view} />);

    expect(elements).toHaveLength(2);
  });

  it('are on every root and on an alias', () => {
    const CustomDeckGL = createDeckGL({createExternalOverlay: () => ({}) as never});
    const layer = new ScatterplotLayer({id: 'points'});
    const elements = [
      <MapboxDeckGL.Layer key="mapbox" layer={layer} />,
      <MapLibreDeckGL.Layer key="maplibre" layer={layer} />,
      <CustomDeckGL.Layer key="custom" layer={layer} />,
      <D.Layer key="alias" layer={layer} />
    ];

    expect(elements).toHaveLength(4);
  });

  it('leave the native elements with the deck prefix', () => {
    const layer = new ScatterplotLayer({id: 'points'});
    const view = new MapView({id: 'main'});
    const elements = (
      <deckView view={view}>
        <deckLayer layer={layer} />
      </deckView>
    );
    // @ts-expect-error The unprefixed names are no longer typed.
    const _layer = <layer layer={layer} />;
    // @ts-expect-error In TSX, <view> is React's SVG element, which has no `view` prop.
    const _svgView = <view view={view} />;

    expect(elements).toBeDefined();
  });
});

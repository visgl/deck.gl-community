import {
  LightingEffect,
  MapView,
  PostProcessEffect,
  Widget,
  type WidgetPlacement
} from '@deck.gl/core';
import {ScatterplotLayer} from '@deck.gl/layers';
import {createElement} from 'react';
import {describe, expect, it} from 'vitest';

import type {DeckGLElements} from '../jsx';

describe('JSX type tests', () => {
  it('should expose native layer and view elements', () => {
    const layer = new ScatterplotLayer({data: [], id: 'points'});
    const view = new MapView({id: 'main'});
    const validLayer: DeckGLElements['layer'] = {layer};
    const validView: DeckGLElements['deckView'] = {view};
    const classicLayer: import('react').JSX.IntrinsicElements['layer'] = validLayer;
    const automaticLayer: import('react/jsx-runtime').JSX.IntrinsicElements['layer'] = validLayer;
    const developmentLayer: import('react/jsx-dev-runtime').JSX.IntrinsicElements['layer'] =
      validLayer;
    const layerElement = createElement('layer', validLayer);
    const viewElement = createElement('deckView', validView);

    expect(layerElement).toBeDefined();
    expect(viewElement).toBeDefined();
    expect(classicLayer).toBeDefined();
    expect(automaticLayer).toBeDefined();
    expect(developmentLayer).toBeDefined();
  });

  it('types <deckView> in TSX, where React already declares an SVG <view>', () => {
    const view = new MapView({id: 'main'});
    const deckView = (
      <deckView view={view}>
        <layer layer={new ScatterplotLayer({data: [], id: 'points'})} />
      </deckView>
    );
    // @ts-expect-error <view> is React's SVG element in TSX; it has no `view` prop.
    const _svgView = <view view={view} />;
    // @ts-expect-error A layer is not a view.
    const _layerAsView = <deckView view={new ScatterplotLayer({id: 'x'})} />;

    expect(deckView).toBeDefined();
  });

  it('accepts a key on every element, for lists', () => {
    const views = [new MapView({id: 'left'}), new MapView({id: 'right'})];
    const elements = (
      <>
        {views.map(view => (
          <deckView key={view.id} view={view} />
        ))}
        <layer key="points" layer={new ScatterplotLayer({data: [], id: 'points'})} />
      </>
    );

    expect(elements).toBeDefined();
  });

  it('should type the widget element', () => {
    class TestWidget extends Widget {
      className = 'test-widget';
      placement: WidgetPlacement = 'top-left';
      onRenderHTML(): void {}
    }
    const widget = new TestWidget({id: 'test'});
    const validWidget: DeckGLElements['widget'] = {widget};
    const widgetElement = createElement('widget', validWidget);
    // @ts-expect-error A layer is not a widget.
    const _layerAsWidget: DeckGLElements['widget'] = {widget: new ScatterplotLayer({id: 'x'})};
    // @ts-expect-error Widgets have no children.
    const _widgetWithChildren: DeckGLElements['widget'] = {children: null, widget};

    expect(widgetElement).toBeDefined();
  });

  it('should type the effect element', () => {
    const lighting = new LightingEffect();
    const validEffect: DeckGLElements['effect'] = {effect: lighting};
    const effectElement = createElement('effect', validEffect);
    const _postProcess = (
      <effect effect={new PostProcessEffect({name: 'p', passes: []} as never, {} as never)} />
    );
    const lightingElement = <effect effect={lighting} />;
    // @ts-expect-error A layer is not an effect.
    const _layerAsEffect: DeckGLElements['effect'] = {effect: new ScatterplotLayer({id: 'x'})};
    // @ts-expect-error Effects have no children.
    const _effectWithChildren: DeckGLElements['effect'] = {children: null, effect: lighting};

    expect(effectElement).toBeDefined();
    expect(lightingElement).toBeDefined();
  });

  it('should reject removed typed intrinsic declarations', () => {
    // @ts-expect-error Legacy typed layer intrinsics are not supported.
    const _removedLayer: keyof DeckGLElements = 'scatterplotLayer';
    // @ts-expect-error Legacy typed view intrinsics are not supported.
    const _removedView: keyof DeckGLElements = 'mapView';
  });
});

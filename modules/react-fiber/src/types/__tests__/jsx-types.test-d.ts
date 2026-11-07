import {MapView, Widget, type WidgetPlacement} from '@deck.gl/core';
import {ScatterplotLayer} from '@deck.gl/layers';
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

  it('should reject removed typed intrinsic declarations', () => {
    // @ts-expect-error Legacy typed layer intrinsics are not supported.
    const _removedLayer: keyof DeckGLElements = 'scatterplotLayer';
    // @ts-expect-error Legacy typed view intrinsics are not supported.
    const _removedView: keyof DeckGLElements = 'mapView';
  });
});

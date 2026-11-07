// Refs on the native elements receive the deck.gl instance (see getPublicInstance).
import {type Layer, MapView, type View, Widget, type WidgetPlacement} from '@deck.gl/core';
import {ScatterplotLayer} from '@deck.gl/layers';
import {createElement, createRef} from 'react';
import {describe, expect, it} from 'vitest';

import '../jsx';

class TestWidget extends Widget {
  className = 'test-widget';
  placement: WidgetPlacement = 'top-left';
  onRenderHTML(): void {}
}

describe('native element refs', () => {
  it('types refs as the element instance', () => {
    const layerRef = createRef<Layer>();
    const widgetRef = createRef<Widget>();
    const viewRef = createRef<View>();

    const layer = <layer ref={layerRef} layer={new ScatterplotLayer({id: 'points'})} />;
    const widget = <widget ref={widgetRef} widget={new TestWidget({id: 'test'})} />;
    // `createElement` because @types/react already declares an SVG `<view>` intrinsic element.
    const view = createElement('view', {ref: viewRef, view: new MapView({id: 'main'})});
    // @ts-expect-error A layer ref does not accept a widget.
    const _wrongRef = <widget ref={layerRef} widget={new TestWidget({id: 'test'})} />;

    expect([layer, widget, view]).toHaveLength(3);
  });
});

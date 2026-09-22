import {MapView} from '@deck.gl/core';
import {ScatterplotLayer} from '@deck.gl/layers';
import {createElement} from 'react';
import {describe, expect, it} from 'vitest';

import type {DeckglElements} from '../jsx';

describe('JSX type tests', () => {
  it('should expose native layer and view elements', () => {
    const layer = new ScatterplotLayer({data: [], id: 'points'});
    const view = new MapView({id: 'main'});
    const validLayer: DeckglElements['layer'] = {layer};
    const validView: DeckglElements['view'] = {view};
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
    const _removedLayer: keyof DeckglElements = 'scatterplotLayer';
    // @ts-expect-error Legacy typed view intrinsics are not supported.
    const _removedView: keyof DeckglElements = 'mapView';
  });
});

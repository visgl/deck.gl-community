import {MapView as DeckMapView} from '@deck.gl/core';
import {ScatterplotLayer as DeckScatterplotLayer} from '@deck.gl/layers';
import {MapView} from '../views';
import {ScatterplotLayer} from '../layers';
import {describe, expect, it} from 'vitest';
import type {FunctionComponent} from 'react';

describe('compat wrappers', () => {
  it('lowers a layer component to the native layer primitive', () => {
    const Layer = ScatterplotLayer as FunctionComponent<{id: string; data: unknown[]}>;
    const element = Layer({data: [], id: 'points'});

    expect(element.type).toBe('layer');
    expect(element.props.layer).toBeInstanceOf(DeckScatterplotLayer);
    expect(element.props.layer.id).toBe('points');
  });

  it('lowers a view component and its nested children to the native view primitive', () => {
    const View = MapView as FunctionComponent<{children?: React.ReactNode; id: string}>;
    const child = <ScatterplotLayer data={[]} id="points" />;
    const element = View({children: child, id: 'map'});

    expect(element.type).toBe('view');
    expect(element.props.view).toBeInstanceOf(DeckMapView);
    expect(element.props.view.id).toBe('map');
    expect(element.props.children).toBe(child);
  });
});

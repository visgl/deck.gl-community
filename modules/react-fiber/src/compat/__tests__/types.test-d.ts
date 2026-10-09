import type {Deck} from '@deck.gl/core';
import {createDeckGL} from '../../dom';
import type {DeckglConfiguration} from '../../reconciler/types';
import {ScatterplotLayer} from '@deck.gl/layers';
import type {MapboxOverlay} from '@deck.gl/mapbox';
import type {MapLibreOverlay} from '@deck.gl/maplibre';
import {createElement, createRef} from 'react';
import type {ComponentProps} from 'react';
import {DeckGL} from '../deckgl';
import {DeckGL as MapboxDeckGL} from '../mapbox';
import type {DeckGLRef as MapboxDeckGLRef} from '../mapbox';
import {DeckGL as MapLibreDeckGL} from '../maplibre';
import type {DeckGLRef as MapLibreDeckGLRef} from '../maplibre';
import {PolygonLayer as CompatPolygonLayer} from '../layers';
import type {DeckGLContextValue, DeckGLProps, DeckGLRef} from '../types';
import {expectTypeOf} from 'vitest';

const props = {
  initialViewState: {latitude: 0, longitude: 0, zoom: 1}
} satisfies DeckGLProps;

expectTypeOf(props).toMatchTypeOf<DeckGLProps>();
expectTypeOf<DeckGLContextValue>().toEqualTypeOf<{deck: Deck | null}>();
expectTypeOf<DeckGLRef['pickObject']>().toEqualTypeOf<Deck['pickObject']>();
expectTypeOf<DeckGLRef['pickObjects']>().toEqualTypeOf<Deck['pickObjects']>();
expectTypeOf<DeckGLRef['pickMultipleObjects']>().toEqualTypeOf<Deck['pickMultipleObjects']>();
expectTypeOf<DeckGLRef['pickObjectAsync']>().toEqualTypeOf<Deck['pickObjectAsync']>();
expectTypeOf<DeckGLRef['pickObjectsAsync']>().toEqualTypeOf<Deck['pickObjectsAsync']>();

// @ts-expect-error Low-level renderer ownership is intentionally excluded.
const unsupportedCanvas: DeckGLProps = {canvas: document.createElement('canvas')};
void unsupportedCanvas;

// @ts-expect-error Native lifecycle notifications are intentionally excluded from compat.
const unsupportedOnDeckglChange: DeckGLProps = {onDeckglChange: () => undefined};
void unsupportedOnDeckglChange;

// @ts-expect-error `interleaved` is an overlay option that `DeckProps` does not declare.
const unsupportedInterleaved: DeckGLProps = {interleaved: true};
void unsupportedInterleaved;

// @ts-expect-error `interleaved` is an external-overlay option, not a Deck configuration prop.
const unsupportedConfigurationInterleaved: DeckglConfiguration = {interleaved: true};
void unsupportedConfigurationInterleaved;

const refProps = {
  initialViewState: {latitude: 0, longitude: 0, zoom: 1},
  ref: createRef<DeckGLRef>()
} satisfies ComponentProps<typeof DeckGL>;
void refProps;

const mapboxProps = {children: null, interleaved: true} satisfies ComponentProps<
  typeof MapboxDeckGL
>;
const maplibreProps = {children: null, interleaved: false} satisfies ComponentProps<
  typeof MapLibreDeckGL
>;
expectTypeOf<MapboxDeckGLRef['deck']>().toEqualTypeOf<MapboxOverlay | null>();
expectTypeOf<MapLibreDeckGLRef['deck']>().toEqualTypeOf<MapLibreOverlay | null>();
void mapboxProps;
void maplibreProps;

interface CustomOverlayProps {
  enabled?: boolean;
}

class CustomOverlay {
  finalize() {}

  setProps(_props: Parameters<Deck['setProps']>[0]) {}
}

const CustomDeckGL = createDeckGL<CustomOverlayProps, CustomOverlay>({
  createExternalOverlay: props => {
    expectTypeOf(props.enabled).toEqualTypeOf<boolean | undefined>();
    return new CustomOverlay();
  }
});
expectTypeOf<Parameters<typeof CustomDeckGL>[0]['onDeckglChange']>().toEqualTypeOf<
  ((deckgl: CustomOverlay | null) => void) | undefined
>();

createDeckGL<CustomOverlayProps, CustomOverlay>({
  createExternalOverlay: () => new CustomOverlay(),
  recreateOnChange: ['enabled']
});

createDeckGL<CustomOverlayProps, CustomOverlay>({
  createExternalOverlay: () => new CustomOverlay(),
  // @ts-expect-error recreateOnChange lists only props of the bound overlay.
  recreateOnChange: ['notAProp']
});

// @ts-expect-error Custom overlays must implement both Deck renderer lifecycle methods.
createDeckGL({createExternalOverlay: () => ({setProps: () => undefined})});

const mixedLayerTree = createElement(
  DeckGL,
  {initialViewState: {latitude: 0, longitude: 0, zoom: 1}},
  createElement('layer', {layer: new ScatterplotLayer({data: [], id: 'native-points'})}),
  createElement(CompatPolygonLayer, {data: [], id: 'compat-polygons'})
);
void mixedLayerTree;

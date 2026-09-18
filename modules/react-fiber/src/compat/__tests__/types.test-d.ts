import type {Deck} from '@deck.gl/core';
import type {MapboxOverlay} from '@deck.gl/mapbox';
import type {DeckGLContextValue, DeckGLProps, DeckGLRef} from '../types';
import {expectTypeOf} from 'vitest';

const props = {
  initialViewState: {latitude: 0, longitude: 0, zoom: 1}
} satisfies DeckGLProps;

expectTypeOf(props).toMatchTypeOf<DeckGLProps>();
expectTypeOf<DeckGLContextValue>().toEqualTypeOf<{deck: Deck | MapboxOverlay | null}>();
expectTypeOf<DeckGLRef['pickObject']>().toEqualTypeOf<Deck['pickObject']>();
expectTypeOf<DeckGLRef['pickObjects']>().toEqualTypeOf<Deck['pickObjects']>();
expectTypeOf<DeckGLRef['pickMultipleObjects']>().toEqualTypeOf<Deck['pickMultipleObjects']>();
expectTypeOf<DeckGLRef['pickObjectAsync']>().toEqualTypeOf<Deck['pickObjectAsync']>();
expectTypeOf<DeckGLRef['pickObjectsAsync']>().toEqualTypeOf<Deck['pickObjectsAsync']>();

// @ts-expect-error Low-level renderer ownership is intentionally excluded.
const unsupportedCanvas: DeckGLProps = {canvas: document.createElement('canvas')};
void unsupportedCanvas;

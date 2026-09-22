import type {Deck} from '@deck.gl/core';
import type {MapboxOverlay} from '@deck.gl/mapbox';
import {createRef} from 'react';
import type {ComponentProps} from 'react';
import {DeckGL} from '../deckgl';
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

// @ts-expect-error Native lifecycle notifications are intentionally excluded from compat.
const unsupportedOnDeckglChange: DeckGLProps = {onDeckglChange: () => undefined};
void unsupportedOnDeckglChange;

const refProps = {
  initialViewState: {latitude: 0, longitude: 0, zoom: 1},
  ref: createRef<DeckGLRef>()
} satisfies ComponentProps<typeof DeckGL>;
void refProps;

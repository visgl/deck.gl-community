import type {Deck} from '@deck.gl/core';
import {DeckGL as NativeDeckGL} from '../dom/components';
import {forwardRef, useCallback, useImperativeHandle, useMemo, useState} from 'react';
import type {MapboxOverlay} from '@deck.gl/mapbox';
import {EMPTY_CONTEXT_VALUE} from './context';
import type {DeckGLInstance, DeckGLProps, DeckGLRef} from './types';

type UnsupportedProps = {
  _customRender?: unknown;
  canvas?: unknown;
  gl?: unknown;
  parent?: unknown;
};

type RuntimeDeckGLProps = DeckGLProps & UnsupportedProps;

type PickingMethod =
  | 'pickObject'
  | 'pickObjectAsync'
  | 'pickObjects'
  | 'pickObjectsAsync'
  | 'pickMultipleObjects';

function getDeckOrThrow(deck: DeckGLInstance | null): DeckGLInstance {
  if (!deck) {
    throw new Error(
      'DeckGL is not initialized yet. Wait until the ref.deck property is available.'
    );
  }

  return deck;
}

function callPickingMethod<Method extends PickingMethod>(
  deck: DeckGLInstance | null,
  method: Method,
  args: Parameters<Deck[Method]>
): ReturnType<Deck[Method]> {
  const instance = getDeckOrThrow(deck) as Deck & Partial<MapboxOverlay>;
  const pick = instance[method];

  if (typeof pick !== 'function') {
    throw new Error(`DeckGL does not support ${method} for this renderer.`);
  }

  return pick.apply(instance, args) as ReturnType<Deck[Method]>;
}

function warnForUnsupportedUsage(props: RuntimeDeckGLProps): void {
  if (process.env.NODE_ENV !== 'development') {
    return;
  }

  const unsupportedProps = (['gl', 'canvas', 'parent', '_customRender'] as const).filter(
    prop => props[prop] !== undefined
  );

  if (unsupportedProps.length > 0) {
    console.warn(
      `DeckGL compat does not support ${unsupportedProps.join(', ')}. ` +
        'Use the native DeckGL component for low-level renderer ownership.'
    );
  }

  if (typeof props.children === 'function') {
    console.warn(
      'DeckGL compat does not support function children. Render supported layer and view components directly.'
    );
  }
}

/**
 * A bounded migration adapter for supported `@deck.gl/react` applications.
 *
 * It lowers compatible layer and view components to the local native reconciler.
 */
export const DeckGL = forwardRef<DeckGLRef, DeckGLProps>(function DeckGL(props, ref) {
  const runtimeProps = props as RuntimeDeckGLProps;
  const {
    ContextProvider,
    _customRender: _unsupportedCustomRender,
    canvas: _unsupportedCanvas,
    gl: _unsupportedGl,
    parent: _unsupportedParent,
    ...deckglProps
  } = runtimeProps;
  const [deck, setDeck] = useState<DeckGLInstance | null>(null);

  warnForUnsupportedUsage(runtimeProps);

  const onDeckglChange = useCallback((nextDeck: DeckGLInstance | null) => {
    setDeck(nextDeck);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      deck,
      pickObject: (...args) => callPickingMethod(deck, 'pickObject', args),
      pickObjects: (...args) => callPickingMethod(deck, 'pickObjects', args),
      pickMultipleObjects: (...args) => callPickingMethod(deck, 'pickMultipleObjects', args),
      pickObjectAsync: (...args) => callPickingMethod(deck, 'pickObjectAsync', args),
      pickObjectsAsync: (...args) => callPickingMethod(deck, 'pickObjectsAsync', args)
    }),
    [deck]
  );

  const contextValue = useMemo(() => (deck ? {deck} : EMPTY_CONTEXT_VALUE), [deck]);
  const children =
    typeof deckglProps.children === 'function' ? null : (deckglProps.children ?? null);
  const content = ContextProvider ? (
    <ContextProvider value={contextValue}>{children}</ContextProvider>
  ) : (
    children
  );

  return (
    <NativeDeckGL {...deckglProps} onDeckglChange={onDeckglChange}>
      {content}
    </NativeDeckGL>
  );
});

import type {Deck} from '@deck.gl/core';
import {log} from '@deck.gl/core';
import {DeckGL as NativeDeckGL} from '../dom/components';
import type {DeckGLRootProps} from '../types/index';
import {forwardRef, useCallback, useImperativeHandle, useMemo, useState} from 'react';
import type {ReactNode} from 'react';
import {EMPTY_CONTEXT_VALUE} from './context';
import type {
  CompatibilityDeckGLProps,
  DeckGLContextValue,
  DeckGLInstance,
  DeckGLProps,
  DeckGLRef
} from './types';

type UnsupportedProps = {
  _customRender?: unknown;
  canvas?: unknown;
  gl?: unknown;
  parent?: unknown;
};

type RuntimeDeckGLProps<Props, Instance> = CompatibilityDeckGLProps<Props, Instance> &
  UnsupportedProps;

type NativeDeckGLComponent<Props, Instance> = (
  props: DeckGLRootProps<Instance, Props> & {children: ReactNode}
) => ReactNode;

type PickingMethod =
  | 'pickObject'
  | 'pickObjectAsync'
  | 'pickObjects'
  | 'pickObjectsAsync'
  | 'pickMultipleObjects';

function getDeckOrThrow<Instance>(deck: Instance | null): Instance {
  if (!deck) {
    throw new Error('DeckGL is not initialized');
  }

  return deck;
}

function callPickingMethod<Instance, Method extends PickingMethod>(
  deck: Instance | null,
  method: Method,
  args: Parameters<Deck[Method]>
): ReturnType<Deck[Method]> {
  const instance = getDeckOrThrow(deck) as Deck & Partial<Record<PickingMethod, Deck[Method]>>;
  const pick = instance[method] as
    | ((...callArgs: Parameters<Deck[Method]>) => ReturnType<Deck[Method]>)
    | undefined;

  if (!pick) {
    throw new Error(`${method} is not supported by this overlay`);
  }

  return pick.apply(instance, args);
}

function warnForUnsupportedUsage(props: UnsupportedProps & {children?: unknown}): void {
  if (process.env.NODE_ENV !== 'development') {
    return;
  }

  const unsupportedProps = (['gl', 'canvas', 'parent', '_customRender'] as const).filter(
    prop => props[prop] !== undefined
  );

  if (unsupportedProps.length > 0) {
    log.warn(`DeckGL compat ignores ${unsupportedProps.join(', ')}; use the native DeckGL`)();
  }

  if (typeof props.children === 'function') {
    log.warn('DeckGL compat ignores function children')();
  }
}

/**
 * Creates a bounded `@deck.gl/react` migration adapter over one native root.
 *
 * @internal Provider entry points bind this helper to their matching native
 * component so they share refs, context, warnings, and picking behavior.
 */
export function createDeckGLAdapter<Props, Instance>(
  NativeComponent: NativeDeckGLComponent<Props, Instance>
) {
  return forwardRef<DeckGLRef<Instance>, CompatibilityDeckGLProps<Props, Instance>>(
    function DeckGL(props, ref) {
      const runtimeProps = props as RuntimeDeckGLProps<Props, Instance>;
      const {
        ContextProvider,
        _customRender: _unsupportedCustomRender,
        canvas: _unsupportedCanvas,
        gl: _unsupportedGl,
        parent: _unsupportedParent,
        ...deckglProps
      } = runtimeProps;
      const [deck, setDeck] = useState<Instance | null>(null);

      warnForUnsupportedUsage(runtimeProps);

      const onDeckChange = useCallback((nextDeck: Instance | null) => {
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

      const contextValue = useMemo<DeckGLContextValue<Instance>>(
        () => (deck ? {deck} : (EMPTY_CONTEXT_VALUE as DeckGLContextValue<Instance>)),
        [deck]
      );
      const children = typeof deckglProps.children === 'function' ? null : deckglProps.children;
      const content = ContextProvider ? (
        <ContextProvider value={contextValue}>{children}</ContextProvider>
      ) : (
        children
      );

      return (
        <NativeComponent {...(deckglProps as Props)} onDeckChange={onDeckChange}>
          {content}
        </NativeComponent>
      );
    }
  );
}

/** A bounded migration adapter for standalone `Deck` applications. */
export const DeckGL = createDeckGLAdapter(NativeDeckGL);

export type {DeckGLInstance, DeckGLProps, DeckGLRef};

// oxlint-disable typescript/no-empty-object-type
// oxlint-disable unicorn/require-module-specifiers
// oxlint-disable import/no-empty-named-blocks
// oxlint-disable typescript/no-empty-interface
// oxlint-disable typescript/no-namespace
import type {Layer, View} from '@deck.gl/core';
import type {ReactNode} from 'react';
import type {} from 'react';
import type {} from 'react/jsx-runtime';
import type {} from 'react/jsx-dev-runtime';

/** JSX intrinsic elements supported by the deck.gl React Fiber renderer. */
export interface DeckglElements {
  /** The deck.gl Layer instance to render. */
  layer: {
    layer: Layer;
    children?: ReactNode;
  };

  /** The deck.gl View instance that owns its child elements. */
  view: {
    view: View;
    children?: ReactNode;
  };
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements extends DeckglElements {}
  }
}

declare module 'react/jsx-runtime' {
  namespace JSX {
    interface IntrinsicElements extends DeckglElements {}
  }
}

declare module 'react/jsx-dev-runtime' {
  namespace JSX {
    interface IntrinsicElements extends DeckglElements {}
  }
}

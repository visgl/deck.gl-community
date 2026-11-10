// oxlint-disable typescript/no-empty-object-type
// oxlint-disable unicorn/require-module-specifiers
// oxlint-disable import/no-empty-named-blocks
// oxlint-disable typescript/no-empty-interface
// oxlint-disable typescript/no-namespace
import type {Layer, View, Widget, WidgetProps} from '@deck.gl/core';
import type {ReactNode, Ref} from 'react';
import type {} from 'react';
import type {} from 'react/jsx-runtime';
import type {} from 'react/jsx-dev-runtime';

/**
 * A deck.gl widget for any views, including one typed for several views, such as
 * `SplitterWidget`.
 */
type AnyWidget = Widget<WidgetProps, View | View[] | null>;

/** JSX intrinsic elements supported by the deck.gl React Fiber renderer. */
export interface DeckGLElements {
  /** The deck.gl Layer instance to render. */
  layer: {
    layer: Layer;
    children?: ReactNode;
    /** Receives the `layer` instance. */
    ref?: Ref<Layer>;
  };

  /** The deck.gl View instance that owns its child elements. */
  view: {
    view: View;
    children?: ReactNode;
    /** Receives the `view` instance. */
    ref?: Ref<View>;
  };

  /** The deck.gl Widget instance to add. Widgets have no children. */
  widget: {
    widget: AnyWidget;
    /** Receives the `widget` instance. */
    ref?: Ref<AnyWidget>;
  };
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements extends DeckGLElements {}
  }
}

declare module 'react/jsx-runtime' {
  namespace JSX {
    interface IntrinsicElements extends DeckGLElements {}
  }
}

declare module 'react/jsx-dev-runtime' {
  namespace JSX {
    interface IntrinsicElements extends DeckGLElements {}
  }
}

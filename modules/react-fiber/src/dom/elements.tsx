import type {Effect, Layer, View} from '@deck.gl/core';
import {createElement} from 'react';
import type {ReactElement, ReactNode, Ref} from 'react';
import type {AnyWidget, DeckGLElements} from '../types/jsx';

/** Props of `DeckGL.Layer`, typed by the layer it renders. */
export type DeckLayerProps<LayerT extends Layer = Layer> = {
  /** The deck.gl Layer instance to render. */
  layer: LayerT;
  children?: ReactNode;
  /** Receives the `layer` instance. */
  ref?: Ref<LayerT>;
};

/** Props of `DeckGL.View`, typed by the view it renders. */
export type DeckViewProps<ViewT extends View = View> = {
  /** The deck.gl View instance that owns its child elements. */
  view: ViewT;
  children?: ReactNode;
  /** Receives the `view` instance. */
  ref?: Ref<ViewT>;
};

/** Props of `DeckGL.Widget`, typed by the widget it adds. */
export type DeckWidgetProps<WidgetT extends AnyWidget = AnyWidget> = {
  /** The deck.gl Widget instance to add. Widgets have no children. */
  widget: WidgetT;
  /** Receives the `widget` instance. */
  ref?: Ref<WidgetT>;
};

/** Props of `DeckGL.Effect`, typed by the effect it applies. */
export type DeckEffectProps<EffectT extends Effect = Effect> = {
  /** The deck.gl effect to apply, such as a `LightingEffect`. Effects have no children. */
  effect: EffectT;
  /** Receives the `effect` instance. */
  ref?: Ref<EffectT>;
};

/** Renders a `<deckLayer>` element. Available as `DeckGL.Layer` on every root. */
export function DeckLayer<LayerT extends Layer>(props: DeckLayerProps<LayerT>): ReactElement {
  // A ref typed for the subclass is safe: the element passes back the same `layer`.
  return createElement('deckLayer', props as DeckGLElements['deckLayer']);
}
DeckLayer.displayName = 'DeckGL.Layer';

/** Renders a `<deckView>` element. Available as `DeckGL.View` on every root. */
export function DeckView<ViewT extends View>(props: DeckViewProps<ViewT>): ReactElement {
  return createElement('deckView', props as DeckGLElements['deckView']);
}
DeckView.displayName = 'DeckGL.View';

/** Renders a `<deckWidget>` element. Available as `DeckGL.Widget` on every root. */
export function DeckWidget<WidgetT extends AnyWidget>(
  props: DeckWidgetProps<WidgetT>
): ReactElement {
  return createElement('deckWidget', props as DeckGLElements['deckWidget']);
}
DeckWidget.displayName = 'DeckGL.Widget';

/** Renders a `<deckEffect>` element. Available as `DeckGL.Effect` on every root. */
export function DeckEffect<EffectT extends Effect>(props: DeckEffectProps<EffectT>): ReactElement {
  return createElement('deckEffect', props as DeckGLElements['deckEffect']);
}
DeckEffect.displayName = 'DeckGL.Effect';

/**
 * The element components attached to every `DeckGL` root, so that
 * `<DeckGL.Layer layer={...} />` renders the same element as `<deckLayer layer={...} />`.
 * Every root shares these components.
 */
export const DECKGL_ELEMENT_COMPONENTS = {
  Layer: DeckLayer,
  View: DeckView,
  Widget: DeckWidget,
  Effect: DeckEffect
} as const;

/** The element components attached to every `DeckGL` root. */
export type DeckGLElementComponents = typeof DECKGL_ELEMENT_COMPONENTS;

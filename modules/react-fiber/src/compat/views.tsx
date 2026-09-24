import {
  FirstPersonView as DeckFirstPersonView,
  _GlobeView as DeckGlobeView,
  MapView as DeckMapView,
  OrbitView as DeckOrbitView,
  OrthographicView as DeckOrthographicView
} from '@deck.gl/core';
import type {
  FirstPersonViewProps,
  GlobeViewProps,
  MapViewProps,
  OrbitViewProps,
  OrthographicViewProps,
  View
} from '@deck.gl/core';
import type {ComponentType, ReactNode} from 'react';

type ViewConstructor<Props extends object> = new (props: Props) => View;
type ViewComponent<Props extends object> = ComponentType<Props & {children?: ReactNode}>;

function createViewComponent<Props extends object>(
  ViewConstructor: ViewConstructor<Props>
): ViewComponent<Props> {
  function ViewComponent({children, ...props}: Props & {children?: ReactNode}) {
    // `view` is also an SVG intrinsic element in React's DOM types, so use a typed
    // host-component alias to target the reconciler's native primitive.
    const NativeView = 'view' as unknown as ComponentType<{
      children?: ReactNode;
      view: View;
    }>;

    return <NativeView view={new ViewConstructor(props as Props)}>{children}</NativeView>;
  }

  return ViewComponent;
}

export const MapView: ViewComponent<MapViewProps> = createViewComponent(
  DeckMapView as ViewConstructor<MapViewProps>
);
export const OrthographicView: ViewComponent<OrthographicViewProps> = createViewComponent(
  DeckOrthographicView as ViewConstructor<OrthographicViewProps>
);
export const OrbitView: ViewComponent<OrbitViewProps> = createViewComponent(
  DeckOrbitView as ViewConstructor<OrbitViewProps>
);
export const FirstPersonView: ViewComponent<FirstPersonViewProps> = createViewComponent(
  DeckFirstPersonView as ViewConstructor<FirstPersonViewProps>
);
export const GlobeView: ViewComponent<GlobeViewProps> = createViewComponent(
  DeckGlobeView as ViewConstructor<GlobeViewProps>
);

import type {DeckProps, View} from '@deck.gl/core';
import type {MapboxOverlayProps} from '@deck.gl/mapbox';
import type {ReactNode} from 'react';

type ViewOrViews = View | View[] | null;

export type DeckglProps<ViewsT extends ViewOrViews = null> = DeckProps<ViewsT> &
  MapboxOverlayProps & {
    children?: ReactNode;
  };

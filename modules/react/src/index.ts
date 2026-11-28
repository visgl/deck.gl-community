// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {createWidgetComponent} from '@deck.gl/react';
import type {PanelComponent, PanelComponentProps} from '@deck.gl-community/panels';
import {PanelWidget} from '@deck.gl-community/widgets';
import type {ReactElement} from 'react';

export {DeckCanvas, type DeckCanvasProps} from './components/deck-canvas';
export {DeviceTabs, type DeviceTabsProps} from './components/device-tabs';

const FiberPanelWidget = createWidgetComponent(PanelWidget);

export type PanelProps<PropsT extends PanelComponentProps> = {
  /** Panel component class to mount in the deck.gl widget tree. */
  type: new (
    props: PropsT
  ) => PanelComponent;
  /** Restrict the widget to this Deck view. */
  viewId?: string | null;
} & NoInfer<PropsT>;

/** Mounts a panel component inside the upstream deck.gl React Fiber renderer. */
export function Panel<PropsT extends PanelComponentProps>({
  type: PanelType,
  viewId,
  ...props
}: PanelProps<PropsT>): ReactElement {
  // The remaining props are the chosen constructor’s props, after removing the JSX type selector.
  return FiberPanelWidget({component: new PanelType(props as unknown as PropsT), viewId});
}

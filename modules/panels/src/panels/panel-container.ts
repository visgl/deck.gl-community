// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {PanelComponent, type PanelComponentProps, type PanelPlacement} from './panel-component';

import type {Panel} from './panel';

/**
 * Shared props supported by panel containers.
 */
export type PanelContainerProps = PanelComponentProps & {
  /** Panel content rendered inside the container shell. */
  panel?: Panel;
  /** Placement anchor used by panel hosts. */
  placement?: PanelPlacement;
};

/**
 * Base class for panel-managed components that host one panel.
 */
export abstract class PanelContainer<
  PropsT extends PanelContainerProps = PanelContainerProps
> extends PanelComponent<PropsT> {
  static defaultProps: Required<PanelContainerProps> = {
    ...PanelComponent.defaultProps,
    panel: undefined!,
    placement: 'top-left'
  };
}

export type {PanelPlacement} from './panel-component';

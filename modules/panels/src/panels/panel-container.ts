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
  /** Default props applied before caller-provided panel container props. */
  static defaultProps: Required<PanelContainerProps> = {
    ...PanelComponent.defaultProps,
    panel: undefined!,
    placement: 'top-left'
  };

  private stopObservingPanel?: () => void;

  /** Start observing live content metadata when a host mounts this shell. */
  override _onAdd(params: {deck: unknown; viewId: string | null}): HTMLDivElement {
    const root = super._onAdd(params);
    this.observePanel();
    return root;
  }

  /** Replace shell props and reconnect when the panel definition changes. */
  override setProps(props: Partial<PropsT>): void {
    super.setProps(props);
    if (this.rootElement) this.observePanel();
  }

  /** Release content subscriptions when the shell is removed. */
  override onRemove(): void {
    this.stopObservingPanel?.();
    this.stopObservingPanel = undefined;
    super.onRemove();
  }

  private observePanel(): void {
    this.stopObservingPanel?.();
    this.stopObservingPanel = this.props.panel?.subscribe(() => this.updateHTML());
  }
}

export type {PanelPlacement} from './panel-component';

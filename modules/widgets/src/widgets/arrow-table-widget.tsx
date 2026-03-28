// deck.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Widget, type WidgetPlacement, type WidgetProps} from '@deck.gl/core';
import {ArrowTablePanel} from '@deck.gl-community/panels';
import {render} from 'preact';

import type {ArrowTableLike} from '@deck.gl-community/panels';

export type ArrowTableWidgetProps = WidgetProps & {
  /** Widget positioning within the view. Default 'top-left'. */
  placement?: WidgetPlacement;
  /** View to attach to and interact with. Required when using multiple views. */
  viewId?: string | null;
  /** Arrow table to display. Accepts Apache Arrow Table-like objects. */
  table?: ArrowTableLike | null;
  /** Header title shown above the table preview. */
  title?: string;
  /** Maximum rows to render in the DOM at once. */
  maxRows?: number;
};

/** Displays an Arrow table in a scrollable grid preview. */
export class ArrowTableWidget extends Widget<ArrowTableWidgetProps> {
  static defaultProps: Required<ArrowTableWidgetProps> = {
    ...Widget.defaultProps,
    id: 'arrow-table',
    placement: 'top-left',
    viewId: null,
    table: null,
    title: 'Arrow Table',
    maxRows: 1000
  };

  className = 'deck-widget-arrow-data';
  placement: WidgetPlacement = 'top-left';

  constructor(props: ArrowTableWidgetProps = {}) {
    super(props);
    this.setProps(this.props);
  }

  setProps(props: Partial<ArrowTableWidgetProps>) {
    this.placement = props.placement ?? this.placement;
    this.viewId = props.viewId;
    super.setProps(props);
  }

  onRenderHTML(rootElement: HTMLElement): void {
    const {table, title, maxRows} = this.props;

    render(
      new ArrowTablePanel({
        id: this.props.id,
        title,
        table,
        maxRows
      }).content,
      rootElement
    );
  }
}

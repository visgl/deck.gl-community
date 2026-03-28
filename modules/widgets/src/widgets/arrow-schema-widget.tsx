// deck.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Widget, type WidgetPlacement, type WidgetProps} from '@deck.gl/core';
import {ArrowSchemaPanel} from '@deck.gl-community/panels';
import {render} from 'preact';

import type {ArrowSchemaLike} from '@deck.gl-community/panels';

export type ArrowSchemaWidgetProps = WidgetProps & {
  /** Widget positioning within the view. Default 'top-left'. */
  placement?: WidgetPlacement;
  /** View to attach to and interact with. Required when using multiple views. */
  viewId?: string | null;
  /** Schema to display. Accepts Apache Arrow Schema-like objects. */
  schema?: ArrowSchemaLike | null;
  /** Header title shown above the schema table. */
  title?: string;
};

/** Displays an Arrow schema in a compact table. */
export class ArrowSchemaWidget extends Widget<ArrowSchemaWidgetProps> {
  static defaultProps: Required<ArrowSchemaWidgetProps> = {
    ...Widget.defaultProps,
    id: 'arrow-schema',
    placement: 'top-left',
    viewId: null,
    schema: null,
    title: 'Arrow Schema'
  };

  className = 'deck-widget-arrow-schema';
  placement: WidgetPlacement = 'top-left';

  constructor(props: ArrowSchemaWidgetProps = {}) {
    super(props);
    this.setProps(this.props);
  }

  setProps(props: Partial<ArrowSchemaWidgetProps>) {
    this.placement = props.placement ?? this.placement;
    this.viewId = props.viewId;
    super.setProps(props);
  }

  onRenderHTML(rootElement: HTMLElement): void {
    render(
      new ArrowSchemaPanel({
        id: this.props.id,
        title: this.props.title,
        schema: this.props.schema
      }).content,
      rootElement
    );
  }
}

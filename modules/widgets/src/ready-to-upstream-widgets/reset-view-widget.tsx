/** @jsxImportSource preact */
import { Widget } from '@deck.gl/core';
import { render } from 'preact';

import type { WidgetPlacement, WidgetProps } from '@deck.gl/core';

export type ResetViewWidgetProps = WidgetProps & {
  /** Widget positioning within the view. Default 'top-left'. */
  placement?: WidgetPlacement;
  /** Tooltip message */
  label?: string;
  /** Callback invoked when the widget button is clicked */
  onResetView?: () => void;
};

/** @todo We can likely just add the onResetView callback to the official ResetViewWidget in deck.g; */
export class ResetViewWidget extends Widget<ResetViewWidgetProps> {
  static defaultProps: Required<ResetViewWidgetProps> = {
    ...Widget.defaultProps,
    id: 'reset-view',
    placement: 'top-left',
    label: 'Resize to fit',
    onResetView: undefined!,
  };

  className = 'deck-widget-reset-view';
  placement: WidgetPlacement = 'top-left';

  constructor(props: ResetViewWidgetProps = {}) {
    super(props);
    this.setProps(this.props);
  }

  setProps(props: Partial<ResetViewWidgetProps>): void {
    this.placement = props.placement ?? this.placement;
    super.setProps(props);
  }

  onRenderHTML(rootElement: HTMLElement): void {
    const label = this.props.label ?? 'Resize to fit';

    render(
      <div className="deck-widget-button">
        <button
          className="deck-widget-icon-button deck-widget-reset-focus"
          type="button"
          title={label}
          aria-label={label}
          onClick={() => this.props.onResetView?.()}
        >
          <div className="deck-widget-icon" />
        </button>
      </div>,
      rootElement,
    );
  }
}

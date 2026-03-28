import { Widget } from '@deck.gl/core';
import { render } from 'preact';

import type { WidgetPlacement, WidgetProps } from '@deck.gl/core';

/** @jsxImportSource preact */

export type ToggleWidgetProps = WidgetProps & {
  placement?: WidgetPlacement;
  viewId?: string | null;
  /** @default false */
  defaultChecked?: boolean;
  /** data url of icon */
  icon: string;
  /** Optional data url of icon when checked */
  onIcon?: string;
  /** Tooltip text */
  label?: string;
  /** Optional tooltip text when checked */
  onLabel?: string;
  /** Icon color when checked
   * @default #3b82f6
   */
  onColor?: string;
  /** Callback on state change */
  onChange?: (checked: boolean) => void;
};

export class ToggleWidget extends Widget<ToggleWidgetProps> {
  static defaultProps: Required<ToggleWidgetProps> = {
    ...Widget.defaultProps,
    id: 'toggle',
    placement: 'top-left',
    viewId: null,
    icon: '',
    label: '',
    defaultChecked: false,
    onIcon: undefined!,
    onLabel: undefined!,
    onColor: '#3b82f6',
    onChange: undefined!,
  };

  className = 'deck-widget-toggle';
  placement: WidgetPlacement = 'top-left';

  checked: boolean = false;

  constructor(props: ToggleWidgetProps) {
    super(props);
    this.setProps(this.props);
    this.checked = this.props.defaultChecked;
  }

  setProps(props: Partial<ToggleWidgetProps>): void {
    this.placement = props.placement ?? this.placement;
    this.viewId = props.viewId ?? this.viewId;
    super.setProps(props);
  }

  toggle = () => {
    this.checked = !this.checked;
    this.props.onChange?.(this.checked);
    this.updateHTML();
  };

  onRenderHTML(rootElement: HTMLElement): void {
    const { icon, label, onIcon = icon, onLabel = label, onColor } = this.props;
    const on = this.checked;
    const title = on ? onLabel : label;

    render(
      <div className="deck-widget-button">
        <button
          className="deck-widget-icon-button"
          type="button"
          title={title}
          aria-label={title}
          onClick={this.toggle}
        >
          <div
            className="deck-widget-icon"
            style={{
              backgroundColor: on ? onColor : '',
              maskImage: `url('${on ? onIcon : icon}')`,
            }}
          />
        </button>
      </div>,
      rootElement,
    );
  }
}

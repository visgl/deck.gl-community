/** @jsxImportSource preact */
import {ToggleWidget} from '@deck.gl/widgets';
import {render} from 'preact';

import {WidgetTooltip} from '@deck.gl-community/panels';

import type {WidgetTooltipPlacement} from '@deck.gl-community/panels';
import type {ToggleWidgetProps} from '@deck.gl/widgets';
import type {JSX} from 'preact';

type CommandToggleWidgetExtraProps = {
  /** Optional command id metadata used by external command wiring. */
  commandId?: string;
  /** Optional caller-owned HTML renderer for the trigger tooltip. */
  renderTooltipHTML?: ({widget}: {widget: CommandToggleWidget}) => HTMLElement | string;
  /** Optional keyboard shortcut text rendered in the tooltip. */
  shortcutKeyHTML?: string;
  /** Tooltip placement relative to the toggle button. */
  tooltipPlacement?: WidgetTooltipPlacement;
};

/** Props for a toggle widget with optional external command metadata and a styled tooltip. */
export type CommandToggleWidgetProps = ToggleWidgetProps & CommandToggleWidgetExtraProps;

/** ToggleWidget subclass that exposes a stable action method and styled tooltips. */
export class CommandToggleWidget extends ToggleWidget {
  /** Resolved props after deck.gl widget defaulting. */
  declare props: Required<ToggleWidgetProps> & CommandToggleWidgetExtraProps;
  /** Command id currently registered for this widget instance. */
  commandId?: string;

  /** Creates a toggle widget. */
  constructor(props: CommandToggleWidgetProps) {
    super(props);
    this.commandId = props.commandId;
  }

  /** Performs the toggle action for external command wiring. */
  static performAction({widget}: {widget: CommandToggleWidget}): void {
    widget.toggleCommand();
  }

  override setProps(props: Partial<CommandToggleWidgetProps>): void {
    this.commandId = props.commandId ?? this.commandId;
    super.setProps(props);
  }

  override onRenderHTML(rootElement: HTMLElement): void {
    const {
      className,
      style,
      icon,
      label,
      color,
      onIcon = icon,
      onLabel = label,
      onColor = color,
      shortcutKeyHTML,
      tooltipPlacement,
      renderTooltipHTML
    } = this.props;
    const isChecked = this.checked;
    const tooltipLabel = isChecked ? onLabel : label;
    const tooltipHTML = renderTooltipHTML?.({widget: this});

    rootElement.dataset.checked = String(isChecked);

    render(
      <WidgetTooltip
        label={tooltipLabel ?? ''}
        html={tooltipHTML}
        shortcutKeyHTML={shortcutKeyHTML}
        placement={tooltipPlacement}
      >
        <div
          className={`deck-widget-button ${className ?? ''}`}
          style={style as unknown as JSX.CSSProperties}
        >
          <button
            aria-label={tooltipLabel}
            aria-pressed={isChecked}
            className="deck-widget-icon-button"
            type="button"
            onClick={this.handleClick}
          >
            <div
              className="deck-widget-icon"
              style={{
                backgroundColor: isChecked ? onColor : color,
                maskImage: `url('${isChecked ? onIcon : icon}')`,
                WebkitMaskImage: `url('${isChecked ? onIcon : icon}')`
              }}
            />
          </button>
        </div>
      </WidgetTooltip>,
      rootElement
    );
  }

  private handleClick = (): void => {
    CommandToggleWidget.performAction({widget: this});
  };

  private toggleCommand(): void {
    this.checked = !this.checked;
    this.props.onChange?.(this.checked);
    this.updateHTML();
  }
}

/** @jsxImportSource preact */
import {ResetViewWidget} from '@deck.gl/widgets';
import {render} from 'preact';

import {WidgetTooltip} from '@deck.gl-community/panels';

import type {WidgetTooltipPlacement} from '@deck.gl-community/panels';
import type {ResetViewWidgetProps} from '@deck.gl/widgets';
import type {JSX} from 'preact';

type CommandResetViewWidgetExtraProps = {
  /** Optional command id metadata used by external command wiring. */
  commandId?: string;
  /** CSS mask data URL used as the reset button icon. */
  icon?: string;
  /** Optional command implementation used instead of the built-in reset behavior. */
  onCommand?: () => void;
  /** Optional caller-owned HTML renderer for the trigger tooltip. */
  renderTooltipHTML?: ({widget}: {widget: CommandResetViewWidget}) => HTMLElement | string;
  /** Optional keyboard shortcut text rendered in the tooltip. */
  shortcutKeyHTML?: string;
  /** Tooltip placement relative to the reset button. */
  tooltipPlacement?: WidgetTooltipPlacement;
};

/** Props for a reset-view widget with optional external command metadata and a styled tooltip. */
export type CommandResetViewWidgetProps = ResetViewWidgetProps & CommandResetViewWidgetExtraProps;

/** ResetViewWidget subclass that exposes a stable action method and styled tooltips. */
export class CommandResetViewWidget extends ResetViewWidget {
  /** Resolved props after deck.gl widget defaulting. */
  declare props: Required<ResetViewWidgetProps> & CommandResetViewWidgetExtraProps;
  /** Command id currently registered for this widget instance. */
  commandId?: string;

  /** Creates a reset-view widget. */
  constructor(props: CommandResetViewWidgetProps = {}) {
    super(props);
    this.commandId = props.commandId;
  }

  /** Performs the reset action for external command wiring. */
  static performAction({widget}: {widget: CommandResetViewWidget}): void {
    widget.runCommand();
  }

  override setProps(props: Partial<CommandResetViewWidgetProps>): void {
    this.commandId = props.commandId ?? this.commandId;
    super.setProps(props);
  }

  override onRenderHTML(rootElement: HTMLElement): void {
    const {
      className,
      style,
      icon = '',
      label = 'Reset View',
      shortcutKeyHTML,
      renderTooltipHTML
    } = this.props;
    const tooltipHTML = renderTooltipHTML?.({widget: this});

    rootElement.className = ['deck-widget', this.className, this.props.className]
      .filter(Boolean)
      .join(' ');

    render(
      <WidgetTooltip
        label={label}
        html={tooltipHTML}
        shortcutKeyHTML={shortcutKeyHTML}
        placement={this.props.tooltipPlacement}
      >
        <div
          className={`deck-widget-button ${className ?? ''}`}
          style={style as unknown as JSX.CSSProperties}
        >
          <button
            aria-label={label}
            className="deck-widget-icon-button deck-widget-reset-focus"
            type="button"
            onClick={this.handleWidgetClick}
          >
            <div
              className="deck-widget-icon"
              style={
                icon
                  ? {
                      maskImage: `url('${icon}')`,
                      WebkitMaskImage: `url('${icon}')`
                    }
                  : undefined
              }
            />
          </button>
        </div>
      </WidgetTooltip>,
      rootElement
    );
  }

  private handleWidgetClick = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    CommandResetViewWidget.performAction({widget: this});
  };

  private runCommand(): void {
    if (this.props.onCommand) {
      this.props.onCommand();
      return;
    }
    super.handleClick();
  }
}

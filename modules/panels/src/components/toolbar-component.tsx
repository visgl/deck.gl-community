/* eslint react/no-unknown-property: 0 */
/** @jsxImportSource preact */
import {render} from 'preact';
import {PanelComponent} from '../panels/panel-component';

import type {ComponentChild, JSX} from 'preact';
import type {PanelComponentProps, PanelPlacement} from '../panels/panel-component';

/** One toolbar button that invokes an action callback. */
export type ToolbarComponentActionItem = {
  /** Toolbar item discriminator. */
  kind: 'action';
  /** Stable toolbar item id. */
  id: string;
  /** Visible action label. */
  label: string;
  /** Optional icon rendered before the label. */
  icon?: ComponentChild;
  /** Optional tooltip and accessible label override. */
  title?: string;
  /** Whether the action is disabled. */
  disabled?: boolean;
  /** Whether the action renders active styling. */
  active?: boolean;
  /** Callback fired when the enabled action is clicked. */
  onClick?: () => void;
};

/** One option rendered inside a toolbar toggle group. */
export type ToolbarComponentToggleOption = {
  /** Stable toggle option id. */
  id: string;
  /** Visible option label. */
  label: string;
  /** Optional icon rendered before the label. */
  icon?: ComponentChild;
  /** Optional tooltip and accessible label override. */
  title?: string;
  /** Whether the option is disabled. */
  disabled?: boolean;
};

/** One mutually exclusive toolbar toggle group. */
export type ToolbarComponentToggleGroupItem = {
  /** Toolbar item discriminator. */
  kind: 'toggle-group';
  /** Stable toolbar item id. */
  id: string;
  /** Optional visible group label. */
  label?: string;
  /** Optional tooltip fallback for group options. */
  title?: string;
  /** Whether every option in the group is disabled. */
  disabled?: boolean;
  /** Currently selected option id. */
  selectedId?: string | null;
  /** Ordered toggle options rendered by the group. */
  options: ToolbarComponentToggleOption[];
  /** Callback fired when an enabled option is clicked. */
  onSelect?: (optionId: string) => void;
};

/** One read-only toolbar badge. */
export type ToolbarComponentBadgeItem = {
  /** Toolbar item discriminator. */
  kind: 'badge';
  /** Stable toolbar item id. */
  id: string;
  /** Visible badge label. */
  label: string;
  /** Optional badge tooltip. */
  title?: string;
};

/** Supported toolbar item variants. */
export type ToolbarComponentItem =
  | ToolbarComponentActionItem
  | ToolbarComponentToggleGroupItem
  | ToolbarComponentBadgeItem;

/** Props for {@link ToolbarComponent}. */
export type ToolbarComponentProps = PanelComponentProps & {
  /** Placement anchor used by panel hosts. */
  placement?: PanelPlacement;
  /** Ordered toolbar items rendered by the component. */
  items?: ToolbarComponentItem[];
};

const ROOT_STYLE: Partial<CSSStyleDeclaration> = {
  position: 'absolute',
  display: 'flex',
  pointerEvents: 'auto',
  userSelect: 'none',
  zIndex: '99'
};

const TOOLBAR_STYLE: JSX.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  flexWrap: 'wrap',
  padding: '8px 10px',
  borderRadius: '999px',
  background: 'rgba(36, 40, 41, 0.88)',
  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.25)'
};

const ITEM_GROUP_STYLE: JSX.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  minWidth: '0'
};

const BUTTON_STYLE: JSX.CSSProperties = {
  appearance: 'none',
  border: 'none',
  borderRadius: '999px',
  background: 'transparent',
  color: '#f0f0f0',
  minHeight: '30px',
  padding: '0 10px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '6px',
  cursor: 'pointer',
  fontSize: '11px',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  fontWeight: '500',
  transition: 'background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease',
  whiteSpace: 'nowrap'
};

const ACTIVE_BUTTON_STYLE: JSX.CSSProperties = {
  background: '#0071e3',
  color: '#ffffff',
  boxShadow: '0 0 0 2px rgba(255, 255, 255, 0.35)'
};

const DISABLED_BUTTON_STYLE: JSX.CSSProperties = {
  opacity: 0.45,
  cursor: 'default'
};

const GROUP_LABEL_STYLE: JSX.CSSProperties = {
  color: 'rgba(255, 255, 255, 0.65)',
  fontSize: '11px',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  whiteSpace: 'nowrap'
};

const BADGE_STYLE: JSX.CSSProperties = {
  padding: '0 8px',
  minHeight: '28px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '999px',
  background: 'rgba(255, 255, 255, 0.12)',
  color: 'rgba(255, 255, 255, 0.88)',
  fontSize: '11px',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  whiteSpace: 'nowrap'
};

function stopToolbarEventPropagation(event: Event) {
  event.stopPropagation();
  if (
    typeof (event as {stopImmediatePropagation?: () => void}).stopImmediatePropagation ===
    'function'
  ) {
    (event as {stopImmediatePropagation?: () => void}).stopImmediatePropagation?.();
  }
}

function ToolbarComponentView({items}: {items: ToolbarComponentItem[]}) {
  return (
    <div
      style={TOOLBAR_STYLE}
      onPointerDown={stopToolbarEventPropagation}
      onPointerMove={stopToolbarEventPropagation}
      onPointerUp={stopToolbarEventPropagation}
      onMouseDown={stopToolbarEventPropagation}
      onMouseMove={stopToolbarEventPropagation}
      onMouseUp={stopToolbarEventPropagation}
      onTouchStart={stopToolbarEventPropagation}
      onTouchMove={stopToolbarEventPropagation}
      onTouchEnd={stopToolbarEventPropagation}
      onClick={stopToolbarEventPropagation}
      onDblClick={stopToolbarEventPropagation}
      onContextMenu={stopToolbarEventPropagation}
      onWheel={stopToolbarEventPropagation}
    >
      {items.map(item => renderToolbarItem(item))}
    </div>
  );
}

function renderToolbarItem(item: ToolbarComponentItem): JSX.Element {
  if (item.kind === 'badge') {
    return (
      <div key={item.id} title={item.title} style={BADGE_STYLE} data-toolbar-item-kind="badge">
        {item.label}
      </div>
    );
  }

  if (item.kind === 'action') {
    const disabled = item.disabled ?? false;
    const buttonStyle: JSX.CSSProperties = {
      ...BUTTON_STYLE,
      ...(item.active ? ACTIVE_BUTTON_STYLE : {}),
      ...(disabled ? DISABLED_BUTTON_STYLE : {})
    };

    return (
      <button
        key={item.id}
        type="button"
        title={item.title ?? item.label}
        aria-label={item.title ?? item.label}
        aria-pressed={item.active ? 'true' : 'false'}
        disabled={disabled}
        style={buttonStyle}
        data-toolbar-item-kind="action"
        data-toolbar-item-id={item.id}
        onClick={() => {
          if (!disabled) {
            item.onClick?.();
          }
        }}
      >
        {item.icon}
        <span>{item.label}</span>
      </button>
    );
  }

  const groupDisabled = item.disabled ?? false;
  return (
    <div key={item.id} style={ITEM_GROUP_STYLE} data-toolbar-item-kind="toggle-group">
      {item.label ? <span style={GROUP_LABEL_STYLE}>{item.label}</span> : null}
      {item.options.map(option => {
        const disabled = groupDisabled || option.disabled;
        const active = item.selectedId === option.id;
        const buttonStyle: JSX.CSSProperties = {
          ...BUTTON_STYLE,
          ...(active ? ACTIVE_BUTTON_STYLE : {}),
          ...(disabled ? DISABLED_BUTTON_STYLE : {})
        };

        return (
          <button
            key={option.id}
            type="button"
            title={option.title ?? option.label ?? item.title}
            aria-label={option.title ?? option.label ?? item.title}
            aria-pressed={active ? 'true' : 'false'}
            disabled={disabled}
            style={buttonStyle}
            data-toolbar-group-id={item.id}
            data-toolbar-option-id={option.id}
            onClick={() => {
              if (!disabled) {
                item.onSelect?.(option.id);
              }
            }}
          >
            {option.icon}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Compact action/status toolbar rendered as a panel-managed component. */
export class ToolbarComponent extends PanelComponent<ToolbarComponentProps> {
  /** Default props applied before caller-provided toolbar props. */
  static defaultProps: Required<ToolbarComponentProps> = {
    ...PanelComponent.defaultProps,
    id: 'toolbar-component',
    placement: 'top-right',
    items: []
  };

  /** Root CSS class applied to the mounted toolbar component. */
  className = 'deck-widget-toolbar';
  /** Placement anchor used by panel hosts. */
  placement: PanelPlacement = ToolbarComponent.defaultProps.placement;
  #rootElement: HTMLElement | null = null;

  /** Creates one toolbar component. */
  constructor(props: ToolbarComponentProps = {}) {
    super({...ToolbarComponent.defaultProps, ...props});
    this.setProps(this.props);
  }

  /** Updates toolbar props and refreshes mounted content when present. */
  override setProps(props: Partial<ToolbarComponentProps>): void {
    if (props.placement !== undefined) {
      this.placement = props.placement;
    }
    super.setProps(props);
    this.#render();
  }

  /** Unmounts toolbar content from the current root element. */
  override onRemove(): void {
    if (this.#rootElement) {
      render(null, this.#rootElement);
    }
  }

  /** Renders toolbar items into a mounted root element. */
  override onRenderHTML(rootElement: HTMLElement): void {
    this.#rootElement = rootElement;
    const className = ['deck-widget', this.className, this.props.className]
      .filter(Boolean)
      .join(' ');
    rootElement.className = className;
    Object.assign(rootElement.style, ROOT_STYLE, this.props.style ?? {});
    this.#render();
  }

  #render() {
    if (!this.#rootElement) {
      return;
    }

    render(<ToolbarComponentView items={this.props.items ?? []} />, this.#rootElement);
  }
}

/** @jsxImportSource preact */
import { Widget } from '@deck.gl/core';
import { render } from 'preact';

import { asPanelContainer, WidgetContainerRenderer } from './widget-containers';
import { makeTextIcon } from './widget-utils';

import type { WidgetContainer, WidgetPanel } from './widget-containers';
import type { WidgetPlacement, WidgetProps } from '@deck.gl/core';
import type { JSX } from 'preact';

/** Sidebar widget properties. */
export type SidebarWidgetProps = WidgetProps & {
  /** Trigger icon alias for legacy compatibility. */
  icon?: string;
  /** The content container to show in the sidebar. */
  container?: WidgetContainer;
  /** Optional shorthand panel. When supplied, shown directly inside the sidebar. */
  panel?: WidgetPanel;
  /** Preferred sidebar edge. */
  side?: 'left' | 'right';
  /** Sidebar width in pixels. */
  widthPx?: number;
  /** Container placement inside the selected widget container. */
  placement?: WidgetPlacement;
  /** Sidebar header title. */
  title?: string;
  /** Uncontrolled default open state. */
  defaultOpen?: boolean;
  /**
   * Controlled open state. If supplied, callers own open/closed state.
   */
  open?: boolean;
  /** Called when user intent changes open/closed state. */
  onOpenChange?: (open: boolean) => void;
  /** Optional trigger label. */
  triggerLabel?: string;
  /** Optional trigger icon. Defaults to a panel-like glyph. */
  triggerIcon?: string;
  /**
   * Hides the trigger. Useful when trigger is implemented externally.
   */
  hideTrigger?: boolean;
  /**
   * Whether to render the built-in icon trigger button.
   * If false, a text trigger button is used unless hidden.
   */
  button?: boolean;
};

const SIDEBAR_WIDGET_CLASS = 'deck-widget-sidebar';
const SIDEBAR_TRIGGER_ICON = makeTextIcon('☰', 16, 24);
const SIDEBAR_HANDLE_WIDTH_PX = 36;
const SIDEBAR_HANDLE_GAP_PX = 8;
const SIDEBAR_TRANSITION_MS = 320;
const SIDEBAR_OVERLAY_Z_INDEX = '35';

/**
 * Resolves the trigger icon from legacy and new prop names.
 */
function resolveTriggerIcon({
  icon,
  triggerIcon,
}: {
  icon?: string;
  triggerIcon?: string;
}): string {
  if (icon !== undefined) {
    return icon;
  }

  if (triggerIcon !== undefined) {
    return triggerIcon;
  }

  return SIDEBAR_TRIGGER_ICON;
}

/**
 * Renders a sidebar container with an edge-mounted trigger and animated slide-over panel.
 */
function SidebarWidgetView({
  container,
  side,
  title,
  triggerLabel,
  open,
  button,
  hideTrigger,
  panelWidthPx,
  onOpenChange,
}: {
  container: WidgetContainer;
  side: 'left' | 'right';
  title?: string;
  triggerLabel: string;
  open: boolean;
  button: boolean;
  hideTrigger: boolean;
  panelWidthPx: number;
  onOpenChange: (next: boolean) => void;
}) {
  const shouldRenderShell = open || !hideTrigger;
  const panelWidthWithHandlePx = hideTrigger
    ? panelWidthPx
    : panelWidthPx + SIDEBAR_HANDLE_WIDTH_PX + SIDEBAR_HANDLE_GAP_PX;
  const handleChevron = getSidebarHandleChevron(side, open);
  const handleLabel = open ? `Close ${triggerLabel}` : triggerLabel;

  return (
    <div>
      {!shouldRenderShell ? null : (
        <aside style={SIDEBAR_PANEL_WRAPPER_STYLE} aria-label={title ?? triggerLabel}>
          <div
            data-sidebar-shell=""
            style={SIDEBAR_SHELL_STYLE(side, panelWidthPx, panelWidthWithHandlePx, open)}
          >
            {!hideTrigger && (
              <div data-sidebar-handle="" style={SIDEBAR_HANDLE_WRAPPER_STYLE}>
                {button ? (
                  <button
                    type="button"
                    data-sidebar-handle-button=""
                    aria-label={handleLabel}
                    title={handleLabel}
                    style={SIDEBAR_HANDLE_BUTTON_STYLE}
                    onClick={() => onOpenChange(!open)}
                  >
                    <span aria-hidden="true" style={SIDEBAR_HANDLE_CHEVRON_STYLE}>
                      {handleChevron}
                    </span>
                  </button>
                ) : (
                  <div className="deck-widget-button" style={SIDEBAR_HANDLE_BUTTON_WRAPPER_STYLE}>
                    <button
                      type="button"
                      aria-label={open ? `Close ${triggerLabel}` : triggerLabel}
                      style={SIDEBAR_TRIGGER_STYLE}
                      onPointerUp={() => onOpenChange(!open)}
                    >
                      {triggerLabel}
                    </button>
                  </div>
                )}
              </div>
            )}
            <div
              style={SIDEBAR_PANEL_STYLE(side, panelWidthPx, open)}
              role="dialog"
              aria-hidden={!open}
            >
              {title ? (
                <header style={SIDEBAR_HEADER_STYLE}>
                  <span>{title}</span>
                </header>
              ) : null}
              <div style={SIDEBAR_CONTENT_STYLE}>
                <WidgetContainerRenderer container={container} />
              </div>
            </div>
          </div>
        </aside>
      )}
    </div>
  );
}

/**
 * Normalizes sidebar width configuration into a practical render value.
 */
function normalizeSidebarWidthPx(widthPx: number): number {
  const clamped = Math.max(220, Math.floor(widthPx));
  return Number.isFinite(clamped) ? clamped : 360;
}

/**
 * A reusable deck widget that renders a side-anchored panel with configurable container content.
 */
export class SidebarWidget extends Widget<SidebarWidgetProps> {
  static defaultProps: Required<SidebarWidgetProps> = {
    ...Widget.defaultProps,
    id: 'sidebar-widget',
    panel: undefined!,
    container: {
      kind: 'accordeon',
      props: {
        panels: [],
      },
    },
    side: 'right',
    widthPx: 360,
    placement: 'top-right',
    title: undefined!,
    defaultOpen: true,
    open: undefined!,
    onOpenChange: undefined!,
    icon: undefined!,
    hideTrigger: false,
    triggerLabel: 'Open sidebar',
    triggerIcon: SIDEBAR_TRIGGER_ICON,
    button: false,
  };

  className = SIDEBAR_WIDGET_CLASS;
  placement: WidgetPlacement = SidebarWidget.defaultProps.placement;
  side: 'left' | 'right' = SidebarWidget.defaultProps.side;
  widthPx = SidebarWidget.defaultProps.widthPx;
  title: string | undefined = SidebarWidget.defaultProps.title;
  triggerLabel = SidebarWidget.defaultProps.triggerLabel;
  hideTrigger = SidebarWidget.defaultProps.hideTrigger;
  triggerIcon = SidebarWidget.defaultProps.triggerIcon;
  button = SidebarWidget.defaultProps.button;
  isOpen = false;
  #hasOpenStateInitialized = false;
  #container: WidgetContainer = SidebarWidget.defaultProps.container;
  #isControlled = false;
  #openChange: ((open: boolean) => void) | undefined = undefined;
  #rootElement: HTMLElement | null = null;
  #overlayParent: HTMLElement | null = null;

  constructor(props: Partial<SidebarWidgetProps> = {}) {
    super({
      ...SidebarWidget.defaultProps,
      ...props,
      container: props.container ?? asContainer(props.panel),
      triggerIcon: resolveTriggerIcon(props),
    } as SidebarWidgetProps);
    this.setProps(this.props);
  }

  setProps(props: Partial<SidebarWidgetProps>): void {
    this.#setDisplayProps(props);
    this.#setContainerProps(props);
    this.#setOpenProps(props);
    this.#render();
    super.setProps(props);
  }

  onAdd(): void {
    this.#render();
  }

  onRemove(): void {
    if (this.#rootElement) {
      render(null, this.#rootElement);
    }
  }

  onRenderHTML(rootElement: HTMLElement): void {
    this.#rootElement = rootElement;
    this.#overlayParent ??= this.#resolveOverlayParent(rootElement);
    if (this.#overlayParent && rootElement.parentElement !== this.#overlayParent) {
      this.#overlayParent.append(rootElement);
    }
    const className = ['deck-widget', this.className, this.props.className]
      .filter(Boolean)
      .join(' ');
    rootElement.className = className;
    rootElement.style.position = 'absolute';
    rootElement.style.top = 'var(--widget-margin, 12px)';
    rootElement.style.bottom = 'var(--widget-margin, 12px)';
    rootElement.style.left =
      this.side === 'left' ? '-1px' : 'var(--widget-margin, 12px)';
    rootElement.style.right =
      this.side === 'right' ? '-1px' : 'var(--widget-margin, 12px)';
    rootElement.style.width = 'auto';
    rootElement.style.height = 'auto';
    rootElement.style.margin = '0';
    rootElement.style.overflow = 'hidden';
    rootElement.style.pointerEvents = 'none';
    rootElement.style.zIndex = SIDEBAR_OVERLAY_Z_INDEX;
    (this.props as { _widgetContainer?: 'overlay' })._widgetContainer = 'overlay';
    this.#render();
  }

  #handleOpenChange = (nextOpen: boolean) => {
    if (!this.#isControlled) {
      this.isOpen = nextOpen;
    }
    this.#openChange?.(nextOpen);
    this.#render();
  };

  #render = () => {
    if (!this.#rootElement) {
      return;
    }

    render(
      <SidebarWidgetView
        container={this.#container}
        side={this.side}
        title={this.title}
        triggerLabel={this.triggerLabel}
        open={this.isOpen}
        button={this.button}
        hideTrigger={this.hideTrigger}
        panelWidthPx={this.widthPx}
        onOpenChange={this.#handleOpenChange}
      />,
      this.#rootElement,
    );
  };

  #setDisplayProps(props: Partial<SidebarWidgetProps>): void {
    if (props.icon !== undefined) {
      this.triggerIcon = props.icon;
    }
    if (props.placement !== undefined) {
      this.placement = props.placement;
    }
    if ('title' in props) {
      this.title = props.title;
    }
    if (props.side !== undefined) {
      this.side = props.side;
    }
    if (props.widthPx !== undefined) {
      this.widthPx = normalizeSidebarWidthPx(props.widthPx);
    }
    if (props.triggerLabel !== undefined) {
      this.triggerLabel = props.triggerLabel;
    }
    if (props.triggerIcon !== undefined) {
      this.triggerIcon = props.triggerIcon;
    }
    if (props.hideTrigger !== undefined) {
      this.hideTrigger = props.hideTrigger;
    }
    if (props.button !== undefined) {
      this.button = props.button;
    }
  }

  #setContainerProps(props: Partial<SidebarWidgetProps>): void {
    if (props.container !== undefined) {
      this.#container = props.container;
    } else if (props.panel !== undefined) {
      this.#container = asContainer(props.panel);
    }
    if (props.onOpenChange !== undefined) {
      this.#openChange = props.onOpenChange;
    }
  }

  #setOpenProps(props: Partial<SidebarWidgetProps>): void {
    this.#isControlled = props.open !== undefined;
    if (props.open !== undefined) {
      this.isOpen = props.open;
      this.#hasOpenStateInitialized = true;
      return;
    }
    if (!this.#hasOpenStateInitialized && props.defaultOpen !== undefined) {
      this.isOpen = props.defaultOpen;
      this.#hasOpenStateInitialized = true;
    }
  }

  #resolveOverlayParent(rootElement: HTMLElement): HTMLElement | null {
    const explicitContainer = this.props._container;
    if (explicitContainer && typeof explicitContainer !== 'string') {
      return explicitContainer;
    }
    return rootElement.parentElement?.parentElement;
  }
}

function asContainer(panel?: WidgetPanel): WidgetContainer {
  if (panel === undefined) {
    return {
      kind: 'accordeon',
      props: {
        panels: [],
      },
    };
  }
  return asPanelContainer(panel);
}

/**
 * Returns the directional chevron shown in the built-in sidebar handle.
 */
function getSidebarHandleChevron(side: 'left' | 'right', open: boolean): string {
  if (side === 'left') {
    return open ? '‹' : '›';
  }

  return open ? '›' : '‹';
}

const SIDEBAR_TRIGGER_STYLE: JSX.CSSProperties = {
  border: '1px solid var(--menu-border, rgba(148, 163, 184, 0.35))',
  borderRadius: '6px',
  background: 'var(--menu-background, #fff)',
  color: 'var(--button-text, rgb(24, 24, 26))',
  fontSize: '12px',
  lineHeight: '1.1',
  padding: '8px 10px',
  cursor: 'pointer',
};

const SIDEBAR_PANEL_WRAPPER_STYLE: JSX.CSSProperties = {
  position: 'absolute',
  inset: '0',
  pointerEvents: 'none',
  zIndex: 31,
};

const SIDEBAR_SHELL_STYLE = (
  side: 'left' | 'right',
  panelWidthPx: number,
  panelWidthWithHandlePx: number,
  open: boolean,
): JSX.CSSProperties => ({
  position: 'absolute',
  top: '0',
  bottom: '0',
  [side]: '0',
  width: `${panelWidthWithHandlePx}px`,
  display: 'flex',
  flexDirection: side === 'left' ? 'row-reverse' : 'row',
  alignItems: 'flex-start',
  pointerEvents: 'none',
  transform: open
    ? 'translateX(0px)'
    : `translateX(${side === 'left' ? -panelWidthPx : panelWidthPx}px)`,
  transition: `transform ${SIDEBAR_TRANSITION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`,
  willChange: 'transform',
  gap: `${SIDEBAR_HANDLE_GAP_PX}px`,
});

const SIDEBAR_HANDLE_WRAPPER_STYLE: JSX.CSSProperties = {
  width: `${SIDEBAR_HANDLE_WIDTH_PX}px`,
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  pointerEvents: 'auto',
};

const SIDEBAR_HANDLE_BUTTON_WRAPPER_STYLE: JSX.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const SIDEBAR_HANDLE_BUTTON_STYLE: JSX.CSSProperties = {
  width: `${SIDEBAR_HANDLE_WIDTH_PX}px`,
  minWidth: `${SIDEBAR_HANDLE_WIDTH_PX}px`,
  height: '40px',
  border: 'var(--button-inner-stroke, 1px solid rgba(148, 163, 184, 0.35))',
  borderRadius: '2px',
  background: 'var(--button-background, #fff)',
  backdropFilter: 'var(--button-backdrop-filter, unset)',
  color: 'var(--button-text, rgb(24, 24, 26))',
  boxShadow: 'var(--button-shadow, 0px 0px 8px 0px rgba(0, 0, 0, 0.25))',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  pointerEvents: 'auto',
  padding: '0',
};

const SIDEBAR_HANDLE_CHEVRON_STYLE: JSX.CSSProperties = {
  display: 'block',
  fontSize: '22px',
  fontWeight: 700,
  lineHeight: '1',
  transform: 'translateY(-1px)',
  color: 'var(--button-icon-idle, #616166)',
  transition: `transform ${SIDEBAR_TRANSITION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`,
};

const SIDEBAR_PANEL_STYLE = (
  side: 'left' | 'right',
  panelWidthPx: number,
  open: boolean,
): JSX.CSSProperties => ({
  pointerEvents: 'auto',
  width: `${panelWidthPx}px`,
  maxWidth: `min(84vw, ${panelWidthPx}px)`,
  minWidth: `${Math.min(panelWidthPx, 260)}px`,
  height: '100%',
  borderLeft:
    side === 'right' ? '1px solid var(--menu-border, rgba(148, 163, 184, 0.35))' : undefined,
  borderRight:
    side === 'left' ? '1px solid var(--menu-border, rgba(148, 163, 184, 0.35))' : undefined,
  background: 'var(--menu-background, #fff)',
  color: 'var(--menu-text, rgb(24, 24, 26))',
  boxShadow: 'var(--menu-shadow, -8px 0 25px rgba(0, 0, 0, 0.22))',
  display: 'flex',
  flexDirection: 'column',
  opacity: open ? 1 : 0.98,
});

const SIDEBAR_HEADER_STYLE: JSX.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-start',
  gap: '10px',
  padding: '10px 12px',
  borderBottom: 'var(--menu-divider, var(--menu-border, 1px solid rgba(148, 163, 184, 0.25)))',
  background: 'var(--menu-weak-background, var(--button-background, var(--menu-background, #fff)))',
  color: 'var(--menu-text, rgb(24, 24, 26))',
  fontSize: '13px',
  fontWeight: 700,
};

const SIDEBAR_CONTENT_STYLE: JSX.CSSProperties = {
  flex: 1,
  overflow: 'auto',
  padding: '10px',
};

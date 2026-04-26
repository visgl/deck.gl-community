/* eslint react/react-in-jsx-scope: 0, react/no-unknown-property: 0 */
/** @jsxImportSource preact */
import {render} from 'preact';
import {PanelContainer, type PanelContainerProps, type PanelPlacement} from '../panel-container';
import {PanelContentRenderer, asPanelContainer} from '../panels/panel-containers';

import type {PanelContentContainer, Panel} from '../panels/panel-containers';
import type {JSX} from 'preact';

/**
 * Props for {@link PanelSidebar}.
 */
export type PanelSidebarProps = PanelContainerProps & {
  /** One pre-built container definition to render. */
  container?: PanelContentContainer;
  /** Convenience single-panel input converted into a container automatically. */
  panel?: Panel;
  /** Edge from which the sidebar opens. */
  side?: 'left' | 'right';
  /** Preferred sidebar width in pixels. */
  widthPx?: number;
  /** Placement anchor used for the trigger shell when mounted by {@link PanelManager}. */
  placement?: PanelPlacement;
  /** Optional header title shown above the sidebar content. */
  title?: string;
  /** Initial open state for uncontrolled usage. */
  defaultOpen?: boolean;
  /** Controlled open state. */
  open?: boolean;
  /** Callback fired when the open state changes. */
  onOpenChange?: (open: boolean) => void;
  /** Label used for the trigger affordance. */
  triggerLabel?: string;
  /** Whether the trigger affordance should be hidden. */
  hideTrigger?: boolean;
  /** Whether to render the compact side-handle button style. */
  button?: boolean;
};

const SIDEBAR_HANDLE_WIDTH_PX = 36;
const SIDEBAR_HANDLE_GAP_PX = 8;
const SIDEBAR_TRANSITION_MS = 320;
const SIDEBAR_OVERLAY_Z_INDEX = '35';

function resolveContainer(container?: PanelContentContainer, panel?: Panel): PanelContentContainer {
  if (container !== undefined) {
    return container;
  }
  if (panel !== undefined) {
    return asPanelContainer(panel);
  }
  return {
    kind: 'accordeon',
    props: {
      panels: []
    }
  };
}

function normalizeSidebarWidthPx(widthPx: number): number {
  const clamped = Math.max(220, Math.floor(widthPx));
  return Number.isFinite(clamped) ? clamped : 360;
}

function stopSidebarEventPropagation(event: Event): void {
  event.stopPropagation();
}

function getSidebarHandleChevron(side: 'left' | 'right', open: boolean): string {
  if (side === 'left') {
    return open ? '‹' : '›';
  }
  return open ? '›' : '‹';
}

function PanelSidebarView({
  container,
  side,
  title,
  triggerLabel,
  open,
  button,
  hideTrigger,
  panelWidthPx,
  onOpenChange
}: {
  container: PanelContentContainer;
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
            onPointerDown={stopSidebarEventPropagation}
            onPointerMove={stopSidebarEventPropagation}
            onPointerUp={stopSidebarEventPropagation}
            onMouseDown={stopSidebarEventPropagation}
            onMouseMove={stopSidebarEventPropagation}
            onMouseUp={stopSidebarEventPropagation}
            onTouchStart={stopSidebarEventPropagation}
            onTouchMove={stopSidebarEventPropagation}
            onTouchEnd={stopSidebarEventPropagation}
            onClick={stopSidebarEventPropagation}
            onDblClick={stopSidebarEventPropagation}
            onContextMenu={stopSidebarEventPropagation}
            onWheel={stopSidebarEventPropagation}
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
                  <button
                    type="button"
                    aria-label={handleLabel}
                    style={SIDEBAR_TRIGGER_STYLE}
                    onPointerUp={() => onOpenChange(!open)}
                  >
                    {triggerLabel}
                  </button>
                )}
              </div>
            )}
            <div
              style={SIDEBAR_PANEL_STYLE(side, panelWidthPx, open)}
              role="dialog"
              aria-hidden={open ? 'false' : 'true'}
            >
              {title ? <header style={SIDEBAR_HEADER_STYLE}>{title}</header> : null}
              <div style={SIDEBAR_CONTENT_STYLE}>
                <PanelContentRenderer container={container} />
              </div>
            </div>
          </div>
        </aside>
      )}
    </div>
  );
}

/**
 * Edge-attached panel container with an optional side handle for open/close control.
 */
export class PanelSidebar extends PanelContainer<PanelSidebarProps> {
  static defaultProps: Required<PanelSidebarProps> = {
    ...PanelContainer.defaultProps,
    id: 'panel-sidebar',
    panel: undefined!,
    container: {
      kind: 'accordeon',
      props: {
        panels: []
      }
    },
    side: 'right',
    widthPx: 360,
    placement: 'top-right',
    title: undefined!,
    defaultOpen: true,
    open: undefined!,
    onOpenChange: undefined!,
    hideTrigger: false,
    triggerLabel: 'Open sidebar',
    button: false
  };

  className = 'deck-widget-sidebar';
  placement: PanelPlacement = PanelSidebar.defaultProps.placement;
  side: 'left' | 'right' = PanelSidebar.defaultProps.side;
  widthPx = PanelSidebar.defaultProps.widthPx;
  title: string | undefined = PanelSidebar.defaultProps.title;
  triggerLabel = PanelSidebar.defaultProps.triggerLabel;
  hideTrigger = PanelSidebar.defaultProps.hideTrigger;
  button = PanelSidebar.defaultProps.button;
  isOpen = false;
  #hasOpenStateInitialized = false;
  #container: PanelContentContainer = PanelSidebar.defaultProps.container;
  #isControlled = false;
  #openChange: ((open: boolean) => void) | undefined = undefined;
  #rootElement: HTMLElement | null = null;

  constructor(props: Partial<PanelSidebarProps> = {}) {
    super({
      ...PanelSidebar.defaultProps,
      ...props,
      container: resolveContainer(props.container, props.panel)
    } as PanelSidebarProps);
    this.setProps(this.props);
  }

  override setProps(props: Partial<PanelSidebarProps>): void {
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
    if (props.hideTrigger !== undefined) {
      this.hideTrigger = props.hideTrigger;
    }
    if (props.button !== undefined) {
      this.button = props.button;
    }
    if (props.container !== undefined) {
      this.#container = props.container;
    } else if (props.panel !== undefined) {
      this.#container = resolveContainer(undefined, props.panel);
    }
    if (props.onOpenChange !== undefined) {
      this.#openChange = props.onOpenChange;
    }
    this.#setOpenProps(props);
    this.#render();
    super.setProps(props);
  }

  override onRemove(): void {
    if (this.#rootElement) {
      render(null, this.#rootElement);
    }
  }

  override onRenderHTML(rootElement: HTMLElement): void {
    this.#rootElement = rootElement;
    reparentToOverlayRoot(rootElement);
    rootElement.style.position = 'absolute';
    rootElement.style.top = 'var(--widget-margin, 12px)';
    rootElement.style.bottom = 'var(--widget-margin, 12px)';
    rootElement.style.left = this.side === 'left' ? '-1px' : 'var(--widget-margin, 12px)';
    rootElement.style.right = this.side === 'right' ? '-1px' : 'var(--widget-margin, 12px)';
    rootElement.style.width = 'auto';
    rootElement.style.height = 'auto';
    rootElement.style.margin = '0';
    rootElement.style.overflow = 'hidden';
    rootElement.style.pointerEvents = 'none';
    rootElement.style.zIndex = SIDEBAR_OVERLAY_Z_INDEX;
    this.#render();
  }

  #handleOpenChange = (nextOpen: boolean) => {
    if (!this.#isControlled) {
      this.isOpen = nextOpen;
    }
    this.#openChange?.(nextOpen);
    this.#render();
  };

  #setOpenProps(props: Partial<PanelSidebarProps>): void {
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

  #render = () => {
    if (!this.#rootElement) {
      return;
    }

    render(
      <PanelSidebarView
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
      this.#rootElement
    );
  };
}

function reparentToOverlayRoot(rootElement: HTMLElement): HTMLElement | null {
  const placementElement = rootElement.parentElement;
  const overlayElement = placementElement?.parentElement;

  if (!isElementNode(placementElement) || !isElementNode(overlayElement)) {
    return null;
  }

  if (rootElement.parentElement !== overlayElement) {
    overlayElement.appendChild(rootElement);
  }

  return overlayElement;
}

function isElementNode(value: Element | null | undefined): value is HTMLElement {
  return Boolean(value && value.nodeType === 1);
}

const SIDEBAR_TRIGGER_STYLE: JSX.CSSProperties = {
  border: '1px solid var(--menu-border, rgba(148, 163, 184, 0.35))',
  borderRadius: '6px',
  background: 'var(--menu-background, #fff)',
  color: 'var(--button-text, rgb(24, 24, 26))',
  fontSize: '12px',
  lineHeight: '1.1',
  padding: '8px 10px',
  cursor: 'pointer'
};

const SIDEBAR_PANEL_WRAPPER_STYLE: JSX.CSSProperties = {
  position: 'absolute',
  inset: '0',
  pointerEvents: 'none',
  zIndex: 31
};

const SIDEBAR_SHELL_STYLE = (
  side: 'left' | 'right',
  panelWidthPx: number,
  panelWidthWithHandlePx: number,
  open: boolean
): JSX.CSSProperties => ({
  position: 'absolute',
  top: '0',
  bottom: '0',
  [side]: '0',
  width: `${panelWidthWithHandlePx}px`,
  display: 'flex',
  flexDirection: side === 'left' ? 'row-reverse' : 'row',
  alignItems: 'flex-start',
  pointerEvents: 'auto',
  transform: open
    ? 'translateX(0px)'
    : `translateX(${side === 'left' ? -panelWidthPx : panelWidthPx}px)`,
  transition: `transform ${SIDEBAR_TRANSITION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`,
  willChange: 'transform',
  gap: `${SIDEBAR_HANDLE_GAP_PX}px`
});

const SIDEBAR_HANDLE_WRAPPER_STYLE: JSX.CSSProperties = {
  width: `${SIDEBAR_HANDLE_WIDTH_PX}px`,
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  pointerEvents: 'auto'
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
  padding: '0'
};

const SIDEBAR_HANDLE_CHEVRON_STYLE: JSX.CSSProperties = {
  display: 'block',
  fontSize: '22px',
  fontWeight: 700,
  lineHeight: '1',
  transform: 'translateY(-1px)',
  color: 'var(--button-icon-idle, #616166)',
  transition: `transform ${SIDEBAR_TRANSITION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`
};

const SIDEBAR_PANEL_STYLE = (
  side: 'left' | 'right',
  panelWidthPx: number,
  open: boolean
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
  opacity: open ? 1 : 0.98
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
  fontWeight: 700
};

const SIDEBAR_CONTENT_STYLE: JSX.CSSProperties = {
  flex: 1,
  overflow: 'auto',
  padding: '10px'
};

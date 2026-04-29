/* eslint react/react-in-jsx-scope: 0, react/no-unknown-property: 0 */
/** @jsxImportSource preact */
import {render} from 'preact';
import {KeyboardShortcutsManager} from '../keyboard-shortcuts/keyboard-shortcuts-manager';
import {PanelContainer, type PanelContainerProps, type PanelPlacement} from '../panel-container';
import {PanelContentRenderer, asPanelContainer} from '../panels/panel-containers';

import type {KeyboardShortcut} from '../keyboard-shortcuts/keyboard-shortcuts';
import type {KeyboardShortcutEventManager} from '../keyboard-shortcuts/keyboard-shortcuts-manager';
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
  /** Optional trigger icon glyph. */
  triggerIcon?: string;
  /** Whether to render sidebar title bar chrome. */
  showTitleBar?: boolean;
  /** Whether the trigger affordance should be hidden. */
  hideTrigger?: boolean;
  /** Whether to render the compact side-handle button style. */
  button?: boolean;
  /** Optional keyboard shortcuts that open this sidebar. */
  openShortcuts?: KeyboardShortcut[];
  /** Optional keyboard shortcuts to register while this sidebar is mounted. */
  shortcuts?: KeyboardShortcut[];
  /** Outer viewport margin applied to the docked panel. */
  viewportMarginPx?: number;
  /** Whether the trigger should slide beside the panel while the sidebar is open. */
  dockTriggerWhenOpen?: boolean;
  /** Whether to render a document backdrop while open. */
  showBackdrop?: boolean;
};

const SIDEBAR_HANDLE_WIDTH_PX = 36;
const SIDEBAR_HANDLE_GAP_PX = 8;
const SIDEBAR_TRANSITION_MS = 320;
const SIDEBAR_OVERLAY_Z_INDEX = '35';
const SIDEBAR_OPEN_Z_INDEX = '2100';

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

function getDeckCanvasElement(deck: unknown): HTMLElement | null {
  const canvas = (deck as {canvas?: HTMLElement | null} | undefined)?.canvas;
  return canvas instanceof HTMLElement ? canvas : null;
}

function focusDeckCanvas(deck: unknown): void {
  const canvas = getDeckCanvasElement(deck);
  if (!canvas) {
    return;
  }
  if (canvas.tabIndex < 0) {
    canvas.tabIndex = 0;
  }
  queueMicrotask(() => {
    if (!canvas.isConnected) {
      return;
    }
    canvas.focus({preventScroll: true});
  });
}

function getDeckEventManager(deck: unknown): KeyboardShortcutEventManager | null {
  const eventManager = (deck as {eventManager?: KeyboardShortcutEventManager} | undefined)
    ?.eventManager;
  return eventManager ?? null;
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
  triggerIcon,
  open,
  button,
  hideTrigger,
  showTitleBar,
  panelWidthPx,
  viewportMarginPx,
  dockTriggerWhenOpen,
  showBackdrop,
  onOpenChange
}: {
  container: PanelContentContainer;
  side: 'left' | 'right';
  title?: string;
  triggerLabel: string;
  triggerIcon?: string;
  open: boolean;
  button: boolean;
  hideTrigger: boolean;
  showTitleBar: boolean;
  panelWidthPx: number;
  viewportMarginPx: number;
  dockTriggerWhenOpen: boolean;
  showBackdrop: boolean;
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
      {open && showBackdrop ? (
        <button
          aria-label={`Close ${title ?? triggerLabel}`}
          type="button"
          style={SIDEBAR_BACKDROP_STYLE}
          onPointerDown={() => onOpenChange(false)}
          onPointerUp={() => onOpenChange(false)}
          onClick={() => onOpenChange(false)}
        />
      ) : null}
      {!shouldRenderShell ? null : (
        <aside
          style={SIDEBAR_PANEL_WRAPPER_STYLE(viewportMarginPx)}
          aria-label={title ?? triggerLabel}
        >
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
                    style={SIDEBAR_HANDLE_BUTTON_STYLE(
                      open,
                      side,
                      panelWidthPx,
                      viewportMarginPx,
                      dockTriggerWhenOpen
                    )}
                    onClick={() => onOpenChange(!open)}
                  >
                    {triggerIcon ? (
                      <span aria-hidden="true" style={SIDEBAR_HANDLE_ICON_STYLE}>
                        {triggerIcon}
                      </span>
                    ) : null}
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
              {title && showTitleBar ? (
                <header style={SIDEBAR_HEADER_STYLE}>
                  <span>{title}</span>
                  <button
                    type="button"
                    aria-label="Close"
                    style={SIDEBAR_CLOSE_BUTTON_STYLE}
                    onPointerDown={stopSidebarEventPropagation}
                    onClick={() => onOpenChange(false)}
                  >
                    ×
                  </button>
                </header>
              ) : null}
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
    triggerIcon: undefined!,
    showTitleBar: true,
    button: false,
    openShortcuts: [],
    shortcuts: [],
    viewportMarginPx: 12,
    dockTriggerWhenOpen: false,
    showBackdrop: false
  };

  className = 'deck-widget-sidebar';
  placement: PanelPlacement = PanelSidebar.defaultProps.placement;
  side: 'left' | 'right' = PanelSidebar.defaultProps.side;
  widthPx = PanelSidebar.defaultProps.widthPx;
  title: string | undefined = PanelSidebar.defaultProps.title;
  triggerLabel = PanelSidebar.defaultProps.triggerLabel;
  triggerIcon: string | undefined = PanelSidebar.defaultProps.triggerIcon;
  showTitleBar = PanelSidebar.defaultProps.showTitleBar;
  hideTrigger = PanelSidebar.defaultProps.hideTrigger;
  button = PanelSidebar.defaultProps.button;
  viewportMarginPx = PanelSidebar.defaultProps.viewportMarginPx;
  dockTriggerWhenOpen = PanelSidebar.defaultProps.dockTriggerWhenOpen;
  showBackdrop = PanelSidebar.defaultProps.showBackdrop;
  isOpen = false;
  #hasOpenStateInitialized = false;
  #container: PanelContentContainer = PanelSidebar.defaultProps.container;
  #isControlled = false;
  #openChange: ((open: boolean) => void) | undefined = undefined;
  #rootElement: HTMLElement | null = null;
  #isDocumentKeyListenerAttached = false;
  #keyboardShortcutsManager: KeyboardShortcutsManager | null = null;
  #openShortcuts: KeyboardShortcut[] = PanelSidebar.defaultProps.openShortcuts;
  #shortcuts: KeyboardShortcut[] = PanelSidebar.defaultProps.shortcuts;

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
    if (props.triggerIcon !== undefined) {
      this.triggerIcon = props.triggerIcon;
    }
    if (props.showTitleBar !== undefined) {
      this.showTitleBar = props.showTitleBar;
    }
    if (props.hideTrigger !== undefined) {
      this.hideTrigger = props.hideTrigger;
    }
    if (props.button !== undefined) {
      this.button = props.button;
    }
    if (props.viewportMarginPx !== undefined) {
      this.viewportMarginPx = Math.max(0, Math.floor(props.viewportMarginPx));
    }
    if (props.dockTriggerWhenOpen !== undefined) {
      this.dockTriggerWhenOpen = props.dockTriggerWhenOpen;
    }
    if (props.showBackdrop !== undefined) {
      this.showBackdrop = props.showBackdrop;
    }
    if (props.container !== undefined) {
      this.#container = props.container;
    } else if (props.panel !== undefined) {
      this.#container = resolveContainer(undefined, props.panel);
    }
    if (props.onOpenChange !== undefined) {
      this.#openChange = props.onOpenChange;
    }
    if (props.openShortcuts !== undefined) {
      this.#openShortcuts = props.openShortcuts;
      this.#restartKeyboardShortcutsManager();
    }
    if (props.shortcuts !== undefined) {
      this.#shortcuts = props.shortcuts;
      this.#restartKeyboardShortcutsManager();
    }
    this.#setOpenProps(props);
    this.#render();
    super.setProps(props);
  }

  override onAdd(_params: {deck: unknown; viewId: string | null}): void {
    this.#restartKeyboardShortcutsManager();
  }

  override onRemove(): void {
    this.#detachDocumentKeyListener();
    if (this.#keyboardShortcutsManager) {
      this.#keyboardShortcutsManager.stop();
      this.#keyboardShortcutsManager = null;
    }
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
    rootElement.style.zIndex = this.isOpen ? SIDEBAR_OPEN_Z_INDEX : SIDEBAR_OVERLAY_Z_INDEX;
    this.#render();
  }

  #handleOpenChange = (nextOpen: boolean) => {
    if (!this.#isControlled) {
      this.isOpen = nextOpen;
    }
    this.#openChange?.(nextOpen);
    this.#render();
    if (!nextOpen) {
      focusDeckCanvas(this.deck);
    }
  };

  #handleKeyboardOpen = (): void => {
    this.#handleOpenChange(true);
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

  #handleDocumentKeyDown = (event: KeyboardEvent) => {
    if (!this.isOpen || event.key !== 'Escape') {
      return;
    }

    event.preventDefault();
    this.#handleOpenChange(false);
  };

  #syncDocumentKeyListener(): void {
    if (this.isOpen) {
      if (!this.#isDocumentKeyListenerAttached) {
        document.addEventListener('keydown', this.#handleDocumentKeyDown);
        this.#isDocumentKeyListenerAttached = true;
      }
      return;
    }

    this.#detachDocumentKeyListener();
  }

  #detachDocumentKeyListener(): void {
    if (!this.#isDocumentKeyListenerAttached) {
      return;
    }

    document.removeEventListener('keydown', this.#handleDocumentKeyDown);
    this.#isDocumentKeyListenerAttached = false;
  }

  #restartKeyboardShortcutsManager(): void {
    if (this.#keyboardShortcutsManager) {
      this.#keyboardShortcutsManager.stop();
      this.#keyboardShortcutsManager = null;
    }
    const eventManager = getDeckEventManager(this.deck);
    if (!eventManager || (this.#openShortcuts.length === 0 && this.#shortcuts.length === 0)) {
      return;
    }

    this.#keyboardShortcutsManager = new KeyboardShortcutsManager(eventManager, [
      ...this.#openShortcuts.map(shortcut => ({
        ...shortcut,
        onKeyPress: this.#handleKeyboardOpen
      })),
      ...this.#shortcuts
    ]);
    this.#keyboardShortcutsManager.start();
  }

  #render = () => {
    if (!this.#rootElement) {
      return;
    }

    this.#syncDocumentKeyListener();
    this.#rootElement.style.zIndex = this.isOpen ? SIDEBAR_OPEN_Z_INDEX : SIDEBAR_OVERLAY_Z_INDEX;
    render(
      <PanelSidebarView
        container={this.#container}
        side={this.side}
        title={this.title}
        triggerLabel={this.triggerLabel}
        triggerIcon={this.triggerIcon}
        open={this.isOpen}
        button={this.button}
        hideTrigger={this.hideTrigger}
        showTitleBar={this.showTitleBar}
        panelWidthPx={this.widthPx}
        viewportMarginPx={this.viewportMarginPx}
        dockTriggerWhenOpen={this.dockTriggerWhenOpen}
        showBackdrop={this.showBackdrop}
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

const SIDEBAR_BACKDROP_STYLE: JSX.CSSProperties = {
  position: 'fixed',
  inset: '0',
  backgroundColor: 'rgba(17, 24, 39, 0.18)',
  border: 'none',
  padding: '0',
  margin: '0',
  zIndex: 2101,
  pointerEvents: 'auto'
};

const SIDEBAR_PANEL_WRAPPER_STYLE = (viewportMarginPx: number): JSX.CSSProperties => ({
  position: 'absolute',
  inset: `${viewportMarginPx}px`,
  pointerEvents: 'none',
  zIndex: 2102
});

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

const SIDEBAR_HANDLE_BUTTON_STYLE = (
  open: boolean,
  side: 'left' | 'right',
  panelWidthPx: number,
  viewportMarginPx: number,
  dockTriggerWhenOpen: boolean
): JSX.CSSProperties => ({
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
  gap: '2px',
  cursor: 'pointer',
  pointerEvents: 'auto',
  padding: '0',
  transform: dockTriggerWhenOpen
    ? getSidebarTriggerTransform(open, side, panelWidthPx, viewportMarginPx)
    : 'translateX(0)',
  transition: `transform ${SIDEBAR_TRANSITION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`
});

function getSidebarTriggerTransform(
  open: boolean,
  side: 'left' | 'right',
  panelWidthPx: number,
  viewportMarginPx: number
): string {
  if (!open) {
    return 'translateX(0)';
  }
  const openOffset = `calc(min(calc(100vw - ${viewportMarginPx * 2}px), ${panelWidthPx}px) + ${SIDEBAR_HANDLE_GAP_PX}px)`;
  return side === 'left' ? `translateX(${openOffset})` : `translateX(calc(-1 * ${openOffset}))`;
}

const SIDEBAR_HANDLE_ICON_STYLE: JSX.CSSProperties = {
  display: 'block',
  fontSize: '12px',
  fontWeight: 700,
  lineHeight: '1',
  color: 'var(--button-icon-idle, #616166)'
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
  justifyContent: 'space-between',
  gap: '10px',
  padding: '10px 12px',
  borderBottom: 'var(--menu-divider, var(--menu-border, 1px solid rgba(148, 163, 184, 0.25)))',
  background: 'var(--menu-weak-background, var(--button-background, var(--menu-background, #fff)))',
  color: 'var(--menu-text, rgb(24, 24, 26))',
  fontSize: '13px',
  fontWeight: 700
};

const SIDEBAR_CLOSE_BUTTON_STYLE: JSX.CSSProperties = {
  width: '24px',
  height: '24px',
  borderRadius: '999px',
  border: 'var(--menu-inner-border, 1px solid rgba(148, 163, 184, 0.35))',
  backgroundColor: 'transparent',
  color: 'var(--button-text, rgb(24, 24, 26))',
  cursor: 'pointer'
};

const SIDEBAR_CONTENT_STYLE: JSX.CSSProperties = {
  flex: 1,
  overflow: 'auto',
  padding: '10px'
};

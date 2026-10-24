/* eslint react/react-in-jsx-scope: 0, react/no-unknown-property: 0 */
/** @jsxImportSource preact */
import {render, type ComponentChildren} from 'preact';
import {KeyboardShortcutsManager} from '../lib/keyboard-shortcuts/keyboard-shortcuts-manager';
import {
  DockedPanelContainer,
  PANEL_INTERACTION_EVENTS,
  type DockedPanelContainerProps
} from './docked-panel-container';
import type {PanelPlacement} from '../panels/panel-container';
import type {PanelManager} from '../panels/panel-manager';
import {PanelContainerStateContext} from '../panels/panel-container-state';
import {PanelThemeScope} from '../panels/panel-theme-scope';
import {getMaskIconStyle, isMaskIcon} from './trigger-icon';

import type {KeyboardShortcut} from '../lib/keyboard-shortcuts/keyboard-shortcuts';
import type {KeyboardShortcutEventManager} from '../lib/keyboard-shortcuts/keyboard-shortcuts-manager';
import type {Panel} from '../panels/panel';
import type {JSX} from 'preact';

/**
 * Props for {@link SidebarPanelContainer}.
 */
export type SidebarPanelContainerProps = DockedPanelContainerProps & {
  /** Panel content rendered inside the sidebar shell. */
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
  /** Show user pin/unpin controls. Defaults to false. */
  pinnable?: boolean;
  /** Controlled docking state, independent of whether the user can toggle it. */
  pinned?: boolean;
  /** Initial local docking state. Defaults to false. */
  defaultPinned?: boolean;
  /** Requested docking state after a user pin action. */
  onPinnedChange?: (pinned: boolean) => void;
  /** Enable user hide/restore controls. Defaults to true; programmatic open still applies. */
  hidable?: boolean;
  /** Label used for the trigger affordance. */
  triggerLabel?: string;
  /** Optional trigger icon glyph or data/http(s) mask image URL. */
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

function normalizeSidebarWidthPx(widthPx: number): number {
  const clamped = Math.max(0, Math.floor(widthPx));
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

function SidebarPanelContainerView({
  panel,
  side,
  title,
  triggerLabel,
  triggerIcon,
  open,
  pinned,
  hidable,
  button,
  hideTrigger,
  showTitleBar,
  panelWidthPx,
  viewportMarginPx,
  dockTriggerWhenOpen,
  showBackdrop,
  pinControl,
  resizeHandle,
  onOpenChange
}: {
  panel?: Panel;
  side: 'left' | 'right';
  title?: string;
  triggerLabel: string;
  triggerIcon?: string;
  open: boolean;
  pinned: boolean;
  hidable: boolean;
  button: boolean;
  hideTrigger: boolean;
  showTitleBar: boolean;
  panelWidthPx: number;
  viewportMarginPx: number;
  dockTriggerWhenOpen: boolean;
  showBackdrop: boolean;
  pinControl: ComponentChildren;
  resizeHandle: ComponentChildren;
  onOpenChange: (next: boolean) => void;
}) {
  const handleVisible = hidable && !hideTrigger && !pinned;
  const panelWidthWithHandlePx = handleVisible
    ? panelWidthPx + SIDEBAR_HANDLE_WIDTH_PX + SIDEBAR_HANDLE_GAP_PX
    : panelWidthPx;
  const handleLabel = open ? `Close ${triggerLabel}` : triggerLabel;
  return (
    <div style={pinned ? {height: '100%', minHeight: 0} : undefined}>
      {open && !pinned && hidable && showBackdrop ? (
        <button
          aria-label={`Close ${title ?? triggerLabel}`}
          type="button"
          style={SIDEBAR_BACKDROP_STYLE}
          onClick={() => onOpenChange(false)}
        />
      ) : null}
      <aside
        style={pinned ? PINNED_WRAPPER_STYLE : SIDEBAR_PANEL_WRAPPER_STYLE(viewportMarginPx)}
        aria-label={title ?? triggerLabel}
      >
        <div
          data-sidebar-shell=""
          style={
            pinned
              ? PINNED_WRAPPER_STYLE
              : SIDEBAR_SHELL_STYLE(side, panelWidthPx, panelWidthWithHandlePx, open)
          }
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
          <div
            data-sidebar-handle=""
            style={{...SIDEBAR_HANDLE_WRAPPER_STYLE, display: handleVisible ? 'flex' : 'none'}}
          >
            {handleVisible ? (
              button ? (
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
                    <span aria-hidden="true" style={getSidebarHandleIconStyle(triggerIcon, open)}>
                      {!isMaskIcon(triggerIcon) ? triggerIcon : null}
                    </span>
                  ) : null}
                  <span aria-hidden="true" style={getSidebarHandleChevronStyle(open)}>
                    {getSidebarHandleChevron(side, open)}
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
              )
            ) : null}
          </div>
          <div
            className={pinned ? 'deck-panel-chrome-shell' : undefined}
            style={pinned ? PINNED_PANEL_STYLE : SIDEBAR_PANEL_STYLE(side, panelWidthPx, open)}
            role={pinned ? 'complementary' : 'dialog'}
            aria-hidden={!open}
            inert={!open}
          >
            {(title || pinControl || (pinned && hidable)) && showTitleBar ? (
              <header
                className={pinned ? 'deck-panel-chrome-header' : undefined}
                style={SIDEBAR_HEADER_STYLE}
              >
                <span>{title ?? panel?.title ?? 'Panel'}</span>
                <span style={{display: 'flex', alignItems: 'center', gap: '4px'}}>
                  {pinControl}
                  {hidable ? (
                    <button
                      type="button"
                      className={pinned ? 'deck-panel-chrome-hide' : undefined}
                      aria-label={pinned ? `Hide ${title ?? 'sidebar'}` : 'Close'}
                      title={pinned ? `Hide ${title ?? 'sidebar'}` : 'Close'}
                      style={SIDEBAR_CLOSE_BUTTON_STYLE}
                      onClick={() => onOpenChange(false)}
                    >
                      {pinned ? (
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.75"
                          aria-hidden="true"
                        >
                          <path d={side === 'left' ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'} />
                        </svg>
                      ) : (
                        '×'
                      )}
                    </button>
                  ) : null}
                </span>
              </header>
            ) : null}
            <div data-sidebar-content="" style={SIDEBAR_CONTENT_STYLE}>
              {panel ? <PanelThemeScope panel={panel}>{panel.content}</PanelThemeScope> : null}
            </div>
            {resizeHandle}
          </div>
        </div>
      </aside>
    </div>
  );
}

/** A single edge drawer that can overlay the content or be pinned beside it. */
export class SidebarPanelContainer extends DockedPanelContainer<SidebarPanelContainerProps> {
  static defaultProps: Required<SidebarPanelContainerProps> = {
    ...DockedPanelContainer.defaultProps,
    id: 'sidebar-panel-container',
    side: 'right',
    widthPx: 360,
    placement: 'top-right',
    title: undefined!,
    panel: undefined!,
    defaultOpen: true,
    open: undefined!,
    onOpenChange: undefined!,
    pinnable: false,
    pinned: undefined!,
    defaultPinned: false,
    onPinnedChange: undefined!,
    hidable: true,
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
  private uncontrolledOpen: boolean;
  private uncontrolledPinned: boolean;
  private renderedRoot?: HTMLElement;
  private restoreHost?: HTMLElement;
  private keyDocument?: Document;
  private keyboardShortcutsManager?: KeyboardShortcutsManager;
  private scrollPositions = new Map<HTMLElement, {top: number; left: number}>();

  constructor(props: SidebarPanelContainerProps = {}) {
    super(props);
    this.placement = this.props.placement;
    this.uncontrolledOpen = this.props.defaultOpen;
    this.uncontrolledPinned = this.props.defaultPinned;
  }

  placement: PanelPlacement = 'top-right';
  get side(): 'left' | 'right' {
    return this.props.side;
  }
  get widthPx(): number {
    return normalizeSidebarWidthPx(this.props.widthPx);
  }
  get title(): string | undefined {
    return this.props.title;
  }
  get isOpen(): boolean {
    return this.props.open ?? this.uncontrolledOpen;
  }
  override get isPinned(): boolean {
    return this.props.pinned ?? this.uncontrolledPinned;
  }
  override get isDocked(): boolean {
    return this.isPinned && this.isOpen;
  }
  override get overlayPlacement(): PanelPlacement {
    return 'fill';
  }
  protected override get isPinnable(): boolean {
    return this.props.pinnable;
  }

  override setProps(props: Partial<SidebarPanelContainerProps>): void {
    if (props.placement !== undefined) this.placement = props.placement;
    if ('open' in props && props.open === undefined && this.props.open !== undefined)
      this.uncontrolledOpen = this.props.open;
    if ('pinned' in props && props.pinned === undefined && this.props.pinned !== undefined)
      this.uncontrolledPinned = this.props.pinned;
    super.setProps(props);
    if ('openShortcuts' in props || 'shortcuts' in props) this.restartKeyboardShortcutsManager();
  }

  override onAdd(_params: {deck: unknown; viewId: string | null}): void {
    this.restartKeyboardShortcutsManager();
  }

  override onRemove(): void {
    this.detachDocumentKeyListener();
    this.keyboardShortcutsManager?.stop();
    this.keyboardShortcutsManager = undefined;
    if (this.restoreHost) {
      render(null, this.restoreHost);
      this.restoreHost.remove();
    }
    this.restoreHost = undefined;
    super.onRemove();
    if (this.renderedRoot) render(null, this.renderedRoot);
    this.renderedRoot = undefined;
    this.scrollPositions.clear();
  }

  override onRenderHTML(root: HTMLElement): void {
    const activeElement = root.ownerDocument.activeElement;
    // Browsers may clamp scroll offsets while the host is temporarily detached or hidden.
    if (!root.hidden) {
      this.scrollPositions.clear();
      for (const element of root.querySelectorAll<HTMLElement>('*')) {
        if (element.scrollTop || element.scrollLeft) {
          this.scrollPositions.set(element, {top: element.scrollTop, left: element.scrollLeft});
        }
      }
    }
    const isNewRoot = this.renderedRoot !== root;
    this.rootElement = root as HTMLDivElement;
    this.renderedRoot = root;
    this.prepareRoot(root);
    const manager = this.panelManager as PanelManager | undefined;
    if (!manager && isNewRoot) reparentToOverlayRoot(root);
    const panelWidthPx = normalizeSidebarWidthPx(parseFloat(root.style.width) || this.widthPx);
    root.classList.toggle('deck-panel-chrome', this.isPinned);
    root.hidden =
      (this.isPinned && (!this.canPin || !this.isOpen)) ||
      (!this.isOpen && (this.props.hideTrigger || !this.props.hidable));
    Object.assign(
      root.style,
      this.isPinned
        ? {
            position: 'relative',
            top: '',
            right: '',
            bottom: '',
            left: '',
            height: '100%',
            margin: '0',
            overflow: 'visible',
            pointerEvents: 'auto',
            zIndex: '2'
          }
        : {
            position: 'absolute',
            top: 'var(--widget-margin, 12px)',
            bottom: 'var(--widget-margin, 12px)',
            left: this.side === 'left' ? '-1px' : 'var(--widget-margin, 12px)',
            right: this.side === 'right' ? '-1px' : 'var(--widget-margin, 12px)',
            width: 'auto',
            height: 'auto',
            margin: '0',
            overflow: 'hidden',
            pointerEvents: 'none',
            zIndex: this.isOpen ? SIDEBAR_OPEN_Z_INDEX : SIDEBAR_OVERLAY_Z_INDEX
          }
    );
    this.syncDocumentKeyListener();
    render(
      <PanelContainerStateContext.Provider
        value={{pinned: this.isPinned, side: this.side, canPin: this.canPin}}
      >
        <SidebarPanelContainerView
          panel={this.props.panel}
          side={this.side}
          title={this.props.title}
          triggerLabel={this.props.triggerLabel}
          triggerIcon={this.props.triggerIcon}
          open={this.isOpen}
          pinned={this.isPinned}
          hidable={this.props.hidable}
          button={this.props.button}
          hideTrigger={this.props.hideTrigger}
          showTitleBar={this.props.showTitleBar}
          panelWidthPx={panelWidthPx}
          viewportMarginPx={Math.max(0, this.props.viewportMarginPx)}
          dockTriggerWhenOpen={this.props.dockTriggerWhenOpen}
          showBackdrop={this.props.showBackdrop}
          pinControl={this.renderPinControl()}
          resizeHandle={this.renderResizeHandle()}
          onOpenChange={this.changeOpen}
        />
      </PanelContainerStateContext.Provider>,
      root
    );
    this.syncRestoreControl();
    if (this.isOpen && !root.hidden) {
      for (const [element, position] of this.scrollPositions) {
        if (root.contains(element)) {
          element.scrollTop = position.top;
          element.scrollLeft = position.left;
        } else this.scrollPositions.delete(element);
      }
    }
    if (this.isOpen && activeElement instanceof HTMLElement && root.contains(activeElement))
      activeElement.focus({preventScroll: true});
  }

  protected override changePinned(pinned: boolean): void {
    if (!this.props.pinnable || !this.canPin) return;
    if (this.props.pinned === undefined) this.uncontrolledPinned = pinned;
    this.props.onPinnedChange?.(pinned);
    this.updateHTML();
  }

  private changeOpen = (open: boolean): void => {
    if (!this.props.hidable) return;
    if (this.props.open === undefined) this.uncontrolledOpen = open;
    this.props.onOpenChange?.(open);
    this.updateHTML();
    if (!open) {
      focusDeckCanvas(this.deck);
      if (!this.isOpen && this.isPinned)
        this.restoreHost?.querySelector('button')?.focus({preventScroll: true});
    }
  };

  private handleDocumentKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this.isOpen || this.isPinned || !this.props.hidable) return;
    event.preventDefault();
    this.changeOpen(false);
  };

  private syncDocumentKeyListener(): void {
    const document = this.rootElement?.ownerDocument;
    if (this.isOpen && !this.isPinned && this.props.hidable && document) {
      if (this.keyDocument !== document) {
        this.detachDocumentKeyListener();
        document.addEventListener('keydown', this.handleDocumentKeyDown);
        this.keyDocument = document;
      }
    } else this.detachDocumentKeyListener();
  }

  private detachDocumentKeyListener(): void {
    this.keyDocument?.removeEventListener('keydown', this.handleDocumentKeyDown);
    this.keyDocument = undefined;
  }

  private restartKeyboardShortcutsManager(): void {
    this.keyboardShortcutsManager?.stop();
    this.keyboardShortcutsManager = undefined;
    const eventManager = getDeckEventManager(this.deck);
    if (!eventManager || (!this.props.openShortcuts.length && !this.props.shortcuts.length)) return;
    this.keyboardShortcutsManager = new KeyboardShortcutsManager(eventManager, [
      ...this.props.openShortcuts.map(shortcut => ({
        ...shortcut,
        onKeyPress: () => this.changeOpen(true)
      })),
      ...this.props.shortcuts
    ]);
    this.keyboardShortcutsManager.start();
  }

  private syncRestoreControl(): void {
    const manager = this.panelManager as PanelManager | undefined;
    const center = manager?.contentElement?.parentElement;
    if (
      !this.isPinned ||
      this.isOpen ||
      !this.canPin ||
      !center ||
      !this.props.hidable ||
      this.props.hideTrigger
    ) {
      if (this.restoreHost) {
        render(null, this.restoreHost);
        this.restoreHost.remove();
      }
      return;
    }
    if (!this.restoreHost) {
      this.restoreHost = center.ownerDocument.createElement('div');
      Object.assign(this.restoreHost.style, {
        position: 'absolute',
        inset: '0',
        pointerEvents: 'none'
      });
      for (const type of PANEL_INTERACTION_EVENTS)
        this.restoreHost.addEventListener(type, stopSidebarEventPropagation);
    }
    if (this.restoreHost.parentElement !== center) center.append(this.restoreHost);
    render(
      <button
        type="button"
        className="deck-panel-chrome-restore"
        aria-label={`Show ${this.props.title ?? 'sidebar'}`}
        title={`Show ${this.props.title ?? 'sidebar'}`}
        style={{[this.side]: '16px', pointerEvents: 'auto'}}
        onClick={() => this.changeOpen(true)}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          aria-hidden="true"
        >
          <path d={this.side === 'left' ? 'm9 18 6-6-6-6' : 'm15 18-6-6 6-6'} />
        </svg>
      </button>,
      this.restoreHost
    );
  }
}

function reparentToOverlayRoot(rootElement: HTMLElement): HTMLElement | null {
  const placementElement = rootElement.parentElement;
  const overlayElement = placementElement?.parentElement;

  if (
    !isElementNode(placementElement) ||
    !isElementNode(overlayElement) ||
    overlayElement === rootElement.ownerDocument.documentElement
  ) {
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
  border: '1px solid var(--menu-border-color, var(--menu-border, rgba(148, 163, 184, 0.35)))',
  borderRadius: 'var(--panel-corner-radius, 6px)',
  background: 'var(--menu-background, #fff)',
  backdropFilter: 'var(--menu-backdrop-filter, unset)',
  WebkitBackdropFilter: 'var(--menu-backdrop-filter, unset)',
  color: 'var(--button-text, rgb(24, 24, 26))',
  fontSize: 'var(--panel-font-size, 12px)',
  lineHeight: '1.1',
  padding: 'var(--panel-padding, 8px 10px)',
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
  borderRadius: 'var(--panel-corner-radius, 2px)',
  background: 'var(--button-background, #fff)',
  backdropFilter: 'var(--button-backdrop-filter, unset)',
  color: 'var(--button-text, rgb(24, 24, 26))',
  boxShadow: 'var(--button-shadow, 0px 0px 8px 0px rgba(0, 0, 0, 0.25))',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'var(--panel-gap, 2px)',
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

function getSidebarHandleIconStyle(triggerIcon: string, open: boolean): JSX.CSSProperties {
  const color = open ? 'var(--button-icon-hover, #18181a)' : 'var(--button-icon-idle, #616166)';

  return isMaskIcon(triggerIcon)
    ? getMaskIconStyle(triggerIcon, color)
    : {
        display: 'block',
        fontSize: 'var(--panel-font-size, 12px)',
        fontWeight: 700,
        lineHeight: '1',
        color
      };
}

function getSidebarHandleChevronStyle(open: boolean): JSX.CSSProperties {
  return {
    display: 'block',
    fontSize: 'var(--panel-font-size, 22px)',
    fontWeight: 700,
    lineHeight: '1',
    transform: 'translateY(-1px)',
    color: open ? 'var(--button-icon-hover, #18181a)' : 'var(--button-icon-idle, #616166)',
    transition: `transform ${SIDEBAR_TRANSITION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`
  };
}

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
    side === 'right'
      ? '1px solid var(--menu-border-color, var(--menu-border, rgba(148, 163, 184, 0.35)))'
      : undefined,
  borderRight:
    side === 'left'
      ? '1px solid var(--menu-border-color, var(--menu-border, rgba(148, 163, 184, 0.35)))'
      : undefined,
  background: 'var(--menu-background, #fff)',
  backdropFilter: 'var(--menu-backdrop-filter, unset)',
  WebkitBackdropFilter: 'var(--menu-backdrop-filter, unset)',
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
  gap: 'var(--panel-gap, 10px)',
  padding: 'var(--panel-padding, 10px 12px)',
  borderBottom: 'var(--menu-divider, var(--menu-border, 1px solid rgba(148, 163, 184, 0.25)))',
  background: 'var(--menu-weak-background, var(--button-background, var(--menu-background, #fff)))',
  color: 'var(--menu-text, rgb(24, 24, 26))',
  fontSize: 'var(--panel-font-size, 13px)',
  fontWeight: 700
};

const SIDEBAR_CLOSE_BUTTON_STYLE: JSX.CSSProperties = {
  width: '24px',
  height: '24px',
  borderRadius: 'var(--panel-round-radius, 999px)',
  border: 'var(--menu-inner-border, 1px solid rgba(148, 163, 184, 0.35))',
  backgroundColor: 'transparent',
  color: 'var(--button-text, rgb(24, 24, 26))',
  cursor: 'pointer'
};

const SIDEBAR_CONTENT_STYLE: JSX.CSSProperties = {
  flex: 1,
  overflow: 'auto',
  padding: 'var(--panel-padding, 10px)'
};

const PINNED_WRAPPER_STYLE: JSX.CSSProperties = {
  position: 'relative',
  width: '100%',
  height: '100%',
  minWidth: 0,
  minHeight: 0,
  pointerEvents: 'auto'
};
const PINNED_PANEL_STYLE: JSX.CSSProperties = {
  ...PINNED_WRAPPER_STYLE,
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--menu-background, #fff)',
  color: 'var(--menu-text, rgb(24, 24, 26))',
  borderRadius: 0,
  overflow: 'hidden'
};

/* eslint react/react-in-jsx-scope: 0 */
/** @jsxImportSource preact */
import {render} from 'preact';
import {useCallback, useEffect, useRef, useState} from 'preact/hooks';
import {KeyboardShortcutsManager} from '../keyboard-shortcuts/keyboard-shortcuts-manager';
import {PanelContainer, type PanelContainerProps, type PanelPlacement} from '../panel-container';
import {PanelThemeScope} from '../panels/panel-theme-scope';

import type {KeyboardShortcut} from '../keyboard-shortcuts/keyboard-shortcuts';
import type {KeyboardShortcutEventManager} from '../keyboard-shortcuts/keyboard-shortcuts-manager';
import type {Panel} from '../panels/panel-types';
import type {JSX} from 'preact';

type ModalDragState = {
  startX: number;
  startY: number;
  originX: number;
  originY: number;
};

/** Initial screen placement modes for an open modal dialog wrapper. */
export type PanelModalDialogPlacement = 'center' | 'left';

/** Controls whether the modal blocks pointer interaction outside the dialog. */
export type PanelModalPresentation = 'modal' | 'floating';

/**
 * Props for {@link PanelModal}.
 */
export type PanelModalProps = PanelContainerProps & {
  /** Panel content rendered inside the modal shell. */
  panel?: Panel;
  /** Placement anchor used for the trigger when mounted by {@link PanelManager}. */
  placement?: PanelPlacement;
  /** Dialog header title. */
  title?: string;
  /** Trigger label shown when the modal is closed. */
  triggerLabel?: string;
  /** Optional trigger icon glyph. */
  triggerIcon?: string;
  /** Whether to render modal title bar chrome. */
  showTitleBar?: boolean;
  /** Controls whether the open panel blocks pointer interaction outside itself. */
  presentation?: PanelModalPresentation;
  /** Whether the dialog can be dragged by its title bar or configured drag handle. */
  draggable?: boolean;
  /** Optional selector for the element that starts a dialog drag. */
  dragHandleSelector?: string;
  /** Optional inline style merged into the dialog panel. */
  dialogStyle?: JSX.CSSProperties;
  /** Initial screen placement for the dialog wrapper. */
  dialogPlacement?: PanelModalDialogPlacement;
  /** Optional inline style merged into the dialog body. */
  contentStyle?: JSX.CSSProperties;
  /** Whether the trigger should be hidden. */
  hideTrigger?: boolean;
  /** Hides modal chrome close controls when content renders its own close action. */
  hideCloseButton?: boolean;
  /** Legacy compatibility flag that maps to a visible trigger button. */
  button?: boolean;
  /** Initial open state for uncontrolled usage. */
  defaultOpen?: boolean;
  /** Controlled open state. */
  open?: boolean;
  /** Callback fired when the open state changes. */
  onOpenChange?: (open: boolean) => void;
  /** Optional keyboard shortcuts that open this modal. */
  openShortcuts?: KeyboardShortcut[];
  /** Optional keyboard shortcuts to register while this modal is mounted. */
  shortcuts?: KeyboardShortcut[];
};

const DEFAULT_TRIGGER_ICON = '▦';

function stopPropagation(event: Event): void {
  event.stopPropagation();
}

function isModalDragHandleTarget(target: Element, dragHandleSelector?: string): boolean {
  if (target.closest('button,a,input,select,textarea,[role="button"],[role="option"]')) {
    return false;
  }
  if (dragHandleSelector) {
    return Boolean(target.closest(dragHandleSelector));
  }
  return Boolean(target.closest('[data-modal-widget-header="true"]'));
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

function PanelModalView({
  panel,
  title,
  hideTrigger,
  triggerLabel,
  triggerIcon,
  showTitleBar,
  presentation,
  draggable,
  dragHandleSelector,
  dialogStyle,
  dialogPlacement,
  contentStyle,
  hideCloseButton,
  open,
  onOpenChange
}: {
  panel?: Panel;
  title: string;
  hideTrigger: boolean;
  triggerIcon: string;
  triggerLabel: string;
  showTitleBar: boolean;
  presentation: PanelModalPresentation;
  draggable: boolean;
  dragHandleSelector?: string;
  dialogStyle?: JSX.CSSProperties;
  dialogPlacement: PanelModalDialogPlacement;
  contentStyle?: JSX.CSSProperties;
  hideCloseButton: boolean;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const dragState = useRef<ModalDragState | null>(null);
  const [dragOffset, setDragOffset] = useState({x: 0, y: 0});

  const handlePointerMove = useCallback((event: PointerEvent) => {
    const state = dragState.current;
    if (!state) {
      return;
    }
    setDragOffset({
      x: state.originX + event.clientX - state.startX,
      y: state.originY + event.clientY - state.startY
    });
  }, []);
  const handlePointerUp = useCallback(() => {
    dragState.current = null;
    document.removeEventListener('pointermove', handlePointerMove);
    document.removeEventListener('pointerup', handlePointerUp);
  }, [handlePointerMove]);

  useEffect(() => {
    if (open) {
      return;
    }
    handlePointerUp();
    setDragOffset(current => (current.x === 0 && current.y === 0 ? current : {x: 0, y: 0}));
  }, [handlePointerUp, open]);

  useEffect(
    () => () => {
      handlePointerUp();
    },
    [handlePointerUp]
  );

  const panelStyle =
    presentation === 'floating'
      ? {...MODAL_FLOATING_DIALOG_PANEL_STYLE, ...dialogStyle}
      : {...MODAL_DIALOG_PANEL_STYLE, ...dialogStyle};
  const wrapperStyle = getModalDialogWrapperStyle(dialogPlacement, dragOffset);
  const bodyStyle =
    presentation === 'floating'
      ? {...MODAL_FLOATING_CONTENT_STYLE, ...contentStyle}
      : {...MODAL_CONTENT_STYLE, ...contentStyle};

  const handleDialogPointerDown = (event: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    if (!draggable || event.button !== 0 || !(event.target instanceof Element)) {
      return;
    }
    if (!isModalDragHandleTarget(event.target, dragHandleSelector)) {
      return;
    }
    event.preventDefault();
    dragState.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: dragOffset.x,
      originY: dragOffset.y
    };
    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
  };
  const handleDialogClick = (event: JSX.TargetedMouseEvent<HTMLDivElement>) => {
    if (!(event.target instanceof Element)) {
      return;
    }
    if (event.target.closest('[data-modal-widget-close="true"]')) {
      onOpenChange(false);
    }
  };

  return (
    <div>
      {!hideTrigger && (
        <div className="deck-widget-button">
          <button
            type="button"
            className={
              open ? 'deck-widget-icon-button deck-widget-button-active' : 'deck-widget-icon-button'
            }
            style={MODAL_TRIGGER_STYLE}
            aria-label={open ? `Close ${triggerLabel}` : `Open ${triggerLabel}`}
            onClick={() => onOpenChange(!open)}
          >
            <span aria-hidden="true" style={MODAL_TRIGGER_ICON_STYLE}>
              {triggerIcon}
            </span>
            <span>{triggerLabel}</span>
          </button>
        </div>
      )}

      {open && (
        <>
          {presentation === 'modal' ? (
            <button
              type="button"
              style={OVERLAY_BACKDROP_STYLE}
              onPointerDown={() => onOpenChange(false)}
              onPointerUp={() => onOpenChange(false)}
              onClick={() => onOpenChange(false)}
            />
          ) : null}
          <div style={wrapperStyle}>
            <div
              style={panelStyle}
              role="dialog"
              aria-label={title}
              onPointerDown={handleDialogPointerDown}
              onClick={handleDialogClick}
            >
              {showTitleBar ? (
                <div data-modal-widget-header="true" style={MODAL_HEADER_STYLE}>
                  <span style={MODAL_HEADER_TITLE_STYLE}>{title}</span>
                  {hideCloseButton ? null : (
                    <button
                      type="button"
                      aria-label="Close"
                      data-modal-widget-close="true"
                      style={MODAL_CLOSE_BUTTON_STYLE}
                      onPointerDown={stopPropagation}
                      onPointerUp={() => onOpenChange(false)}
                    >
                      ×
                    </button>
                  )}
                </div>
              ) : hideCloseButton ? null : (
                <button
                  type="button"
                  aria-label="Close"
                  data-modal-widget-close="true"
                  style={MODAL_FLOATING_CLOSE_BUTTON_STYLE}
                  onPointerDown={stopPropagation}
                  onPointerUp={() => onOpenChange(false)}
                >
                  ×
                </button>
              )}
              <div style={bodyStyle}>
                {panel ? <PanelThemeScope panel={panel}>{panel.content}</PanelThemeScope> : null}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Overlay-style panel container that renders one modal dialog and optional trigger.
 */
export class PanelModal extends PanelContainer<PanelModalProps> {
  static defaultProps: Required<PanelModalProps> = {
    ...PanelContainer.defaultProps,
    id: 'panel-modal',
    placement: 'top-right',
    title: 'Panel',
    triggerLabel: 'Open panel',
    triggerIcon: DEFAULT_TRIGGER_ICON,
    showTitleBar: true,
    presentation: 'modal',
    draggable: false,
    dragHandleSelector: undefined!,
    dialogStyle: undefined!,
    dialogPlacement: 'center',
    contentStyle: undefined!,
    hideTrigger: false,
    hideCloseButton: false,
    button: false,
    defaultOpen: false,
    onOpenChange: undefined!,
    open: undefined!,
    openShortcuts: [],
    shortcuts: [],
    panel: undefined!
  };

  className = 'deck-widget-modal';
  placement: PanelPlacement = PanelModal.defaultProps.placement;
  title = PanelModal.defaultProps.title;
  triggerLabel = PanelModal.defaultProps.triggerLabel;
  triggerIcon = PanelModal.defaultProps.triggerIcon;
  showTitleBar = PanelModal.defaultProps.showTitleBar;
  presentation: PanelModalPresentation = PanelModal.defaultProps.presentation;
  draggable = PanelModal.defaultProps.draggable;
  dragHandleSelector: string | undefined = PanelModal.defaultProps.dragHandleSelector;
  dialogStyle: JSX.CSSProperties | undefined = PanelModal.defaultProps.dialogStyle;
  dialogPlacement: PanelModalDialogPlacement = PanelModal.defaultProps.dialogPlacement;
  contentStyle: JSX.CSSProperties | undefined = PanelModal.defaultProps.contentStyle;
  hideTrigger = PanelModal.defaultProps.hideTrigger;
  hideCloseButton = PanelModal.defaultProps.hideCloseButton;
  isOpen = false;
  #hasOpenStateInitialized = false;
  #panel: Panel | undefined = PanelModal.defaultProps.panel;
  #isControlled = false;
  #openChange: ((open: boolean) => void) | undefined = undefined;
  #rootElement: HTMLElement | null = null;
  #isDocumentKeyListenerAttached = false;
  #placementContainerElement: HTMLElement | null = null;
  #basePlacementZIndex: string | null = null;
  #keyboardShortcutsManager: KeyboardShortcutsManager | null = null;
  #openShortcuts: KeyboardShortcut[] = PanelModal.defaultProps.openShortcuts;
  #shortcuts: KeyboardShortcut[] = PanelModal.defaultProps.shortcuts;

  constructor(props: Partial<PanelModalProps> = {}) {
    super({
      ...PanelModal.defaultProps,
      ...props
    } as PanelModalProps);
    this.setProps(this.props);
  }

  // eslint-disable-next-line complexity
  override setProps(props: Partial<PanelModalProps>): void {
    if (props.placement !== undefined) {
      this.placement = props.placement;
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
    if (props.presentation !== undefined) {
      this.presentation = props.presentation;
    }
    if (props.draggable !== undefined) {
      this.draggable = props.draggable;
    }
    if (props.dragHandleSelector !== undefined) {
      this.dragHandleSelector = props.dragHandleSelector;
    }
    if (props.dialogStyle !== undefined) {
      this.dialogStyle = props.dialogStyle;
    }
    if (props.dialogPlacement !== undefined) {
      this.dialogPlacement = props.dialogPlacement;
    }
    if (props.contentStyle !== undefined) {
      this.contentStyle = props.contentStyle;
    }
    if (props.hideTrigger !== undefined || props.button !== undefined) {
      this.hideTrigger = props.button !== undefined ? !props.button : (props.hideTrigger ?? false);
    }
    if (props.hideCloseButton !== undefined) {
      this.hideCloseButton = props.hideCloseButton;
    }
    if (props.title !== undefined) {
      this.title = props.title;
    }
    if ('panel' in props) {
      this.#panel = props.panel;
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
    this.#syncPlacementZIndex(false);
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
    this.#placementContainerElement = isElementNode(rootElement.parentElement)
      ? rootElement.parentElement
      : null;
    this.#basePlacementZIndex = this.#placementContainerElement?.style.zIndex ?? null;
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

  #setOpenProps(props: Partial<PanelModalProps>): void {
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
    this.#syncPlacementZIndex(this.isOpen);
    render(
      <PanelModalView
        panel={this.#panel}
        title={this.title}
        hideTrigger={this.hideTrigger}
        triggerLabel={this.triggerLabel}
        triggerIcon={this.triggerIcon}
        showTitleBar={this.showTitleBar}
        presentation={this.presentation}
        draggable={this.draggable}
        dragHandleSelector={this.dragHandleSelector}
        dialogStyle={this.dialogStyle}
        dialogPlacement={this.dialogPlacement}
        contentStyle={this.contentStyle}
        hideCloseButton={this.hideCloseButton}
        open={this.isOpen}
        onOpenChange={this.#handleOpenChange}
      />,
      this.#rootElement
    );
  };

  #syncPlacementZIndex(isOpen: boolean): void {
    if (!this.#placementContainerElement) {
      return;
    }

    this.#placementContainerElement.style.zIndex = isOpen
      ? '2100'
      : (this.#basePlacementZIndex ?? '');
  }
}

function isElementNode(value: Element | null | undefined): value is HTMLElement {
  return Boolean(value && value.nodeType === 1);
}

const MODAL_TRIGGER_STYLE: JSX.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '8px',
  border: 'var(--button-inner-stroke, 1px solid rgba(148, 163, 184, 0.35))',
  borderRadius: '6px',
  background: 'var(--button-background, #fff)',
  color: 'var(--button-text, rgb(24, 24, 26))',
  boxShadow: 'var(--button-shadow, 0px 0px 8px 0px rgba(0, 0, 0, 0.25))',
  cursor: 'pointer',
  font: '600 12px/1 ui-sans-serif, system-ui, sans-serif',
  padding: '8px 10px'
};

const MODAL_TRIGGER_ICON_STYLE: JSX.CSSProperties = {
  fontSize: '16px',
  lineHeight: 1
};

const OVERLAY_BACKDROP_STYLE: JSX.CSSProperties = {
  position: 'fixed',
  inset: '0',
  backgroundColor: 'rgba(17, 24, 39, 0.28)',
  border: 'none',
  padding: '0',
  margin: '0',
  zIndex: 30
};

const MODAL_DIALOG_WRAPPER_STYLE: JSX.CSSProperties = {
  position: 'fixed',
  inset: '0',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  pointerEvents: 'none',
  zIndex: 31
};

function getModalDialogWrapperStyle(
  dialogPlacement: PanelModalDialogPlacement,
  dragOffset: {x: number; y: number}
): JSX.CSSProperties {
  const placementStyle =
    dialogPlacement === 'left'
      ? {
          justifyContent: 'flex-start',
          padding: '24px'
        }
      : {};
  const transformStyle =
    dragOffset.x === 0 && dragOffset.y === 0
      ? {}
      : {transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)`};
  return {
    ...MODAL_DIALOG_WRAPPER_STYLE,
    ...placementStyle,
    ...transformStyle
  };
}

const MODAL_DIALOG_PANEL_STYLE: JSX.CSSProperties = {
  pointerEvents: 'auto',
  width: 'min(90vw, 760px)',
  maxWidth: 'min(88vw, 620px)',
  maxHeight: 'min(84vh, 84dvh)',
  borderRadius: 'var(--menu-corner-radius, 10px)',
  border: 'var(--menu-border, 1px solid rgba(148, 163, 184, 0.35))',
  background: 'var(--menu-background, #fff)',
  color: 'var(--menu-text, rgb(24, 24, 26))',
  boxShadow: 'var(--menu-shadow, 0px 12px 30px rgba(0,0,0,0.25))',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  position: 'relative'
};

const MODAL_FLOATING_DIALOG_PANEL_STYLE: JSX.CSSProperties = {
  pointerEvents: 'auto',
  width: 'fit-content',
  maxWidth: 'calc(100vw - 48px)',
  maxHeight: 'min(88vh, 88dvh)',
  border: 'none',
  background: 'transparent',
  color: 'var(--menu-text, rgb(24, 24, 26))',
  boxShadow: 'none',
  overflow: 'visible',
  display: 'flex',
  flexDirection: 'column',
  position: 'relative'
};

const MODAL_HEADER_STYLE: JSX.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '10px',
  padding: '10px 12px',
  borderBottom: 'var(--menu-divider, var(--menu-border, 1px solid rgba(148, 163, 184, 0.25)))',
  backgroundColor:
    'var(--menu-weak-background, var(--button-background, var(--menu-background, #fff)))',
  color: 'var(--menu-text, rgb(24, 24, 26))'
};

const MODAL_HEADER_TITLE_STYLE: JSX.CSSProperties = {
  margin: 0,
  fontSize: '13px',
  fontWeight: 700
};

const MODAL_CLOSE_BUTTON_STYLE: JSX.CSSProperties = {
  width: '24px',
  height: '24px',
  borderRadius: '999px',
  border: 'var(--menu-inner-border, 1px solid rgba(148, 163, 184, 0.35))',
  backgroundColor: 'transparent',
  color: 'var(--button-text, rgb(24, 24, 26))',
  cursor: 'pointer'
};

const MODAL_FLOATING_CLOSE_BUTTON_STYLE: JSX.CSSProperties = {
  ...MODAL_CLOSE_BUTTON_STYLE,
  position: 'absolute',
  top: '12px',
  right: '12px',
  zIndex: 2,
  backgroundColor: 'var(--menu-background, #fff)',
  boxShadow: '0 4px 12px rgba(15, 23, 42, 0.12)'
};

const MODAL_CONTENT_STYLE: JSX.CSSProperties = {
  flex: 1,
  overflow: 'auto',
  padding: '10px'
};

const MODAL_FLOATING_CONTENT_STYLE: JSX.CSSProperties = {
  flex: 1,
  overflow: 'visible',
  padding: '0'
};

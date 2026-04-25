/* eslint react/react-in-jsx-scope: 0 */
/** @jsxImportSource preact */
import {h, render} from 'preact';
import {PanelContainer, type PanelContainerProps, type PanelPlacement} from '../panel-container';
import {WidgetContainerRenderer, asPanelContainer} from '../widget-panels/widget-containers';

import type {WidgetContainer, WidgetPanel} from '../widget-panels/widget-containers';
import type {JSX} from 'preact';

/**
 * Props for {@link PanelModal}.
 */
export type PanelModalProps = PanelContainerProps & {
  /** One pre-built container definition to render. */
  container?: WidgetContainer;
  /** Convenience single-panel input converted into a container automatically. */
  panel?: WidgetPanel;
  /** Placement anchor used for the trigger when mounted by {@link PanelManager}. */
  placement?: PanelPlacement;
  /** Dialog header title. */
  title?: string;
  /** Trigger label shown when the modal is closed. */
  triggerLabel?: string;
  /** Optional trigger icon glyph. */
  triggerIcon?: string;
  /** Whether the trigger should be hidden. */
  hideTrigger?: boolean;
  /** Legacy compatibility flag that maps to a visible trigger button. */
  button?: boolean;
  /** Initial open state for uncontrolled usage. */
  defaultOpen?: boolean;
  /** Controlled open state. */
  open?: boolean;
  /** Callback fired when the open state changes. */
  onOpenChange?: (open: boolean) => void;
};

const DEFAULT_TRIGGER_ICON = '▦';

function resolveContainer(container?: WidgetContainer, panel?: WidgetPanel): WidgetContainer {
  if (container !== undefined) {
    return container;
  }
  if (panel !== undefined) {
    return asPanelContainer(panel);
  }
  return {
    kind: 'panel',
    props: {
      panel: {
        id: 'empty-panel-modal-panel',
        title: '',
        content: h('div', {})
      }
    }
  };
}

function stopPropagation(event: Event): void {
  event.stopPropagation();
}

function PanelModalView({
  container,
  title,
  hideTrigger,
  triggerLabel,
  triggerIcon,
  open,
  onOpenChange
}: {
  container: WidgetContainer;
  title: string;
  hideTrigger: boolean;
  triggerIcon: string;
  triggerLabel: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  return (
    <div>
      {!hideTrigger && (
        <button
          type="button"
          style={MODAL_TRIGGER_STYLE}
          aria-label={open ? `Close ${triggerLabel}` : `Open ${triggerLabel}`}
          onClick={() => onOpenChange(!open)}
        >
          <span aria-hidden="true" style={MODAL_TRIGGER_ICON_STYLE}>
            {triggerIcon}
          </span>
          <span>{triggerLabel}</span>
        </button>
      )}

      {open && (
        <>
          <button
            type="button"
            style={OVERLAY_BACKDROP_STYLE}
            onPointerDown={() => onOpenChange(false)}
          />
          <div style={MODAL_DIALOG_WRAPPER_STYLE}>
            <div style={MODAL_DIALOG_PANEL_STYLE}>
              <div style={MODAL_HEADER_STYLE}>
                <span style={MODAL_HEADER_TITLE_STYLE}>{title}</span>
                <button
                  type="button"
                  aria-label="Close"
                  style={MODAL_CLOSE_BUTTON_STYLE}
                  onPointerDown={stopPropagation}
                  onPointerUp={() => onOpenChange(false)}
                >
                  ×
                </button>
              </div>
              <div style={MODAL_CONTENT_STYLE}>
                <WidgetContainerRenderer container={container} />
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
    hideTrigger: false,
    button: false,
    defaultOpen: false,
    onOpenChange: undefined!,
    open: undefined!,
    panel: undefined!,
    container: {
      kind: 'panel',
      props: {
        panel: {
          id: 'empty-panel-modal-panel',
          title: '',
          content: h('div', {})
        }
      }
    }
  };

  className = 'deck-widget-modal';
  placement: PanelPlacement = PanelModal.defaultProps.placement;
  title = PanelModal.defaultProps.title;
  triggerLabel = PanelModal.defaultProps.triggerLabel;
  triggerIcon = PanelModal.defaultProps.triggerIcon;
  hideTrigger = PanelModal.defaultProps.hideTrigger;
  isOpen = false;
  #hasOpenStateInitialized = false;
  #container: WidgetContainer = PanelModal.defaultProps.container;
  #isControlled = false;
  #openChange: ((open: boolean) => void) | undefined = undefined;
  #rootElement: HTMLElement | null = null;
  #isDocumentKeyListenerAttached = false;

  constructor(props: Partial<PanelModalProps> = {}) {
    super({
      ...PanelModal.defaultProps,
      ...props,
      container: resolveContainer(props.container, props.panel)
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
    if (props.hideTrigger !== undefined || props.button !== undefined) {
      this.hideTrigger = props.button !== undefined ? !props.button : (props.hideTrigger ?? false);
    }
    if (props.title !== undefined) {
      this.title = props.title;
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
    this.#detachDocumentKeyListener();
    if (this.#rootElement) {
      render(null, this.#rootElement);
    }
  }

  override onRenderHTML(rootElement: HTMLElement): void {
    this.#rootElement = rootElement;
    this.#render();
  }

  #handleOpenChange = (nextOpen: boolean) => {
    if (!this.#isControlled) {
      this.isOpen = nextOpen;
    }
    this.#openChange?.(nextOpen);
    this.#render();
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

  #render = () => {
    if (!this.#rootElement) {
      return;
    }

    this.#syncDocumentKeyListener();
    render(
      <PanelModalView
        container={this.#container}
        title={this.title}
        hideTrigger={this.hideTrigger}
        triggerLabel={this.triggerLabel}
        triggerIcon={this.triggerIcon}
        open={this.isOpen}
        onOpenChange={this.#handleOpenChange}
      />,
      this.#rootElement
    );
  };
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
  flexDirection: 'column'
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

const MODAL_CONTENT_STYLE: JSX.CSSProperties = {
  flex: 1,
  overflow: 'auto',
  padding: '10px'
};

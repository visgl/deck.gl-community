/** @jsxImportSource preact */
import { Widget } from '@deck.gl/core';
import { render } from 'preact';

import { asPanelContainer, WidgetContainerRenderer } from './widget-containers';
import { IconButton, makeTextIcon } from './widget-utils';

import type { WidgetContainer, WidgetPanel } from './widget-containers';
import type { WidgetPlacement, WidgetProps } from '@deck.gl/core';
import type { JSX } from 'preact';

/** Trigger and panel configuration for a modal-style widget. */
export type ModalWidgetProps = WidgetProps & {
  /** Trigger icon alias for legacy compatibility. */
  icon?: string;
  /** The content container to show when the modal is open. */
  container?: WidgetContainer;
  /** Optional shorthand panel. When supplied, shown directly in the modal body. */
  panel?: WidgetPanel;
  /** Button and panel placement anchor. */
  placement?: WidgetPlacement;
  /** Optional modal title shown in the header. */
  title?: string;
  /** Optional trigger button label visible in the UI. */
  triggerLabel?: string;
  /** Optional trigger icon. Defaults to a menu-like glyph. */
  triggerIcon?: string;
  /**
   * Hides the trigger. Useful when trigger is implemented externally.
   */
  hideTrigger?: boolean;
  /**
   * Whether to render the built-in trigger button.
   * If false, no built-in trigger is rendered.
   */
  button?: boolean;
  /**
   * Uncontrolled default open state.
   */
  defaultOpen?: boolean;
  /**
   * Controlled open state. If supplied, callers own open/closed state.
   */
  open?: boolean;
  /**
   * Called when user intent changes open/closed state.
   */
  onOpenChange?: (open: boolean) => void;
};

const MODAL_WIDGET_CLASS = 'deck-widget-modal';
const MODAL_TRIGGER_ICON = makeTextIcon('▦', 18, 24);
const DIALOG_MAX_WIDTH = 'min(88vw, 620px)';
const MODAL_OPEN_CONTAINER_Z_INDEX = '40';

/**
 * Normalizes widget-container/panel inputs into a concrete widget container.
 */
function asContainer(container?: WidgetContainer, panel?: WidgetPanel): WidgetContainer {
  if (container !== undefined) {
    return container;
  }

  if (panel !== undefined) {
    return asPanelContainer(panel);
  }

  return {
    kind: 'accordeon',
    props: {
      panels: [],
    },
  };
}

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

  return MODAL_TRIGGER_ICON;
}

/**
 * Resolves final trigger visibility from explicit and legacy hide props.
 */
function resolveHideTrigger({
  hideTrigger,
  button,
}: {
  hideTrigger?: boolean;
  button?: boolean;
}): boolean {
  if (button !== undefined) {
    return !button;
  }

  return hideTrigger ?? false;
}

/**
 * Stops bubbling from inner modal controls so parent listeners do not receive the interaction.
 */
function stopPropagation(event: Event): void {
  event.stopPropagation();
}

function ModalWidgetView({
  container,
  title,
  hideTrigger,
  triggerLabel,
  triggerIcon,
  open,
  onOpenChange,
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
        <IconButton
          icon={triggerIcon}
          title={open ? `Close ${triggerLabel}` : `Open ${triggerLabel}`}
          onClick={() => onOpenChange(!open)}
        />
      )}

      {!open && <div />}
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
 * A reusable deck widget that renders a trigger + modal panel assembled from widget containers.
 */
export class ModalWidget extends Widget<ModalWidgetProps> {
  static defaultProps: Required<ModalWidgetProps> = {
    ...Widget.defaultProps,
    id: 'modal-widget',
    placement: 'top-right',
    title: 'Panel',
    triggerLabel: 'Open panel',
    triggerIcon: MODAL_TRIGGER_ICON,
    icon: undefined!,
    panel: undefined!,
    hideTrigger: false,
    button: undefined!,
    defaultOpen: false,
    onOpenChange: undefined!,
    open: undefined!,
    container: {
      kind: 'panel',
      props: {
        panel: {
          id: 'empty-modal-panel',
          title: 'Empty',
          content: <div />,
        },
      },
    },
  };

  className = MODAL_WIDGET_CLASS;
  placement: WidgetPlacement = ModalWidget.defaultProps.placement;
  triggerLabel: string = ModalWidget.defaultProps.triggerLabel;
  triggerIcon: string = ModalWidget.defaultProps.triggerIcon;
  hideTrigger = ModalWidget.defaultProps.hideTrigger;
  title = ModalWidget.defaultProps.title;
  isOpen = false;
  #hasOpenStateInitialized = false;
  #container: WidgetContainer = ModalWidget.defaultProps.container;
  #isControlled = false;
  #openChange: ((open: boolean) => void) | undefined = undefined;
  #rootElement: HTMLElement | null = null;
  #placementContainer: HTMLElement | null = null;
  #placementContainerZIndex = '';
  #isDocumentKeyListenerAttached = false;

  constructor(props: Partial<ModalWidgetProps> = {}) {
    super({
      ...ModalWidget.defaultProps,
      ...props,
      container: asContainer(props.container, props.panel),
      triggerIcon: resolveTriggerIcon(props),
    } as ModalWidgetProps);
    this.setProps(this.props);
  }

  setProps(props: Partial<ModalWidgetProps>): void {
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
    this.#detachDocumentKeyListener();
    this.#syncPlacementContainerZIndex();
    if (this.#rootElement) {
      render(null, this.#rootElement);
    }
  }

  onRenderHTML(rootElement: HTMLElement): void {
    this.#rootElement = rootElement;
    this.#placementContainer ??= rootElement.parentElement;
    if (this.#placementContainer && !this.#placementContainerZIndex) {
      this.#placementContainerZIndex = this.#placementContainer.style.zIndex;
    }
    const className = ['deck-widget', this.className, this.props.className]
      .filter(Boolean)
      .join(' ');
    rootElement.className = className;
    this.#render();
  }

  #handleOpenChange = (nextOpen: boolean) => {
    if (!this.#isControlled) {
      this.isOpen = nextOpen;
    }
    this.#openChange?.(nextOpen);
    this.#render();
  };

  #setDisplayProps(props: Partial<ModalWidgetProps>): void {
    if (props.icon !== undefined) {
      this.triggerIcon = props.icon;
    }
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
      this.hideTrigger = resolveHideTrigger({
        hideTrigger: props.hideTrigger,
        button: props.button,
      });
    }
    if (props.title !== undefined) {
      this.title = props.title;
    }
  }

  #setContainerProps(props: Partial<ModalWidgetProps>): void {
    if (props.container !== undefined) {
      this.#container = props.container;
    } else if (props.panel !== undefined) {
      this.#container = asContainer(undefined, props.panel);
    }

    if (props.onOpenChange !== undefined) {
      this.#openChange = props.onOpenChange;
    }
  }

  #setOpenProps(props: Partial<ModalWidgetProps>): void {
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

  /**
   * Closes the modal when the user presses Escape while it is open.
   */
  #handleDocumentKeyDown = (event: KeyboardEvent) => {
    if (!this.isOpen || event.key !== 'Escape') {
      return;
    }

    event.preventDefault();
    this.#handleOpenChange(false);
  };

  /**
   * Keeps the document Escape handler attached only while the modal is open.
   */
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

  /**
   * Removes the document Escape handler when the modal is closed or unmounted.
   */
  #detachDocumentKeyListener(): void {
    if (!this.#isDocumentKeyListenerAttached) {
      return;
    }

    document.removeEventListener('keydown', this.#handleDocumentKeyDown);
    this.#isDocumentKeyListenerAttached = false;
  }

  /**
   * Keeps the modal's placement container above sibling widget containers while the modal is open.
   */
  #syncPlacementContainerZIndex(): void {
    if (!this.#placementContainer) {
      return;
    }

    this.#placementContainer.style.zIndex = this.isOpen
      ? MODAL_OPEN_CONTAINER_Z_INDEX
      : this.#placementContainerZIndex;
  }

  #render = () => {
    if (!this.#rootElement) {
      return;
    }

    this.#syncDocumentKeyListener();
    this.#syncPlacementContainerZIndex();

    render(
      <ModalWidgetView
        container={this.#container}
        title={this.title}
        hideTrigger={this.hideTrigger}
        triggerLabel={this.triggerLabel}
        triggerIcon={this.triggerIcon}
        open={this.isOpen}
        onOpenChange={this.#handleOpenChange}
      />,
      this.#rootElement,
    );
  };
}

const OVERLAY_BACKDROP_STYLE: JSX.CSSProperties = {
  position: 'fixed',
  inset: '0',
  backgroundColor: 'rgba(17, 24, 39, 0.28)',
  border: 'none',
  padding: '0',
  margin: '0',
  zIndex: 30,
};

const MODAL_DIALOG_WRAPPER_STYLE: JSX.CSSProperties = {
  position: 'fixed',
  inset: '0',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  pointerEvents: 'none',
  zIndex: 31,
};

const MODAL_DIALOG_PANEL_STYLE: JSX.CSSProperties = {
  pointerEvents: 'auto',
  width: 'min(90vw, 760px)',
  maxWidth: DIALOG_MAX_WIDTH,
  maxHeight: 'min(84vh, 84dvh)',
  borderRadius: 'var(--menu-corner-radius, 10px)',
  border: 'var(--menu-border, 1px solid rgba(148, 163, 184, 0.35))',
  background: 'var(--menu-background, #fff)',
  color: 'var(--menu-text, rgb(24, 24, 26))',
  boxShadow: 'var(--menu-shadow, 0px 12px 30px rgba(0,0,0,0.25))',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
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
  color: 'var(--menu-text, rgb(24, 24, 26))',
};

const MODAL_HEADER_TITLE_STYLE: JSX.CSSProperties = {
  margin: 0,
  fontSize: '13px',
  fontWeight: 700,
};

const MODAL_CLOSE_BUTTON_STYLE: JSX.CSSProperties = {
  width: '24px',
  height: '24px',
  borderRadius: '999px',
  border: 'var(--menu-inner-border, 1px solid rgba(148, 163, 184, 0.35))',
  backgroundColor: 'transparent',
  color: 'var(--button-text, rgb(24, 24, 26))',
  cursor: 'pointer',
};

const MODAL_CONTENT_STYLE: JSX.CSSProperties = {
  flex: 1,
  overflow: 'auto',
  padding: '10px',
};

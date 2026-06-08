/** @jsxImportSource preact */

import {Widget} from '@deck.gl/core';
import {render} from 'preact';
import {
  commandManager,
  DEFAULT_SHORTCUTS,
  KeyboardShortcutsManager,
  KeyboardShortcutsPanelContent
} from '@deck.gl-community/panels';

import type {WidgetPlacement, WidgetProps} from '@deck.gl/core';
import type {KeyboardShortcut} from '@deck.gl-community/panels';
import type {JSX} from 'preact';

/** Props for the standalone keyboard shortcuts widget. */
export type KeyboardShortcutsWidgetProps = WidgetProps & {
  /** Widget positioning within the view. */
  placement?: WidgetPlacement;
  /** Keyboard shortcuts and display-only interactions rendered in the panel. */
  keyboardShortcuts: KeyboardShortcut[];
  /** Whether to install shortcut handlers on deck's event manager. */
  installShortcuts?: boolean;
  /** Command id used by the trigger and default keyboard shortcut. */
  commandId?: string;
};

/** Standalone shortcuts widget that renders a help trigger and shortcut reference modal. */
export class KeyboardShortcutsWidget extends Widget<KeyboardShortcutsWidgetProps> {
  static override defaultProps = {
    ...Widget.defaultProps,
    id: 'keyboard-bindings',
    placement: 'top-left',
    keyboardShortcuts: [],
    commandId: 'keyboard-shortcuts.open'
  } satisfies Required<WidgetProps> &
    Required<Pick<KeyboardShortcutsWidgetProps, 'placement' | 'keyboardShortcuts' | 'commandId'>> &
    KeyboardShortcutsWidgetProps;

  className = 'deck-widget-keyboard-bindings';
  placement: WidgetPlacement = KeyboardShortcutsWidget.defaultProps.placement;

  #isOpen = false;
  #rootElement: HTMLElement | null = null;
  #keyboardShortcuts: KeyboardShortcut[] = KeyboardShortcutsWidget.defaultProps.keyboardShortcuts;
  #keyboardShortcutsManager: KeyboardShortcutsManager | null = null;
  /** Command id registered for opening the shortcuts panel. */
  commandId = KeyboardShortcutsWidget.defaultProps.commandId;

  /** Creates a standalone shortcuts widget. */
  constructor(props: KeyboardShortcutsWidgetProps) {
    super({...KeyboardShortcutsWidget.defaultProps, ...props});
    this.#keyboardShortcuts = props.keyboardShortcuts;
    this.commandId = props.commandId ?? this.commandId;
    commandManager.registerCommand({
      id: this.commandId,
      do: this.#handleOpen
    });
    if (props.placement !== undefined) {
      this.placement = props.placement;
    }
  }

  /** Updates widget placement, shortcut list, and installed shortcut handlers. */
  override setProps(props: Partial<KeyboardShortcutsWidgetProps>): void {
    this.commandId = props.commandId ?? this.commandId;
    commandManager.registerCommand({
      id: this.commandId,
      do: this.#handleOpen
    });
    if (props.keyboardShortcuts !== undefined) {
      this.#keyboardShortcuts = props.keyboardShortcuts;
      this.#restartKeyboardShortcutsManager();
      this.#renderRootElement();
    }
    if (props.installShortcuts !== undefined) {
      this.#restartKeyboardShortcutsManager();
      this.#renderRootElement();
    }
    if (props.placement !== undefined) {
      this.placement = props.placement;
    }
    super.setProps(props);
  }

  /** Installs optional deck keyboard handling when the widget is added. */
  override onAdd(): void {
    this.#restartKeyboardShortcutsManager();
    this.#renderRootElement();
  }

  /** Renders the shortcut trigger and modal into the deck widget root. */
  override onRenderHTML(rootElement: HTMLElement): void {
    this.#rootElement = rootElement;
    rootElement.className = ['deck-widget', this.className, this.props.className]
      .filter(Boolean)
      .join(' ');
    this.#renderRootElement();
  }

  /** Removes rendered UI and installed keyboard handlers. */
  override onRemove(): void {
    if (this.#rootElement) {
      render(null, this.#rootElement);
    }
    if (this.#keyboardShortcutsManager) {
      this.#keyboardShortcutsManager.stop();
      this.#keyboardShortcutsManager = null;
    }
  }

  #restartKeyboardShortcutsManager(): void {
    if (this.#keyboardShortcutsManager) {
      this.#keyboardShortcutsManager.stop();
      this.#keyboardShortcutsManager = null;
    }
    // @ts-expect-error Accessing protected member 'eventManager'.
    const eventManager = this.deck?.eventManager;
    if (eventManager && this.props.installShortcuts) {
      this.#keyboardShortcutsManager = new KeyboardShortcutsManager(
        eventManager,
        this.#getEffectiveKeyboardShortcuts()
      );
      this.#keyboardShortcutsManager.start();
    }
  }

  #renderRootElement(): void {
    if (!this.#rootElement) {
      return;
    }

    render(
      <KeyboardShortcutsWidgetView
        isOpen={this.#isOpen}
        keyboardShortcuts={this.#getEffectiveKeyboardShortcuts()}
        shortcutKeyHTML={
          this.#keyboardShortcutsManager?.getKeyHTML(this.commandId) ??
          KeyboardShortcutsManager.getKeyHTML(this.commandId)
        }
        onClose={this.#handleClose}
        onOpen={this.#handleTrigger}
      />,
      this.#rootElement
    );
  }

  #getEffectiveKeyboardShortcuts(): KeyboardShortcut[] {
    return [
      ...DEFAULT_SHORTCUTS.map(shortcut => ({
        ...shortcut,
        commandId: this.commandId,
        onKeyPress: this.#handleOpen
      })),
      ...this.#keyboardShortcuts
    ];
  }

  #handleOpen = (): void => {
    if (this.#isOpen) {
      return;
    }
    this.#isOpen = true;
    this.#renderRootElement();
  };

  #handleClose = (): void => {
    if (!this.#isOpen) {
      return;
    }
    this.#isOpen = false;
    this.#renderRootElement();
  };

  #handleTrigger = (): void => {
    commandManager.executeCommand(this.commandId);
  };
}

function KeyboardShortcutsWidgetView({
  isOpen,
  keyboardShortcuts,
  shortcutKeyHTML,
  onClose,
  onOpen
}: {
  isOpen: boolean;
  keyboardShortcuts: KeyboardShortcut[];
  shortcutKeyHTML?: string;
  onClose: () => void;
  onOpen: () => void;
}) {
  return (
    <>
      <div className="deck-widget-button">
        <button
          className="deck-widget-icon-button"
          style={{color: 'var(--button-text, currentColor)'}}
          type="button"
          title={getWidgetTooltipTitle('Keyboard shortcuts', shortcutKeyHTML)}
          aria-label="Keyboard shortcuts"
          onClick={onOpen}
        >
          <span style={{fontSize: '12px', fontWeight: 700, color: ICON_COLOR}}>
            <kbd style={{color: ICON_COLOR}}>?</kbd>
          </span>
        </button>
      </div>

      {isOpen && (
        <div style={MODAL_BACKDROP_STYLE} onClick={onClose}>
          <div
            style={MODAL_STYLE}
            role="dialog"
            aria-label="Keyboard Shortcuts"
            onClick={event => event.stopPropagation()}
          >
            <div style={MODAL_HEADER_STYLE}>
              <div style={MODAL_TITLE_STYLE}>Keyboard Shortcuts</div>
              <button
                type="button"
                onClick={onClose}
                style={MODAL_CLOSE_BUTTON_STYLE}
                aria-label="Close keyboard shortcuts"
                title="Close"
              >
                ×
              </button>
            </div>
            <KeyboardShortcutsPanelContent keyboardShortcuts={keyboardShortcuts} />
          </div>
        </div>
      )}
    </>
  );
}

function getWidgetTooltipTitle(label: string, shortcutKeyHTML?: string): string {
  return shortcutKeyHTML ? `${label} (${shortcutKeyHTML})` : label;
}

const MODAL_BACKDROP_STYLE: JSX.CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'grid',
  placeItems: 'center',
  background: 'rgba(15, 23, 42, 0.28)',
  zIndex: 50
};

const MODAL_STYLE: JSX.CSSProperties = {
  width: 'min(720px, calc(100vw - 24px))',
  maxHeight: 'min(720px, calc(100vh - 24px))',
  borderRadius: '12px',
  background: 'rgba(255, 255, 255, 0.96)',
  boxShadow: '0 14px 40px rgba(15, 23, 42, 0.28)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden'
};

const MODAL_HEADER_STYLE: JSX.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  borderBottom: '1px solid rgba(226, 232, 240, 1)',
  padding: '10px 12px'
};

const MODAL_TITLE_STYLE: JSX.CSSProperties = {
  fontSize: '14px',
  fontWeight: 700,
  color: 'rgb(30, 41, 59)'
};

const MODAL_CLOSE_BUTTON_STYLE: JSX.CSSProperties = {
  border: 0,
  background: 'transparent',
  color: 'rgb(71, 85, 105)',
  cursor: 'pointer',
  fontSize: '18px',
  lineHeight: '18px'
};

const ICON_COLOR = 'var(--button-icon-idle, var(--button-text, currentColor))';

/** @jsxImportSource preact */
import { Widget } from '@deck.gl/core';
import { render } from 'preact';
import { useState } from 'preact/hooks';

import { formatKey } from '../keyboard-shortcuts/keyboard-shortcuts';
import { KeyboardShortcutsManager } from '../keyboard-shortcuts/keyboard-shortcuts-manager';

import type { KeyboardShortcut } from '../keyboard-shortcuts/keyboard-shortcuts';
import type { WidgetPlacement, WidgetProps } from '@deck.gl/core';
import type { JSX } from 'preact';

export type KeyboardShortcutsWidgetProps = WidgetProps & {
  placement?: WidgetPlacement;
  keyboardShortcuts: KeyboardShortcut[];
  installShortcuts?: boolean;
};

export class KeyboardShortcutsWidget extends Widget<KeyboardShortcutsWidgetProps> {
  static override defaultProps = {
    ...Widget.defaultProps,
    id: 'keyboard-bindings',
    placement: 'top-left',
    keyboardShortcuts: [],
  } satisfies Required<WidgetProps> &
    Required<Pick<KeyboardShortcutsWidgetProps, 'placement' | 'keyboardShortcuts'>> &
    KeyboardShortcutsWidgetProps;

  className = 'deck-widget-keyboard-bindings';
  placement: WidgetPlacement = KeyboardShortcutsWidget.defaultProps.placement;

  #rootElement: HTMLElement | null = null;
  #keyboardShortcuts: KeyboardShortcut[] = KeyboardShortcutsWidget.defaultProps.keyboardShortcuts;
  #keyboardShortcutsManager: KeyboardShortcutsManager | null = null;

  constructor(props: KeyboardShortcutsWidgetProps) {
    super({ ...KeyboardShortcutsWidget.defaultProps, ...props });
    this.#keyboardShortcuts = props.keyboardShortcuts;
    if (props.placement !== undefined) {
      this.placement = props.placement;
    }
  }

  override setProps(props: Partial<KeyboardShortcutsWidgetProps>): void {
    if (props.keyboardShortcuts !== undefined) {
      this.#keyboardShortcuts = props.keyboardShortcuts;
    }
    if (props.placement !== undefined) {
      this.placement = props.placement;
    }
    super.setProps(props);
  }

  override onAdd(): void {
    // @ts-expect-error Accessing protected member 'eventManager'.
    const eventManager = this.deck?.eventManager;
    if (eventManager && this.props.installShortcuts) {
      this.#keyboardShortcutsManager = new KeyboardShortcutsManager(
        eventManager,
        this.#keyboardShortcuts,
      );
      this.#keyboardShortcutsManager.start();
    }
  }

  override onRenderHTML(rootElement: HTMLElement): void {
    this.#rootElement = rootElement;

    const className = ['deck-widget', this.className, this.props.className]
      .filter(Boolean)
      .join(' ');
    rootElement.className = className;

    render(
      <KeyboardShortcutsWidgetView keyboardShortcuts={this.#keyboardShortcuts} />,
      rootElement,
    );
  }

  override onRemove(): void {
    if (this.#rootElement) {
      render(null, this.#rootElement);
    }
    if (this.#keyboardShortcutsManager) {
      this.#keyboardShortcutsManager.stop();
      this.#keyboardShortcutsManager = null;
    }
  }
}

const MODAL_BACKDROP_STYLE: JSX.CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: 'rgba(15, 23, 42, 0.28)',
  pointerEvents: 'auto',
  zIndex: 1000,
};

const MODAL_STYLE: JSX.CSSProperties = {
  width: 'min(420px, calc(100vw - 24px))',
  maxHeight: 'min(460px, calc(100vh - 24px))',
  borderRadius: '10px',
  border: '1px solid rgba(148, 163, 184, 0.75)',
  backgroundColor: 'rgba(255, 255, 255, 0.98)',
  boxShadow: '0 14px 40px rgba(15, 23, 42, 0.28)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const KEY_STYLE: JSX.CSSProperties = {
  borderRadius: '6px',
  border: '1px solid rgba(148, 163, 184, 0.85)',
  backgroundColor: 'rgba(248, 250, 252, 1)',
  padding: '2px 8px',
  fontSize: '11px',
  color: 'rgb(51, 65, 85)',
  whiteSpace: 'nowrap',
};

function KeyboardShortcutsWidgetView({
  keyboardShortcuts,
}: {
  keyboardShortcuts: KeyboardShortcut[];
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <div className="deck-widget-button">
        <button
          className="deck-widget-icon-button"
          type="button"
          title="Keyboard shortcuts"
          aria-label="Keyboard shortcuts"
          onClick={() => setIsOpen(true)}
        >
          <span
            style={{
              fontSize: '12px',
              fontWeight: 700,
              color: 'var(--deck-widget-icon-color, #0f172a)',
            }}
          >
            <kbd
              style={{
                color: 'var(--deck-widget-icon-color, #0f172a)',
              }}
            >
              ?
            </kbd>
          </span>
        </button>
      </div>

      {isOpen && (
        <div style={MODAL_BACKDROP_STYLE} onClick={() => setIsOpen(false)}>
          <div
            style={MODAL_STYLE}
            role="dialog"
            aria-label="Keyboard Shortcuts"
            onClick={(event) => event.stopPropagation()}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderBottom: '1px solid rgba(226, 232, 240, 1)',
                padding: '10px 12px',
              }}
            >
              <div style={{ fontSize: '14px', fontWeight: 700, color: 'rgb(30, 41, 59)' }}>
                Keyboard Shortcuts
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                style={{
                  border: 0,
                  background: 'transparent',
                  color: 'rgb(71, 85, 105)',
                  cursor: 'pointer',
                  fontSize: '18px',
                  lineHeight: '18px',
                }}
                aria-label="Close keyboard shortcuts"
                title="Close"
              >
                ×
              </button>
            </div>

            <div style={{ overflowY: 'auto', padding: '10px 12px' }}>
              <div style={{ display: 'grid', gap: '8px' }}>
                {keyboardShortcuts.map((shortcut, index) => (
                  <div
                    key={`${shortcut.name}-${shortcut.key}-${index}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '8px',
                    }}
                  >
                    <ShortcutKey shortcut={shortcut} />
                    <span style={{ fontSize: '12px', color: 'rgb(71, 85, 105)' }}>
                      {shortcut.name}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ShortcutKey({ shortcut }: { shortcut: KeyboardShortcut }) {
  return (
    <div style={{ color: 'rgb(51, 65, 85)', fontSize: '11px' }}>
      {shortcut.commandKey && (
        <span>
          <kbd style={KEY_STYLE}>⌘</kbd>
          {' + '}
        </span>
      )}
      {shortcut.ctrlKey && (
        <span>
          <kbd style={KEY_STYLE}>^</kbd>
          {' + '}
        </span>
      )}
      {shortcut.shiftKey && (
        <span>
          <kbd style={KEY_STYLE}>Shift</kbd>
          {' + '}
        </span>
      )}
      {shortcut.key && <kbd style={KEY_STYLE}>{formatKey(shortcut.key)}</kbd>}
      {shortcut.dragMouse && 'drag mouse'}
    </div>
  );
}

/** @jsxImportSource preact */
import {Widget} from '@deck.gl/core';
import {render} from 'preact';

import {DEFAULT_SHORTCUTS, formatKey} from '../keyboard-shortcuts/keyboard-shortcuts';
import {KeyboardShortcutsManager} from '../keyboard-shortcuts/keyboard-shortcuts-manager';

import type {KeyboardShortcut} from '../keyboard-shortcuts/keyboard-shortcuts';
import type {WidgetPanel, WidgetPanelTheme} from './widget-containers';
import type {WidgetPlacement, WidgetProps} from '@deck.gl/core';
import type {JSX} from 'preact';

export type KeyboardShortcutsWidgetProps = WidgetProps & {
  placement?: WidgetPlacement;
  keyboardShortcuts: KeyboardShortcut[];
  installShortcuts?: boolean;
};

export type KeyboardShortcutsPanelProps = {
  /** Optional list of keyboard shortcuts to render in the panel. */
  keyboardShortcuts?: KeyboardShortcut[];
  /** Optional theme override applied to this panel subtree. */
  theme?: WidgetPanelTheme;
};

/**
 * A panel definition representing keyboard shortcut details for a modal/tab container.
 */
export class KeyboardShortcutsPanel implements WidgetPanel {
  id = 'keyboard-shortcuts';
  title = 'Keyboard Shortcuts';
  theme?: WidgetPanelTheme;
  content: JSX.Element;

  constructor({keyboardShortcuts = [], theme = 'inherit'}: KeyboardShortcutsPanelProps = {}) {
    this.theme = theme;
    this.content = <KeyboardSettingsPanelContent keyboardShortcuts={keyboardShortcuts} />;
  }
}

export class KeyboardShortcutsWidget extends Widget<KeyboardShortcutsWidgetProps> {
  static override defaultProps = {
    ...Widget.defaultProps,
    id: 'keyboard-bindings',
    placement: 'top-left',
    keyboardShortcuts: []
  } satisfies Required<WidgetProps> &
    Required<Pick<KeyboardShortcutsWidgetProps, 'placement' | 'keyboardShortcuts'>> &
    KeyboardShortcutsWidgetProps;

  className = 'deck-widget-keyboard-bindings';
  placement: WidgetPlacement = KeyboardShortcutsWidget.defaultProps.placement;

  #isOpen = false;
  #rootElement: HTMLElement | null = null;
  #keyboardShortcuts: KeyboardShortcut[] = KeyboardShortcutsWidget.defaultProps.keyboardShortcuts;
  #keyboardShortcutsManager: KeyboardShortcutsManager | null = null;

  constructor(props: KeyboardShortcutsWidgetProps) {
    super({...KeyboardShortcutsWidget.defaultProps, ...props});
    this.#keyboardShortcuts = props.keyboardShortcuts;
    if (props.placement !== undefined) {
      this.placement = props.placement;
    }
  }

  override setProps(props: Partial<KeyboardShortcutsWidgetProps>): void {
    if (props.keyboardShortcuts !== undefined) {
      this.#keyboardShortcuts = props.keyboardShortcuts;
      this.#restartKeyboardShortcutsManager();
      this.#renderRootElement();
    }
    if (props.installShortcuts !== undefined) {
      this.#restartKeyboardShortcutsManager();
    }
    if (props.placement !== undefined) {
      this.placement = props.placement;
    }
    super.setProps(props);
  }

  override onAdd(): void {
    this.#restartKeyboardShortcutsManager();
  }

  override onRenderHTML(rootElement: HTMLElement): void {
    this.#rootElement = rootElement;

    const className = ['deck-widget', this.className, this.props.className]
      .filter(Boolean)
      .join(' ');
    rootElement.className = className;

    this.#renderRootElement();
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
        onClose={this.#handleClose}
        onOpen={this.#handleOpen}
      />,
      this.#rootElement
    );
  }

  #getEffectiveKeyboardShortcuts(): KeyboardShortcut[] {
    return [
      ...DEFAULT_SHORTCUTS.map((shortcut) => ({
        ...shortcut,
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
}

const MODAL_BACKDROP_STYLE: JSX.CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: 'rgba(15, 23, 42, 0.28)',
  pointerEvents: 'auto',
  zIndex: 1000
};

const MODAL_STYLE: JSX.CSSProperties = {
  width: 'min(640px, calc(100vw - 24px))',
  maxHeight: 'min(520px, calc(100vh - 24px))',
  borderRadius: '14px',
  border: '1px solid rgba(148, 163, 184, 0.75)',
  backgroundColor: 'rgba(255, 255, 255, 0.98)',
  boxShadow: '0 14px 40px rgba(15, 23, 42, 0.28)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden'
};

const KEY_STYLE: JSX.CSSProperties = {
  borderRadius: '6px',
  border: '1px solid rgba(148, 163, 184, 0.85)',
  backgroundColor: 'rgba(248, 250, 252, 1)',
  padding: '2px 8px',
  fontSize: '11px',
  color: 'var(--button-text, #0f172a)',
  whiteSpace: 'nowrap'
};
const ICON_COLOR = 'var(--button-icon-idle, var(--button-text, currentColor))';
const SHORTCUT_BADGE_STYLE: JSX.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: '999px',
  border: '1px solid rgba(148, 163, 184, 0.75)',
  backgroundColor: 'rgba(248, 250, 252, 1)',
  padding: '1px 6px',
  fontSize: '10px',
  lineHeight: '12px',
  color: 'rgb(71, 85, 105)',
  whiteSpace: 'nowrap'
};
const SHORTCUT_ROW_STYLE: JSX.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(104px, 148px) minmax(0, 1fr) auto',
  gap: '10px 14px',
  alignItems: 'start',
  padding: '10px 0',
  borderBottom: '1px solid rgba(226, 232, 240, 0.8)'
};
const SHORTCUT_KEYS_STYLE: JSX.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  flexWrap: 'wrap',
  gap: '10px',
  minWidth: 0
};
const SHORTCUT_DESCRIPTION_STYLE: JSX.CSSProperties = {
  fontSize: '13px',
  lineHeight: '18px',
  fontWeight: 500,
  color: 'rgb(71, 85, 105)',
  textAlign: 'left',
  minWidth: 0,
  width: '100%'
};
const SHORTCUT_BADGES_STYLE: JSX.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: '6px',
  flexWrap: 'wrap',
  justifySelf: 'end'
};
const SHORTCUT_CHORD_STYLE: JSX.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '2px',
  color: 'rgb(51, 65, 85)',
  fontSize: '11px',
  whiteSpace: 'nowrap'
};

function KeyboardShortcutsWidgetView({
  isOpen,
  keyboardShortcuts,
  onClose,
  onOpen
}: {
  isOpen: boolean;
  keyboardShortcuts: KeyboardShortcut[];
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
          title="Keyboard shortcuts"
          aria-label="Keyboard shortcuts"
          onClick={onOpen}
        >
          <span
            style={{
              fontSize: '12px',
              fontWeight: 700,
              color: ICON_COLOR
            }}
          >
            <kbd
              style={{
                color: ICON_COLOR
              }}
            >
              ?
            </kbd>
          </span>
        </button>
      </div>

      {isOpen && (
        <div style={MODAL_BACKDROP_STYLE} onClick={onClose}>
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
                padding: '10px 12px'
              }}
            >
              <div style={{fontSize: '14px', fontWeight: 700, color: 'rgb(30, 41, 59)'}}>
                Keyboard Shortcuts
              </div>
              <button
                type="button"
                onClick={onClose}
                style={{
                  border: 0,
                  background: 'transparent',
                  color: 'rgb(71, 85, 105)',
                  cursor: 'pointer',
                  fontSize: '18px',
                  lineHeight: '18px'
                }}
                aria-label="Close keyboard shortcuts"
                title="Close"
              >
                ×
              </button>
            </div>
            <KeyboardSettingsPanelContent keyboardShortcuts={keyboardShortcuts} />
          </div>
        </div>
      )}
    </>
  );
}

function KeyboardSettingsPanelContent({
  keyboardShortcuts
}: {
  keyboardShortcuts: KeyboardShortcut[];
}) {
  const shortcutRows = buildKeyboardShortcutRows(keyboardShortcuts);

  return (
    <div style={{overflowY: 'auto', padding: '10px 12px', flex: 1, minHeight: 0}}>
      <div style={{display: 'flex', flexDirection: 'column'}}>
        {shortcutRows.map((row) => (
          <div key={row.key} style={SHORTCUT_ROW_STYLE}>
            <div
              data-shortcut-row-kind={row.shortcuts.length === 2 ? 'pair' : 'single'}
              style={SHORTCUT_KEYS_STYLE}
            >
              {row.shortcuts.map((shortcut, index) => (
                <div
                  key={`${row.key}-${index}`}
                  style={{display: 'inline-flex', alignItems: 'center'}}
                >
                  <div data-shortcut-key-group="true" key={`${row.key}-${index}`}>
                    <ShortcutKey shortcut={shortcut} />
                  </div>
                </div>
              ))}
            </div>
            <span data-shortcut-description="true" style={SHORTCUT_DESCRIPTION_STYLE}>
              {row.description}
            </span>
            {row.badges.length > 0 ? (
              <span data-shortcut-badges="true" style={SHORTCUT_BADGES_STYLE}>
                {row.badges.map((badge) => (
                  <span key={`${row.key}-${badge}`} style={SHORTCUT_BADGE_STYLE}>
                    {badge}
                  </span>
                ))}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function ShortcutKey({shortcut}: {shortcut: KeyboardShortcut}) {
  const parts: JSX.Element[] = [];

  if (shortcut.commandKey) {
    parts.push(
      <kbd key="command" style={KEY_STYLE}>
        ⌘
      </kbd>
    );
  }
  if (shortcut.ctrlKey) {
    parts.push(
      <kbd key="ctrl" style={KEY_STYLE}>
        ^
      </kbd>
    );
  }
  if (shortcut.shiftKey) {
    parts.push(
      <kbd key="shift" style={KEY_STYLE}>
        Shift
      </kbd>
    );
  }
  if (shortcut.key) {
    parts.push(
      <kbd key="key" style={KEY_STYLE}>
        {formatKey(shortcut.key)}
      </kbd>
    );
  }
  if (shortcut.dragMouse) {
    parts.push(
      <span key="drag" style={{whiteSpace: 'nowrap'}}>
        drag mouse
      </span>
    );
  }

  return (
    <div style={SHORTCUT_CHORD_STYLE}>
      {parts.map((part, index) => (
        <span key={`shortcut-part-${index}`} style={{display: 'inline-flex', alignItems: 'center'}}>
          {part}
        </span>
      ))}
    </div>
  );
}

type KeyboardShortcutRow = {
  badges: string[];
  description: string;
  key: string;
  shortcuts: KeyboardShortcut[];
};

function buildKeyboardShortcutRows(shortcuts: KeyboardShortcut[]): KeyboardShortcutRow[] {
  const rows: KeyboardShortcutRow[] = [];

  for (let index = 0; index < shortcuts.length; index += 1) {
    const shortcut = shortcuts[index];
    const nextShortcut = shortcuts[index + 1];
    const shortcutDisplayPair = shortcut?.displayPair;

    if (
      shortcut &&
      shortcutDisplayPair &&
      nextShortcut &&
      canPairShortcuts(shortcut, nextShortcut)
    ) {
      rows.push({
        badges: mergeShortcutBadges(shortcut, nextShortcut),
        description: shortcutDisplayPair.description,
        key: `${shortcutDisplayPair.id}-${index}`,
        shortcuts: [shortcut, nextShortcut]
      });
      index += 1;
    } else if (shortcut) {
      rows.push({
        badges: [...(shortcut.badges ?? [])],
        description: shortcut.description,
        key: `${shortcut.name}-${shortcut.key}-${index}`,
        shortcuts: [shortcut]
      });
    }
  }

  return rows;
}

function canPairShortcuts(
  shortcut: KeyboardShortcut,
  nextShortcut: KeyboardShortcut | undefined
): nextShortcut is KeyboardShortcut {
  if (!nextShortcut) {
    return false;
  }

  const shortcutPair = shortcut.displayPair;
  const nextShortcutPair = nextShortcut.displayPair;
  if (!shortcutPair || !nextShortcutPair) {
    return false;
  }

  return (
    shortcutPair.position === 'primary' &&
    nextShortcutPair.position === 'secondary' &&
    shortcutPair.id === nextShortcutPair.id &&
    shortcutPair.description === nextShortcutPair.description
  );
}

function mergeShortcutBadges(...shortcuts: KeyboardShortcut[]): string[] {
  const seenBadges = new Set<string>();
  const mergedBadges: string[] = [];

  for (const shortcut of shortcuts) {
    for (const badge of shortcut.badges ?? []) {
      if (!seenBadges.has(badge)) {
        seenBadges.add(badge);
        mergedBadges.push(badge);
      }
    }
  }

  return mergedBadges;
}

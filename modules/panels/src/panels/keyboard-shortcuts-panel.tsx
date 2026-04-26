/** @jsxImportSource preact */

import {formatKey} from '../keyboard-shortcuts/keyboard-shortcuts';

import type {KeyboardShortcut} from '../keyboard-shortcuts/keyboard-shortcuts';
import type {Panel, PanelTheme} from './panel-containers';
import type {JSX} from 'preact';

export type KeyboardShortcutsPanelProps = {
  /** Optional list of keyboard shortcuts to render in the panel. */
  keyboardShortcuts?: KeyboardShortcut[];
  /** Optional theme override applied to this panel subtree. */
  theme?: PanelTheme;
};

/**
 * A panel definition representing keyboard shortcut details for a modal/tab container.
 */
export class KeyboardShortcutsPanel implements Panel {
  id = 'keyboard-shortcuts';
  title = 'Keyboard Shortcuts';
  theme?: PanelTheme;
  content: JSX.Element;

  constructor({keyboardShortcuts = [], theme = 'inherit'}: KeyboardShortcutsPanelProps = {}) {
    this.theme = theme;
    this.content = <KeyboardSettingsPanelContent keyboardShortcuts={keyboardShortcuts} />;
  }
}

const KEY_STYLE: JSX.CSSProperties = {
  borderRadius: '6px',
  border: '1px solid rgba(148, 163, 184, 0.85)',
  backgroundColor: 'rgba(248, 250, 252, 1)',
  padding: '2px 8px',
  fontSize: '11px',
  color: 'var(--button-text, #0f172a)',
  whiteSpace: 'nowrap'
};
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

function KeyboardSettingsPanelContent({
  keyboardShortcuts
}: {
  keyboardShortcuts: KeyboardShortcut[];
}) {
  const shortcutRows = buildKeyboardShortcutRows(keyboardShortcuts);

  return (
    <div style={{overflowY: 'auto', padding: '10px 12px', flex: 1, minHeight: 0}}>
      <div style={{display: 'flex', flexDirection: 'column'}}>
        {shortcutRows.map(row => (
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
                {row.badges.map(badge => (
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

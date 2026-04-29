/** @jsxImportSource preact */

import {formatKey} from '../keyboard-shortcuts/keyboard-shortcuts';
import {InteractionIcon} from './interaction-icons';

import type {
  KeyboardShortcut,
  KeyboardShortcutDisplaySection,
  ShortcutDisplayInput,
  ShortcutDisplayModifier
} from '../keyboard-shortcuts/keyboard-shortcuts';
import type {Panel, PanelTheme} from './panel-containers';
import type {JSX} from 'preact';

export type KeyboardShortcutsPanelProps = {
  /** Optional list of keyboard shortcuts to render in the panel. */
  keyboardShortcuts?: KeyboardShortcut[];
  /** Optional theme override applied to this panel subtree. */
  theme?: PanelTheme;
};

/**
 * A panel definition representing keyboard, mouse, and trackpad interaction details.
 */
export class KeyboardShortcutsPanel implements Panel {
  /** Stable id used by tab containers. */
  id = 'keyboard-shortcuts';
  /** Visible tab title. */
  title = 'Keyboard & Mouse';
  /** Optional panel theme override. */
  theme?: PanelTheme;
  /** Renderable panel body. */
  content: JSX.Element;

  constructor({keyboardShortcuts = [], theme = 'inherit'}: KeyboardShortcutsPanelProps = {}) {
    this.theme = theme;
    this.content = <KeyboardShortcutsPanelContent keyboardShortcuts={keyboardShortcuts} />;
  }
}

/**
 * Renders keyboard shortcuts and pointer interactions as panel content.
 */
export function KeyboardShortcutsPanelContent({
  keyboardShortcuts
}: {
  /** Shortcuts and display-only interactions to render. */
  keyboardShortcuts: KeyboardShortcut[];
}) {
  const shortcutRows = buildKeyboardShortcutRows(keyboardShortcuts);
  const shortcutSections = buildKeyboardShortcutSections(shortcutRows);

  return (
    <div style={{overflowY: 'auto', padding: '10px 12px', flex: 1, minHeight: 0}}>
      <div style={{display: 'flex', flexDirection: 'column'}}>
        {shortcutSections.map(section => (
          <section
            key={section.title}
            aria-label={section.title}
            data-shortcut-section={section.title}
            style={SHORTCUT_SECTION_STYLE}
          >
            <h3 style={SHORTCUT_SECTION_HEADING_STYLE}>{section.title}</h3>
            <div style={{display: 'flex', flexDirection: 'column'}}>
              {section.rows.map(row => (
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
                          <ShortcutInputs shortcut={shortcut} />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={SHORTCUT_CONTENT_STYLE}>
                    <span data-shortcut-description="true" style={SHORTCUT_DESCRIPTION_STYLE}>
                      {row.description}
                    </span>
                    <span data-shortcut-badges="true" style={SHORTCUT_BADGES_STYLE}>
                      {row.badges.map(badge => (
                        <span key={`${row.key}-${badge}`} style={SHORTCUT_BADGE_STYLE}>
                          {badge}
                        </span>
                      ))}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function ShortcutInputs({shortcut}: {/** Shortcut to render. */ shortcut: KeyboardShortcut}) {
  return (
    <div style={SHORTCUT_INPUTS_STYLE}>
      {getShortcutDisplayInputs(shortcut).map((input, index) => (
        <ShortcutDisplayChip key={`${input.kind}-${input.label}-${index}`} input={input} />
      ))}
    </div>
  );
}

function ShortcutDisplayChip({
  input
}: {
  /** Input chip model to render. */
  input: ShortcutDisplayInput;
}) {
  const icon = input.kind === 'trackpad' ? (input.icon ?? getDefaultInputIcon(input)) : null;
  return (
    <div data-shortcut-input-kind={input.kind} style={SHORTCUT_CHORD_STYLE}>
      {(input.modifiers ?? []).map(modifier => (
        <kbd key={modifier} style={KEY_STYLE}>
          {formatShortcutModifier(modifier)}
        </kbd>
      ))}
      {icon ? <InteractionIcon icon={icon} /> : null}
      {input.kind === 'keyboard' ? <kbd style={KEY_STYLE}>{input.label}</kbd> : null}
      {input.kind !== 'keyboard' ? <span style={{whiteSpace: 'nowrap'}}>{input.label}</span> : null}
    </div>
  );
}

function getShortcutDisplayInputs(shortcut: KeyboardShortcut): ShortcutDisplayInput[] {
  if (shortcut.displayInputs && shortcut.displayInputs.length > 0) {
    return [...shortcut.displayInputs];
  }

  if (shortcut.dragMouse) {
    return [
      {
        kind: 'mouse',
        label: 'drag mouse',
        modifiers: getShortcutModifiers(shortcut),
        icon: 'mouse-drag'
      }
    ];
  }

  const label = shortcut.key ? formatKey(shortcut.key) : shortcut.name;
  return [
    {
      kind: 'keyboard',
      label,
      modifiers: getShortcutModifiers(shortcut),
      icon: 'keyboard'
    }
  ];
}

function getShortcutModifiers(shortcut: KeyboardShortcut): ShortcutDisplayModifier[] {
  const modifiers: ShortcutDisplayModifier[] = [];
  if (shortcut.commandKey) {
    modifiers.push('command');
  }
  if (shortcut.ctrlKey) {
    modifiers.push('ctrl');
  }
  if (shortcut.shiftKey) {
    modifiers.push('shift');
  }
  return modifiers;
}

function getDefaultInputIcon(input: ShortcutDisplayInput) {
  if (input.kind === 'mouse') {
    return 'mouse-drag';
  }
  if (input.kind === 'trackpad') {
    return 'trackpad-pan';
  }
  return 'keyboard';
}

function formatShortcutModifier(modifier: ShortcutDisplayModifier): string {
  if (modifier === 'command') {
    return '⌘';
  }
  if (modifier === 'ctrl') {
    return '^';
  }
  if (modifier === 'alt') {
    return '⌥';
  }
  return 'Shift';
}

type KeyboardShortcutRow = {
  /** Badges rendered after the shortcut description. */
  badges: string[];
  /** Description rendered for this row. */
  description: string;
  /** Stable render key for this row. */
  key: string;
  /** One or two shortcuts represented by this row. */
  shortcuts: KeyboardShortcut[];
};

type KeyboardShortcutSection = {
  /** Section title rendered above a group of related shortcuts. */
  title: 'Navigation' | 'Interaction' | 'Commands' | 'Settings';
  /** Shortcut rows rendered in this section. */
  rows: KeyboardShortcutRow[];
};

const SECTION_INDEX_BY_DISPLAY_SECTION: Record<KeyboardShortcutDisplaySection, number> = {
  navigation: 0,
  interaction: 1,
  commands: 2,
  settings: 3
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
      continue;
    }

    if (!shortcut) {
      continue;
    }

    rows.push({
      badges: [...(shortcut.badges ?? [])],
      description: shortcut.description,
      key: `${shortcut.name}-${shortcut.key}-${index}`,
      shortcuts: [shortcut]
    });
  }

  return rows;
}

function buildKeyboardShortcutSections(rows: KeyboardShortcutRow[]): KeyboardShortcutSection[] {
  const sections: KeyboardShortcutSection[] = [
    {title: 'Navigation', rows: []},
    {title: 'Interaction', rows: []},
    {title: 'Commands', rows: []},
    {title: 'Settings', rows: []}
  ];

  for (const row of rows) {
    sections[getKeyboardShortcutSectionIndex(row)].rows.push(row);
  }

  return sections.filter(section => section.rows.length > 0);
}

function getKeyboardShortcutSectionIndex(row: KeyboardShortcutRow): number {
  const explicitSection = getExplicitShortcutSection(row);
  if (explicitSection) {
    return SECTION_INDEX_BY_DISPLAY_SECTION[explicitSection];
  }
  if (isSettingsShortcutRow(row)) {
    return 3;
  }
  return isNavigationShortcutRow(row) ? 0 : 2;
}

function getExplicitShortcutSection(
  row: KeyboardShortcutRow
): KeyboardShortcutDisplaySection | undefined {
  const firstSection = row.shortcuts[0]?.displaySection;
  if (!firstSection) {
    return undefined;
  }
  return row.shortcuts.every(shortcut => shortcut.displaySection === firstSection)
    ? firstSection
    : undefined;
}

function isNavigationShortcutRow(row: KeyboardShortcutRow): boolean {
  return row.shortcuts.every(shortcut => isNavigationShortcut(shortcut));
}

function isSettingsShortcutRow(row: KeyboardShortcutRow): boolean {
  return row.shortcuts.every(shortcut => isSettingsShortcut(shortcut));
}

function isNavigationShortcut(shortcut: KeyboardShortcut): boolean {
  if (isSettingsShortcut(shortcut) || isCommandShortcut(shortcut)) {
    return false;
  }

  const key = shortcut.key;
  if (['a', 'd', 'w', 's', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) {
    return true;
  }

  if (shortcut.displayInputs?.some(input => input.kind === 'trackpad' || input.kind === 'mouse')) {
    return true;
  }

  return (
    /^(pan|zoom|swipe|drag)\b/i.test(shortcut.name) ||
    /\b(pan|zoom|swipe)\b/i.test(shortcut.description)
  );
}

function isSettingsShortcut(shortcut: KeyboardShortcut): boolean {
  const text = `${shortcut.name} ${shortcut.description} ${shortcut.displayPair?.description ?? ''}`;
  return (
    /\bcycle\b/i.test(text) &&
    /\b(color scheme|aggregation|mode|setting|layout|density)\b/i.test(text)
  );
}

function isCommandShortcut(shortcut: KeyboardShortcut): boolean {
  if (shortcut.dragMouse || shortcut.shiftKey || shortcut.key === '/' || shortcut.key === 'x') {
    return true;
  }

  return /\b(search|shortcut|measure|expand|collapse|select|copy|open|jump)\b/i.test(
    `${shortcut.name} ${shortcut.description}`
  );
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
      if (seenBadges.has(badge)) {
        continue;
      }
      seenBadges.add(badge);
      mergedBadges.push(badge);
    }
  }

  return mergedBadges;
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
  border: '1px solid rgba(148, 163, 184, 0.55)',
  backgroundColor: 'rgba(248, 250, 252, 0.8)',
  padding: '0 5px',
  fontSize: '9px',
  lineHeight: '11px',
  color: 'rgb(100, 116, 139)',
  transform: 'translateY(-2px)',
  whiteSpace: 'nowrap'
};

const SHORTCUT_SECTION_STYLE: JSX.CSSProperties = {
  display: 'flex',
  flexDirection: 'column'
};

const SHORTCUT_SECTION_HEADING_STYLE: JSX.CSSProperties = {
  margin: '12px 0 4px',
  color: 'rgb(100, 116, 139)',
  fontSize: '10px',
  fontWeight: 700,
  letterSpacing: '0',
  lineHeight: '14px',
  textTransform: 'uppercase'
};

const SHORTCUT_ROW_STYLE: JSX.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(124px, 180px) minmax(0, 1fr)',
  gap: '8px 10px',
  alignItems: 'center',
  padding: '6px 0',
  borderBottom: '1px solid rgba(226, 232, 240, 0.8)'
};

const SHORTCUT_KEYS_STYLE: JSX.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '11px',
  minWidth: 0
};

const SHORTCUT_CONTENT_STYLE: JSX.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  alignItems: 'start',
  gap: '8px',
  minWidth: 0
};

const SHORTCUT_DESCRIPTION_STYLE: JSX.CSSProperties = {
  fontSize: '13px',
  lineHeight: '18px',
  fontWeight: 400,
  color: 'rgb(51, 65, 85)',
  textAlign: 'left',
  minWidth: 0,
  flex: '1 1 240px'
};

const SHORTCUT_BADGES_STYLE: JSX.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  flexWrap: 'nowrap',
  justifyContent: 'flex-end',
  justifySelf: 'end',
  minHeight: '18px',
  whiteSpace: 'nowrap'
};

const SHORTCUT_INPUTS_STYLE: JSX.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '2px'
};

const SHORTCUT_CHORD_STYLE: JSX.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '2px',
  color: 'rgb(51, 65, 85)',
  fontSize: '11px',
  whiteSpace: 'nowrap'
};

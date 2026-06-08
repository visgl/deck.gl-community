/** Describes how two related shortcuts should be presented on one panel row. */
export type KeyboardShortcutDisplayPair = {
  /** Stable identifier used to join two related shortcuts into one row. */
  id: string;
  /** Whether this shortcut renders first or second within the paired row. */
  position: 'primary' | 'secondary';
  /** Shared description rendered for the paired row. */
  description: string;
};

/** User-facing input category shown in shortcut/help panels. */
export type ShortcutDisplayInputKind = 'keyboard' | 'mouse' | 'trackpad';

/** Modifier label displayed before a pointer or keyboard interaction. */
export type ShortcutDisplayModifier = 'command' | 'ctrl' | 'shift' | 'alt';

/** Icon style displayed for a pointer or trackpad interaction. */
export type ShortcutDisplayIcon =
  | 'keyboard'
  | 'mouse-drag'
  | 'trackpad-click'
  | 'trackpad-pan'
  | 'trackpad-zoom';

/** Shortcut panel section used by the help panel. */
export type KeyboardShortcutDisplaySection = 'navigation' | 'interaction' | 'commands' | 'settings';

/** Describes one display-only keyboard, mouse, or trackpad interaction in help panels. */
export type ShortcutDisplayInput = {
  /** Input device category shown by the help panel. */
  kind: ShortcutDisplayInputKind;
  /** Human-readable gesture label, such as "drag" or "two-finger swipe". */
  label: string;
  /** Optional modifier keys shown before the gesture label. */
  modifiers?: ShortcutDisplayModifier[];
  /** Optional icon override used by the help panel. */
  icon?: ShortcutDisplayIcon;
};

/** One keyboard shortcut entry rendered by shortcut-oriented panels and managed by helpers. */
export type KeyboardShortcut = {
  /** KeyboardEvent.key value that activates the shortcut. */
  key: string;
  /** Requires Command on macOS and Control on other platforms. */
  commandKey?: boolean;
  /** Requires the Shift modifier to be pressed. */
  shiftKey?: boolean;
  /** Requires the Control modifier to be pressed. */
  ctrlKey?: boolean;
  /** Indicates that the shortcut is shown as a drag interaction in the UI. */
  dragMouse?: boolean;
  /** Optional display-only keyboard, mouse, or trackpad interaction chips. */
  displayInputs?: ShortcutDisplayInput[];
  /** Optional explicit section override for the help panel. */
  displaySection?: KeyboardShortcutDisplaySection;
  /** Prevents the browser default behavior when this shortcut matches. */
  preventDefault?: boolean;
  /** Optional visual badges displayed next to the shortcut. */
  badges?: string[];
  /** Optional paired display metadata used for grouped shortcut rows. */
  displayPair?: KeyboardShortcutDisplayPair;
  /** Short display name shown in shortcut lists. */
  name: string;
  /** Longer explanation of what the shortcut does. */
  description: string;
  /** Optional callback invoked when the shortcut is triggered. */
  onKeyPress?: () => void;
};

/**
 * Minimal default shortcut set used by shortcut panels when no explicit list is provided.
 */
export const DEFAULT_SHORTCUTS: KeyboardShortcut[] = [
  {
    key: '/',
    commandKey: true,
    name: 'Show Shortcuts',
    description: 'Show keyboard shortcuts'
  }
];

const navigator = typeof window !== 'undefined' ? globalThis.navigator : {platform: ''};
const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

/**
 * Returns `true` when one DOM keyboard event matches one shortcut definition.
 */
export const isShortcutMatchingKeyEvent = (e: KeyboardEvent, shortcut: KeyboardShortcut) => {
  const requiresCommandKey = Boolean(shortcut.commandKey);
  const requiresShiftKey = Boolean(shortcut.shiftKey);
  const requiresCtrlKey = Boolean(shortcut.ctrlKey);
  const requiresPrimaryCtrlKey = !isMac && (requiresCommandKey || requiresCtrlKey);

  if (shortcut.key.toLowerCase() !== e.key.toLowerCase()) {
    return false;
  }

  if (e.shiftKey !== requiresShiftKey) {
    return false;
  }

  if (e.altKey) {
    return false;
  }

  if (isMac) {
    return e.metaKey === requiresCommandKey && e.ctrlKey === requiresCtrlKey;
  }

  return e.ctrlKey === requiresPrimaryCtrlKey && e.metaKey === false;
};

/**
 * Finds the most specific shortcut definition that matches one DOM keyboard event.
 */
export const findShortcutMatchingKeyEvent = (e: KeyboardEvent, shortcuts: KeyboardShortcut[]) => {
  let bestMatch: KeyboardShortcut | undefined;
  let bestSpecificity = -1;

  for (const shortcut of shortcuts) {
    if (!isShortcutMatchingKeyEvent(e, shortcut)) {
      continue;
    }

    const specificity =
      Number(Boolean(shortcut.commandKey)) +
      Number(Boolean(shortcut.shiftKey)) +
      Number(Boolean(shortcut.ctrlKey));
    if (specificity > bestSpecificity) {
      bestMatch = shortcut;
      bestSpecificity = specificity;
    }
  }

  return bestMatch;
};

/**
 * Human-friendly glyphs for special `KeyboardEvent.key` values.
 */
export const keyCharacter: Record<string, string> = {
  // Arrows
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',

  // Navigation
  Home: '⤒',
  End: '⤓',
  PageUp: '⇞',
  PageDown: '⇟',

  // Editing
  Backspace: '⌫',
  Delete: '⌦',
  Insert: 'Ins',

  // Whitespace / confirm / escape
  Enter: '⏎',
  Escape: '⎋',
  Tab: '⇥',
  ' ': '␠', // KeyboardEvent.key for Space is literally " "
  Spacebar: '␠', // legacy (some older browsers)

  // Modifiers
  Shift: 'Shift', // '⇧',
  Control: '⌃',
  Alt: '⌥',
  Meta: '⌘', // Windows key on Win; Command on macOS
  CapsLock: '⇪',

  // System / toggles
  ContextMenu: '≣',
  PrintScreen: '⎙',
  ScrollLock: '⇳',
  Pause: '⏸',
  NumLock: '⇭',

  // Media keys (common)
  MediaPlayPause: '⏯',
  MediaStop: '⏹',
  MediaTrackNext: '⏭',
  MediaTrackPrevious: '⏮',
  AudioVolumeMute: '🔇',
  AudioVolumeDown: '🔉',
  AudioVolumeUp: '🔊'
};

/**
 * Formats one `KeyboardEvent.key` value for display inside shortcut UIs.
 */
export function formatKey(key: string): string {
  // Prefer mapping for special keys, otherwise use the raw key (letters, digits, punctuation).
  // Make single characters uppercase for nicer display.
  const mapped = keyCharacter[key];
  if (mapped) return mapped;

  // Function keys: "F1"..."F24"
  if (/^F\d{1,2}$/.test(key)) return key;

  // Numpad keys often come as "Numpad1", etc.
  if (key.startsWith('Numpad')) return key.replace('Numpad', 'Num ');

  // For plain characters: show as-is, but uppercase letters.
  if (key.length === 1) return key.toUpperCase();

  // Fallback for less common named keys
  return key.toUpperCase();
}

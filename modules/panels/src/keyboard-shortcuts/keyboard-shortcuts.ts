/**
 * One keyboard shortcut entry rendered by shortcut-oriented panels and managed
 * by the keyboard shortcut helpers.
 */
export type KeyboardShortcut = {
  /** KeyboardEvent.key value that activates the shortcut. */
  key: string;
  /** Whether the platform command key must be pressed. */
  commandKey?: boolean;
  /** Whether the shift key must be pressed. */
  shiftKey?: boolean;
  /** Whether the control key must be pressed. */
  ctrlKey?: boolean;
  /** Whether the shortcut is associated with a drag gesture. */
  dragMouse?: boolean;
  /** Optional visual badges displayed next to the shortcut. */
  badges?: string[];
  /** Optional paired display metadata used for grouped shortcut rows. */
  displayPair?: {
    id: string;
    position: 'primary' | 'secondary';
    description: string;
  };

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
  const isCmd = isMac ? e.metaKey : e.ctrlKey;
  return (
    shortcut.key.toLowerCase() === e.key.toLowerCase() &&
    (shortcut.commandKey ? isCmd : true) &&
    (shortcut.shiftKey ? e.shiftKey : true) &&
    (shortcut.ctrlKey ? e.ctrlKey : true)
  );
};

/**
 * Finds the first shortcut definition that matches one DOM keyboard event.
 */
export const findShortcutMatchingKeyEvent = (e: KeyboardEvent, shortcuts: KeyboardShortcut[]) => {
  return shortcuts.find((shortcut) => isShortcutMatchingKeyEvent(e, shortcut));
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

export type KeyboardShortcut = {
  key: string;
  commandKey?: boolean;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  dragMouse?: boolean;
  badges?: string[];
  displayPair?: {
    id: string;
    position: 'primary' | 'secondary';
    description: string;
  };

  name: string;
  description: string;
  onKeyPress?: () => void;
};

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

export const isShortcutMatchingKeyEvent = (e: KeyboardEvent, shortcut: KeyboardShortcut) => {
  const isCmd = isMac ? e.metaKey : e.ctrlKey;
  return (
    shortcut.key.toLowerCase() === e.key.toLowerCase() &&
    (shortcut.commandKey ? isCmd : true) &&
    (shortcut.shiftKey ? e.shiftKey : true) &&
    (shortcut.ctrlKey ? e.ctrlKey : true)
  );
};

export const findShortcutMatchingKeyEvent = (e: KeyboardEvent, shortcuts: KeyboardShortcut[]) => {
  return shortcuts.find((shortcut) => isShortcutMatchingKeyEvent(e, shortcut));
};

// Pretty “keycap” glyphs for KeyboardEvent.key (browser KeyEvent)
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

// Optional: normalize a KeyboardEvent into a human-friendly label
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

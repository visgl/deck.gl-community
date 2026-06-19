import {formatShortcutKeyHTML} from '@deck.gl-community/panels';
import {cn} from './ui';

import type {KeyboardShortcut} from '@deck.gl-community/panels';
import type {ReactNode} from 'react';

/** Props for a compact copy shortcut hint. */
export type CopyShortcutHintProps = {
  /** Optional label rendered after the shortcut chip. */
  label?: ReactNode;
  /** Optional class name applied to the hint container. */
  className?: string;
};

const COPY_SHORTCUT: KeyboardShortcut = {
  key: 'c',
  commandKey: true,
  name: 'Copy',
  description: 'Copy'
};

/** Renders the primary copy shortcut using the shared shortcut formatter. */
export function CopyShortcutHint({label = 'to copy', className}: CopyShortcutHintProps) {
  return (
    <div className={cn('inline-flex items-center gap-1 font-medium text-current', className)}>
      <kbd className="inline-flex h-4 items-center rounded border border-current/20 bg-current/10 px-1 font-mono text-[10px] font-semibold leading-none text-current shadow-sm">
        {formatShortcutKeyHTML(COPY_SHORTCUT)}
      </kbd>
      <span>{label}</span>
    </div>
  );
}

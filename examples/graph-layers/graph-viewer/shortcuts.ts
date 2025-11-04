// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

export type ShortcutHint = {
  key: string;
  description: string;
};

export const TOGGLE_CHAIN_SHORTCUT = {
  key: 't',
  label: 'T',
  description: 'Toggle focused chain'
} as const;

export const COLLAPSE_CONTROLS_SHORTCUTS: ShortcutHint[] = [
  {key: TOGGLE_CHAIN_SHORTCUT.label, description: TOGGLE_CHAIN_SHORTCUT.description}
];

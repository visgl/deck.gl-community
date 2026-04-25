// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';

import {
  PANEL_THEME_DARK,
  PANEL_THEME_LIGHT,
  applyPanelTheme
} from './panel-theme';

function createStyleHost(): HTMLElement {
  const values = new Map<string, string>();
  return {
    style: {
      setProperty: (name: string, value: string) => values.set(name, value),
      removeProperty: (name: string) => values.delete(name),
      getPropertyValue: (name: string) => values.get(name) ?? ''
    }
  } as HTMLElement;
}

describe('panel-theme', () => {
  it('applies the light panel theme variables to a host element', () => {
    const root = createStyleHost();

    applyPanelTheme(root, PANEL_THEME_LIGHT);

    expect(root.style.getPropertyValue('--menu-background')).toBe(
      PANEL_THEME_LIGHT['--menu-background']
    );
    expect(root.style.getPropertyValue('--button-text')).toBe(PANEL_THEME_LIGHT['--button-text']);
  });

  it('replaces previous theme values when switching themes', () => {
    const root = createStyleHost();

    applyPanelTheme(root, PANEL_THEME_LIGHT);
    applyPanelTheme(root, PANEL_THEME_DARK);

    expect(root.style.getPropertyValue('--menu-background')).toBe(
      PANEL_THEME_DARK['--menu-background']
    );
    expect(root.style.getPropertyValue('--button-text')).toBe(PANEL_THEME_DARK['--button-text']);
  });
});

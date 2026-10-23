// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';

import {
  PANEL_THEME_DARK,
  PANEL_THEME_LIGHT,
  PANEL_THEME_SLEEK_LIGHT,
  PANEL_THEME_SLEEK_DARK,
  PANEL_THEME_PRESETS,
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
  } as unknown as HTMLElement;
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

describe('panel presets', () => {
  it.each(Object.entries(PANEL_THEME_PRESETS))('applies every value of %s', (preset, variables) => {
    const root = createStyleHost();
    applyPanelTheme(root, variables);
    expect(root.style.getPropertyValue('--panel-preset')).toBe(preset);
    for (const [key, value] of Object.entries(variables)) {
      expect(root.style.getPropertyValue(key)).toBe(value);
    }
  });

  it.each([
    PANEL_THEME_LIGHT,
    PANEL_THEME_DARK
  ])('resets compact values for an original preset', theme => {
    const root = createStyleHost();
    applyPanelTheme(root, PANEL_THEME_SLEEK_DARK);
    applyPanelTheme(root, theme);
    expect(root.style.getPropertyValue('--panel-padding')).toBe('initial');
    expect(root.style.getPropertyValue('--button-size')).toBe('28px');
    expect(root.style.getPropertyValue('--panel-preset')).toBe(theme['--panel-preset']);
  });

  it('keeps caller overrides and clears compact properties for a partial replacement', () => {
    const root = createStyleHost();
    applyPanelTheme(root, {...PANEL_THEME_SLEEK_LIGHT, '--panel-padding': '3px'});
    expect(root.style.getPropertyValue('--panel-padding')).toBe('3px');
    applyPanelTheme(root, {'--menu-background': '#abcdef'});
    expect(root.style.getPropertyValue('--panel-preset')).toBe('');
    expect(root.style.getPropertyValue('--panel-padding')).toBe('');
    expect(root.style.getPropertyValue('--menu-background')).toBe('#abcdef');
  });
});

it('applies reusable custom definitions and resets their overrides', () => {
  const host = createStyleHost();
  applyPanelTheme(host, {
    base: 'sleek-dark',
    variables: {'--panel-accent-color': '#b99aff', '--panel-control-height': '22px'}
  });
  expect(host.style.getPropertyValue('--panel-preset')).toBe('sleek-dark');
  expect(host.style.getPropertyValue('--panel-control-height')).toBe('22px');
  expect(host.style.getPropertyValue('--menu-background')).toBe(
    PANEL_THEME_SLEEK_DARK['--menu-background']
  );
  applyPanelTheme(host, PANEL_THEME_LIGHT);
  expect(host.style.getPropertyValue('--panel-accent-color')).toBe('initial');
});

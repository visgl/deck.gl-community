// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * CSS custom properties understood by the panel styling system.
 *
 * These variables mirror the deck.gl panel theme contract so standalone panel
 * hosts can render with the same visual language without importing deck.gl
 * runtime code.
 */
export type PanelThemeVariables = Record<`--${string}`, string>;

const PANEL_THEME_KEYS = [
  '--panel-preset',
  '--panel-font-size',
  '--panel-padding',
  '--panel-control-height',
  '--panel-control-padding',
  '--panel-surface-radius',
  '--panel-input-corner-radius',
  '--panel-content-background',
  '--panel-gap',
  '--panel-corner-radius',
  '--panel-focus-color',
  '--panel-accent-color',
  '--panel-hover-background',
  '--panel-disabled-opacity',
  '--menu-corner-radius',
  '--menu-weak-background',
  '--menu-divider',
  '--widget-margin',
  '--button-size',
  '--button-corner-radius',
  '--button-background',
  '--button-stroke',
  '--button-inner-stroke',
  '--button-shadow',
  '--button-backdrop-filter',
  '--button-icon-idle',
  '--button-icon-hover',
  '--button-text',
  '--icon-compass-north-color',
  '--icon-compass-south-color',
  '--menu-gap',
  '--menu-background',
  '--menu-backdrop-filter',
  '--menu-border',
  '--menu-border-color',
  '--menu-shadow',
  '--menu-text',
  '--menu-item-hover',
  '--range-step-button-size',
  '--range-track-size',
  '--range-thumb-size',
  '--range-track-color',
  '--range-thumb-color',
  '--range-decoration-active-color'
] as const satisfies ReadonlyArray<`--${string}`>;

/**
 * Built-in light panel theme variables.
 */
export const PANEL_THEME_LIGHT = {
  '--panel-preset': 'light',
  '--panel-font-size': 'initial',
  '--panel-padding': 'initial',
  '--panel-control-height': 'initial',
  '--panel-control-padding': 'initial',
  '--panel-surface-radius': 'initial',
  '--panel-input-corner-radius': 'initial',
  '--panel-content-background': 'initial',
  '--panel-gap': 'initial',
  '--panel-corner-radius': 'initial',
  '--menu-border-color': 'initial',
  '--panel-focus-color': 'initial',
  '--panel-accent-color': 'initial',
  '--panel-hover-background': 'initial',
  '--panel-disabled-opacity': 'initial',
  '--menu-corner-radius': 'initial',
  '--menu-weak-background': 'initial',
  '--menu-divider': 'initial',
  '--widget-margin': '12px',
  '--button-size': '28px',
  '--button-corner-radius': '8px',
  '--button-background': '#fff',
  '--button-stroke': 'rgba(255, 255, 255, 0.3)',
  '--button-inner-stroke': 'unset',
  '--button-shadow': '0px 0px 8px 0px rgba(0, 0, 0, 0.25)',
  '--button-backdrop-filter': 'unset',
  '--button-icon-idle': 'rgba(97, 97, 102, 1)',
  '--button-icon-hover': 'rgba(24, 24, 26, 1)',
  '--button-text': 'rgb(24, 24, 26, 1)',
  '--icon-compass-north-color': 'rgb(240, 92, 68)',
  '--icon-compass-south-color': 'rgb(204, 204, 204)',
  '--menu-gap': '4px',
  '--menu-background': '#fff',
  '--menu-backdrop-filter': 'unset',
  '--menu-border': 'unset',
  '--menu-shadow': '0px 0px 8px 0px rgba(0, 0, 0, 0.25)',
  '--menu-text': 'rgb(24, 24, 26, 1)',
  '--menu-item-hover': 'rgba(0, 0, 0, 0.08)',
  '--range-step-button-size': '24px',
  '--range-track-size': '16px',
  '--range-thumb-size': '10px',
  '--range-track-color': '#d8d8e5',
  '--range-thumb-color': '#616166',
  '--range-decoration-active-color': '#f8dd50'
} as const satisfies PanelThemeVariables;

/**
 * Built-in dark panel theme variables.
 */
export const PANEL_THEME_DARK = {
  '--panel-preset': 'dark',
  '--panel-font-size': 'initial',
  '--panel-padding': 'initial',
  '--panel-control-height': 'initial',
  '--panel-control-padding': 'initial',
  '--panel-surface-radius': 'initial',
  '--panel-input-corner-radius': 'initial',
  '--panel-content-background': 'initial',
  '--panel-gap': 'initial',
  '--panel-corner-radius': 'initial',
  '--menu-border-color': 'initial',
  '--panel-focus-color': 'initial',
  '--panel-accent-color': 'initial',
  '--panel-hover-background': 'initial',
  '--panel-disabled-opacity': 'initial',
  '--menu-corner-radius': 'initial',
  '--menu-weak-background': 'initial',
  '--menu-divider': 'initial',
  '--widget-margin': '12px',
  '--button-size': '28px',
  '--button-corner-radius': '8px',
  '--button-background': 'rgba(18, 18, 20, 1)',
  '--button-stroke': 'rgba(18, 18, 20, 0.30)',
  '--button-inner-stroke': 'unset',
  '--button-shadow': '0px 0px 8px 0px rgba(0, 0, 0, 0.25)',
  '--button-backdrop-filter': 'unset',
  '--button-icon-idle': 'rgba(158, 157, 168, 1)',
  '--button-icon-hover': 'rgba(215, 214, 229, 1)',
  '--button-text': 'rgb(215, 214, 229, 1)',
  '--icon-compass-north-color': 'rgb(240, 92, 68)',
  '--icon-compass-south-color': 'rgb(200, 199, 209)',
  '--menu-gap': '4px',
  '--menu-background': 'rgba(18, 18, 20, 1)',
  '--menu-backdrop-filter': 'unset',
  '--menu-border': 'unset',
  '--menu-shadow': '0px 0px 8px 0px rgba(0, 0, 0, 0.25)',
  '--menu-text': 'rgb(215, 214, 229, 1)',
  '--menu-item-hover': 'rgba(255, 255, 255, 0.1)',
  '--range-step-button-size': '24px',
  '--range-track-size': '16px',
  '--range-thumb-size': '10px',
  '--range-track-color': '#2c2c30',
  '--range-thumb-color': '#9e9da8',
  '--range-decoration-active-color': '#dd7d2c'
} as const satisfies PanelThemeVariables;

/** Shared compact geometry for the luma.gl-style translucent panels. */
const SLEEK_PANEL_GEOMETRY = {
  '--widget-margin': '8px',
  '--button-size': '20px',
  '--button-corner-radius': '4px',
  '--panel-font-size': '10px',
  '--panel-padding': '4px 6px',
  '--panel-control-height': '20px',
  '--panel-control-padding': '1px 5px',
  '--panel-gap': '3px',
  '--panel-corner-radius': '4px',
  '--panel-surface-radius': '8px',
  '--panel-input-corner-radius': '3px',
  '--panel-content-background': 'transparent',
  '--menu-corner-radius': '8px',
  '--menu-backdrop-filter': 'none',
  '--button-backdrop-filter': 'none',
  '--menu-gap': '4px',
  '--range-step-button-size': '20px',
  '--range-track-size': '12px',
  '--range-thumb-size': '8px'
} as const satisfies PanelThemeVariables;

/** Frosted light counterpart to the luma.gl-inspired translucent dark panels. */
export const PANEL_THEME_SLEEK_LIGHT = {
  ...PANEL_THEME_LIGHT,
  ...SLEEK_PANEL_GEOMETRY,
  '--panel-preset': 'sleek-light',
  '--button-background': 'rgba(241, 245, 251, 0.78)',
  '--button-stroke': 'rgba(82, 111, 157, 0.28)',
  '--button-inner-stroke': '1px solid rgba(82, 111, 157, 0.28)',
  '--button-shadow': 'inset 0 1px 0 rgba(255, 255, 255, 0.7)',
  '--button-text': '#24344c',
  '--button-icon-idle': '#526985',
  '--button-icon-hover': '#16385e',
  '--menu-background': 'rgba(248, 251, 255, 0.72)',
  '--menu-text': '#24344c',
  '--menu-border': '1px solid rgba(82, 111, 157, 0.28)',
  '--menu-border-color': 'rgba(82, 111, 157, 0.28)',
  '--menu-divider': '1px solid rgba(82, 111, 157, 0.16)',
  '--menu-weak-background': 'rgba(210, 225, 245, 0.18)',
  '--menu-item-hover': 'rgba(70, 125, 196, 0.12)',
  '--menu-shadow': '0 12px 30px rgba(15, 32, 60, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.65)',
  '--panel-focus-color': '#2563eb',
  '--panel-accent-color': '#167565',
  '--panel-hover-background': 'rgba(201, 221, 247, 0.76)',
  '--panel-disabled-opacity': '0.5',
  '--range-track-color': 'rgba(111, 137, 173, 0.38)',
  '--range-thumb-color': '#527caa',
  '--range-decoration-active-color': '#267cba'
} as const satisfies PanelThemeVariables;

/** Translucent blue-black surfaces based on luma.gl's packet-spraying panels. */
export const PANEL_THEME_SLEEK_DARK = {
  ...PANEL_THEME_DARK,
  ...SLEEK_PANEL_GEOMETRY,
  '--panel-preset': 'sleek-dark',
  '--button-background': 'rgba(15, 23, 42, 0.72)',
  '--button-stroke': 'rgba(140, 169, 211, 0.28)',
  '--button-inner-stroke': 'initial',
  '--button-shadow': 'inset 0 1px 0 rgba(255, 255, 255, 0.04)',
  '--button-text': '#e2e8f0',
  '--button-icon-idle': '#94a3b8',
  '--button-icon-hover': '#eff4fd',
  '--menu-background': 'rgba(8, 12, 20, 0.91)',
  '--menu-text': '#e2e8f0',
  '--menu-border': '1px solid rgba(126, 155, 205, 0.26)',
  '--menu-border-color': 'rgba(126, 155, 205, 0.26)',
  '--menu-divider': '1px solid rgba(126, 155, 205, 0.18)',
  '--menu-weak-background': 'rgba(15, 23, 42, 0.48)',
  '--menu-item-hover': 'rgba(125, 211, 252, 0.12)',
  '--menu-shadow': '0 12px 30px rgba(0, 0, 0, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.04)',
  '--panel-focus-color': '#8bb4ff',
  '--panel-accent-color': '#86cbbd',
  '--panel-hover-background': 'rgba(70, 104, 159, 0.38)',
  '--panel-disabled-opacity': '0.5',
  '--range-track-color': 'rgba(71, 85, 105, 0.8)',
  '--range-thumb-color': '#7dd3fc',
  '--range-decoration-active-color': '#86cbbd'
} as const satisfies PanelThemeVariables;

/** Named presets understood by panel scopes and host theme markers. */
export const PANEL_THEME_PRESETS = {
  light: PANEL_THEME_LIGHT,
  dark: PANEL_THEME_DARK,
  'sleek-light': PANEL_THEME_SLEEK_LIGHT,
  'sleek-dark': PANEL_THEME_SLEEK_DARK
} as const;

export type PanelThemePreset = keyof typeof PANEL_THEME_PRESETS;

/** A reusable custom theme, based on a built-in preset. */
export type PanelThemeDefinition = {
  base: PanelThemePreset;
  variables: PanelThemeVariables;
};

/** Resolves a custom definition to a complete set of CSS variables. */
export function resolvePanelThemeVariables(theme: PanelThemeDefinition): PanelThemeVariables {
  return {...PANEL_THEME_PRESETS[theme.base], ...theme.variables, '--panel-preset': theme.base};
}

/**
 * Applies one panel theme to an HTML element.
 *
 * Existing panel theme variables are cleared before the supplied variables are
 * written, which makes repeated theme switching deterministic.
 */
export function applyPanelTheme(
  element: HTMLElement,
  theme: PanelThemeVariables | PanelThemeDefinition
): void {
  for (const key of PANEL_THEME_KEYS) {
    element.style.removeProperty(key);
  }

  for (const [key, value] of Object.entries(
    'base' in theme ? resolvePanelThemeVariables(theme) : theme
  )) {
    element.style.setProperty(key, value);
  }
}

/** Copies computed theme values for menus mounted outside their panel subtree. */
export function getPanelThemeVariables(element: HTMLElement): PanelThemeVariables {
  const computedStyle = element.ownerDocument.defaultView?.getComputedStyle(element);
  const variables: PanelThemeVariables = {};
  for (const key of PANEL_THEME_KEYS) {
    const value = computedStyle?.getPropertyValue(key).trim();
    if (value) variables[key] = value;
  }
  return variables;
}

/** Watches the ancestors whose classes or inline styles can change a portal theme. */
export function observePanelTheme(element: HTMLElement, onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  let ancestor: HTMLElement | null = element;
  while (ancestor) {
    observer.observe(ancestor, {attributes: true, attributeFilter: ['style', 'class']});
    ancestor = ancestor.parentElement;
  }
  return () => observer.disconnect();
}

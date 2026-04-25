// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * CSS custom properties understood by the panel styling system.
 *
 * These variables mirror the deck.gl widget theme contract so standalone panel
 * hosts can render with the same visual language without importing deck.gl
 * runtime code.
 */
export type PanelThemeVariables = Record<`--${string}`, string>;

const PANEL_THEME_KEYS = [
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

/**
 * Applies one panel theme to an HTML element.
 *
 * Existing panel theme variables are cleared before the supplied variables are
 * written, which makes repeated theme switching deterministic.
 */
export function applyPanelTheme(element: HTMLElement, theme: PanelThemeVariables): void {
  for (const key of PANEL_THEME_KEYS) {
    element.style.removeProperty(key);
  }

  for (const [key, value] of Object.entries(theme)) {
    element.style.setProperty(key, value);
  }
}

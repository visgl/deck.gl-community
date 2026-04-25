# Panel Themes

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

`@deck.gl-community/panels` exports built-in light and dark panel theme variables
plus a small helper for applying them to a DOM host.

Use this API when you want standalone panel UI to match deck.gl-equivalent
light/dark styling without importing `@deck.gl/widgets`.

## Usage

```ts
import {
  PanelManager,
  PANEL_THEME_LIGHT,
  PANEL_THEME_DARK,
  applyPanelTheme,
  type PanelThemeVariables
} from '@deck.gl-community/panels';

const parentElement = document.getElementById('app') as HTMLElement;

const panelManager = new PanelManager({parentElement});
applyPanelTheme(parentElement, PANEL_THEME_DARK);
```

## Types

```ts
type PanelThemeVariables = Record<`--${string}`, string>;
```

## Exports

- `PANEL_THEME_LIGHT`: built-in light panel theme variables
- `PANEL_THEME_DARK`: built-in dark panel theme variables
- `applyPanelTheme(element, theme)`: applies panel theme variables to an HTML element

## Remarks

- These theme variables are intended for standalone `panels` usage.
- deck.gl widget wrappers should continue to use deck.gl theming from `@deck.gl/widgets`.
- Panel theme inference continues to work through the themed host element and `PanelManager`.

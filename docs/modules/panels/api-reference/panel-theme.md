import PanelLiveExample from '@site/src/components/docs/panel-live-example';

# Panel Themes

<PanelLiveExample highlight="panels" />

Panels support four presets. `light` and `dark` preserve the original deck.gl-style appearance. `sleek-light` and `sleek-dark` provide compact overlays with 10px text, 20px controls, tight 3px gaps, translucent surfaces, 8px panel corners, 3px numeric-field corners and mint control accents. Boolean controls use small sliding switches with native checkbox keyboard behavior. The dark preset follows the blue-black surfaces, muted borders and mint accents of the [luma.gl packet-spraying example](https://luma.gl/examples/showcase/packet-spraying).

## Select a panel preset

```ts
import {CustomPanel} from '@deck.gl-community/panels';

const panel = new CustomPanel({
  id: 'settings',
  title: 'Settings',
  theme: 'sleek-dark',
  onRenderHTML: (element) => {
    element.textContent = 'Settings';
  }
});

panel.setProps({theme: 'sleek-light'});
```

`PanelTheme` accepts `'inherit' | 'light' | 'dark' | 'sleek-light' | 'sleek-dark' | 'invert'`.

- `inherit` (the default) retains the parent's full preset and CSS variable overrides.
- `invert` flips the parent's light/dark mode while retaining its original or sleek family.
- An explicit preset selects that preset and resets inherited compact geometry when switching to `light` or `dark`.

`PanelThemeMode` and `useEffectivePanelThemeMode()` continue to return only `'light' | 'dark'`.

## Theme a host

```ts
import {
  PANEL_THEME_LIGHT,
  PANEL_THEME_DARK,
  PANEL_THEME_SLEEK_LIGHT,
  PANEL_THEME_SLEEK_DARK,
  applyPanelTheme
} from '@deck.gl-community/panels';

const host = document.getElementById('app')!;
applyPanelTheme(host, PANEL_THEME_SLEEK_DARK);

// Change the host and all inheriting descendants at runtime.
applyPanelTheme(host, PANEL_THEME_LIGHT);
```

Each preset includes a `--panel-preset` marker so nested panels recognize its family. Hosts without a recognized marker retain the existing background-color-based light/dark inference. `applyPanelTheme` clears recognized theme variables before applying the replacement, including compact geometry and the marker.

## Customize variables

`PanelThemeVariables` maps CSS custom property names to string values. Spread a preset to override individual values:

```ts
applyPanelTheme(host, {
  ...PANEL_THEME_SLEEK_LIGHT,
  '--panel-padding': '8px',
  '--panel-gap': '6px',
  '--menu-background': '#f8fafc'
});
```

Panel-specific variables include `--panel-font-size`, `--panel-padding`, `--panel-gap`, `--panel-corner-radius`, `--panel-control-height`, `--panel-control-padding`, `--panel-focus-color`, `--panel-hover-background` and `--panel-disabled-opacity`. Existing presets use CSS `initial` for these additions, allowing each component's original fallback styling to remain in effect. Caller-provided content must consume the variables to share the appearance; arbitrary HTML is not restyled automatically.

The existing deck.gl-compatible button, menu and range variables remain available. Panels do not import deck.gl, and these presets do not change PanWidget or ZoomRangeWidget.

## Browser comparison

From the repository root, run:

```bash
yarn vite modules/panels/examples --host 127.0.0.1
```

Open the printed local URL to compare all four presets, nested inheritance and inversion, tabs, select menus, text inputs, checkboxes and disabled controls. Use Tab to inspect focus visibility and the preset selector to test runtime switching.

## User-defined themes

Define a reusable `PanelThemeDefinition` with a built-in base and CSS variable overrides.
Pass the same object directly to a panel's `theme` property or to `applyPanelTheme()`:

```typescript
import {applyPanelTheme, type PanelThemeDefinition} from '@deck.gl-community/panels';

const violetTheme: PanelThemeDefinition = {
  base: 'sleek-dark',
  variables: {
    '--panel-accent-color': '#b99aff',
    '--panel-focus-color': '#cbb8ff',
    '--panel-control-height': '22px',
    '--panel-font-size': '11px'
  }
};

panel.setProps({theme: violetTheme});
// Or apply to a host containing panels with theme: 'inherit':
applyPanelTheme(hostElement, violetTheme);
```

Nested `inherit` panels preserve all custom values. The base determines the light/dark
mode and control styling. Explicit preset names reset overrides; `invert` selects the
opposite built-in preset in the base's family. For a custom opposite palette, supply
another theme definition. Existing CSS variable objects and spread overrides remain
supported by `applyPanelTheme()`.

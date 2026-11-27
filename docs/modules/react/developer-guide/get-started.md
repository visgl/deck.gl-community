# Get Started

## Panels inside React Fiber

Install `@deck.gl-community/react`, `@deck.gl/react` and its
React 19.2+ peers, and matching versions of `@deck.gl-community/panels` and
`@deck.gl-community/widgets`.

Use `Panel` inside the upstream `DeckGL` root. Pass a panel component class
as `type` and pass its constructor props directly to `Panel`.

```tsx
import {DeckGL} from '@deck.gl/react';
import {BoxPanelContainer as BoxPanel, MarkdownPanel} from '@deck.gl-community/panels';
import {Panel} from '@deck.gl-community/react';

const tools = new MarkdownPanel({title: 'Map help', markdown: 'Use the map to explore the data.'});

export function MapExample() {
  return (
    <DeckGL initialViewState={{longitude: -122.4, latitude: 37.8, zoom: 11}} controller>
      <Panel type={BoxPanel} id="tools" title="Tools" panel={tools} />
    </DeckGL>
  );
}
```

Set distinct IDs when rendering multiple panels. Use another panel component,
such as `SidebarPanelContainer`, to change how the panel is mounted.

## Panels in a React DOM tree

Import the legacy `Panel` to render a panel definition in a React layout or
MDX page. This entry point also provides `useReactPanel` for
React-owned content. For the classic wrapper, import
`DeckGL` from `@deck.gl/react/legacy` and the DOM panel components from
`@deck.gl-community/react/legacy`.

```tsx
import {Panel} from '@deck.gl-community/react/legacy';
import {MarkdownPanel} from '@deck.gl-community/panels';

const help = new MarkdownPanel({title: 'Help', markdown: 'Select a point to inspect it.'});

export function HelpPanel() {
  return <Panel panel={help} themeMode="inherit" />;
}
```

## Shared Deck canvases

Import `DeckCanvas` from `@deck.gl-community/react` when your
application owns an imperative, multi-canvas `Deck` instance. Each component
contributes its own canvas, views, layers, and widgets. See the
[DeckCanvas example](../api-reference/deck-canvas.md#example) for setup and cleanup.

## Graphics backend dropdown

Use `DeviceTabs` in a React DOM toolbar or overlay. Pass the same device manager
that drives the example's renderer. The dropdown shows the active backend and
disables unavailable options.

```tsx
import {DeviceTabs} from '@deck.gl-community/react';

<DeviceTabs manager={deviceManager} devices={['webgpu', 'webgl2']} />;
```

Initialize and reset the controller in the example host. The host can subscribe
to the controller to recreate its renderer when the active device changes. Pass
`onDeviceTypeChange` when backend selection needs to coordinate with other
example state.

## HTML overlays

HTML overlays from this package have moved to the **@deck.gl-community/widgets** module so they can
run inside deck.gl's widget system. Use the widget equivalents with Preact-rendered items:

```tsx
import DeckGL from '@deck.gl/react/legacy';
import {h} from 'preact';
import {HtmlOverlayItem, HtmlOverlayWidget} from '@deck.gl-community/widgets';

const htmlOverlay = new HtmlOverlayWidget({
  items: [h(HtmlOverlayItem, {coordinates}, title)]
});

<DeckGL initialViewState={initialViewState} controller={true} widgets={[htmlOverlay]} />;
```

See the [@deck.gl-community/widgets documentation](/docs/modules/widgets/api-reference/html-overlay-widget)
for the full API and examples.

# Get Started

Install `@deck.gl-community/react`, deck.gl v10's `@deck.gl/react` and its
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

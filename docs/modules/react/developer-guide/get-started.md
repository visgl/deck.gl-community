# Get Started

HTML overlays from this package have moved to the **@deck.gl-community/widgets** module so they can
run inside deck.gl's widget system. Use the widget equivalents with Preact-rendered items:

```tsx
import DeckGL from '@deck.gl/react';
import {h} from 'preact';
import {HtmlOverlayItem, HtmlOverlayWidget} from '@deck.gl-community/widgets';

const htmlOverlay = new HtmlOverlayWidget({
  items: [h(HtmlOverlayItem, {coordinates}, title)]
});

<DeckGL initialViewState={initialViewState} controller={true} widgets={[htmlOverlay]} />;
```

See the [@deck.gl-community/widgets documentation](/docs/modules/widgets/api-reference/html-overlay-widget)
for the full API and examples.

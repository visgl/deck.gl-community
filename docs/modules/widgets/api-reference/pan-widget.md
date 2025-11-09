# PanWidget

A directional pad that pans the target view by a fixed number of screen pixels per interaction.

## Usage

```ts
import {PanWidget} from '@deck.gl-community/widgets';

const panWidget = new PanWidget({step: 64});
```

Add the widget instance to the `widgets` array on a Deck or DeckGL React component.

## Properties

### `id` (string, optional)

Unique identifier for the widget. Defaults to `'pan'`.

### `viewId` (string | null, optional)

Limits the widget to a single view. When omitted, the widget applies updates to every view managed by the Deck instance.

### `placement` (`WidgetPlacement`, optional)

Preferred placement in the Deck view. Defaults to `'top-left'`.

### `step` (number, optional)

Number of pixels to pan in each direction when a button is activated. Defaults to `48`.

### `style` (`Partial<CSSStyleDeclaration>`, optional)

Inline styles merged into the wrapper element. Use this to adjust spacing relative to other widgets.

### `className` (string, optional)

Additional CSS classes appended to the widget container.

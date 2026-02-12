# ZoomRangeWidget

A vertical slider with increment/decrement buttons that adjusts the zoom level of the target view.

## Usage

```ts
import {ZoomRangeWidget} from '@deck.gl-community/widgets';

const zoomWidget = new ZoomRangeWidget({minZoom: -5, maxZoom: 5, step: 0.5});
```

Add the widget instance to the `widgets` array on a Deck or DeckGL React component.

## Properties

### `id` (string, optional)

Unique identifier for the widget. Defaults to `'zoom-range'`.

### `viewId` (string | null, optional)

Limits the widget to a single view. When omitted, the widget applies updates to every view managed by the Deck instance.

### `placement` (`WidgetPlacement`, optional)

Preferred placement in the Deck view. Defaults to `'top-left'`.

### `minZoom` (number, optional)

Lower bound for the zoom slider. When not provided, the widget infers the minimum zoom from the current view state.

### `maxZoom` (number, optional)

Upper bound for the zoom slider. When not provided, the widget infers the maximum zoom from the current view state.

### `step` (number, optional)

Resolution for the slider and the increment/decrement buttons. Defaults to `0.1`.

### `style` (`Partial<CSSStyleDeclaration>`, optional)

Inline styles merged into the wrapper element. Use this to adjust spacing relative to other widgets.

### `className` (string, optional)

Additional CSS classes appended to the widget container.

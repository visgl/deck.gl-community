# HtmlTooltipWidget

Display a tooltip built from picking info returned by deck.gl hover events. Tooltips are rendered
as [`HtmlOverlayItem`](./html-overlay-item.md) instances by the widget, so you only need to supply
an optional `getTooltip` function.

```ts
import {HtmlTooltipWidget} from '@deck.gl-community/widgets';

const tooltipWidget = new HtmlTooltipWidget({
  showDelay: 200,
  getTooltip: (info) => info.object?.name
});
```

## Props

### showDelay

Optional. Default: `250` milliseconds. Delay before showing the tooltip after hover.

### getTooltip(pickingInfo)

Optional. Return the tooltip contents for the supplied `PickingInfo`. If this function returns
`null`, the tooltip is hidden.

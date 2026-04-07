# ResetViewWidget

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

`ResetViewWidget` is a small icon button widget that invokes a caller-provided “fit/reset view” callback.

## Import

```ts
import {ResetViewWidget} from '@deck.gl-community/widgets';
```

## Props

```ts
type ResetViewWidgetProps = WidgetProps & {
  placement?: WidgetPlacement;
  label?: string;
  onResetView?: () => void;
};
```

Default props:

- `id: 'reset-view'`
- `placement: 'top-left'`
- `label: 'Resize to fit'`


## Usage

Within this repo it is typically wired to a `DeckTraceGraph` or controller callback that recomputes visible bounds and resets the camera.

## Remarks

- Renders a single icon button.
- Uses `label` for tooltip and aria label.
- Calls `onResetView` when clicked.

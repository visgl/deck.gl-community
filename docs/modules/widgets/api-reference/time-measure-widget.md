# TimeMeasureWidget

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

`TimeMeasureWidget` is an interactive measurement widget for selecting a time range directly from a deck trace view.

## Import

```ts
import {TimeMeasureWidget, type TimeMeasureRange} from '@deck.gl-community/widgets';
```

## Types

```ts
type TimeMeasureRange = {startTimeMs: number; endTimeMs: number};

type TimeMeasureSelectionState = {
  phase: 'idle' | 'selecting-start' | 'selecting-end' | 'selected';
  cursorTimeMs: number | null;
  draftStartTimeMs: number | null;
  range: TimeMeasureRange | null;
};
```

## Props

```ts
type TimeMeasureWidgetProps = WidgetProps & {
  placement?: WidgetPlacement;
  viewId?: string | null;
  eventViewId?: string | string[] | null;
  projectionViewId?: string | null;
  label?: string;
  activeLabel?: string;
  onActivate?: () => void;
  onDeactivate?: () => void;
  onRangeChange?: (range: TimeMeasureRange | null) => void;
  onSelectionChange?: (selection: TimeMeasureSelectionState) => void;
};
```

Default props:

- `id: 'time-measure'`
- `placement: 'top-left'`
- `eventViewId: 'main'`
- `projectionViewId: 'main'`

## Usage

```ts
new TimeMeasureWidget({
  onRangeChange: (range) => setSelectedRange(range),
  onSelectionChange: (selection) => setMeasureState(selection)
});
```

## Related surface

The selected range can be rendered or visualized further with `TimeMeasureLayer`.

## Remarks

- Renders a toolbar button for entering measurement mode.
- Supports click-based two-step range selection.
- Supports Shift-drag selection directly in the target view.
- Emits incremental selection state updates while the user is dragging or hovering.
- Cancels on `Escape`.
- Tracks separate event and projection views so input and coordinate projection can be decoupled.

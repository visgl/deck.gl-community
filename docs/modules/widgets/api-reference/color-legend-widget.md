# ColorLegendWidget

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

`ColorLegendWidget` renders declarative color keys in a deck.gl HTML widget. Its payload is JSON-safe, so applications can prepare legend content outside the rendering layer and pass it through unchanged.

The widget supports categorical lists, continuous gradients, and compact palettes in one ordered legend. Large categorical lists stay bounded by default and can expose a bounded expanded view. Categorical entries with a `title` expose that text through a keyboard-accessible, viewport-clamped tooltip that stays visible outside an expanded list's scroll container.

## Import

```ts
import {
  ColorLegendWidget,
  type ColorLegendPayload,
  type ColorLegendWidgetProps
} from '@deck.gl-community/widgets';
```

## Types

```ts
type ColorLegendColor =
  | string
  | readonly [red: number, green: number, blue: number]
  | readonly [red: number, green: number, blue: number, alpha: number];

type ColorLegendPayload = {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly ariaLabel?: string;
  readonly sections: readonly ColorLegendSection[];
};

type ColorLegendSection =
  | ColorLegendCategoricalSection
  | ColorLegendContinuousSection
  | ColorLegendPaletteSection;

type ColorLegendWidgetProps = WidgetProps & {
  readonly payload: ColorLegendPayload;
  readonly placement?: WidgetPlacement;
  readonly viewId?: string | null;
  readonly onClose?: () => void;
};
```

Categorical sections contain labeled swatches:

```ts
type ColorLegendCategoricalSection = {
  readonly type: 'categorical';
  readonly id: string;
  readonly title?: string;
  readonly entries: readonly {
    readonly color: ColorLegendColor;
    readonly label: string;
    readonly description?: string;
    readonly title?: string;
  }[];
  readonly totalCount?: number;
  readonly maxVisibleEntries?: number;
  readonly maxExpandedEntries?: number;
};
```

Continuous sections contain low-to-high stops, and palette sections contain a compact row of colors:

```ts
type ColorLegendContinuousSection = {
  readonly type: 'continuous';
  readonly id: string;
  readonly title?: string;
  readonly stops: readonly {
    readonly color: ColorLegendColor;
    readonly label: string;
  }[];
};

type ColorLegendPaletteSection = {
  readonly type: 'palette';
  readonly id: string;
  readonly title?: string;
  readonly label?: string;
  readonly colors: readonly {
    readonly color: ColorLegendColor;
    readonly label?: string;
  }[];
};
```

## Usage

```ts
import {ColorLegendWidget} from '@deck.gl-community/widgets';

const colorLegend = new ColorLegendWidget({
  placement: 'bottom-right',
  payload: {
    id: 'latency',
    title: 'Latency',
    description: 'P95 duration by operation',
    sections: [
      {
        id: 'duration',
        type: 'continuous',
        title: 'Duration',
        stops: [
          {label: 'Fast', color: '#22c55e'},
          {label: 'Slow', color: '#ef4444'}
        ]
      },
      {
        id: 'operation',
        type: 'categorical',
        entries: [
          {label: 'Read', description: 'Cached and local', color: [33, 150, 243]},
          {label: 'Write', color: [156, 39, 176, 255]}
        ]
      },
      {
        id: 'fallback',
        type: 'palette',
        label: 'Hash-derived operations',
        colors: [{color: '#ffc107'}, {color: [128, 128, 128, 128], label: 'Fallback'}]
      }
    ]
  }
});
```

## Remarks

- The payload uses only strings, numbers, arrays, and objects; it can be serialized, stored, or transferred between application layers.
- Categorical sections render at most 10 entries initially and 100 after expansion unless the section overrides `maxVisibleEntries` or `maxExpandedEntries`.
- `totalCount` can report categories that are intentionally omitted from the prepared payload.
- A categorical entry's optional `title` is available on its row, label, and swatch, and opens a focusable/hoverable tooltip that is portaled outside clipped widget content.
- Supplying `onClose` adds an accessible dismiss button to the header.
- CSS follows deck.gl widget theme tokens such as `--menu-background`, `--menu-text`, `--button-background`, `--button-text`, and `--button-stroke`.

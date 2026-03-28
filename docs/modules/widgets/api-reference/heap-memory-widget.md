# HeapMemoryWidget

<p class="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

`HeapMemoryWidget` is a small diagnostic widget that displays browser JS heap usage in gigabytes.

It is exported from `@deck.gl-community/widgets`.

## Import

```ts
import {HeapMemoryWidget} from '@deck.gl-community/widgets';
```

## Props

```ts
type HeapMemoryWidgetProps = WidgetProps & {
  placement?: WidgetPlacement;
  pollIntervalMs?: number;
};
```

## Behavior

- Polls `window.performance.memory` on an interval.
- Displays used heap in GB.
- Uses a background gradient to show used, reserved, and remaining capacity.
- Falls back to `N/A` when the browser does not expose heap metrics.
- Enforces a minimum effective poll interval of 500ms.

Default props:

- `id: 'heap-memory'`
- `placement: 'top-right'`
- `pollIntervalMs: 2000`

## Usage

```ts
new Deck({
  widgets: [new HeapMemoryWidget({ pollIntervalMs: 1000 })],
});
```

## Notes

This is a debugging/observability widget. It depends on browser support for `performance.memory`, so it is not guaranteed to show data in every environment.

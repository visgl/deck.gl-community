# DeckTraceGraphController

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square" alt="from v9.4" />
  <img src="https://img.shields.io/badge/status-work--in--progress-orange.svg?style=flat-square" alt="status Work-in-Progress" />
</p>

`DeckTraceGraphController` computes trace-specific deck.gl viewport updates and bounds fitting for a
custom deck shell.

```ts
import {DeckTraceGraphController} from '@deck.gl-community/trace-layers/layers';
```

## Use it when

- you are not using `DeckTraceGraph`
- you still want trace-aware viewport fitting and updates
- your shell owns the deck instance and synchronized trace views

Most React applications should use `DeckTraceGraph` instead.

## Related exports

- `DeckTraceGraphViewUpdateOptions`
- `widenBoundsForMinimumBlockWidth(...)`
- `buildTracevisViewLayout(...)`

See [Rendering traces](../../developer-guide/rendering-traces.md) and
[ImperativeDeckController](./imperative-deck-controller.md).

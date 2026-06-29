# ImperativeDeckController

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square" alt="from v9.4" />
  <img src="https://img.shields.io/badge/status-work--in--progress-orange.svg?style=flat-square" alt="status Work-in-Progress" />
</p>

`ImperativeDeckController` exposes imperative navigation for the currently mounted trace deck target.

```ts
import {
  ImperativeDeckController,
  imperativeDeckController
} from '@deck.gl-community/trace-layers/layers';
```

## Use it for

- host-owned search result navigation
- breadcrumb jumps
- deep-link restore after a graph is mounted
- custom shells that need trace-aware imperative viewport commands

The singleton `imperativeDeckController` is useful when one shared mounted viewer owns navigation.
Use an instance when a host needs explicit ownership.

## Target

`ImperativeDeckControllerTarget` is the adapter a mounted deck surface gives to the controller. Keep
that target lifecycle aligned with the mounted viewer; do not retain stale targets across unmounts.

See [DeckTraceGraph](../react/deck-trace-graph.md) for the higher-level React handle.

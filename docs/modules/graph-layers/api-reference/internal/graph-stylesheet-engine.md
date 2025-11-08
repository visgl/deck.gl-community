## GraphStylesheetEngine

> Looking for stylesheet authoring guidance? Start with the [graph stylesheet reference](./graph-stylesheet.md), which documents the structure of the style objects you pass into `GraphLayer`.

`GraphStylesheetEngine` is the runtime helper that turns user-authored `GraphStylesheet` objects into the Deck.gl accessors consumed by the graph layers. It extends the reusable `StylesheetEngine` utility, so advanced renderers can re-use the parsing, state-selector handling, and update-trigger wiring outside of `GraphLayer`. The class is still exported as `GraphStyleEngine` for backwards compatibility, but new code should prefer `GraphStylesheetEngine`.

> From a deck.gl design point-of-view, the `StylesheetEngine` enables a deck.gl `CompositeLayer` to create a variable number of sub-layers. `CompositeLayer` supports prop forwarding for sub-layers which works well when the number of sub-layers is pre-determined. A StyleSheet lets the application specify multiple styling primitives for each node, which are the n implemented using dynamically created sub layers.

## Responsibilities

When `GraphLayer` receives a stylesheet it instantiates a `GraphStylesheetEngine`. The engine:

1. Validates the `type` against the supplied accessor map.
2. Normalizes each property into either a constant value or an accessor function.
3. Expands optional state selectors (e.g. `:hover`, `:selected`) into state-aware accessors.
4. Registers update triggers so that Deck.gl re-evaluates affected accessors when inputs change.

This pipeline lets you focus on the *what* of styling while the engine handles the *how*.

## Re-using the engine

```ts
import {GraphStylesheetEngine, type GraphStylesheet} from '@deck.gl-community/graph-layers';

const CUSTOM_ACCESSOR_MAP = {
  'custom-node': {
    getFillColor: 'fill',
    getLineColor: 'stroke'
  }
};

const CUSTOM_UPDATE_TRIGGERS = {
  'custom-node': ['getFillColor', 'getLineColor']
};

const customNodeStyle: GraphStylesheet<'custom-node'> = {
  type: 'custom-node',
  fill: '#2563EB',
  ':hover': {
    fill: '#60A5FA'
  }
};

const stylesheet = new GraphStylesheetEngine(customNodeStyle, {
  deckglAccessorMap: CUSTOM_ACCESSOR_MAP,
  deckglUpdateTriggers: CUSTOM_UPDATE_TRIGGERS
});

const accessors = stylesheet.getDeckGLAccessors();
```

#### Extensibility hooks

Provide your own `StyleProperty` subclass or default-style resolver via the `StylePropertyClass` and `getDefaultStyleValue` options when you need different value coercion or defaults. These hooks make it possible to adapt the engine to non-graph rendering pipelines while maintaining the author-friendly stylesheet format.

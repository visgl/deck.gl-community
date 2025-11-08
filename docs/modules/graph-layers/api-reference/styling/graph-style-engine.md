# Graph style engine

> Looking for authoring guidance? Start with the [graph stylesheet reference](./graph-stylesheet.md), which documents the structure of the style objects you pass into `GraphLayer`.

`GraphStylesheetEngine` is the runtime helper that turns user-authored `GraphStylesheet` objects into the Deck.gl accessors consumed by the graph layers. It extends the reusable `StyleEngine` utility, so advanced renderers can re-use the parsing, state-selector handling, and update-trigger wiring outside of `GraphLayer`. The class is still exported as `GraphStyleEngine` for backwards compatibility, but new code should prefer `GraphStylesheetEngine`.

## GraphStylesheetEngine

### Responsibilities

When `GraphLayer` receives a stylesheet it instantiates a `GraphStylesheetEngine`. The engine:

1. Validates the `type` against the supplied accessor map.
2. Normalizes each property into either a constant value or an accessor function.
3. Expands optional state selectors (e.g. `:hover`, `:selected`) into state-aware accessors.
4. Registers update triggers so that Deck.gl re-evaluates affected accessors when inputs change.

This pipeline lets you focus on the *what* of styling while the engine handles the *how*.

### Re-using the engine

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

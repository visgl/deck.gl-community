# Base stylesheet helper

`GraphStylesheet` builds on a reusable `BaseStylesheet` class that accepts the
style-to-accessor mappings and Deck.gl update trigger definitions. Advanced
renderers can re-use this helper to drive their own layer compositions while
still benefiting from the selector parsing and accessor normalization logic.

## How the stylesheet engine works

1. `GraphLayer` receives your style objects and instantiates a `Stylesheet` for
   each entry.
2. Every property is normalized into either a constant value or an accessor
   function. Functions are wrapped so you can return plain JavaScript values
   (strings, arrays, numbers) and the stylesheet will coerce them to the format
   required by the underlying Deck.gl layer.
3. Optional state selectors such as `:hover` or `:selected` are expanded into
   state-aware accessors. At render time the accessor receives a node with a
   `state` field (`default`, `hover`, `dragging`, `selected`) and returns the
   matching style variant.
4. Deck.gl update triggers are wired automatically so that your accessors are
   re-evaluated when their dependencies change.

This pipeline allows you to focus on the *what* of styling while GraphGL takes
care of the *how*.

```ts
import {BaseStylesheet} from '@deck.gl-community/graph-layers';

const CUSTOM_ACCESSOR_MAP = {
  'custom-node': {
    getFillColor: 'fill',
    getLineColor: 'stroke'
  }
};

const CUSTOM_UPDATE_TRIGGERS = {
  'custom-node': ['getFillColor', 'getLineColor']
};

const stylesheet = new BaseStylesheet(
  {
    type: 'custom-node',
    fill: '#2563EB',
    ':hover': {
      fill: '#60A5FA'
    }
  },
  {
    deckglAccessorMap: CUSTOM_ACCESSOR_MAP,
    deckglUpdateTriggers: CUSTOM_UPDATE_TRIGGERS
  }
);

const accessors = stylesheet.getDeckGLAccessors();
```

Provide your own `StyleProperty` subclass or default-style resolver via the
`StylePropertyClass` and `getDefaultStyleValue` options when you need different
value coercion or defaults.

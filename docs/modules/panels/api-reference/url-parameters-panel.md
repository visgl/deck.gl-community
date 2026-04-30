# URLParametersPanel

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

`URLParametersPanel` renders a read-only reference for URL parameters supported
by the current view. Use it inside a tabbed help modal or sidebar when users
need to understand available deep links.

## Usage

```ts
import {
  URLParametersPanel,
  type URLParameter,
  type URLParametersPanelProps
} from '@deck.gl-community/panels';

type ViewState = {
  mode: string;
};

const urlParameters: URLParameter<ViewState>[] = [
  {
    name: 'mode',
    description: 'Active view mode.',
    legacyNames: ['viewMode'],
    serialize: state => state.mode,
    deserialize: (value, state) => {
      state.mode = String(value ?? '');
    }
  }
];

const panel = new URLParametersPanel({urlParameters});
```

## Props

```ts
type URLParametersPanelProps = {
  urlParameters?: readonly URLParameter[];
  theme?: 'inherit' | 'light' | 'dark' | 'invert';
};
```

## Remarks

- Displays canonical names, descriptions, and legacy aliases.
- Uses generic copy: URL parameters control deep links for the current view.
- Pair it with `URLManager` when the same descriptor list should drive parsing,
  serialization, and help text.

## Related Pages

- [URLManager](./url-manager.md)

# URLManager

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

`URLManager` and the URL parameter helpers provide descriptor-based deep-link
parsing and serialization. They are deck-independent and can be used by panels,
widgets, or standalone applications.

## Usage

```ts
import {
  URLManager,
  type URLParameter,
  type URLParameterValue
} from '@deck.gl-community/panels';

type ViewState = {
  mode: string;
  selectedIds: string[];
};

const urlParameters: URLParameter<ViewState>[] = [
  {
    name: 'mode',
    description: 'Active view mode.',
    legacyNames: ['viewMode'],
    serialize: state => state.mode,
    deserialize: (value: URLParameterValue, state) => {
      if (typeof value === 'string') {
        state.mode = value;
      }
    }
  },
  {
    name: 'selectedIds',
    description: 'Selected item identifiers.',
    serialize: state => state.selectedIds,
    deserialize: (value, state) => {
      state.selectedIds = Array.isArray(value) ? [...value] : value ? [value] : [];
    }
  }
];

const urlManager = new URLManager(urlParameters);
const state = {mode: 'overview', selectedIds: []};

urlManager.parseIntoState(state, window.location.search);
const query = urlManager.serializeSearchParams(state);
```

## Types

```ts
type URLParameterValue = string | readonly string[] | null;

type URLParameter<TState = unknown> = {
  name: string;
  description: string;
  legacyNames?: readonly string[];
  serialize(state: TState): string | readonly string[] | undefined;
  deserialize(value: URLParameterValue, state: TState): void;
};

type RawUrlParametersInput =
  | string
  | URLSearchParams
  | Readonly<Record<string, string | readonly string[] | null | undefined>>;

type URLManagerCreateSearchParamsOptions = {
  baseParams?: string | URLSearchParams;
  preserveUnknownParams?: boolean;
};
```

## URLManager Methods

```ts
getRecognizedKeys(): readonly string[];

parseIntoState(
  state: TState,
  paramsOrSearch: RawUrlParametersInput,
  options?: ParseUrlParametersIntoStateOptions
): Record<string, URLParameterValue>;

serialize(state: TState): Record<string, string | readonly string[]>;

createSearchParams(
  state: TState,
  options?: URLManagerCreateSearchParamsOptions
): URLSearchParams;

serializeSearchParams(
  state: TState,
  options?: URLManagerCreateSearchParamsOptions
): string;
```

## Helper Functions

```ts
getRecognizedUrlParameterKeys(parameters): readonly string[];
parseUrlParametersIntoState(state, parameters, paramsOrSearch, options?);
serializeUrlParameters(state, parameters): Record<string, string | readonly string[]>;
serializeUrlSearchParams(searchParams): string;
```

## Remarks

- Canonical parameter names are serialized. Legacy names are accepted during
  parsing, but are not emitted.
- Canonical keys take precedence over legacy aliases when both are present.
- Repeated query keys are passed to `deserialize` as arrays.
- Bare query keys such as `?debug` parse as an empty string value and serialize
  without a trailing equals sign.

## Related Pages

- [URLParametersPanel](./url-parameters-panel.md)

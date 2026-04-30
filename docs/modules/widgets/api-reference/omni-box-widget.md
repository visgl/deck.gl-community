import WidgetLiveExample from '@site/src/components/docs/widget-live-example';

# OmniBoxWidget

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

<WidgetLiveExample highlight="omni-box-widget" />

`OmniBoxWidget` is a deck.gl HTML widget that renders an omnibox input with an autocomplete dropdown.

## Import

```ts
import {
  OmniBoxWidget,
  type OmniBoxOption,
  type OmniBoxOptionProvider,
  type OmniBoxRenderOptionArgs
} from '@deck.gl-community/widgets';
```

## Types

```ts
export type OmniBoxOption = {
  id: string;
  label: string;
  value?: string;
  description?: string;
  data?: unknown;
};

export type OmniBoxOptionProvider =
  | ((query: string) => Promise<ReadonlyArray<OmniBoxOption>>)
  | ((query: string) => ReadonlyArray<OmniBoxOption>);

export type OmniBoxRenderOptionArgs = {
  option: OmniBoxOption;
  index: number;
  isActive: boolean;
  query: string;
};
```

## Props

```ts
type OmniBoxWidgetProps = WidgetProps & {
  placement?: WidgetPlacement;
  placeholder?: string;
  minQueryLength?: number;
  defaultOpen?: boolean;
  closeOnSelect?: boolean;
  rememberQueries?: boolean;
  maxRememberedQueryCount?: number;
  queryHistoryStorageKey?: string;
  showAnchorButton?: boolean;
  topOffsetPx?: number;
  getOptions?: OmniBoxOptionProvider;
  renderOption?: (args: OmniBoxRenderOptionArgs) => ComponentChildren;
  onSelectOption?: (option: OmniBoxOption) => void;
  onActiveOptionChange?: (option: OmniBoxOption | null) => void;
  onNavigateOption?: (option: OmniBoxOption) => void;
  onQueryChange?: (query: string) => void;
};
```

## Usage

```ts
const widget = new OmniBoxWidget({
  placeholder: 'Search items…',
  defaultOpen: true,
  closeOnSelect: false,
  rememberQueries: true,
  queryHistoryStorageKey: 'example-search-history',
  minQueryLength: 1,
  getOptions: (query) => searchItems(query),
  onSelectOption: (option) => selectItem((option.data as any).id),
  onNavigateOption: (option) => previewItem((option.data as any).id)
});
```

## Notes

This widget is intentionally generic. Callers provide search options, selection behavior, and optional custom row rendering.

## Remarks

- Renders a floating search input centered near the top of the deck canvas.
- Supports sync or async option providers.
- Caps the dropdown to 4 visible rows and makes it scrollable beyond that.
- Includes built-in `<` and `>` navigation controls for cycling the active option.
- Opens and focuses from `/` when focus is not already inside an editable element.
- Can render a compact slash anchor button while closed.
- Can keep the result list open after selection with `closeOnSelect: false`.
- Can remember recent selected queries in `localStorage`.
- Closes on blur after a short delay so option clicks can still land.

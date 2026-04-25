import WidgetLiveExample from '@site/src/components/docs/widget-live-example';

# OmniBoxPanelWidget

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

<WidgetLiveExample highlight="omni-box-widget" />

`OmniBoxPanelWidget` is a deck.gl HTML widget that renders a one-line omnibox input with an autocomplete dropdown.

## Import

```ts
import {
  OmniBoxPanelWidget,
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
type OmniBoxPanelWidgetProps = WidgetProps & {
  placement?: WidgetPlacement;
  placeholder?: string;
  minQueryLength?: number;
  defaultOpen?: boolean;
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
const widget = new OmniBoxPanelWidget({
  placeholder: 'Search blocks…',
  defaultOpen: true,
  minQueryLength: 1,
  getOptions: (query) => searchBlocks(query),
  onSelectOption: (option) => zoomToBlock((option.data as any).blockId),
  onNavigateOption: (option) => zoomToBlock((option.data as any).blockId)
});
```

## Notes

This widget is intentionally generic. It does not know about trace blocks or color schemes on its own; callers provide search options, selection behavior, and optional custom row rendering.

## Remarks

- Renders a floating search input centered near the top of the deck canvas.
- Supports sync or async option providers.
- Caps the dropdown to 4 visible rows and makes it scrollable beyond that.
- Includes built-in `<` and `>` navigation controls for cycling the active option.
- Opens and focuses from the keyboard shortcut path used by the owning view.
- Closes on blur after a short delay so option clicks can still land.

# OmniBoxWidget

`OmniBoxWidget` is a deck.gl widget that renders a one-line omnibox input and an autocomplete dropdown.

```ts
import {
  OmniBoxWidget,
  type OmniBoxOption,
  type OmniBoxRenderOptionArgs,
} from '@deck.gl-community/widgets';
```

## Behavior

- Input field is rendered at the top of the deck canvas and starts hidden by default.
- Dropdown suggestions are produced by your `getOptions` callback.
- Dropdown is capped to 4 visible rows and becomes scrollable when there are more matches.
- Built-in `<` and `>` buttons cycle active matches, keep the active row scrolled into view, and can trigger navigation callbacks.
- A close button hides the widget; press `/` from the canvas to reopen and focus the input.

## Types

```ts
export type OmniBoxOption = {
  id: string;
  label: string;
  value?: string;
  description?: string;
  data?: unknown;
};

export type OmniBoxRenderOptionArgs = {
  option: OmniBoxOption;
  index: number;
  isActive: boolean;
  query: string;
};
```

## Props

```ts
export type OmniBoxWidgetProps = WidgetProps & {
  placement?: WidgetPlacement;
  placeholder?: string;
  minQueryLength?: number;
  defaultOpen?: boolean;

  // Vertical offset from canvas top in pixels.
  // If omitted, OmniBox uses the deck widget margin CSS variable.
  topOffsetPx?: number;

  // Called as the user types. Can return sync or async matches.
  getOptions?:
    | ((query: string) => ReadonlyArray<OmniBoxOption>)
    | ((query: string) => Promise<ReadonlyArray<OmniBoxOption>>);

  // Optional custom row renderer for suggestions.
  renderOption?: (args: OmniBoxRenderOptionArgs) => ComponentChildren;

  // Fired when user commits a selection (click/Enter).
  onSelectOption?: (option: OmniBoxOption) => void;

  // Fired whenever active match index changes.
  onActiveOptionChange?: (option: OmniBoxOption | null) => void;

  // Fired when user cycles matches with the < / > navigation buttons.
  onNavigateOption?: (option: OmniBoxOption) => void;

  onQueryChange?: (query: string) => void;
};
```

## Example: custom option rendering + navigation

```ts
const widget = new OmniBoxWidget({
  placeholder: 'Search blocks…',
  defaultOpen: true,
  topOffsetPx: 40,
  getOptions: (query) => searchBlocks(query),
  renderOption: ({ option }) => (
    <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: '8px', width: '100%' }}>
      <span
        style={{
          borderRadius: '999px',
          padding: '0 8px',
          backgroundColor: (option.data as any)?.badgeColor ?? '#64748b',
          color: 'white',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {option.label}
      </span>
      <span style={{ color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {option.description}
      </span>
    </div>
  ),
  onNavigateOption: (option) => zoomToBlock((option.data as any).blockId),
  onSelectOption: (option) => zoomToBlock((option.data as any).blockId),
});
```

# ToolbarWidget

A compact deck.gl widget for horizontal action buttons, single-select toggle groups, and read-only status badges.

Use it when an example or app needs a small control strip without building a custom React toolbar. `ToolbarWidget` is generic and lives in `@deck.gl-community/widgets`, unlike edit-mode-specific widgets from `@deck.gl-community/editable-layers`.

## Usage

```tsx
import {ToolbarWidget} from '@deck.gl-community/widgets';

const toolbar = new ToolbarWidget({
  placement: 'top-right',
  items: [
    {
      kind: 'toggle-group',
      id: 'boolean-op',
      selectedId: currentBooleanOperation ?? 'edit',
      options: [
        {id: 'edit', label: 'Edit'},
        {id: 'union', label: 'Union'},
        {id: 'difference', label: 'Subtract'}
      ],
      onSelect: (optionId) => {
        setBooleanOperation(optionId === 'edit' ? null : optionId);
      }
    },
    {
      kind: 'badge',
      id: 'count',
      label: `${featureCount} features`
    }
  ]
});
```

## Props

### `placement`

- Type: `WidgetPlacement`
- Default: `'top-right'`

Where to position the toolbar within the deck widget overlay.

### `items`

- Type: `ToolbarWidgetItem[]`
- Default: `[]`

Ordered toolbar items. Supported item kinds:

- `action` for clickable buttons
- `toggle-group` for single-select button groups
- `badge` for read-only status text

## Item Types

### `ToolbarWidgetActionItem`

```ts
{
  kind: 'action';
  id: string;
  label: string;
  icon?: ComponentChild;
  title?: string;
  disabled?: boolean;
  active?: boolean;
  onClick?: () => void;
}
```

Use for standalone buttons such as reset, clear, export, or selection toggles.

### `ToolbarWidgetToggleGroupItem`

```ts
{
  kind: 'toggle-group';
  id: string;
  label?: string;
  title?: string;
  disabled?: boolean;
  selectedId?: string | null;
  options: ToolbarWidgetToggleOption[];
  onSelect?: (optionId: string) => void;
}
```

Use for mutually exclusive choices such as boolean operations, display modes, or filter presets.

### `ToolbarWidgetBadgeItem`

```ts
{
  kind: 'badge';
  id: string;
  label: string;
  title?: string;
}
```

Use for compact read-only status such as feature counts or active dataset names.

## See Also

- [BoxWidget](./box-widget.md)
- [SidebarWidget](./sidebar-widget.md)
- [Widget Panels](./widget-panels.md)

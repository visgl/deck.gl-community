import PanelLiveExample from '@site/src/components/docs/panel-live-example';

# AccordionPanel

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

`AccordionPanel` wraps multiple child panels into one collapsible accordion panel.

<PanelLiveExample highlight="accordion-panel" />

## Usage

Use `AccordionPanel` when one panel should expand into several collapsible subsections.

```ts
import {AccordionPanel, type AccordionPanelProps} from '@deck.gl-community/panels';
```

The example assumes two content panels, `summaryPanel` and `detailsPanel`, with those IDs.

```ts
new AccordionPanel({
  id: 'inspector', title: 'Inspector', panels: [summaryPanel, detailsPanel],
  defaultExpandedPanelIds: ['summary'], allowMultipleExpanded: false
});
```

## Props

```ts
type AccordionPanelProps = PanelProps & {
  panels: ReadonlyArray<Panel>;
  id?: string;
  title?: string;
  theme?: PanelTheme;
  defaultExpandedPanelIds?: ReadonlyArray<PanelId>;
  expandedPanelIds?: ReadonlyArray<PanelId>;
  onExpandedPanelIdsChange?: (ids: ReadonlyArray<PanelId>) => void;
  allowMultipleExpanded?: boolean;
};
```

## See Also

- [Using Panels](../../developer-guide/using-panels.md)

## Remarks

- Renders the ordered child panel array as accordion sections.
- Produces one composite panel that can be used directly or passed into the deck.gl wrapper module.

Child arrays define display order. Give each child a distinct, stable ID.
See [state and updates](../../developer-guide/using-panels.md#state-and-updates)
for controlled values, local defaults, and refreshing definitions. `PanelTheme` is described
in [Panel Themes](../panel-theme.md).

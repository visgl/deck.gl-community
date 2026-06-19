import PanelLiveExample from '@site/src/components/docs/panel-live-example';

# ArrowTablePanel

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square" alt="from v9.4" />
</p>

<PanelLiveExample highlight="arrow-table-panel" />

`ArrowTablePanel` renders an Apache Arrow table preview in a scrollable grid. It
is deck.gl-independent and accepts Apache Arrow table-like objects or loaders.gl
`{shape: 'arrow-table', data}` wrappers.

## Usage

```ts
import {tableFromArrays} from 'apache-arrow';
import {ArrowTablePanel, BoxPanelContainer, PanelManager} from '@deck.gl-community/panels';

const table = tableFromArrays({
  city: ['Oakland', 'San Jose', 'Fremont'],
  trips: [1840, 1320, 980]
});

const panel = new ArrowTablePanel({
  id: 'arrow-table',
  title: 'Arrow Table',
  table,
  maxRows: 100
});

const panelManager = new PanelManager({
  parentElement: document.getElementById('app') as HTMLElement
});

panelManager.setProps({
  components: [new BoxPanelContainer({id: 'arrow-table-box', panel})]
});
```

## Props

```ts
type ArrowTablePanelProps = {
  id: string;
  title: string;
  table?: ArrowTableInput;
  maxRows?: number;
  maxColumns?: number;
  showRowIndex?: boolean;
  batchIndex?: number | 'all';
  maxNestedItems?: number;
  columnFormatters?: ArrowTableColumnFormatters;
  className?: string;
  theme?: 'inherit' | 'light' | 'dark' | 'invert';
};
```

## Remarks

- Accepts Apache Arrow JS table-like objects, including Arrow JS v17 and newer,
  and loaders.gl arrow-table wrappers.
- Renders at most `maxRows` rows and `maxColumns` columns, defaulting to 1,000
  rows and all columns.
- `batchIndex` can preview one record batch while preserving absolute row
  indexes when `showRowIndex` is enabled.
- Nested struct fields are labeled with dot notation.
- luma.gl Arrow patterns are displayed compactly, including numeric scalars,
  fixed-size numeric tuples, matrix vectors annotated with `luma.gl:matrix-*`
  metadata, temporal columns, dictionary text, and bounded nested list values.
- `columnFormatters` can override display for a field path or field name.

## luma.gl usage

Use the panel from a luma.gl example by mounting it into any DOM node. This path
does not import deck.gl or deck.gl widgets.

```ts
import {ArrowTablePanel, BoxPanelContainer, PanelManager} from '@deck.gl-community/panels';

const panelManager = new PanelManager({
  parentElement: document.getElementById('inspector') as HTMLElement
});

panelManager.setProps({
  components: [
    new BoxPanelContainer({
      id: 'arrow-table-box',
      title: 'Arrow Table',
      panel: new ArrowTablePanel({
        id: 'arrow-table',
        title: 'Arrow Table',
        table,
        maxRows: 50,
        maxColumns: 12,
        maxNestedItems: 6,
        showRowIndex: true
      })
    })
  ]
});
```

import PanelLiveExample from '@site/src/components/docs/panel-live-example';

# ArrowTablePanel

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square" alt="from v9.4" />
</p>

<PanelLiveExample highlight="arrow-table-panel" />

`ArrowTablePanel` renders an Apache Arrow table preview in a scrollable grid.

## Usage

```ts
import {tableFromArrays} from 'apache-arrow';
import {ArrowTablePanel, PanelBox, PanelManager} from '@deck.gl-community/panels';

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
  components: [new PanelBox({id: 'arrow-table-box', panel})]
});
```

## Props

```ts
type ArrowTablePanelProps = {
  id: string;
  title: string;
  table?: ArrowTableLike | null;
  maxRows?: number;
  className?: string;
  theme?: 'inherit' | 'light' | 'dark' | 'invert';
};
```

## Remarks

- Accepts Apache Arrow JS table-like objects, including Arrow JS v17 and newer.
- Renders at most `maxRows` rows, defaulting to 1,000.
- Always shows a bottom summary with the included row count and omitted row count.
- Complex Arrow cell values that expose `toArray()` are formatted as JSON arrays.

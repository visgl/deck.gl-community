import PanelLiveExample from '@site/src/components/docs/panel-live-example';

# ArrowBatchesPanel

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square" alt="from v9.4" />
</p>

<PanelLiveExample highlight="arrow-batches-panel" />

`ArrowBatchesPanel` renders one row per Arrow record batch, including batch
index, row count, cumulative row range, and column count. It is
deck.gl-independent and accepts Apache Arrow table-like objects or loaders.gl
`{shape: 'arrow-table', data}` wrappers.

## Usage

```ts
import {ArrowBatchesPanel, BoxPanelContainer, PanelManager} from '@deck.gl-community/panels';

const panel = new ArrowBatchesPanel({
  id: 'arrow-batches',
  title: 'Arrow Batches',
  table,
  selectedBatchIndex: 0,
  onBatchSelect: batchIndex => {
    console.log('selected batch', batchIndex);
  }
});

const panelManager = new PanelManager({
  parentElement: document.getElementById('app') as HTMLElement
});

panelManager.setProps({
  components: [new BoxPanelContainer({id: 'arrow-batches-box', panel})]
});
```

## Props

```ts
type ArrowBatchesPanelProps = {
  id: string;
  title: string;
  table?: ArrowTableInput;
  selectedBatchIndex?: number;
  onBatchSelect?: (batchIndex: number) => void;
  className?: string;
  theme?: 'inherit' | 'light' | 'dark' | 'invert';
};
```

## Remarks

- Renders structural Arrow record batches from `table.batches`.
- Falls back to Arrow table data chunks when batches are not exposed.
- Synthesizes a single batch summary for table-like objects that only expose a
  table-level row count.
- Uses zero-based cumulative row ranges such as `0-999` and `1000-1999`.
- Can be paired with `ArrowTablePanel` by passing the selected batch index into
  `ArrowTablePanel` as `batchIndex`.

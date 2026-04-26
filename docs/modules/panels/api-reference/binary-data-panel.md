import PanelLiveExample from '@site/src/components/docs/panel-live-example';

# BinaryDataPanel

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

<PanelLiveExample highlight="binary-data-panel" />

`BinaryDataPanel` renders caller-supplied binary data as offset, hex, and ASCII rows.

## Usage

Use `BinaryDataPanel` when a sidebar or modal needs a compact read-only preview of file bytes.

```ts
import {BinaryDataPanel, PanelBox, PanelManager} from '@deck.gl-community/panels';

const panel = new BinaryDataPanel({
  id: 'source-bytes',
  title: 'Source Bytes',
  data: await file.arrayBuffer(),
  rowByteLength: 8,
  maxByteLength: 384
});

const panelManager = new PanelManager({
  parentElement: document.getElementById('app') as HTMLElement
});

panelManager.setProps({
  components: [new PanelBox({id: 'source-bytes-box', panel})]
});
```

## Props

```ts
type BinaryDataPanelProps = {
  id: string;
  title: string;
  data: ArrayBuffer | ArrayBufferView;
  byteOffset?: number;
  byteLength?: number;
  rowByteLength?: number;
  maxByteLength?: number;
  showAscii?: boolean;
  className?: string;
  theme?: 'inherit' | 'light' | 'dark' | 'invert';
};
```

## Remarks

- Renders supplied bytes only; callers own fetching or file reading.
- `byteOffset` and `byteLength` select the source range before `maxByteLength` caps the preview.
- Printable ASCII bytes use characters from `0x20` through `0x7e`; other bytes leave the ASCII cell blank.
- Defaults to 8 bytes per row and a 10,000 byte preview cap.
- Always shows a bottom summary with the included byte count and omitted byte count.

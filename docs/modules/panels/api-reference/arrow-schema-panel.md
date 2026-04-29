import PanelLiveExample from '@site/src/components/docs/panel-live-example';

# ArrowSchemaPanel

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square" alt="from v9.4" />
</p>

<PanelLiveExample highlight="arrow-schema-panel" />

`ArrowSchemaPanel` renders an Apache Arrow schema as a table with one row per field.

## Usage

```ts
import {tableFromArrays} from 'apache-arrow';
import {ArrowSchemaPanel, PanelBox, PanelManager} from '@deck.gl-community/panels';

const table = tableFromArrays({
  city: ['Oakland', 'San Jose', 'Fremont'],
  trips: [1840, 1320, 980]
});

const panel = new ArrowSchemaPanel({
  id: 'arrow-schema',
  title: 'Arrow Schema',
  schema: table.schema
});

const panelManager = new PanelManager({
  parentElement: document.getElementById('app') as HTMLElement
});

panelManager.setProps({
  components: [new PanelBox({id: 'arrow-schema-box', panel})]
});
```

## Props

```ts
type ArrowSchemaPanelProps = {
  id: string;
  title: string;
  schema?: ArrowSchemaLike | null;
  className?: string;
  theme?: 'inherit' | 'light' | 'dark' | 'invert';
};
```

## Metadata

Arrow schema and field metadata are shown as key/value entries. When a metadata value is a string containing JSON, `ArrowSchemaPanel` parses it and renders the parsed value as formatted JSON.

## Remarks

- Accepts Apache Arrow JS schema-like objects, including Arrow JS v17 and newer.
- Renders field name, type, nullable state, and field metadata.
- Shows schema-level metadata above the field table when metadata is present.

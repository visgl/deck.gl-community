import PanelLiveExample from '@site/src/components/docs/panel-live-example';

# StatsPanel

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

<PanelLiveExample highlight="stats-panel" />

`StatsPanel` renders a compact table from a [`Stats`](https://github.com/visgl/probe.gl/tree/master/modules/stats) object from `@probe.gl/stats`.

## Usage

```ts
import {PanelBox, PanelManager, StatsPanel} from '@deck.gl-community/panels';
import {Stats} from '@probe.gl/stats';

const stats = new Stats({
  id: 'Tile cache',
  stats: [{name: 'Tiles In Cache'}, {name: 'Visible Tiles'}]
});

stats.get('Tiles In Cache').addCount(24);
stats.get('Visible Tiles').addCount(12);

const panel = new StatsPanel({
  id: 'tile-stats',
  title: 'Stats',
  stats,
  labels: {
    'Tiles In Cache': 'Total tiles in cache',
    'Visible Tiles': 'Visible tiles across views'
  }
});

const panelManager = new PanelManager({
  parentElement: document.getElementById('app') as HTMLElement
});

panelManager.setProps({
  components: [new PanelBox({id: 'stats-box', panel})]
});
```

## Props

```ts
type StatsPanelProps = {
  id: string;
  title: string;
  stats: Stats;
  statNames?: string[];
  labels?: Partial<Record<string, string>>;
  className?: string;
  theme?: 'inherit' | 'light' | 'dark' | 'invert';
};
```

## See Also

- [Using Panels](../developer-guide/widget-panels.md)
- [ColumnPanel](./column-panel.md)
- [MarkdownPanel](./markdown-panel.md)

## Remarks

- Renders one row per selected stat.
- Uses the stat `count` value from `stats.getTable()`.
- Preserves probe.gl stat ordering unless `statNames` is provided.
- Supports relabeling rows with the optional `labels` prop.

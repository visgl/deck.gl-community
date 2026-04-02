# StatsWidgetPanel

<p class="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

`StatsWidgetPanel` renders a compact table from a [`Stats`](https://github.com/visgl/probe.gl/tree/master/modules/stats) object from `@probe.gl/stats`.

It is exported from `@deck.gl-community/widgets`.

## Import

```ts
import {StatsWidgetPanel, type StatsWidgetPanelProps} from '@deck.gl-community/widgets';
import {Stats} from '@probe.gl/stats';
```

## Props

```ts
type StatsWidgetPanelProps = {
  id: string;
  title: string;
  stats: Stats;
  statNames?: string[];
  labels?: Partial<Record<string, string>>;
  className?: string;
  theme?: WidgetPanelTheme;
};
```

## Behavior

- Renders one row per selected stat.
- Uses the stat `count` value from `stats.getTable()`.
- Preserves probe.gl stat ordering unless `statNames` is provided.
- Supports relabeling rows with the optional `labels` prop.

## Usage

```ts
import {BoxWidget, StatsWidgetPanel} from '@deck.gl-community/widgets';
import {Stats} from '@probe.gl/stats';

const stats = new Stats({
  id: 'Tile cache',
  stats: [{name: 'Tiles In Cache'}, {name: 'Visible Tiles'}]
});

stats.get('Tiles In Cache').addCount(24);
stats.get('Visible Tiles').addCount(12);

const panel = new StatsWidgetPanel({
  id: 'tile-stats',
  title: 'Stats',
  stats,
  labels: {
    'Tiles In Cache': 'Total tiles in cache',
    'Visible Tiles': 'Visible tiles across views'
  }
});

const widget = new BoxWidget({
  id: 'tile-stats-box',
  title: 'Shared Tileset',
  panel
});
```

## See Also

- [Widget Panels](./widget-panels.md)
- [ColumnWidgetPanel](./column-widget-panel.md)
- [MarkdownWidgetPanel](./markdown-widget-panel.md)

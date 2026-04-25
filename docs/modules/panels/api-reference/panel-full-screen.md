import PanelLiveExample from '@site/src/components/docs/panel-live-example';

# PanelFullScreen

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

<PanelLiveExample highlight="panel-full-screen" size="tall" />

`PanelFullScreen` renders one panel or panel container inside a large inset full-screen container.

Use it when one focused standalone panel layout should occupy most of the host
while preserving a visible edge around it.

## Usage

```ts
import {
  ColumnPanel,
  MarkdownPanel,
  PanelFullScreen,
  PanelManager,
  type PanelFullScreenProps
} from '@deck.gl-community/panels';

const detailPanel = new ColumnPanel({
  id: 'details',
  title: 'Details',
  panels: {
    summary: new MarkdownPanel({
      id: 'summary',
      title: 'Summary',
      markdown: 'A focused standalone panel layout.'
    })
  }
});

const panelFullScreen = new PanelFullScreen({
  id: 'details-full-screen',
  panel: detailPanel,
  title: 'Details'
});

const panelManager = new PanelManager({
  parentElement: document.getElementById('app') as HTMLElement
});

panelManager.setProps({
  components: [panelFullScreen]
});
```

## Props

```ts
type PanelFullScreenProps = PanelContainerProps & {
  container?: PanelContainer;
  panel?: Panel;
  placement?: PanelPlacement;
  title?: string;
  marginPx?: number;
};
```

## Remarks

- Uses the `fill` placement by default.
- Accepts either a full panel container description or a single panel.
- Insets itself from the host edge with `marginPx`.
- Use `FullScreenPanelWidget` from `@deck.gl-community/widgets` when the same UI should be mounted through deck.gl.

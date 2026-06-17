import PanelLiveExample from '@site/src/components/docs/panel-live-example';

# FullScreenPanelContainer

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

<PanelLiveExample highlight="full-screen-panel-container" size="tall" />

`FullScreenPanelContainer` renders one panel inside a large inset full-screen container.

Use it when one focused standalone panel layout should occupy most of the host
while preserving a visible edge around it.

## Usage

```ts
import {
  ColumnPanel,
  MarkdownPanel,
  FullScreenPanelContainer,
  PanelManager,
  type FullScreenPanelContainerProps
} from '@deck.gl-community/panels';

const detailPanel = new ColumnPanel({
  id: 'details',
  title: 'Details',
  panels: [
    new MarkdownPanel({
      id: 'summary',
      title: 'Summary',
      markdown: 'A focused standalone panel layout.'
    })
  ]
});

const panelFullScreen = new FullScreenPanelContainer({
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
type FullScreenPanelContainerProps = PanelContainerProps & {
  panel?: Panel;
  placement?: PanelPlacement;
  title?: string;
  marginPx?: number;
};
```

## Remarks

- Uses the `fill` placement by default.
- Accepts one reusable panel definition.
- Insets itself from the host edge with `marginPx`.
- Use `FullScreenPanelWidget` from `@deck.gl-community/widgets` when the same UI should be mounted through deck.gl.

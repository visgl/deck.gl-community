import PanelLiveExample from '@site/src/components/docs/panel-live-example';

# PanelBox

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

<PanelLiveExample highlight="panel-box" />

`PanelBox` renders one panel or panel container inside a static card-style container.

Use it when panel content should stay visible in a fixed standalone card without
deck.gl widget placement.

## Usage

```ts
import {MarkdownPanel, PanelBox, PanelManager, type PanelBoxProps} from '@deck.gl-community/panels';

const summaryPanel = new MarkdownPanel({
  id: 'summary',
  title: 'Summary',
  markdown: 'Always-visible standalone context.'
});

const panelBox = new PanelBox({
  id: 'summary-box',
  panel: summaryPanel,
  title: 'Summary'
});

const panelManager = new PanelManager({
  parentElement: document.getElementById('app') as HTMLElement
});

panelManager.setProps({
  components: [panelBox]
});
```

## Props

```ts
type PanelBoxProps = PanelContainerProps & {
  container?: PanelContainer;
  panel?: Panel;
  placement?: PanelPlacement;
  title?: string;
  widthPx?: number;
  collapsible?: boolean;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};
```

## Remarks

- Accepts either a full panel container description or a single panel.
- Renders a themed card with optional title and collapsible body.
- Supports controlled and uncontrolled open state.
- Use `BoxPanelWidget` from `@deck.gl-community/widgets` when the same UI should be mounted through deck.gl.

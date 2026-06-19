import PanelLiveExample from '@site/src/components/docs/panel-live-example';

# Panel

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square" alt="from v9.4" />
</p>

<PanelLiveExample highlight="markdown-panel" />

`Panel` is the base class for titled panel content. It extends
`PanelComponent`, so a concrete panel can be mounted directly or hosted by a
`PanelContainer`.

## Usage

```ts
import {MarkdownPanel, PanelManager} from '@deck.gl-community/panels';

const panel = new MarkdownPanel({
  id: 'summary',
  title: 'Summary',
  markdown: 'A concrete Panel can be mounted directly.'
});

const panelManager = new PanelManager({
  parentElement: document.getElementById('app') as HTMLElement
});

panelManager.setProps({components: [panel]});
```

## Props

```ts
type PanelProps = PanelComponentProps & {
  id: string;
  title: string;
  content: ComponentChildren;
  theme?: 'inherit' | 'light' | 'dark' | 'invert';
  disabled?: boolean;
  keepMounted?: boolean;
};
```

## Remarks

- Leaf and composite panel classes extend `Panel`.
- Direct mounting renders the panel's themed `content` through the shared
  `PanelComponent` lifecycle.
- Use a real `PanelContainer` when the content needs box, modal, sidebar, or
  full-screen chrome.

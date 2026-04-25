import PanelLiveExample from '@site/src/components/docs/panel-live-example';

# PanelModal

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

<PanelLiveExample highlight="panel-modal" />

`PanelModal` renders panel content in a centered modal container with an optional trigger.

Use it when secondary content should open on demand without permanently taking
space in the standalone layout.

## Usage

```ts
import {MarkdownPanel, PanelManager, PanelModal, type PanelModalProps} from '@deck.gl-community/panels';

const helpPanel = new MarkdownPanel({
  id: 'help',
  title: 'Help',
  markdown: 'Secondary content opened from a standalone modal.'
});

const panelModal = new PanelModal({
  id: 'help-modal',
  panel: helpPanel,
  title: 'Help',
  triggerLabel: 'Open help'
});

const panelManager = new PanelManager({
  parentElement: document.getElementById('app') as HTMLElement
});

panelManager.setProps({
  components: [panelModal]
});
```

## Props

```ts
type PanelModalProps = PanelContainerProps & {
  container?: PanelContainer;
  panel?: Panel;
  placement?: PanelPlacement;
  title?: string;
  triggerLabel?: string;
  triggerIcon?: string;
  hideTrigger?: boolean;
  button?: boolean;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};
```

## Remarks

- Accepts either a full panel container description or a single panel.
- Supports controlled and uncontrolled open state.
- Closes on backdrop click and `Escape`.
- Use `ModalWidget` from `@deck.gl-community/widgets` when the same UI should be mounted through deck.gl.

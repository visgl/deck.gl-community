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
  container?: PanelContentContainer;
  panel?: Panel;
  placement?: PanelPlacement;
  title?: string;
  triggerLabel?: string;
  triggerIcon?: string;
  showTitleBar?: boolean;
  hideTrigger?: boolean;
  button?: boolean;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  openShortcuts?: KeyboardShortcut[];
  shortcuts?: KeyboardShortcut[];
};
```

## Remarks

- Accepts either a full panel container description or a single panel.
- Supports controlled and uncontrolled open state.
- Closes on backdrop click and `Escape`.
- `openShortcuts` are installed through `deck.eventManager` when available and
  open the modal without importing deck.gl into `@deck.gl-community/panels`.
- `shortcuts` are also registered through the same manager and keep their own
  handlers.
- Restores focus to `deck.canvas` after close when mounted by deck.gl.
- Use `ModalPanelWidget` from `@deck.gl-community/widgets` when the same UI should be mounted through deck.gl.

import PanelLiveExample from '@site/src/components/docs/panel-live-example';

# ModalPanelContainer

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

<PanelLiveExample highlight="modal-panel-container" />

`ModalPanelContainer` renders panel content in a centered modal container with an optional trigger.

Use it when secondary content should open on demand without permanently taking
space in the standalone layout.

## Usage

```ts
import {MarkdownPanel, PanelManager, ModalPanelContainer, type ModalPanelContainerProps} from '@deck.gl-community/panels';

const helpPanel = new MarkdownPanel({
  id: 'help',
  title: 'Help',
  markdown: 'Secondary content opened from a standalone modal.'
});

const panelModal = new ModalPanelContainer({
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
type ModalPanelContainerProps = PanelContainerProps & {
  panel?: Panel;
  placement?: PanelPlacement;
  title?: string;
  triggerLabel?: string;
  triggerIcon?: string;
  showTitleBar?: boolean;
  presentation?: 'modal' | 'floating';
  draggable?: boolean;
  dragHandleSelector?: string;
  dialogStyle?: JSX.CSSProperties;
  dialogPlacement?: 'center' | 'left';
  contentStyle?: JSX.CSSProperties;
  hideTrigger?: boolean;
  hideCloseButton?: boolean;
  button?: boolean;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  openShortcuts?: KeyboardShortcut[];
  shortcuts?: KeyboardShortcut[];
};
```

## Remarks

- Accepts one reusable panel definition.
- Supports controlled and uncontrolled open state.
- Closes on backdrop click and `Escape`.
- `triggerLabel` names the icon trigger for accessible labels and browser title text.
- `triggerIcon` accepts a text glyph or a data/http(s) image URL rendered as a CSS mask icon.
- Use `presentation: 'floating'` for non-blocking dialogs.
- Use `dialogPlacement: 'left'`, `dialogStyle`, and `contentStyle` to tune
  larger custom dialogs.
- Set `hideCloseButton` when panel content renders its own
  `data-modal-panel-container-close="true"` close control.
- `openShortcuts` are installed through `deck.eventManager` when available and
  open the modal without importing deck.gl into `@deck.gl-community/panels`.
- `shortcuts` are also registered through the same manager and keep their own
  handlers.
- Restores focus to `deck.canvas` after close when mounted by deck.gl.
- Use `ModalPanelWidget` from `@deck.gl-community/widgets` when the same UI should be mounted through deck.gl.

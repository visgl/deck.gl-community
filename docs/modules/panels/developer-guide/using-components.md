# Using Components

Use `PanelComponent` when UI belongs to `@deck.gl-community/panels` but is not
itself titled panel content.

`Panel` is the base class for titled content. `PanelContainer` hosts one
`Panel` inside box, modal, sidebar, or full-screen chrome. Other mountable UI,
such as toolbars, toast stacks, or app-specific status controls, should extend
or use `PanelComponent` directly.

## Choose The Right Primitive

| Need | Use |
| --- | --- |
| Titled content inside a panel layout | `Panel` |
| One panel mounted inside shell chrome | `BoxPanelContainer`, `ModalPanelContainer`, `SidebarPanelContainer`, or `FullScreenPanelContainer` |
| Actions or status badges outside panel content | `ToolbarComponent` |
| App notifications | `ToastComponent` with `toastManager` |
| App-specific mountable UI owned by panels | Extend `PanelComponent` |

`ToolbarComponent` and `ToastComponent` are specialized panel-managed UI
components. They are not panel containers because they do not host a `Panel`.

## Standalone Components

`PanelManager` mounts any `PanelComponent`, including panels, panel containers,
toolbar/toast components, and application-specific components.

```ts
import {
  PanelComponent,
  PanelManager,
  ToastComponent,
  ToolbarComponent,
  toastManager,
  type PanelComponentProps
} from '@deck.gl-community/panels';

class StatusComponent extends PanelComponent<PanelComponentProps> {
  static defaultProps: Required<PanelComponentProps> = {
    ...PanelComponent.defaultProps,
    id: 'status'
  };

  placement = 'top-right' as const;
  className = 'app-status';

  constructor(props: PanelComponentProps = {}) {
    super(props);
  }

  override onRenderHTML(rootElement: HTMLElement): void {
    rootElement.textContent = 'Ready';
  }
}

const panelManager = new PanelManager({
  parentElement: document.getElementById('panel-root') as HTMLElement
});

panelManager.setProps({
  components: [
    new StatusComponent(),
    new ToolbarComponent({
      items: [
        {
          kind: 'action',
          id: 'refresh',
          label: 'Refresh',
          onClick: refreshData
        }
      ]
    }),
    new ToastComponent()
  ]
});

toastManager.toast({
  type: 'info',
  message: 'Ready'
});
```

Use `PanelComponentProps._container` only when a component must mount into an
explicit host instead of the manager-created placement host.

## deck.gl Components

When deck.gl owns placement, adapt the panel-owned component through
`PanelWidget`. Named adapters exist only where they are concise construction
helpers.

```ts
import {PanelWidget, ToastWidget, ToolbarWidget} from '@deck.gl-community/widgets';

const widgets = [
  new PanelWidget({component: new StatusComponent()}),
  new ToolbarWidget({
    items: [
      {
        kind: 'action',
        id: 'refresh',
        label: 'Refresh',
        onClick: refreshData
      }
    ]
  }),
  new ToastWidget()
];
```

The widgets package does not reimplement these components. It forwards
deck.gl lifecycle and interaction hooks to the `PanelComponent` owned by the
panels package.

## Related Pages

- [PanelComponent](../api-reference/panel-components/panel-component.md)
- [ToolbarComponent](../api-reference/panel-components/toolbar-component.md)
- [ToastComponent](../api-reference/panel-components/toast-component.md)
- [PanelContainer](../api-reference/panel-containers/panel-container.md)
- [Using Stand-Alone](./using-stand-alone.md)
- [Using with deck.gl](./using-with-deck-gl.md)

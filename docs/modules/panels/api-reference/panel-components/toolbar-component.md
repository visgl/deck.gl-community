import PanelLiveExample from '@site/src/components/docs/panel-live-example';

# ToolbarComponent

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square" alt="from v9.4" />
</p>

<PanelLiveExample highlight="panels" />

`ToolbarComponent` renders a compact standalone toolbar for action buttons,
single-select toggle groups, and read-only status badges.

## Usage

```tsx
import {PanelManager, ToolbarComponent} from '@deck.gl-community/panels';

const manager = new PanelManager({
  parentElement: document.getElementById('app') as HTMLElement
});

manager.setProps({
  components: [
    new ToolbarComponent({
      placement: 'top-right',
      items: [
        {
          kind: 'badge',
          id: 'count',
          label: '12 features'
        }
      ]
    })
  ]
});
```

## Props

```ts
type ToolbarComponentProps = PanelComponentProps & {
  placement?: PanelPlacement;
  items?: ToolbarComponentItem[];
};
```

## Remarks

- `ToolbarComponent` extends `PanelComponent`, not `PanelContainer`.
- Use `ToolbarWidget` from `@deck.gl-community/widgets` when the toolbar should
  be mounted through deck.gl.

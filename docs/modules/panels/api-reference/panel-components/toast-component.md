import PanelLiveExample from '@site/src/components/docs/panel-live-example';

# ToastComponent

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square" alt="from v9.4" />
</p>

<PanelLiveExample highlight="panels" />

`ToastComponent` renders the compact toast stack managed by `toastManager`.

## Usage

```ts
import {PanelManager, ToastComponent, toastManager} from '@deck.gl-community/panels';

const manager = new PanelManager({
  parentElement: document.getElementById('app') as HTMLElement
});

manager.setProps({components: [new ToastComponent()]});

toastManager.toast({
  type: 'warning',
  title: 'Build delayed',
  message: 'Dependency graph refresh is still running',
  key: 'build-status'
});
```

## Props

```ts
type ToastComponentProps = PanelComponentProps & {
  placement?: PanelPlacement;
  showBorder?: boolean;
};
```

## Remarks

- `ToastComponent` extends `PanelComponent`, not `PanelContainer`.
- Use `ToastWidget` from `@deck.gl-community/widgets` when the toast stack
  should be mounted through deck.gl.
- See [Toast Manager](../managers/toast-manager.md) for toast lifecycle APIs.

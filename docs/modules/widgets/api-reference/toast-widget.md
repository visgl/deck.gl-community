# ToastWidget

<p class="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

`ToastWidget` is a deck.gl HTML widget that renders a compact toast stack in the deck overlay.

It is exported from `@deck.gl-community/widgets`.

## Import

```ts
import {
  ToastWidget,
  toastManager,
  type ToastEntry,
  type ToastKind,
  type ToastRequest,
} from '@deck.gl-community/widgets';
```

## Types

```ts
export type ToastKind = 'info' | 'warning' | 'error';

export type ToastRequest = {
  type: ToastKind;
  title?: string;
  message: string;
  key?: string;
};

export type ToastEntry = ToastRequest & {
  id: string;
  createdAtMs: number;
};
```

## Props

```ts
type ToastWidgetProps = WidgetProps & {
  placement?: WidgetPlacement;
  showBorder?: boolean;
};
```

Default props:

- `id: 'toast'`
- `placement: 'bottom-right'`
- `showBorder: false`

## Behavior

- Subscribes to the shared `toastManager` singleton.
- Renders up to the currently active toast entries.
- Supports dismiss buttons per toast.
- Applies type-specific iconography and accent colors.
- Uses deck widget theme variables for integration with the host UI.

## Usage

```ts
new Deck({
  widgets: [new ToastWidget()],
});

toastManager.toast({
  type: 'warning',
  title: 'Build delayed',
  message: 'Dependency graph refresh is still running',
  key: 'build-status',
});
```

## Related helper

See `ToastManager` for the lifecycle and subscription model behind the rendered toast stack.

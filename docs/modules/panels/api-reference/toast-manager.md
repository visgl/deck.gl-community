# Toast Manager

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

`toastManager` manages toast state independently of any specific rendering host.

Use it when application code needs to enqueue, dismiss, or observe toast
messages without coupling that logic to a React component or a deck.gl widget.

## Usage

```ts
import {toastManager, type ToastKind, type ToastRequest} from '@deck.gl-community/panels';
```

## API

### `toastManager.toast(request)`

Adds a toast and returns its generated id.

```ts
const toastId = toastManager.toast({
  type: 'info',
  title: 'Loaded',
  message: 'Style resolved successfully.'
});
```

### `toastManager.dismiss(toastId)`

Dismisses one toast by id.

### `toastManager.clear()`

Dismisses all visible toasts.

### `toastManager.getToasts()`

Returns the current visible toast entries.

### `toastManager.subscribe(listener)`

Subscribes to toast updates and returns an unsubscribe callback.

```ts
const unsubscribe = toastManager.subscribe((toasts) => {
  console.log(toasts);
});
```

## Types

```ts
type ToastKind = 'info' | 'warning' | 'error';

type ToastRequest = {
  type: ToastKind;
  title?: string;
  message: string;
  key?: string;
};
```

## Remarks

- Toasts are capped to a small visible stack.
- Duplicate `key` values replace the previous toast instead of appending.
- Auto-dismiss timing depends on `type`.
- Rendering can be handled by any host that subscribes to `toastManager`.

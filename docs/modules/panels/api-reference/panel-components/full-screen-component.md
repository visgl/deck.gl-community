# FullScreenComponent

Add an enter/exit fullscreen button to an existing visualization. The component
uses browser fullscreen when available and falls back to a viewport-filling view
when the API is missing or rejects the request, including on iPhones.

```ts
import {FullScreenComponent, PanelManager} from '@deck.gl-community/panels';

const host = document.getElementById('app') as HTMLElement;
host.setAttribute('aria-label', 'Map explorer');
const manager = new PanelManager({parentElement: host});
manager.setProps({
  components: [
    new FullScreenComponent({
      target: host,
      placement: 'bottom-right',
      onChange: mode => console.log(mode), // 'none', 'native', or 'fallback'
      onError: error => console.error(error)
    })
  ]
});

// When the visualization is removed:
// manager.finalize();
```

Mount the button **inside its target**, alongside the canvas and other controls,
so it remains available to exit fullscreen. Give the host a normal layout size,
relative positioning, and a background color. Include your other components when
updating the manager's `components` array.

## Props

`FullScreenComponentProps` extends `PanelComponentProps`.

| Prop | Default | Description |
| --- | --- | --- |
| `target` | Required | Existing `HTMLElement` to expand |
| `placement` | `'bottom-right'` | Placement within the panel host |
| `enterLabel` | `'Enter fullscreen'` | Entry button's accessible label and tooltip |
| `exitLabel` | `'Exit fullscreen'` | Exit button's accessible label and tooltip |
| `onChange` | — | Receives the actual `FullScreenMode` |
| `onError` | — | Receives errors that could not be handled by the fallback |

The button has a minimum 44 × 44 pixel hit area. Native browser exits, including
Escape, update the button's state.

## Viewport fallback

The fallback fills the current viewport; it does not hide the browser's address
bar. It preserves the existing DOM, canvas context, input values, and component
state. It also:

- Locks background scrolling, including when application resize handlers change inline overflow styles.
- Follows viewport changes during portrait/landscape rotation.
- Presents an accessible modal dialog, contains keyboard focus, and closes with Escape.
- Restores the host's attributes, focus, and scroll position on exit.
- Releases listeners and scroll locks when the control is removed.

When the Popover API is available, the host enters the browser's top layer without
being reparented, avoiding clipping by transformed ancestors. On older browsers,
place the host outside transformed or paint-contained ancestors so fixed
positioning can fill the viewport. Label the host with `aria-label` or
`aria-labelledby`; an unlabelled fallback uses “Fullscreen view”.

## FullScreenController

Use the controller directly when your framework already renders its own buttons:

```ts
import {FullScreenController} from '@deck.gl-community/panels';

const fullscreen = new FullScreenController({
  target: host,
  getInitialFocus: () => exitButton,
  onChange: mode => updateControls(mode !== 'none')
});

// Invoke from a click or other user gesture:
await fullscreen.enter();
await fullscreen.exit();
// Or: await fullscreen.toggle();

// On unmount:
fullscreen.destroy();
```

Construct the controller after mounting the host. `active` reports whether it is
expanded; `mode` distinguishes `'native'`, `'fallback'`, and `'none'`. `enter`,
`exit`, and `toggle` return promises. `destroy` releases fallback state and
listeners immediately and exits any pending native fullscreen when it settles.
Only one controller owns fullscreen per document; entering another exits the
previous one. The optional `label` sets the fallback dialog's accessible name.

`FullScreenPanelContainer` continues to mean
[fill the panel host](../panel-containers/full-screen-panel-container.md).
Combine it with this component when the host should also support browser fullscreen.

## API Reference

### loadModules

`loadModules(moduleNames)`

Arguments:

- `moduleNames` (`String[]?`) - Optional modules to load, e.g. `'Microsoft.Maps.GeoJson'`, `'Microsoft.Maps.DrawingTools'`

Returns a Promise that resolves to the global `Microsoft.Maps` namespace. A custom class, `DeckOverlay`, is also added to the namespace.

### DeckOverlay

An implementation of [CustomOverlay](https://docs.microsoft.com/en-us/bingmaps/v8-web-control/map-control-api/customoverlay-class).

```ts
const deckOverlay = new DeckOverlay({...});
map.layers.insert(deckOverlay);
```

The constructor accepts a props object that is passed to the [Deck](https://deck.gl/docs/api-reference/core/deck) constructor. See the [limitations](#supported-features-and-limitations) section below for more details.

The following [Deck methods](https://deck.gl/docs/api-reference/core/deck#methods) can be called directly from a `DeckOverlay` instance:

- `deckOverlay.setProps`
- `deckOverlay.pickObject`
- `deckOverlay.pickMultipleObjects`
- `deckOverlay.pickObjects`
- `deckOverlay.redraw`
- `deckOverlay.finalize`

## Supported Features and Limitations

Supported deck.gl features:

- Layers
- Effects
- Auto-highlighting
- Attribute transitions
- `onHover` and `onClick` callbacks
- Tooltip

Not supported features:

- Tilting
- Multiple views
- Controller
- React integration
- Gesture event callbacks (e.g. `onDrag*`)

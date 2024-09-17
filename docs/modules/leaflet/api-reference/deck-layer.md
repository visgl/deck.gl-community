# DeckLayer

### DeckLayer

An implementation of [L.Layer](https://leafletjs.com/reference.html#layer).

```js
const deckLayer = new DeckLayer({
  views: [
    new MapView({ repeat: true }),
  ],
  layers: [...],
});
map.addLayer(deckLayer);
```

The constructor accepts a props object that is passed to the [Deck](https://deck.gl/docs/api-reference/core/deck) constructor. See the [limitations](#supported-features-and-limitations) section below for more details.

The following [Deck methods](https://deck.gl/docs/api-reference/core/deck#methods) can be called directly from a `DeckLayer` instance:

- `deckOverlay.setProps`
- `deckOverlay.pickObject`
- `deckOverlay.pickMultipleObjects`
- `deckOverlay.pickObjects`

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

import DeckPanelLiveExample from '@site/src/components/docs/deck-panel-live-example';

# DeckPanel

<DeckPanelLiveExample />

[Open the standalone example](/examples/widgets/deck-panel). Switch layouts to compare
two DeckPanels with no root canvas against a root canvas plus a detail panel.

`DeckPanel` renders a caller-defined scene in a panel-owned canvas using an existing
Deck instance. It lives in `@deck.gl-community/widgets`; the panels package remains
independent of deck.gl.

The root and panels share one Deck, device, layer manager and render loop. Each panel
has its own view, controlled camera and layers. Rendering and picking are filtered
so panel layers appear only in their panel and root layers stay in root views.

## Usage

Construct the root Deck with deck.gl 9.4's experimental `_canvases` option. This mode
must be selected at construction: an existing single-canvas Deck cannot be converted.
Mount panels after `onLoad`, when Deck is initialized.

```ts
import {Deck, MapView} from '@deck.gl/core';
import {ScatterplotLayer} from '@deck.gl/layers';
import {BoxPanelWidget, DeckPanel, setDeckPropsWithPanels} from '@deck.gl-community/widgets';

// An existing canvas with an explicit id and CSS dimensions.
const rootCanvas = document.querySelector<HTMLCanvasElement>('#main-canvas')!;
const camera = {longitude: -122.4, latitude: 37.8, zoom: 11};

const deck = new Deck({
  _canvases: [rootCanvas],
  views: [new MapView({id: 'main', canvasId: rootCanvas.id, controller: true})],
  initialViewState: {main: camera},
  layers: [],
  onLoad: () => {
    const panel = new DeckPanel({
      id: 'detail-panel',
      title: 'Detail',
      deck,
      height: 240,
      sceneProps: {
        view: new MapView({id: 'detail', controller: true}),
        viewState: {...camera, zoom: 13},
        layers: [new ScatterplotLayer({
          id: 'detail-points',
          data: [{position: [-122.4, 37.8]}],
          getPosition: d => d.position,
          getRadius: 100,
          getFillColor: [0, 180, 255],
          pickable: true
        })],
        onViewStateChange: ({viewState}) => {
          panel.setProps({sceneProps: {...panel.props.sceneProps, viewState}});
        }
      }
    });
    setDeckPropsWithPanels(deck, {
      widgets: [new BoxPanelWidget({id: 'detail-box', panel, placement: 'top-right'})]
    });
  }
});
```

A `DeckPanel` is a regular `Panel`: compose it in a `TabbedPanel`, `AccordionPanel`,
container or `PanelManager`. Pass the shared Deck explicitly even when nesting it
inside a widget.

## Without a root canvas

A root canvas is optional. Construct an empty multi-canvas Deck and mount any number
of DeckPanels after it initializes:

```ts
const deck = new Deck({
  _canvases: [],
  views: [],
  layers: [],
  onLoad: () => {
    // Each panel receives this same deck, its own unique view id, layers and camera.
    // Mount the panels using PanelManager or another panel composition.
  }
});
```

Use `views: []` for an explicitly empty root scene. DeckPanel also suppresses Deck's
implicit default view while panels are mounted without any root canvases. The first panel
adds the first presentation canvas; removing every panel returns Deck to an empty
canvas list. The same instance can host newly mounted panels afterward.

## Props

`DeckPanelProps` includes ordinary `PanelProps` except `content`, plus:

| Prop | Description |
| --- | --- |
| `deck` | Required initialized Deck created with `_canvases`. |
| `sceneProps` | Required caller-defined view, layers and camera (below). |
| `height` | Canvas CSS height; numeric values are pixels. Default: `240`. Width fills the panel. |

`DeckPanelSceneProps` contains:

| Prop | Description |
| --- | --- |
| `view` | Required deck.gl `View`. Set its `controller` to enable interaction. |
| `layers` | Optional deck.gl layers, including nested arrays and conditional entries. |
| `viewState` | Required controlled camera state. Must not contain a view-state lookup `id`. |
| `onViewStateChange` | Camera-change callback for this panel only. Update `sceneProps.viewState` to accept changes. |
| `layerFilter` | Optional additional filter for this scene's rendering and picking passes. |

View and layer ids must be unique across root and panel scenes. To display similar
content in multiple scenes, create or clone layers with distinct ids. The panel
clones the supplied view to assign its canvas and camera; it does not mutate the
caller's view. Layers are cloned so the same definitions remain usable after unmounting
and remounting a panel. Global Deck settings such as effects and rendering parameters remain
shared. A panel currently represents one view.

## Updating scenes

Use `panel.setProps({sceneProps: nextScene})` to replace a panel's scene. This preserves
the mounted canvas. `sceneProps` is replaced as a whole; spread the current value when
changing only its camera or layers.

Use the exported `setDeckPropsWithPanels(deck, props)` for **root** updates to `layers`,
`views`, `_canvases`, `layerFilter` or `onViewStateChange`. It merges root props with all
mounted panel contributions. Supply only root scenes to this helper, not the combined
arrays in `deck.props`. With no mounted panels, it delegates directly to `deck.setProps`.
Other Deck props pass through unchanged.

Direct `deck.setProps` updates to these managed scene props replace the combined scene.
For this reason, integrations that manage those props themselves, such as React
`DeckGL`, need to route their scene updates through this helper before using DeckPanel.
The helper does not replace or patch `deck.setProps`.

## Lifecycle

Mounting registers the canvas, view and layers; unmounting removes them and restores
the latest root scene. Tabs retain their contents. Accordion sections unmount when
collapsed unless `keepMounted` is set. Canvas resizing uses Deck's multi-canvas resize
handling. The panel never creates or finalizes a Deck instance.

Do not supply `canvas` or `gl` alongside `_canvases`. Follow deck.gl's multi-canvas
requirements when supplying an external device. This API depends on the experimental
9.4 multi-canvas API and does not fall back to a separate Deck instance.

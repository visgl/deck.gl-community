# MarkerLayer

This layer provides the basic marker functionality. This marker layer provided by Deck.gl only has one marker (circle) while this layer provides numerous markers.

## Properties

Inherits from all [Icon Layer](http://deck.gl/#/documentation/deckgl-api-reference/layers/icon-layer) properties.

### Render Options

##### `getPosition` (Function, optional) ![transition-enabled](https://img.shields.io/badge/transition-enabled-green.svg?style=flat-square")

- Default: `d => d.position`

Method called to retrieve the position of each object, returns `[x, y]`.

##### `getMarker` (Function, optional)

- Default: `d => d.marker`

Method called to retrieve the marker name of each object, returns string.

Available markers:
location-marker-filled, bell-filled, bookmark-filled, bookmark, cd-filled, cd, checkmark, circle-check-filled, circle-check, circle-filled, circle-i-filled, circle-i, circle-minus-filled, circle-minus, circle-plus-filled, circle-plus, circle-questionmark-filled, circle-questionmark, circle-slash-filled, circle-slash, circle-x-filled, circle-x, circle, diamond-filled, diamond, flag-filled, flag, gear, heart-filled, heart, bell, location-marker, octagonal-star-filled, octagonal-star, person-filled, person, pin-filled, pin, plus-small, plus, rectangle-filled, rectangle, star-filled, star, tag-filled, tag, thumb-down-filled, thumb-down, thumb-up, thumb_up-filled, triangle-down-filled, triangle-down, triangle-left-filled, triangle-left, triangle-right-filled, triangle-right, triangle-up-filled, triangle-up, x-small, x

Or you can import the marker list file:

```
  import {Markers} from '@uber/mlvis-layers';
```

##### `getSize` (Function|Number, optional) ![transition-enabled](https://img.shields.io/badge/transition-enabled-green.svg?style=flat-square")

- Default: `1`

The height of each object, in pixels.

- If a number is provided, it is used as the size for all objects.
- If a function is provided, it is called on each object to retrieve its size.

##### `getColor` (Function|Array, optional) ![transition-enabled](https://img.shields.io/badge/transition-enabled-green.svg?style=flat-square")

- Default: `[0, 0, 0, 255]`

The rgba color of each object, in `r, g, b, [a]`. Each component is in the 0-255 range.

- If an array is provided, it is used as the color for all objects.
- If a function is provided, it is called on each object to retrieve its color.

## How to add new markers

- The marker image has to be 32x32 pixels with transparent background in PNG format. The marker itself should be at the center of the image.

- Add the new marker into `markers` folder. Note that the file name will be the name of the marker.

- Go to folder 'scripts' and run `sh scripts/packing.sh` to generate four files: `marker-atlas.png`, `atlas-data-url.js`, `marker-list.js`, and `marker-mapping.js`.

- Go back to the root level of this repo (mlvis-toolkit), and run `yarn prettier` to fix the linter errors.

- Commit changes and create a diff for review (reviewer: `#mlvis`)

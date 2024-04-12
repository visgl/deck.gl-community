# MARKER

<p align="center">
  <img src="/gatsby/images/node-styles/marker.png" height="100" />
</p>

### `marker` (String | Function, required)
- Marker can be one of the following types:
```js
"location-marker-filled", "bell-filled", "bookmark-filled", "bookmark", "cd-filled", "cd", "checkmark",
"circle-check-filled", "circle-check", "circle-filled", "circle-i-filled", "circle-i", "circle-minus-filled",
"circle-minus", "circle-plus-filled", "circle-plus", "circle-questionmark-filled", "circle-questionmark",
"circle-slash-filled", "circle-slash", "circle-x-filled", "circle-x", "circle", "diamond-filled", "diamond",
"flag-filled", "flag", "gear", "heart-filled", "heart", "bell", "location-marker", "octagonal-star-filled",
"octagonal-star", "person-filled", "person", "pin-filled", "pin", "plus-small", "plus", "rectangle-filled",
"rectangle", "star-filled", "star", "tag-filled", "tag", "thumb-down-filled", "thumb-down", "thumb-up",
"thumb_up-filled", "triangle-down-filled", "triangle-down", "triangle-left-filled", "triangle-left",
"triangle-right-filled", "triangle-right", "triangle-up-filled", "triangle-up", "x-small", "x"
```
- If a string is provided for `marker`, all the objects will use the same marker.
- If an accessor function is provided, the function will be called to retrieve the marker of each marker.

### `size` (Number | Function, optional)
- Default: `12`
- If a number is provided for `size`, all the markers will have the same size.
- If an accessor function is provided, the function will be called to retrieve the size of each marker.

### `fill` (String | Array | Function, optional)
- Default: `[0, 0, 0, 255]`
- The value can be hex code, color name, or color array `[r, g, b, a]` (each component is in the 0 - 255 range).
If a color value (hex code, color name, or array) is provided, it is used as the global color for all objects.
- If a function is provided, it is called on each object to retrieve its color.

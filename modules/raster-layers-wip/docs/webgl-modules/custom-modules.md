# Custom Modules

WebGL doesn't have a system for handling dependencies and modules, so I use a
system developed by the [`luma.gl`][luma.gl] library.

This system works by defining _hooks_ designating where the code can be
modified, and _injections_ that insert custom code into those hooks.

Currently, two such hooks exist in the `RasterLayer` and `RasterMeshLayer`,
one for _assembling an image_ and one for _altering the colors in the existing
image_.

## Create color

## Mutate color

### Example: Averaging Bands

Suppose you wanted to implement a spectral index that averages three bands.

```js
// average.js
const fs = `\
float average_calc(vec4 image) {
  return (image.r + image.g + image.b) / 3.;
}
`;

export default {
  name: 'average',
  fs,
  inject: {
    'fs:DECKGL_MUTATE_COLOR': `
    image = vec4(average_calc(image), 0., 0., 0.);
    `
  }
};
```

[luma.gl]: https://luma.gl

## Important Notes

Prop names must be unique.

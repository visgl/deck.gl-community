import {expect, it} from 'vitest';
import type {BitmapLayer} from '@deck.gl/layers';
import {createRasterBasemap} from './raster-basemap';

it('passes tile pixels as the bitmap image, not as iterable layer data', () => {
  const basemap = createRasterBasemap();
  const image = {width: 256, height: 256};
  const bitmap = basemap.props.renderSubLayers!({
    id: 'tile',
    data: image,
    tile: {bbox: {west: -1, south: -2, east: 3, north: 4}}
  } as never) as BitmapLayer;

  expect(bitmap.props.image).toBe(image);
  // Layer initialization counts data rows. A decoded tile image is not a container.
  expect(() => bitmap.getNumInstances()).not.toThrow();
});

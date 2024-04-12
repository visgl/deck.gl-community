// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
// Copyright 2022 Foursquare Labs, Inc.

/* eslint-disable no-continue */

import {Device, Texture, SamplerProps} from '@luma.gl/core';
import isEqual from 'lodash.isequal';

import type {ImageInput, ImageState} from './types';
import type {TextureProps} from '@luma.gl/core';

/**
 * Texture parameters that should work for every texture on both WebGL1 and WebGL2
 */
const DEFAULT_UNIVERSAL_SAMPLER_PROPS: SamplerProps = {
  minFilter: 'nearest',
  magFilter: 'nearest',
  addressModeU: 'clamp-to-edge',
  addressModeV: 'clamp-to-edge'
};

type LoadImagesOptions = {
  device: Device;
  images: ImageState;
  imagesData: ImageInput;
  oldImagesData: ImageInput;
};

// eslint-disable-next-line complexity
export function loadImages({
  device,
  images,
  imagesData,
  oldImagesData
}: LoadImagesOptions): ImageState | null {
  // Change to `true` if we need to setState with a new `images` object
  let imagesDirty = false;

  // If there are any removed keys, which previously existed in oldProps and
  // this.state.images but no longer exist in props, remove from the images
  // object
  if (oldImagesData) {
    for (const key in oldImagesData) {
      if (imagesData && !(key in imagesData) && key in images) {
        delete images[key];
        imagesDirty = true;
      }
    }
  }

  // Check if any keys of props.images have changed
  const changedKeys: string[] = [];
  for (const key in imagesData) {
    // If oldProps.images didn't exist or it existed and this key didn't exist
    if (!oldImagesData || (oldImagesData && !(key in oldImagesData))) {
      changedKeys.push(key);
      continue;
    }

    // Deep compare when the key previously existed to see if it changed
    if (!isEqual(imagesData[key], oldImagesData[key])) {
      changedKeys.push(key);
    }
  }

  for (const key of changedKeys) {
    const imageData = imagesData[key];
    if (!imageData) {
      continue;
    }

    const loadedItem = loadImageItem(device, imageData);
    if (loadedItem) {
      images[key] = loadedItem;
    }
    imagesDirty = true;
  }

  if (imagesDirty) {
    return images;
  }

  return null;
}

/**
 * Load image items to webgl context
 * @param device GPU device
 * @param imageItem image item, might be single texture or array of textures
 * @returns loaded single webgl texture or array of webgl texture or null
 */
function loadImageItem(
  device: Device,
  imageItem: TextureProps | Texture | (TextureProps | Texture)[]
): null | Texture | Texture[] {
  let result: null | Texture | Texture[];
  if (Array.isArray(imageItem)) {
    const dirtyResult = imageItem.map((x) => loadTexture(device, x));
    result = [];
    for (const texture of dirtyResult) {
      if (texture) {
        result.push(texture);
      }
    }
    if (!result.length) {
      result = null;
    }
  } else {
    result = loadTexture(device, imageItem);
  }
  return result;
}

/**
 * Create Texture object from image data
 */
function loadTexture(device: Device, imageProps: Texture | TextureProps): Texture | null {
  if (!imageProps) {
    return null;
  }

  if (imageProps instanceof Texture) {
    return imageProps;
  }

  return device.createTexture({
    ...imageProps,
    sampler: DEFAULT_UNIVERSAL_SAMPLER_PROPS
  });
}

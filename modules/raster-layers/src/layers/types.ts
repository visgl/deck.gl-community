// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
// Copyright 2022 Foursquare Labs, Inc.

import type {TextureProps, Texture} from '@luma.gl/core';
import type {ShaderModule} from '../shadermodules/types';

/** Allowed input for images prop
 * Texture is already on the GPU, while TextureProps can be data on the CPU that is not yet copied to the GPU.
 */
export type ImageInput = Record<string, TextureProps | Texture | (TextureProps | Texture)[]>;

/** Internal storage of images
 * The Texture object references data on the GPU
 */
export type ImageState = Record<string, Texture | Texture[]>;

/** Properties added by RasterLayer. */
export type RasterLayerAddedProps = {
  modules: ShaderModule[];
  images: ImageInput;
  moduleProps: Record<string, number>;
};

// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {TextureCubeManifest, TextureCubeLoaderOptions} from '@loaders.gl/textures';
import type {TextureCubeData, TextureCubeFace} from '@luma.gl/engine';

const CUBE_FACES: TextureCubeFace[] = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'];

type LoadedTextureLevel = {
  /** Browser-native bitmap representation for a mip level. */
  imageBitmap?: ImageBitmap;
  /** Explicit WebGPU texture format name. */
  textureFormat?: string;
  /** Legacy format field returned by some loaders.gl code paths. */
  format?: string;
  /** Raw pixel data for CPU-side texture uploads. */
  data?: Uint8Array;
  /** Width in pixels for raw pixel data uploads. */
  width?: number;
  /** Height in pixels for raw pixel data uploads. */
  height?: number;
};

type LoadedCubemapTexture = {
  type: 'cube';
  data: unknown[];
};

/**
 * Normalizes loaders.gl cubemap load options so in-memory manifests can still
 * resolve relative face URLs through `core.baseUrl`.
 */
export function createCubemapLoadOptions(
  cubemap: string | TextureCubeManifest,
  loadOptions?: TextureCubeLoaderOptions | null
): TextureCubeLoaderOptions | undefined {
  if (!loadOptions) {
    return undefined;
  }

  if (typeof cubemap === 'string' || loadOptions.core?.baseUrl || !loadOptions.baseUrl) {
    return loadOptions;
  }

  return {
    ...loadOptions,
    core: {
      ...loadOptions.core,
      baseUrl: loadOptions.baseUrl
    }
  };
}

/** Converts a loaders.gl cubemap result into luma.gl `TextureCubeData`. */
export function convertLoadedCubemapToTextureData(texture: LoadedCubemapTexture): TextureCubeData {
  if (texture.type !== 'cube' || !Array.isArray(texture.data) || texture.data.length !== 6) {
    throw new Error('SkyboxLayer expected a cubemap texture with six faces.');
  }

  return Object.fromEntries(
    CUBE_FACES.map((face, index) => [face, normalizeTextureSlice(texture.data[index], face)])
  ) as TextureCubeData;
}

/** Normalizes a cubemap face that may contain one or more mip levels. */
function normalizeTextureSlice(faceData: unknown, face: TextureCubeFace): any {
  if (Array.isArray(faceData)) {
    if (faceData.length === 0) {
      throw new Error(`SkyboxLayer received an empty mip chain for face ${face}.`);
    }
    return faceData.map((level, mipLevel) => normalizeTextureLevel(level, face, mipLevel));
  }

  return normalizeTextureLevel(faceData, face, 0);
}

/** Normalizes a single cubemap face mip level into luma.gl upload data. */
function normalizeTextureLevel(faceData: unknown, face: TextureCubeFace, mipLevel: number) {
  if (typeof ImageBitmap !== 'undefined' && faceData instanceof ImageBitmap) {
    return faceData;
  }

  const level = faceData as LoadedTextureLevel | null | undefined;

  if (level?.imageBitmap) {
    return level.imageBitmap;
  }

  if (level && ArrayBuffer.isView(level.data) && level.width && level.height) {
    return {
      data: level.data,
      width: level.width,
      height: level.height,
      format:
        typeof level.textureFormat === 'string'
          ? level.textureFormat
          : typeof level.format === 'string'
            ? level.format
            : 'rgba8unorm'
    };
  }

  throw new Error(`SkyboxLayer could not normalize cubemap face ${face} mip ${mipLevel}.`);
}

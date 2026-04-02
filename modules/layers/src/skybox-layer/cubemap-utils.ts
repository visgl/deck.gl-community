// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {TextureCubeManifest, TextureCubeLoaderOptions} from '@loaders.gl/textures';
import type {TextureCubeData, TextureCubeFace, TextureSliceData} from '@luma.gl/engine';

const CUBE_FACES: TextureCubeFace[] = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'];

type LoadedTextureLevel = {
  imageBitmap?: ImageBitmap;
  textureFormat?: string;
  format?: string;
  data?: Uint8Array;
  width?: number;
  height?: number;
};

type LoadedCubemapTexture = {
  type: 'cube';
  data: unknown[];
};

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

export function convertLoadedCubemapToTextureData(texture: LoadedCubemapTexture): TextureCubeData {
  if (texture.type !== 'cube' || !Array.isArray(texture.data) || texture.data.length !== 6) {
    throw new Error('SkyboxLayer expected a cubemap texture with six faces.');
  }

  return Object.fromEntries(
    CUBE_FACES.map((face, index) => [face, normalizeTextureSlice(texture.data[index], face)])
  ) as TextureCubeData;
}

function normalizeTextureSlice(faceData: unknown, face: TextureCubeFace): TextureSliceData {
  if (Array.isArray(faceData)) {
    if (faceData.length === 0) {
      throw new Error(`SkyboxLayer received an empty mip chain for face ${face}.`);
    }
    return faceData.map((level, mipLevel) => normalizeTextureLevel(level, face, mipLevel));
  }

  return normalizeTextureLevel(faceData, face, 0);
}

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

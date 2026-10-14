import type {Device, SamplerProps, Texture, TextureProps} from '@luma.gl/core';

/** The sampler deck.gl gives the textures it creates from `image` props. */
const DEFAULT_SAMPLER: SamplerProps = {
  minFilter: 'linear',
  mipmapFilter: 'linear',
  magFilter: 'linear',
  addressModeU: 'clamp-to-edge',
  addressModeV: 'clamp-to-edge'
};

type SharedTexture = {texture: Texture; users: number};

/** The shared textures of each device, by the image they were created from. */
const sharedTextures = new WeakMap<Device, Map<object, SharedTexture>>();

/**
 * Creates a texture from an image as deck.gl does for an `image` prop: an `ImageBitmap` or canvas,
 * or a plain object with `data`, `width` and `height`, with mipmaps.
 */
function createTexture(device: Device, image: object): Texture {
  const source = (
    image.constructor && image.constructor.name !== 'Object' ? {data: image} : image
  ) as {data: {width?: number; height?: number}; width?: number; height?: number};
  // A plain object gives its size; raw pixel data has none of its own.
  const width = source.width ?? source.data.width ?? 1;
  const height = source.height ?? source.data.height ?? 1;
  const texture = device.createTexture({
    ...source,
    sampler: DEFAULT_SAMPLER,
    mipLevels: device.getMipLevelCount(width, height)
  } as TextureProps);
  if (device.type === 'webgl') {
    texture.generateMipmapsWebGL();
  } else if (device.type === 'webgpu') {
    (device as any).generateMipmapsWebGPU(texture);
  }
  return texture;
}

/**
 * The textures one layer uses, shared with every other layer that uses the same image on the
 * same device. deck.gl creates a texture, and uploads the image, for each layer that is handed an
 * image: every label sublayer of every tile would upload the same font atlas and sprite sheet. A
 * shared texture is created on first use and destroyed when its last user releases it.
 */
export class SharedTextureSet {
  private images = new Set<object>();

  constructor(private device: Device) {}

  /** Returns the shared texture of `image`, which this set uses until `retainOnly` drops it. */
  get(image: object): Texture {
    let textures = sharedTextures.get(this.device);
    if (!textures) {
      textures = new Map();
      sharedTextures.set(this.device, textures);
    }
    let entry = textures.get(image);
    if (!entry) {
      entry = {texture: createTexture(this.device, image), users: 0};
      textures.set(image, entry);
    }
    if (!this.images.has(image)) {
      this.images.add(image);
      entry.users++;
    }
    return entry.texture;
  }

  /** Releases the textures of every image this set uses that is not in `images`. */
  retainOnly(images: Iterable<object>): void {
    const kept = new Set(images);
    for (const image of this.images) {
      if (!kept.has(image)) {
        this.release(image);
      }
    }
  }

  /** Releases every texture this set uses. */
  releaseAll(): void {
    for (const image of this.images) {
      this.release(image);
    }
  }

  private release(image: object): void {
    this.images.delete(image);
    const textures = sharedTextures.get(this.device);
    const entry = textures?.get(image);
    if (entry && --entry.users <= 0) {
      entry.texture.destroy();
      textures!.delete(image);
    }
  }
}

/** The number of shared textures alive on a device, for tests. */
export function getSharedTextureCount(device: Device): number {
  return sharedTextures.get(device)?.size ?? 0;
}

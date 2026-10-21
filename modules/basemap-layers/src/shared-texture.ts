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

/** Options of a `SharedTextureSet`. Sets with different options share no textures. */
export type SharedTextureOptions = {
  /**
   * Most mip levels of a texture, the full image included: 1 for none. Default: the full chain.
   * Fewer levels keep a minified texture sharper, at the cost of aliasing beyond the last level.
   */
  maxMipLevels?: number;
};

/**
 * The shared textures of each device, by the options they were created with (see `getOptionsKey`)
 * and the image they were created from.
 */
const sharedTextures = new WeakMap<Device, Map<string, Map<object, SharedTexture>>>();

function getOptionsKey({maxMipLevels}: SharedTextureOptions): string {
  return maxMipLevels === undefined ? 'mip:all' : `mip:${maxMipLevels}`;
}

/**
 * Creates a texture from an image as deck.gl does for an `image` prop: an `ImageBitmap` or canvas,
 * or a plain object with `data`, `width` and `height`, with mipmaps (at most `maxMipLevels`).
 */
function createTexture(
  device: Device,
  image: object,
  {maxMipLevels}: SharedTextureOptions
): Texture {
  const source = (
    image.constructor && image.constructor.name !== 'Object' ? {data: image} : image
  ) as {data: {width?: number; height?: number}; width?: number; height?: number};
  // A plain object gives its size; raw pixel data has none of its own.
  const width = source.width ?? source.data.width ?? 1;
  const height = source.height ?? source.data.height ?? 1;
  const texture = device.createTexture({
    ...source,
    sampler: DEFAULT_SAMPLER,
    mipLevels: Math.max(
      1,
      Math.min(maxMipLevels ?? Infinity, device.getMipLevelCount(width, height))
    )
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
  /** The options, as given at construction: they are part of the cache key. */
  readonly options: Readonly<SharedTextureOptions>;
  private optionsKey: string;

  constructor(
    private device: Device,
    {maxMipLevels}: SharedTextureOptions = {}
  ) {
    this.options = {maxMipLevels};
    this.optionsKey = getOptionsKey(this.options);
  }

  /** The textures shared by the sets with this set's options on its device. */
  private getTextures(): Map<object, SharedTexture> {
    let byOptions = sharedTextures.get(this.device);
    if (!byOptions) {
      byOptions = new Map();
      sharedTextures.set(this.device, byOptions);
    }
    let textures = byOptions.get(this.optionsKey);
    if (!textures) {
      textures = new Map();
      byOptions.set(this.optionsKey, textures);
    }
    return textures;
  }

  /** Returns the shared texture of `image`, which this set uses until `retainOnly` drops it. */
  get(image: object): Texture {
    const textures = this.getTextures();
    let entry = textures.get(image);
    if (!entry) {
      entry = {texture: createTexture(this.device, image, this.options), users: 0};
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
    const textures = this.getTextures();
    const entry = textures.get(image);
    if (entry && --entry.users <= 0) {
      entry.texture.destroy();
      textures.delete(image);
    }
  }
}

/** The number of shared textures alive on a device, for tests. */
export function getSharedTextureCount(device: Device): number {
  let count = 0;
  for (const textures of sharedTextures.get(device)?.values() || []) {
    count += textures.size;
  }
  return count;
}

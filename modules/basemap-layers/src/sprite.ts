import {log} from '@deck.gl/core';
import type {BasemapLoadOptions} from './style-resolver';

/** One image in a style sprite, as listed in the sprite's JSON index. */
export type SpriteImage = {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Device pixels per CSS pixel of the image. Default 1. */
  pixelRatio?: number;
  /** `true` for signed-distance-field images, which are tinted with `icon-color`. */
  sdf?: boolean;
};

/** A deck.gl `IconLayer` mapping entry for one sprite image. */
export type SpriteIconMappingEntry = {
  x: number;
  y: number;
  width: number;
  height: number;
  /** `true` for SDF images: deck.gl tints masked icons with `getColor`. */
  mask: boolean;
  /** Device pixels per CSS pixel; `icon-size` scales `height / pixelRatio`. */
  pixelRatio: number;
};

/** A loaded sprite: the atlas image and its deck.gl icon mapping. */
export type SpriteAtlas = {
  /**
   * Sprite id. `'default'` for a style whose `sprite` is a single URL; otherwise the id from the
   * style's sprite array, which prefixes its image names as `id:name`.
   */
  id: string;
  /**
   * The atlas image, decoded once and shared by every icon layer, or its URL where
   * `createImageBitmap` is unavailable (each `IconLayer` then loads the URL itself).
   */
  image: ImageBitmap | string;
  /** Icon mapping keyed by image name, without the `id:` prefix. */
  mapping: Record<string, SpriteIconMappingEntry>;
};

/** A style's `sprite` value: a URL, or the array form with one `{id, url}` per sprite. */
export type StyleSprite = string | Array<{id: string; url: string}>;

/** A sprite source after relative URLs are resolved. */
export type SpriteSource = {id: string; url: string};

/** Options for {@link loadSpriteAtlases}. */
export type SpriteLoadOptions = {
  /** Base URL that relative sprite URLs resolve against, normally the style URL. */
  baseUrl?: string;
  /** Device pixel ratio. At 2 or more, the `@2x` sprite is requested first. Default 1. */
  pixelRatio?: number;
} & Pick<NonNullable<BasemapLoadOptions>, 'fetch' | 'fetchOptions'>;

/** Resolves a style's `sprite` value into sprite sources with absolute URLs. */
export function getSpriteSources(sprite: unknown, baseUrl?: string): SpriteSource[] {
  const resolve = (url: string) => {
    try {
      return new URL(url, baseUrl).toString();
    } catch {
      return url;
    }
  };
  if (typeof sprite === 'string' && sprite) {
    return [{id: 'default', url: resolve(sprite)}];
  }
  if (Array.isArray(sprite)) {
    return sprite
      .filter(entry => entry && typeof entry.id === 'string' && typeof entry.url === 'string')
      .map(entry => ({id: entry.id, url: resolve(entry.url)}));
  }
  return [];
}

/** Converts a sprite JSON index into a deck.gl `IconLayer` mapping. */
export function getSpriteIconMapping(
  index: Record<string, SpriteImage>
): Record<string, SpriteIconMappingEntry> {
  const mapping: Record<string, SpriteIconMappingEntry> = {};
  for (const [name, image] of Object.entries(index || {})) {
    mapping[name] = {
      x: image.x,
      y: image.y,
      width: image.width,
      height: image.height,
      mask: Boolean(image.sdf),
      pixelRatio: image.pixelRatio || 1
    };
  }
  return mapping;
}

/**
 * Decodes the atlas PNG once, so the per-tile icon layers share one image instead of each
 * requesting it. Without `createImageBitmap` (e.g. in Node), returns the URL.
 */
async function loadSpriteImage(
  url: string,
  fetchFn: typeof fetch,
  fetchOptions?: RequestInit
): Promise<ImageBitmap | string> {
  if (typeof createImageBitmap !== 'function') {
    return url;
  }
  const response = await fetchFn(url, fetchOptions);
  if (!response.ok) {
    throw new Error(`Failed to load sprite image: ${url} (${response.status})`);
  }
  return await createImageBitmap(await response.blob());
}

/** Appends a suffix and extension to a sprite URL's path, keeping its query string and hash. */
function getSpriteFileUrl(url: string, suffix: string, extension: string): string {
  const pathEnd = url.search(/[?#]/);
  return pathEnd < 0
    ? `${url}${suffix}${extension}`
    : `${url.slice(0, pathEnd)}${suffix}${extension}${url.slice(pathEnd)}`;
}

/**
 * Loads one sprite: the `@2x` variant first at any pixel ratio above 1, as MapLibre does, falling
 * back to `@1x`.
 */
async function loadSpriteAtlas(
  source: SpriteSource,
  options: SpriteLoadOptions
): Promise<SpriteAtlas> {
  const fetchFn = options.fetch || fetch;
  const suffixes = (options.pixelRatio ?? 1) > 1 ? ['@2x', ''] : [''];
  let lastError: unknown;
  for (const suffix of suffixes) {
    const jsonUrl = getSpriteFileUrl(source.url, suffix, '.json');
    try {
      const response = await fetchFn(jsonUrl, options.fetchOptions);
      if (!response.ok) {
        throw new Error(`Failed to load sprite: ${jsonUrl} (${response.status})`);
      }
      const index = (await response.json()) as Record<string, SpriteImage>;
      return {
        id: source.id,
        image: await loadSpriteImage(
          getSpriteFileUrl(source.url, suffix, '.png'),
          fetchFn,
          options.fetchOptions
        ),
        mapping: getSpriteIconMapping(index)
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/**
 * Loads every sprite a style references. A sprite that fails to load is skipped with a warning,
 * so its icons are not drawn and the rest of the style still renders.
 */
export async function loadSpriteAtlases(
  sprite: unknown,
  options: SpriteLoadOptions = {}
): Promise<SpriteAtlas[]> {
  const sources = getSpriteSources(sprite, options.baseUrl);
  const atlases = await Promise.all(
    sources.map(source =>
      loadSpriteAtlas(source, options).catch(error => {
        log.warn(
          `[BasemapLayer] Sprite ${source.url} failed to load; its icons are skipped`,
          error
        )();
        return null;
      })
    )
  );
  return atlases.filter((atlas): atlas is SpriteAtlas => Boolean(atlas));
}

const imageNamesCache = new WeakMap<readonly SpriteAtlas[], string[]>();

/**
 * The image names `icon-image` can reference: unprefixed for the `'default'` sprite and `id:name`
 * for the others. Passed to expression evaluation so `["image", ...]` sees which images exist.
 */
export function getSpriteImageNames(atlases: readonly SpriteAtlas[] | null | undefined): string[] {
  if (!atlases) {
    return [];
  }
  let names = imageNamesCache.get(atlases);
  if (!names) {
    names = atlases.flatMap(atlas =>
      Object.keys(atlas.mapping).map(name =>
        atlas.id === 'default' ? name : `${atlas.id}:${name}`
      )
    );
    imageNamesCache.set(atlases, names);
  }
  return names;
}

/** An icon resolved against the loaded sprites. */
export type ResolvedSpriteIcon = {atlas: SpriteAtlas; name: string; entry: SpriteIconMappingEntry};

/**
 * Finds the sprite and mapping entry for an `icon-image` name. Names from the `'default'` sprite
 * are unprefixed; names from other sprites are written `id:name`, as in MapLibre.
 */
export function resolveSpriteIcon(
  atlases: readonly SpriteAtlas[] | undefined,
  iconImage: string
): ResolvedSpriteIcon | null {
  if (!atlases || !iconImage) {
    return null;
  }
  const separator = iconImage.indexOf(':');
  if (separator > 0) {
    const atlas = atlases.find(candidate => candidate.id === iconImage.slice(0, separator));
    const name = iconImage.slice(separator + 1);
    if (atlas?.mapping[name]) {
      return {atlas, name, entry: atlas.mapping[name]};
    }
  }
  const atlas = atlases.find(candidate => candidate.id === 'default');
  if (atlas?.mapping[iconImage]) {
    return {atlas, name: iconImage, entry: atlas.mapping[iconImage]};
  }
  return null;
}

const warnedMissingIcons = new Set<string>();

/** Warns once per icon name that a style references an image no loaded sprite contains. */
export function warnMissingIcon(iconImage: string): void {
  if (!warnedMissingIcons.has(iconImage)) {
    warnedMissingIcons.add(iconImage);
    log.warn(`[BasemapLayer] icon-image "${iconImage}" is not in the style's sprite; skipped`)();
  }
}

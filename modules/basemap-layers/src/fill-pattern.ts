// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {log} from '@deck.gl/core';
import {getCompiledStyleProperty, type StyleFeature} from './style-expression';
import {
  type ResolvedSpriteIcon,
  type SpriteAtlas,
  type SpriteIconMappingEntry,
  getSpriteImageNames,
  resolveSpriteIcon
} from './sprite';

type StyleLayerLike = {
  paint?: Record<string, unknown>;
  layout?: Record<string, unknown>;
};

/** The features of a patterned fill whose images come from one sprite. */
export type FillPatternGroup = {
  atlas: SpriteAtlas;
  /** The atlas's index in the style's sprite list, unique per group. */
  atlasIndex: number;
  features: any[];
  /** The image name in the atlas's mapping, for every feature or per feature. */
  getFillPattern: string | ((feature: StyleFeature) => string);
  /** The image's pixel ratio, device pixels per CSS pixel, for every feature or per feature. */
  getPixelRatio: number | ((feature: StyleFeature) => number);
  /** The names of the group's images, sorted. */
  names: string[];
};

const warnedMissingPatterns = new Set<string>();

function warnMissingPattern(name: string): void {
  if (!warnedMissingPatterns.has(name)) {
    warnedMissingPatterns.add(name);
    log.warn(`[BasemapLayer] fill-pattern "${name}" is not in the style's sprite; skipped`)();
  }
}

/** The latest groups per tile content and style layer, reused while their inputs are unchanged. */
const patternGroupCache = new WeakMap<
  any[],
  WeakMap<StyleLayerLike, {key: unknown[]; groups: FillPatternGroup[]}>
>();

/**
 * Splits a patterned fill's features by the sprite their `fill-pattern` image is in. Features
 * whose image is in no loaded sprite draw nothing, as in MapLibre GL JS. `fill-pattern` is
 * evaluated at the integer zoom, as the style spec does for cross-faded properties.
 *
 * Returns no groups while the sprites load (`null`) or when the layer has no `fill-pattern`. A
 * pattern that does not depend on feature data keeps the tile's feature array, so deck.gl does not
 * re-tessellate the features at a new zoom step; per-feature groups are cached per tile, style
 * layer, sprite list and zoom.
 */
export function getFillPatternGroups(
  features: any[],
  styleLayer: StyleLayerLike,
  zoom: number,
  spriteAtlases: SpriteAtlas[] | null | undefined
): FillPatternGroup[] {
  const property = getCompiledStyleProperty(styleLayer, 'fill-pattern');
  if (!property || !spriteAtlases?.length) {
    return [];
  }
  const patternZoom = Math.floor(zoom);
  const imageNames = getSpriteImageNames(spriteAtlases);
  const resolve = (feature?: StyleFeature): ResolvedSpriteIcon | null => {
    const value = property.evaluate(patternZoom, feature, imageNames);
    const name = value === null || value === undefined ? '' : String(value);
    if (!name) {
      return null;
    }
    const icon = resolveSpriteIcon(spriteAtlases, name);
    if (!icon) {
      warnMissingPattern(name);
    }
    return icon;
  };

  if (!property.isFeatureDependent) {
    const icon = resolve();
    return icon
      ? [
          {
            atlas: icon.atlas,
            atlasIndex: spriteAtlases.indexOf(icon.atlas),
            features,
            getFillPattern: icon.name,
            getPixelRatio: icon.entry.pixelRatio,
            names: [icon.name]
          }
        ]
      : [];
  }

  const key = [spriteAtlases, property.isZoomDependent ? patternZoom : null];
  let byStyleLayer = patternGroupCache.get(features);
  if (!byStyleLayer) {
    byStyleLayer = new WeakMap();
    patternGroupCache.set(features, byStyleLayer);
  }
  const cached = byStyleLayer.get(styleLayer);
  if (cached && cached.key.every((entry, index) => entry === key[index])) {
    return cached.groups;
  }

  const icons = new Map<StyleFeature, ResolvedSpriteIcon>();
  const groups = new Map<SpriteAtlas, FillPatternGroup>();
  const pixelRatios = new Map<SpriteAtlas, Set<number>>();
  for (const feature of features) {
    const icon = resolve(feature);
    if (!icon) {
      continue;
    }
    icons.set(feature, icon);
    let group = groups.get(icon.atlas);
    if (!group) {
      group = {
        atlas: icon.atlas,
        atlasIndex: spriteAtlases.indexOf(icon.atlas),
        features: [],
        getFillPattern: feature => icons.get(feature)!.name,
        getPixelRatio: feature => icons.get(feature)!.entry.pixelRatio,
        names: []
      };
      groups.set(icon.atlas, group);
      pixelRatios.set(icon.atlas, new Set());
    }
    group.features.push(feature);
    group.names.push(icon.name);
    pixelRatios.get(icon.atlas)!.add(icon.entry.pixelRatio);
  }
  const result = [...groups.values()];
  for (const group of result) {
    group.names = [...new Set(group.names)].sort();
  }
  // A constant pixel ratio, as a sprite normally has, keeps the pattern scale a constant.
  for (const group of result) {
    const ratios = pixelRatios.get(group.atlas)!;
    if (ratios.size === 1) {
      group.getPixelRatio = [...ratios][0];
    }
  }
  byStyleLayer.set(styleLayer, {key, groups: result});
  return result;
}

const PATTERN_TEXTURE_PARAMETERS = {mipmapFilter: 'none'} as const;

type PatternAtlas = {
  image: SpriteAtlas['image'] | OffscreenCanvas | HTMLCanvasElement;
  mapping: Record<string, SpriteIconMappingEntry>;
};

/** Pattern atlases per sprite and list of image names. */
const patternAtlasCache = new WeakMap<SpriteAtlas, Map<string, PatternAtlas>>();

function createCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement | null {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  return null;
}

/**
 * An atlas of the named sprite images for a pattern, each with a 1 pixel border copied from its
 * opposite edge, as MapLibre GL JS pads its pattern atlas. A sprite packs its images edge to edge,
 * so a linear filter at an image's edge would blend in the next image and draw a seam between the
 * repeats; with the border, it blends in the image's own wrapped pixels. The atlas holds only
 * these images, so each fill uploads a small texture instead of the whole sprite. Where the
 * sprite image is a URL, or no canvas is available, it returns the sprite itself.
 */
export function getPatternAtlas(atlas: SpriteAtlas, names: string[]): PatternAtlas {
  let byNames = patternAtlasCache.get(atlas);
  if (!byNames) {
    byNames = new Map();
    patternAtlasCache.set(atlas, byNames);
  }
  const key = names.join('\n');
  const cached = byNames.get(key);
  if (cached) {
    return cached;
  }
  const entries = names.map(name => atlas.mapping[name]);
  const width = entries.reduce((sum, entry) => sum + entry.width + 2, 0);
  const height = Math.max(...entries.map(entry => entry.height + 2));
  const canvas = typeof atlas.image === 'string' ? null : createCanvas(width, height);
  const context = canvas?.getContext('2d') as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null
    | undefined;
  let result: PatternAtlas = {image: atlas.image, mapping: atlas.mapping};
  if (canvas && context) {
    const mapping: Record<string, SpriteIconMappingEntry> = {};
    let left = 0;
    names.forEach((name, index) => {
      const entry = entries[index];
      const {x, y, width: w, height: h} = entry;
      // The image, then each border from the opposite edge, corners included: a 3x3 tiling of
      // the image clipped to its 1 pixel border.
      for (const dx of [-1, 0, 1]) {
        for (const dy of [-1, 0, 1]) {
          const sx = dx === 0 ? x : dx < 0 ? x + w - 1 : x;
          const sy = dy === 0 ? y : dy < 0 ? y + h - 1 : y;
          const sw = dx === 0 ? w : 1;
          const sh = dy === 0 ? h : 1;
          const tx = left + 1 + (dx === 0 ? 0 : dx < 0 ? -1 : w);
          const ty = 1 + (dy === 0 ? 0 : dy < 0 ? -1 : h);
          context.drawImage(atlas.image as CanvasImageSource, sx, sy, sw, sh, tx, ty, sw, sh);
        }
      }
      mapping[name] = {...entry, x: left + 1, y: 1};
      left += w + 2;
    });
    result = {image: canvas, mapping};
  }
  byNames.set(key, result);
  return result;
}

/**
 * `FillPatternExtension` props for a group: the sprite atlas and mapping, and each image repeated
 * at its CSS-pixel size at the integer zoom, as MapLibre GL JS sizes patterns. Between integer
 * zooms the pattern scales with the map, and it steps back at the next integer zoom. The image
 * supplies the colors, so the fill color is only the opacity.
 */
export function getFillPatternProps(group: FillPatternGroup, zoom: number) {
  const unitScale = 2 ** -Math.floor(zoom);
  const {getPixelRatio} = group;
  const {image, mapping} = getPatternAtlas(group.atlas, group.names);
  return {
    fillPatternAtlas: image,
    fillPatternMapping: mapping,
    fillPatternMask: false,
    // Sampled without mipmaps, as in MapLibre GL JS: a mipmap level would blend the atlas's
    // images, and an image's own quadrants. Patterns minify only where a sprite's pixel ratio
    // exceeds the screen's.
    textureParameters: PATTERN_TEXTURE_PARAMETERS,
    fillPatternSizeUnits: 'common' as const,
    getFillPattern: group.getFillPattern,
    getFillPatternScale:
      typeof getPixelRatio === 'function'
        ? (feature: StyleFeature) => unitScale / getPixelRatio(feature)
        : unitScale / getPixelRatio
  };
}

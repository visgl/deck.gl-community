/** Runtime exports for `@deck.gl-community/basemap-layers`. */
export {BasemapLayer} from './basemap-layer';
export {
  createDemTileset,
  getBasemapLayers,
  getGlobeBaseLayers,
  getGlobeTopLayers
} from './globe-layers';
export {getSpriteIconMapping, getSpriteSources, loadSpriteAtlases} from './sprite';
export type {SpriteAtlas, SpriteIconMappingEntry, SpriteSource} from './sprite';
export {getLabelFont} from './text-font';
export type {LabelFont, LabelFontFamily} from './text-font';
export {GlyphStore} from './glyph-store';
export type {GlyphStoreOptions} from './glyph-store';

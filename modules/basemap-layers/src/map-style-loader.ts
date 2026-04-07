import type {LoaderContext, LoaderOptions, LoaderWithParser} from '@loaders.gl/loader-utils';
import {ResolvedBasemapStyleSchema} from './map-style-schema';
import {resolveBasemapStyle} from './style-resolver';
import type {BasemapLoadOptions, BasemapStyle, ResolvedBasemapStyle} from './style-resolver';

// __VERSION__ is injected by babel-plugin-version-inline
// @ts-ignore TS2304: Cannot find name '__VERSION__'.
const VERSION = typeof __VERSION__ !== 'undefined' ? __VERSION__ : 'latest';

/** Namespaced loaders.gl options for {@link MapStyleLoader}. */
export type MapStyleLoaderOptions = LoaderOptions & {
  mapStyle?: NonNullable<BasemapLoadOptions>;
};

function getMapStyleLoadOptions(
  options?: MapStyleLoaderOptions,
  context?: LoaderContext
): NonNullable<BasemapLoadOptions> {
  return {
    ...options?.mapStyle,
    baseUrl: options?.mapStyle?.baseUrl || context?.url || context?.baseUrl,
    fetch: options?.mapStyle?.fetch || (context?.fetch as typeof fetch | undefined)
  };
}

/** loaders.gl-compatible loader that resolves and validates map-style documents. */
export const MapStyleLoader = {
  dataType: null as unknown as ResolvedBasemapStyle,
  batchType: null as never,

  name: 'Map Style',
  id: 'map-style',
  module: 'basemap-layers',
  version: VERSION,
  worker: false,
  extensions: ['json'],
  mimeTypes: ['application/json', 'application/vnd.mapbox.style+json'],
  text: true,
  options: {
    mapStyle: {}
  },
  parse: async (
    arrayBuffer: ArrayBuffer,
    options?: MapStyleLoaderOptions,
    context?: LoaderContext
  ) => {
    const text =
      typeof arrayBuffer === 'string' ? arrayBuffer : new TextDecoder().decode(arrayBuffer);
    const style = JSON.parse(text) as BasemapStyle;
    const resolved = await resolveBasemapStyle(style, getMapStyleLoadOptions(options, context));
    return ResolvedBasemapStyleSchema.parse(resolved);
  }
} as const satisfies LoaderWithParser<ResolvedBasemapStyle, never, MapStyleLoaderOptions>;

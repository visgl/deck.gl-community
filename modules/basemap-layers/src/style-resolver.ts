import {log} from '@deck.gl/core';
import {derefLayers} from '@maplibre/maplibre-gl-style-spec';
import {
  BasemapSourceSchema,
  BasemapStyleSchema,
  ResolvedBasemapStyleSchema
} from './map-style-schema';

/**
 * A basemap source entry from a style document.
 */
export type BasemapSource = {
  /** Source kind such as `vector` or `raster`. */
  type?: string;
  /** Optional TileJSON URL used to resolve the source metadata. */
  url?: string;
  /** Inline tile templates for the source. */
  tiles?: string[];
  /** Minimum source zoom, when supplied by the style or TileJSON. */
  minzoom?: number;
  /** Maximum source zoom, when supplied by the style or TileJSON. */
  maxzoom?: number;
  /** Tile size in pixels. */
  tileSize?: number;
  /** Additional source properties are preserved verbatim. */
  [key: string]: unknown;
};

/**
 * A style layer entry used by the basemap runtime.
 */
export type BasemapStyleLayer = {
  /** Unique layer identifier. */
  id: string;
  /** Optional concrete style layer type such as `background`, `fill`, `line`, or `raster`. */
  type?: string;
  /** Legacy style layer id whose structural render properties are inherited. */
  ref?: string;
  /** Referenced source identifier. */
  source?: string;
  /** Referenced vector source-layer identifier. */
  'source-layer'?: string;
  /** Optional minimum zoom. */
  minzoom?: number;
  /** Optional maximum zoom. */
  maxzoom?: number;
  /** Optional style-spec filter expression. */
  filter?: unknown[];
  /** Paint properties from the source style layer. */
  paint?: Record<string, unknown>;
  /** Layout properties from the source style layer. */
  layout?: Record<string, unknown>;
  /** Additional layer properties are preserved verbatim. */
  [key: string]: unknown;
};

/** A style layer after legacy `ref` inheritance has been resolved. */
export type ResolvedBasemapStyleLayer = BasemapStyleLayer & {
  /** Concrete style layer type after optional `ref` inheritance. */
  type: string;
};

/**
 * A MapLibre or Mapbox style document consumed by the basemap runtime.
 */
export type BasemapStyle = {
  /** Style-spec version number. */
  version?: number;
  /** Optional style metadata bag. */
  metadata?: Record<string, unknown>;
  /** Named source definitions used by the style. */
  sources?: Record<string, BasemapSource>;
  /** Ordered list of style layers. */
  layers?: BasemapStyleLayer[];
  /** Additional style properties are preserved verbatim. */
  [key: string]: unknown;
};

/**
 * A style document after all sources have been normalized and TileJSON-backed
 * sources have been resolved.
 */
export type ResolvedBasemapStyle = Omit<BasemapStyle, 'sources' | 'layers'> & {
  /** Fully resolved source definitions. */
  sources: Record<string, BasemapSource>;
  /** Style layers copied into a mutable array. */
  layers: ResolvedBasemapStyleLayer[];
};

/**
 * Load options accepted by {@link resolveBasemapStyle}.
 */
export type BasemapLoadOptions = {
  /** Base URL used to resolve relative source or tile URLs for in-memory styles. */
  baseUrl?: string;
  /** Optional custom fetch implementation. */
  fetch?: typeof fetch;
  /** Optional init object passed to the selected fetch implementation. */
  fetchOptions?: RequestInit;
  /** Additional loader options are accepted for forward compatibility. */
  [key: string]: unknown;
} | null;

/** Resolves a possibly relative URL against the provided base URL. */
function normalizeUrl(url: string | undefined, baseUrl?: string) {
  if (!url) {
    return url;
  }

  try {
    return decodeURI(new URL(url, baseUrl).toString());
  } catch {
    return url;
  }
}

/** Resolves all tile templates in a source against the source base URL. */
function normalizeTiles(tiles: string[] | undefined, baseUrl?: string) {
  return Array.isArray(tiles) ? tiles.map(tile => normalizeUrl(tile, baseUrl) || tile) : tiles;
}

/** Fetches and parses a JSON resource. */
async function fetchJson(url: string, loadOptions?: BasemapLoadOptions) {
  const fetchFn = loadOptions?.fetch || fetch;
  const response = await fetchFn(url, loadOptions?.fetchOptions);

  if (!response.ok) {
    throw new Error(`Failed to load basemap resource: ${url} (${response.status})`);
  }

  return await response.json();
}

/**
 * Source types whose `url` is fetched as TileJSON. Only the types this module renders are fetched:
 * `raster-dem` is unsupported, and for `image` and `video` the `url` is the media itself.
 */
const TILEJSON_SOURCE_TYPES = new Set(['vector', 'raster']);

/**
 * TileJSON fields that may fill in a source, as MapLibre picks them. Every other TileJSON field,
 * including `type` and `url`, is ignored.
 */
const TILEJSON_SOURCE_KEYS = [
  'tiles',
  'minzoom',
  'maxzoom',
  'attribution',
  'bounds',
  'scheme',
  'tileSize',
  'encoding'
] as const;

/** Copies the TileJSON fields a source may take into a fresh object. */
function pickTileJsonFields(tileJson: unknown): Partial<BasemapSource> {
  const fields: Record<string, unknown> = {};
  if (!tileJson || typeof tileJson !== 'object' || Array.isArray(tileJson)) {
    return fields;
  }
  for (const key of TILEJSON_SOURCE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(tileJson, key)) {
      fields[key] = (tileJson as Record<string, unknown>)[key];
    }
  }
  return fields as Partial<BasemapSource>;
}

/**
 * Resolves a single source, including optional TileJSON indirection. As in MapLibre, the style's
 * own source properties take precedence over the TileJSON's. Inline `tiles` resolve against the
 * style's base URL and TileJSON `tiles` against the TileJSON URL. Throws if the TileJSON cannot be
 * fetched or the resolved source is invalid.
 */
async function resolveSource(
  source: BasemapSource | undefined,
  baseUrl: string | undefined,
  loadOptions?: BasemapLoadOptions
) {
  if (!source) {
    return source;
  }

  if (!source.url || !TILEJSON_SOURCE_TYPES.has(String(source.type))) {
    return source.tiles ? {...source, tiles: normalizeTiles(source.tiles, baseUrl)} : {...source};
  }

  const tileJsonUrl = normalizeUrl(source.url, baseUrl);
  const tileJsonFields = pickTileJsonFields(
    await fetchJson(tileJsonUrl || source.url, loadOptions)
  );
  const resolvedSource: BasemapSource = {
    ...tileJsonFields,
    ...source,
    url: tileJsonUrl,
    tiles: source.tiles
      ? normalizeTiles(source.tiles, baseUrl)
      : normalizeTiles(tileJsonFields.tiles as string[] | undefined, tileJsonUrl)
  };

  const result = BasemapSourceSchema.safeParse(resolvedSource);
  if (!result.success) {
    throw new Error(`Invalid TileJSON: ${tileJsonUrl} (${result.error.issues[0]?.message})`);
  }
  if (!resolvedSource.tiles?.length) {
    throw new Error(`TileJSON has no tiles: ${tileJsonUrl}`);
  }
  return resolvedSource;
}

/**
 * Whether a source failure means the whole load was cancelled. The caller's signal decides; an
 * `AbortError` is also treated as a cancellation. A timeout raised inside a custom `fetch`
 * (`TimeoutError`) is an ordinary source failure, unless it aborted the caller's own signal.
 */
function isLoadCancelled(error: unknown, loadOptions?: BasemapLoadOptions) {
  return (
    Boolean(loadOptions?.fetchOptions?.signal?.aborted) || (error as Error)?.name === 'AbortError'
  );
}

/**
 * Resolves a basemap style input into a style object whose sources contain
 * directly consumable tile templates and source metadata.
 */
export async function resolveBasemapStyle(
  style: string | BasemapStyle,
  loadOptions?: BasemapLoadOptions
): Promise<ResolvedBasemapStyle> {
  const styleDefinition = BasemapStyleSchema.parse(
    typeof style === 'string' ? await fetchJson(style, loadOptions) : structuredClone(style)
  );
  const baseUrl = typeof style === 'string' ? style : loadOptions?.baseUrl;
  const resolvedSources: Record<string, BasemapSource> = {};

  await Promise.all(
    Object.entries(styleDefinition.sources || {}).map(async ([sourceId, source]) => {
      try {
        resolvedSources[sourceId] = (await resolveSource(source, baseUrl, loadOptions)) || {};
      } catch (error) {
        if (isLoadCancelled(error, loadOptions)) {
          throw loadOptions?.fetchOptions?.signal?.aborted
            ? (loadOptions.fetchOptions.signal.reason ?? error)
            : error;
        }
        // One source that cannot be loaded must not fail the whole style. A source that also
        // lists its own `tiles` keeps them; otherwise it keeps no tile templates, and the layers
        // that use it are skipped.
        const inlineTiles = source?.tiles?.length
          ? normalizeTiles(source.tiles, baseUrl)
          : undefined;
        log.warn(
          `[BasemapLayer] Source "${sourceId}" could not be loaded; ${
            inlineTiles ? 'using its inline tiles' : 'its layers are skipped'
          }: ${String((error as Error)?.message ?? error)}`
        )();
        resolvedSources[sourceId] = {...source, url: undefined, tiles: inlineTiles};
      }
    })
  );

  return ResolvedBasemapStyleSchema.parse({
    ...styleDefinition,
    sources: resolvedSources,
    layers: derefLayers([...(styleDefinition.layers || [])] as Parameters<
      typeof derefLayers
    >[0]) as ResolvedBasemapStyleLayer[]
  });
}

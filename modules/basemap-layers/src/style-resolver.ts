import {BasemapStyleSchema, ResolvedBasemapStyleSchema} from './map-style-schema';

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
  /** Style layer type such as `background`, `fill`, `line`, `symbol`, or `raster`. */
  type: string;
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
export type ResolvedBasemapStyle = BasemapStyle & {
  /** Fully resolved source definitions. */
  sources: Record<string, BasemapSource>;
  /** Style layers copied into a mutable array. */
  layers: BasemapStyleLayer[];
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
  return Array.isArray(tiles) ? tiles.map((tile) => normalizeUrl(tile, baseUrl) || tile) : tiles;
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

/** Resolves a single source, including optional TileJSON indirection. */
async function resolveSource(
  source: BasemapSource | undefined,
  baseUrl: string | undefined,
  loadOptions?: BasemapLoadOptions
) {
  if (!source) {
    return source;
  }

  const resolvedSource: BasemapSource = {...source};
  let sourceBaseUrl = baseUrl;

  if (resolvedSource.url) {
    const tileJsonUrl = normalizeUrl(resolvedSource.url, baseUrl);
    const tileJson = await fetchJson(tileJsonUrl || resolvedSource.url, loadOptions);
    Object.assign(resolvedSource, tileJson);
    resolvedSource.url = tileJsonUrl;
    sourceBaseUrl = tileJsonUrl;
  }

  if (resolvedSource.tiles) {
    resolvedSource.tiles = normalizeTiles(resolvedSource.tiles, sourceBaseUrl);
  }

  return resolvedSource;
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
      resolvedSources[sourceId] = (await resolveSource(source, baseUrl, loadOptions)) || {};
    })
  );

  return ResolvedBasemapStyleSchema.parse({
    ...styleDefinition,
    sources: resolvedSources,
    layers: [...(styleDefinition.layers || [])]
  });
}

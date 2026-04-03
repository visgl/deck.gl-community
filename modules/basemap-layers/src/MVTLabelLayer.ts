import {CompositeLayer} from '@deck.gl/core';
import type {UpdateParameters} from '@deck.gl/core';
import {CollisionFilterExtension} from '@deck.gl/extensions';
import {GeoJsonLayer, TextLayer} from '@deck.gl/layers';

type GeometryType = 'Point' | 'MultiPoint' | 'LineString' | 'MultiLineString' | string;

type FeatureGeometry = {
  type: GeometryType;
  coordinates: any;
};

type FeatureLike = {
  geometry: FeatureGeometry;
  properties?: Record<string, any>;
};

type LabelRow = {
  position: number[];
};

type StyleLayerLike = {
  layout?: Record<string, any>;
};

type LabelConfig = {
  labels?: boolean;
};

/**
 * Props accepted by {@link MVTLabelLayer}.
 */
export type MVTLabelLayerProps = {
  /** Decoded vector-tile features or a feature-collection-like object. */
  data?: {features?: FeatureLike[]} | FeatureLike[];
  /** Label rendering enablement for the current basemap mode. */
  config: LabelConfig;
  /** Style layer that contributes label rules. */
  styleLayer?: StyleLayerLike;
  /** Zoom level used to resolve stop-based style values. */
  zoom?: number;
  /** Text fill color. */
  textColor?: number[];
  /** Optional text halo/background color. */
  labelBackground?: number[] | null;
  /** Text size units forwarded to `TextLayer`. */
  labelSizeUnits?: 'pixels' | 'meters' | 'common';
  /** Font family used by `TextLayer`. */
  fontFamily?: string;
  /** Enables billboard rendering in the text sublayer. */
  billboard?: boolean;
  /** When `true`, renders the source geometries for debugging. */
  renderGeometry?: boolean;
  /** Additional extension instances passed through to the text sublayer. */
  extensions?: any[];
  /** Active basemap mode. */
  mode?: 'map' | 'globe';
};

type MVTLabelLayerState = {
  /** Flattened label rows generated from the current tile data. */
  labelData?: LabelRow[];
};

/**
 * Evaluates a style value that may contain stop definitions.
 */
function evaluateStyleValue(value: unknown, zoom: number): unknown {
  if (typeof value === 'number' || typeof value === 'string') {
    return value;
  }

  if (value && typeof value === 'object' && Array.isArray((value as {stops?: unknown[]}).stops)) {
    let resolved = (value as {stops: [number, unknown][]}).stops[0]?.[1];
    for (const stop of (value as {stops: [number, unknown][]}).stops) {
      if (zoom >= stop[0]) {
        resolved = stop[1];
      }
    }
    return resolved;
  }

  return value;
}

/**
 * Replaces style-spec token placeholders in a label template.
 */
function resolveTokenString(template: unknown, properties?: Record<string, any>): string | null {
  if (typeof template !== 'string') {
    return null;
  }

  return template.replace(/\{([^}]+)\}/g, (_, token) => {
    const value = properties?.[token];
    return value === null || value === undefined ? '' : String(value);
  });
}

/**
 * Returns a midpoint for a line geometry.
 */
function getLineMidpoint(coordinates: number[][]): number[] | null {
  if (!Array.isArray(coordinates) || coordinates.length === 0) {
    return null;
  }

  return coordinates[Math.floor(coordinates.length / 2)] || coordinates[0] || null;
}

/**
 * Returns a coarse collision priority for a label feature.
 */
function getCollisionPriority(feature: FeatureLike): number {
  const properties = feature?.properties || {};

  if (properties.capital > 0 || properties.class === 'country') {
    return 1000;
  }
  if (properties.class === 'state' || properties.class === 'city') {
    return 750;
  }
  if (properties.layerName === 'water_name' || properties.layerName === 'waterway') {
    return 400;
  }

  return 100;
}

/**
 * Renders label text for decoded vector-tile features, with optional geometry
 * passthrough for debugging.
 */
export class MVTLabelLayer extends CompositeLayer<MVTLabelLayerProps> {
  /** Deck.gl layer name. */
  static layerName = 'MVTLabelLayer';

  /** Default props for {@link MVTLabelLayer}. */
  static defaultProps = {
    ...GeoJsonLayer.defaultProps,
    billboard: true,
    renderGeometry: false,
    labelSizeUnits: 'pixels',
    labelBackground: {type: 'color', value: null, optional: true},
    fontFamily: 'Monaco, monospace'
  };

  /** Current label-row state. */
  declare state: MVTLabelLayerState;

  /**
   * Extracts the visible label text for a decoded feature.
   */
  getLabel(feature: FeatureLike): string | undefined {
    const {styleLayer, zoom = 0} = this.props;
    const textField = evaluateStyleValue(styleLayer?.layout?.['text-field'], zoom);
    const label = resolveTokenString(textField, feature.properties)?.trim();
    return label || undefined;
  }

  /**
   * Returns the font size for a decoded feature label.
   */
  getLabelSize(_feature: FeatureLike): number {
    const {styleLayer, zoom = 0} = this.props;
    return Number(evaluateStyleValue(styleLayer?.layout?.['text-size'], zoom) || 14);
  }

  /**
   * Returns the text color for a decoded feature label.
   */
  getLabelColor(_feature: FeatureLike): number[] {
    return this.props.textColor || [255, 255, 255];
  }

  /**
   * Extracts candidate label anchor positions from a feature geometry.
   */
  getLabelAnchors(feature: FeatureLike): number[][] {
    const {type, coordinates} = feature.geometry;
    switch (type) {
      case 'Point':
        return [coordinates];
      case 'MultiPoint':
        return coordinates;
      case 'LineString': {
        const midpoint = getLineMidpoint(coordinates);
        return midpoint ? [midpoint] : [];
      }
      case 'MultiLineString': {
        const midpoint = getLineMidpoint(coordinates[0]);
        return midpoint ? [midpoint] : [];
      }
      default:
        return [];
    }
  }

  /**
   * Recomputes label anchor rows when the source tile data changes.
   */
  updateState({changeFlags}: UpdateParameters<this>): void {
    const {data} = this.props;
    if (changeFlags.dataChanged && data) {
      const features = Array.isArray(data) ? data : data.features || [];
      const labelData = features.flatMap((feature, index) => {
        const labelAnchors = this.getLabelAnchors(feature);
        return labelAnchors.map((position) => this.getSubLayerRow({position}, feature, index));
      });

      this.setState({labelData});
    }
  }

  /**
   * Renders the optional debug geometry and the text labels.
   */
  renderLayers(): any {
    const {config, labelSizeUnits, labelBackground, billboard, renderGeometry} = this.props;
    const layers: any[] = [];

    if (renderGeometry) {
      layers.push(
        new GeoJsonLayer({
          ...this.props,
          ...this.getSubLayerProps({id: 'geojson'}),
          data: this.props.data
        })
      );
    }

    if (config.labels) {
      const hasBackground = Array.isArray(labelBackground) && labelBackground.length >= 3;
      layers.push(
        new TextLayer({
          ...this.getSubLayerProps({id: 'text'}),
          data: this.state.labelData,
          extensions: [...(this.props.extensions || []), new CollisionFilterExtension()],
          parameters: {
            depthTest: false
          },
          billboard,
          characterSet: 'auto',
          collisionEnabled: true,
          collisionGroup: 'basemap-labels',
          getCollisionPriority: this.getSubLayerAccessor((feature: FeatureLike) =>
            getCollisionPriority(feature)
          ) as any,
          fontFamily: this.props.fontFamily,
          sizeUnits: labelSizeUnits,
          background: hasBackground,
          getBackgroundColor: (hasBackground ? labelBackground : [0, 0, 0, 0]) as any,
          getPosition: (d: LabelRow) => d.position,
          getText: this.getSubLayerAccessor((feature: FeatureLike) =>
            this.getLabel(feature)
          ) as any,
          getSize: this.getSubLayerAccessor((feature: FeatureLike) =>
            this.getLabelSize(feature)
          ) as any,
          getColor: this.getSubLayerAccessor((feature: FeatureLike) =>
            this.getLabelColor(feature)
          ) as any
        })
      );
    }

    return layers;
  }
}

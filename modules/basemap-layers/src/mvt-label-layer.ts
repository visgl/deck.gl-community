import {CompositeLayer} from '@deck.gl/core';
import type {DefaultProps, UpdateParameters} from '@deck.gl/core';
import {CollisionFilterExtension} from '@deck.gl/extensions';
import {GeoJsonLayer, TextLayer} from '@deck.gl/layers';
import {getZoomBucket, withOpacity} from './style-accessor';
import {getCompiledStyleProperty, type CompiledStyleProperty} from './style-expression';

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
  paint?: Record<string, any>;
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
  /** Zoom level used to evaluate style expressions. */
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

const geoJsonDefaultProps = {...GeoJsonLayer.defaultProps} as Omit<
  typeof GeoJsonLayer.defaultProps,
  'data'
>;
delete (geoJsonDefaultProps as typeof GeoJsonLayer.defaultProps).data;

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
  static defaultProps: DefaultProps<MVTLabelLayerProps> = {
    ...geoJsonDefaultProps,
    billboard: true,
    renderGeometry: false,
    labelSizeUnits: 'pixels',
    labelBackground: {type: 'color', value: null, optional: true},
    fontFamily: 'Monaco, monospace'
  };

  /** Current label-row state. */
  state: MVTLabelLayerState = undefined!;

  /** Returns a compiled `layout` or `paint` property of the style layer, if it sets one. */
  private getStyleProperty(propertyName: string): CompiledStyleProperty | null {
    const {styleLayer} = this.props;
    return styleLayer ? getCompiledStyleProperty(styleLayer, propertyName) : null;
  }

  /** Evaluates a style property for a feature at the integer zoom. */
  private evaluateStyleProperty(propertyName: string, feature: FeatureLike): unknown {
    return this.getStyleProperty(propertyName)?.evaluate(
      getZoomBucket(this.props.zoom || 0),
      feature
    );
  }

  /**
   * Extracts the visible label text for a decoded feature. Legacy `{token}` placeholders are
   * resolved only in literal and zoom-function values, as in the style specification.
   */
  getLabel(feature: FeatureLike): string | undefined {
    const textField = this.getStyleProperty('text-field');
    if (!textField) {
      return undefined;
    }

    const value = this.evaluateStyleProperty('text-field', feature);
    const text = value === null || value === undefined ? '' : String(value);
    const isExpression = Array.isArray(this.props.styleLayer?.layout?.['text-field']);
    const label =
      isExpression || textField.isFeatureDependent
        ? text.trim()
        : resolveTokenString(text, feature.properties)?.trim();
    return label || undefined;
  }

  /**
   * Returns the font size for a decoded feature label.
   */
  getLabelSize(feature: FeatureLike): number {
    return Number(this.evaluateStyleProperty('text-size', feature) || 14);
  }

  /**
   * Returns the text color for a decoded feature label, from `text-color` and `text-opacity`.
   * Falls back to the `textColor` prop when the style layer does not set `text-color`.
   */
  getLabelColor(feature: FeatureLike): number[] {
    const textColor = this.evaluateStyleProperty('text-color', feature) as number[] | undefined;
    const opacity = this.evaluateStyleProperty('text-opacity', feature) as number | undefined;
    if (textColor) {
      return withOpacity(textColor, opacity ?? 1);
    }

    const fallbackColor = this.props.textColor || [255, 255, 255];
    return opacity === undefined ? fallbackColor : withOpacity(fallbackColor, opacity);
  }

  /**
   * Returns the collision priority of a label: from `symbol-sort-key` when the style layer sets
   * one, otherwise a coarse built-in priority. Lower sort keys win in the style specification,
   * while higher priorities win in `CollisionFilterExtension`, so the sort key is negated.
   */
  getLabelCollisionPriority(feature: FeatureLike): number {
    if (!this.getStyleProperty('symbol-sort-key')) {
      return getCollisionPriority(feature);
    }
    return -(Number(this.evaluateStyleProperty('symbol-sort-key', feature)) || 0);
  }

  /** Update triggers for the text accessors: the integer zoom for zoom-dependent properties. */
  getLabelUpdateTriggers(): Record<string, number | undefined> {
    const zoomBucket = getZoomBucket(this.props.zoom || 0);
    const getTrigger = (...propertyNames: string[]) =>
      propertyNames.some(name => this.getStyleProperty(name)?.isZoomDependent)
        ? zoomBucket
        : undefined;

    return {
      getText: getTrigger('text-field'),
      getSize: getTrigger('text-size'),
      getColor: getTrigger('text-color', 'text-opacity'),
      getCollisionPriority: getTrigger('symbol-sort-key')
    };
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
        return labelAnchors.map(position => this.getSubLayerRow({position}, feature, index));
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
            this.getLabelCollisionPriority(feature)
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
          ) as any,
          updateTriggers: this.getLabelUpdateTriggers()
        })
      );
    }

    return layers;
  }
}

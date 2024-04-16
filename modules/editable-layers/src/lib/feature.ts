import {Feature as GeoJson} from '../geojson-types';

import {Style} from '../types';

export default class Feature {
  // geo json coordinates
  geoJson: GeoJson;
  style: Style;
  original: any | null | undefined;
  metadata: Record<string, any>;

  constructor(
    geoJson: GeoJson,
    style: Style,
    original: any | null | undefined = null,
    metadata: Record<string, any> = {}
  ) {
    this.geoJson = geoJson;
    this.style = style;
    this.original = original;
    this.metadata = metadata;
  }

  getCoords() {
    return this.geoJson.geometry.coordinates;
  }
}

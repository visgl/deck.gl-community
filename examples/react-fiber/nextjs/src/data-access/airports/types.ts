export interface AirportProperties {
  OBJECTID: number;
  IDENT: string;
  NAME: string;
  LATITUDE: number;
  LONGITUDE: number;
  ELEVATION: number;
  TYPE_CODE: string;
}

export interface AirportFeature {
  type: 'Feature';
  geometry: {
    type: 'Point';
    coordinates: [number, number];
  };
  properties: AirportProperties;
}

export interface AirportsGeoJSON {
  type: 'FeatureCollection';
  features: AirportFeature[];
}

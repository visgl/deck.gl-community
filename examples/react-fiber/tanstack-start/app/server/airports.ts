import {createServerFn} from '@tanstack/start';
import {zodValidator} from '@tanstack/zod-adapter';
import {z} from 'zod';

// Types
export interface Airport {
  id: number;
  name: string;
  ident: string;
  city: string;
  state: string;
  latitude: number;
  longitude: number;
  elevation: number;
  typeCode: string;
  coordinates: [number, number];
}

interface AirportProperties {
  OBJECTID: number;
  IDENT: string;
  NAME: string;
  CITY: string;
  STATE: string;
  LATITUDE: number;
  LONGITUDE: number;
  ELEVATION: number;
  TYPE_CODE: string;
}

interface AirportFeature {
  type: 'Feature';
  geometry: {
    type: 'Point';
    coordinates: [number, number];
  };
  properties: AirportProperties;
}

interface AirportsGeoJSON {
  type: 'FeatureCollection';
  features: AirportFeature[];
}

// API URL
const API_URL =
  'https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/US_Airport/FeatureServer/0/query';

// Server function to get airports list
export const getAirports = createServerFn({method: 'GET'})
  .validator(
    zodValidator(
      z.object({
        search: z.string().optional()
      })
    )
  )
  .handler(async ({data}) => {
    try {
      let where = '1=1';

      // Apply server-side filtering
      if (data.search && data.search.trim()) {
        const term = data.search.trim().toUpperCase();
        where = `(NAME LIKE '%${term}%' OR IDENT LIKE '%${term}%')`;
      }

      const params = new URLSearchParams({
        outFields: '*',
        where,
        f: 'geojson'
      });

      const response = await fetch(`${API_URL}?${params.toString()}`);

      if (!response.ok) {
        throw new Error(`Failed to fetch airports: ${response.statusText}`);
      }

      const json = (await response.json()) as AirportsGeoJSON;
      return json.features.map(feature => ({
        city: feature.properties.CITY,
        coordinates: feature.geometry.coordinates,
        elevation: feature.properties.ELEVATION,
        id: feature.properties.OBJECTID,
        ident: feature.properties.IDENT,
        latitude: feature.properties.LATITUDE,
        longitude: feature.properties.LONGITUDE,
        name: feature.properties.NAME,
        state: feature.properties.STATE,
        typeCode: feature.properties.TYPE_CODE
      }));
    } catch (error) {
      throw new Error(
        `Error fetching airports: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  });

// Server function to get single airport by ID
export const getAirportById = createServerFn({method: 'GET'})
  .validator(
    zodValidator(
      z.object({
        id: z.string()
      })
    )
  )
  .handler(async ({data}) => {
    try {
      const params = new URLSearchParams({
        outFields: '*',
        where: `OBJECTID=${data.id}`,
        f: 'geojson'
      });

      const response = await fetch(`${API_URL}?${params.toString()}`);

      if (!response.ok) {
        throw new Error(`Failed to fetch airport: ${response.statusText}`);
      }

      const json = (await response.json()) as AirportsGeoJSON;
      const feature = json.features[0];

      if (!feature) {
        throw new Error(`Airport with ID ${data.id} not found`);
      }

      return {
        city: feature.properties.CITY,
        coordinates: feature.geometry.coordinates,
        elevation: feature.properties.ELEVATION,
        id: feature.properties.OBJECTID,
        ident: feature.properties.IDENT,
        latitude: feature.properties.LATITUDE,
        longitude: feature.properties.LONGITUDE,
        name: feature.properties.NAME,
        state: feature.properties.STATE,
        typeCode: feature.properties.TYPE_CODE
      };
    } catch (error) {
      throw new Error(
        `Error fetching airport: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  });

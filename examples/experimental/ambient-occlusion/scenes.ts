// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  AmbientLight,
  DirectionalLight,
  LightingEffect,
  type Layer,
  type MapViewState
} from '@deck.gl/core';
import {TerrainLayer} from '@deck.gl/geo-layers';
import {ColumnLayer, SolidPolygonLayer} from '@deck.gl/layers';
import {SimpleMeshLayer} from '@deck.gl/mesh-layers';
import {A5Grid, GlobalGridLayer} from '@deck.gl-community/geo-layers';
import {CubeGeometry, SphereGeometry} from '@luma.gl/engine';

/** The ids of the test scenes. */
export type SceneId = 'city' | 'terrain' | 'primitives' | 'bike-parking';

/** One test scene of the example. */
export type Scene = {
  id: SceneId;
  /** Name in the scene selector. */
  label: string;
  /** What to look at in the scene. */
  description: string;
  /** Data attribution to show on the map, or an empty string. */
  attribution: string;
  /** Initial camera. */
  viewState: MapViewState;
  /** Scene lighting. `null` uses the deck.gl default lighting. */
  lighting: LightingEffect | null;
  /** Creates the layers. `onReady` is called once, when the first frame with all data is drawn. */
  createLayers: (onReady: () => void) => Layer[];
};

const DATA_ROOT = 'https://raw.githubusercontent.com/visgl/deck.gl-data/master';

/** Building footprints of lower Manhattan, from the deck.gl `trips` example. */
const BUILDINGS_URL = `${DATA_ROOT}/examples/trips/buildings.json`;

/** San Francisco bike parking counts per A5 cell. The global-grid-layer docs use the same file. */
const BIKE_PARKING_URL = `${DATA_ROOT}/website/sf.bike.parking.a5.json`;

/** AWS Terrain Tiles (Terrarium encoding). */
const TERRAIN_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

/** Decodes Terrarium RGB to meters. */
const TERRARIUM_DECODER = {rScaler: 256, gScaler: 1, bScaler: 1 / 256, offset: -32768};

/** Calls `onReady` after the next two frames, so that the new data is on screen. */
function afterNextFrame(onReady: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(onReady));
}

/** The material props of the lit layers. */
type Material = {
  ambient: number;
  diffuse: number;
  shininess: number;
  specularColor: [number, number, number];
};

/** A rectangle polygon from its south-west and north-east corners. */
function rectangle(
  [west, south]: readonly number[],
  [east, north]: readonly number[]
): [number, number][][] {
  return [
    [
      [west, south],
      [east, south],
      [east, north],
      [west, north]
    ]
  ];
}

/**
 * Ambient light and a low sun. Ambient light fills the shadows, so the occlusion shows there.
 * The sum stays below 1 on lit faces: a clipped color turns olive when the effect darkens it.
 */
function createLowSunLighting(direction: [number, number, number]): LightingEffect {
  return new LightingEffect({
    ambient: new AmbientLight({color: [255, 255, 255], intensity: 1}),
    sun: new DirectionalLight({color: [255, 240, 220], intensity: 0.9, direction})
  });
}

/** One building of the `trips` example data. */
type Building = {height: number; polygon: [number, number][]};

const city: Scene = {
  id: 'city',
  label: '3D city buildings',
  description: 'Contact shadows at building bases, in courtyards and between towers.',
  attribution: 'Buildings: deck.gl trips example data',
  viewState: {
    longitude: -74.0128,
    latitude: 40.7062,
    zoom: 16.7,
    pitch: 70,
    bearing: 32,
    maxPitch: 85
  },
  lighting: createLowSunLighting([-2, 1, -0.45]),
  createLayers: onReady => [
    new SolidPolygonLayer({
      id: 'city-ground',
      data: rectangle([-74.03, 40.69], [-73.96, 40.8]),
      getPolygon: polygon => polygon,
      getFillColor: [222, 220, 214]
    }),
    new SolidPolygonLayer<Building>({
      id: 'city-buildings',
      data: BUILDINGS_URL,
      extruded: true,
      getPolygon: building => building.polygon,
      getElevation: building => building.height,
      getFillColor: [238, 234, 226],
      material: {ambient: 0.35, diffuse: 0.6, shininess: 16, specularColor: [40, 40, 40]},
      onDataLoad: () => afterNextFrame(onReady)
    })
  ]
};

const terrain: Scene = {
  id: 'terrain',
  label: 'Terrain (Grand Canyon)',
  description: 'Valleys, side canyons and ridge lines at a high pitch.',
  attribution:
    'AWS Terrain Tiles. United States 3DEP (formerly NED) and global GMTED2010 and SRTM ' +
    'terrain data courtesy of the U.S. Geological Survey',
  viewState: {
    longitude: -112.09,
    latitude: 36.135,
    zoom: 12.7,
    pitch: 62,
    bearing: 10,
    maxPitch: 85
  },
  lighting: createLowSunLighting([1, 2, -0.6]),
  createLayers: onReady => {
    // TerrainLayer does not forward `onViewportLoad`. The scene is ready when no tile has
    // loaded for one second.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let isReady = false;
    return [
      new TerrainLayer({
        id: 'terrain',
        elevationData: TERRAIN_URL,
        elevationDecoder: TERRARIUM_DECODER,
        maxZoom: 14,
        meshMaxError: 2,
        color: [214, 186, 152],
        material: {ambient: 0.35, diffuse: 0.65, shininess: 8, specularColor: [20, 20, 20]},
        onTileLoad: () => {
          clearTimeout(timer);
          timer = setTimeout(() => {
            if (!isReady) {
              isReady = true;
              afterNextFrame(onReady);
            }
          }, 1000);
        }
      })
    ];
  }
};

/** The geographic origin of the procedural scene. */
const PRIMITIVES_ORIGIN: [number, number] = [-0.0005, 0.0005];
const METERS_PER_DEGREE = 111320;

/** Converts meter offsets from the procedural scene origin to longitude and latitude. */
function fromMeters(x: number, y: number, z = 0): [number, number, number] {
  return [
    PRIMITIVES_ORIGIN[0] + x / METERS_PER_DEGREE,
    PRIMITIVES_ORIGIN[1] + y / METERS_PER_DEGREE,
    z
  ];
}

/** A seeded random number generator, so that the scene is the same in every run. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

type Column = {position: [number, number, number]; height: number; color: [number, number, number]};
type Mesh = {
  position: [number, number, number];
  scale: [number, number, number];
  orientation: [number, number, number];
  color: [number, number, number];
};

/** A grid of columns with random heights, tight rows of spheres, and stacks of boxes. */
function createPrimitives(): {columns: Column[]; spheres: Mesh[]; boxes: Mesh[]} {
  const random = createRandom(7);
  const columns: Column[] = [];
  const spheres: Mesh[] = [];
  const boxes: Mesh[] = [];
  // A 16 x 16 grid of columns, 5 m apart, with gaps of 1 m to 3 m between them.
  for (let row = 0; row < 16; row++) {
    for (let col = 0; col < 16; col++) {
      const height = 2 + random() ** 2 * 34;
      const shade = 200 + random() * 40;
      columns.push({
        position: fromMeters(-60 + col * 5, -40 + row * 5),
        height,
        color: [shade, shade * 0.97, shade * 0.92]
      });
      // Some columns carry a sphere on top.
      if (random() < 0.15) {
        spheres.push({
          position: fromMeters(-60 + col * 5, -40 + row * 5, height + 1.8),
          scale: [1.8, 1.8, 1.8],
          orientation: [0, 0, 0],
          color: [180, 205, 230]
        });
      }
    }
  }
  // Rows of spheres that touch each other and the ground.
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 10; col++) {
      const radius = 1 + random() * 1.5;
      spheres.push({
        position: fromMeters(30 + col * 4, -40 + row * 5, radius),
        scale: [radius, radius, radius],
        orientation: [0, 0, 0],
        color: [235, 205, 170]
      });
    }
  }
  // Stacks of boxes with steps and narrow slots between them.
  for (let stack = 0; stack < 8; stack++) {
    const x = 30 + (stack % 4) * 10;
    const y = 0 + Math.floor(stack / 4) * 12;
    let z = 0;
    for (let level = 0; level < 5; level++) {
      const size = 8 - level * 1.4;
      const height = 1.5 + random() * 2;
      boxes.push({
        position: fromMeters(x + random() - 0.5, y + random() - 0.5, z + height / 2),
        scale: [size / 2, size / 2, height / 2],
        orientation: [0, random() * 40 - 20, 0],
        color: [205, 215, 200]
      });
      z += height;
    }
  }
  return {columns, spheres, boxes};
}

const primitives: Scene = {
  id: 'primitives',
  label: 'Dense primitives',
  description: 'Crevices, gaps between columns, and sphere contact points.',
  attribution: '',
  viewState: {
    longitude: PRIMITIVES_ORIGIN[0] + -5 / METERS_PER_DEGREE,
    latitude: PRIMITIVES_ORIGIN[1] + -25 / METERS_PER_DEGREE,
    zoom: 19.7,
    pitch: 62,
    bearing: 25,
    maxPitch: 85
  },
  lighting: createLowSunLighting([-1, 2, -0.7]),
  createLayers: onReady => {
    const {columns, spheres, boxes} = createPrimitives();
    afterNextFrame(onReady);
    const material: Material = {
      ambient: 0.35,
      diffuse: 0.6,
      shininess: 24,
      specularColor: [50, 50, 50]
    };
    return [
      new SolidPolygonLayer({
        id: 'primitives-ground',
        data: rectangle(fromMeters(-200, -200), fromMeters(200, 200)),
        getPolygon: polygon => polygon,
        getFillColor: [226, 224, 218]
      }),
      new ColumnLayer<Column>({
        id: 'primitives-columns',
        data: columns,
        diskResolution: 12,
        radius: 1.6,
        extruded: true,
        getPosition: column => column.position,
        getElevation: column => column.height,
        getFillColor: column => column.color,
        material
      }),
      new SimpleMeshLayer<Mesh>({
        id: 'primitives-spheres',
        data: spheres,
        mesh: new SphereGeometry({nlat: 24, nlong: 32}),
        getPosition: mesh => mesh.position,
        getScale: mesh => mesh.scale,
        getOrientation: mesh => mesh.orientation,
        getColor: mesh => mesh.color,
        material
      }),
      new SimpleMeshLayer<Mesh>({
        id: 'primitives-boxes',
        data: boxes,
        mesh: new CubeGeometry(),
        getPosition: mesh => mesh.position,
        getScale: mesh => mesh.scale,
        getOrientation: mesh => mesh.orientation,
        getColor: mesh => mesh.color,
        material
      })
    ];
  }
};

/** One A5 cell of the bike parking data. */
type BikeParkingCell = {pentagon: string; count: number};

const bikeParking: Scene = {
  id: 'bike-parking',
  label: 'SF bike parking (A5 cells)',
  description: 'The first test scene: extruded A5 cells over a flat ground.',
  attribution: 'Bike parking: deck.gl example data',
  viewState: {
    longitude: -122.418,
    latitude: 37.772,
    zoom: 13.2,
    pitch: 60,
    bearing: -25
  },
  lighting: null,
  createLayers: onReady => [
    new SolidPolygonLayer({
      id: 'bike-parking-ground',
      data: rectangle([-122.53, 37.69], [-122.35, 37.83]),
      getPolygon: polygon => polygon,
      getFillColor: [236, 233, 226]
    }),
    new GlobalGridLayer<BikeParkingCell>({
      id: 'bike-parking',
      data: BIKE_PARKING_URL,
      globalGrid: A5Grid,
      extruded: true,
      getCellId: cell => cell.pentagon,
      getFillColor: cell => {
        const value = cell.count / 211;
        return [(1 - value) * 235, 255 - 85 * value, 255 - 170 * value];
      },
      getElevation: cell => cell.count,
      elevationScale: 4,
      onDataLoad: () => afterNextFrame(onReady)
    })
  ]
};

/** All scenes, in selector order. */
export const SCENES: readonly Scene[] = [city, terrain, primitives, bikeParking];

/** Gets a scene by id. Unknown ids get the first scene. */
export function getScene(id: string | null | undefined): Scene {
  return SCENES.find(scene => scene.id === id) ?? SCENES[0];
}

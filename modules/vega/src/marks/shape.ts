// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {base} from '../base';
import {colorFromString} from '../color';
import type {Vec3, Polygon, Path} from '../interfaces';
import type {MarkStager} from './interfaces';
import type {SceneItem} from 'vega';

interface PathContext {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  arc(x: number, y: number, radius: number, start: number, end: number): void;
}
type ShapeGenerator = {context(context: PathContext | null): (item: SceneItem) => void};
type ShapeItem = SceneItem & {
  mark: SceneItem['mark'] & {shape?: ShapeGenerator};
  shape?: ShapeGenerator;
  x?: number;
  y?: number;
  angle?: number;
  scaleX?: number;
  scaleY?: number;
  fill?: string;
  stroke?: string;
  opacity?: number;
  fillOpacity?: number;
  strokeOpacity?: number;
  strokeWidth?: number;
};

type Contour = {positions: Vec3[]; closed: boolean};

/** Collects Vega's projected, resampled and clipped geoshape canvas commands. */
const stageShape: MarkStager = (_options, stage, scene, x, y) => {
  const geographicData = stage.geographicData ?? [];
  stage.geographicData = geographicData;
  base.vega.sceneVisit(scene, (item: ShapeItem) => {
    const shape = item.mark.shape || item.shape;
    if (typeof shape?.context !== 'function') {
      throw new Error('Vega shape marks require a geoshape generator. SVG paths are unsupported.');
    }
    const contours: Contour[] = [];
    let current: Contour;
    const position = (px: number, py: number): Vec3 => {
      const angle = ((item.angle ?? 0) * Math.PI) / 180;
      const dx = px * (item.scaleX ?? 1),
        dy = py * (item.scaleY ?? 1);
      return [
        x + (item.x || 0) + dx * Math.cos(angle) - dy * Math.sin(angle),
        -(y + (item.y || 0) + dx * Math.sin(angle) + dy * Math.cos(angle)),
        0
      ];
    };
    const context = {
      moveTo(px: number, py: number) {
        current = {positions: [position(px, py)], closed: false};
        contours.push(current);
      },
      lineTo(px: number, py: number) {
        current.positions.push(position(px, py));
      },
      closePath() {
        current.closed = true;
      },
      // GeoJSON points are emitted as full circles by Vega's projection path.
      arc(cx: number, cy: number, radius: number, start: number, end: number) {
        const points = Array.from({length: 49}, (_, i) => {
          const angle = start + ((end - start) * i) / 48;
          return position(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle));
        });
        current.positions = points;
        current.closed = true;
      }
    };
    try {
      shape.context(context)(item);
    } finally {
      // GeoShape shares a projection path; never leave our context attached.
      shape.context(null);
    }
    const fillColor = colorFromString(item.fill) || [0, 0, 0, 0];
    const strokeColor = colorFromString(item.stroke) || [0, 0, 0, 0];
    fillColor[3] *= (item.opacity ?? 1) * (item.fillOpacity ?? 1);
    strokeColor[3] *= (item.opacity ?? 1) * (item.strokeOpacity ?? 1);
    const rings = contours.filter(c => c.closed && c.positions.length >= 3);
    // Ring containment handles disconnected polygons and holes independent of winding.
    const areas = rings.map(ring => Math.abs(getRingArea(ring.positions)));
    const bounds = rings.map(ring =>
      ring.positions.reduce(
        (bounds, p) => [
          Math.min(bounds[0], p[0]),
          Math.min(bounds[1], p[1]),
          Math.max(bounds[2], p[0]),
          Math.max(bounds[3], p[1])
        ],
        [Infinity, Infinity, -Infinity, -Infinity]
      )
    );
    const parents = rings.map((ring, index) => {
      const containers = rings
        .map((candidate, i) => i)
        .filter(
          i =>
            i !== index &&
            areas[i] > areas[index] &&
            ring.positions[0][0] >= bounds[i][0] &&
            ring.positions[0][0] <= bounds[i][2] &&
            ring.positions[0][1] >= bounds[i][1] &&
            ring.positions[0][1] <= bounds[i][3] &&
            containsPoint(rings[i].positions, ring.positions[0])
        );
      return containers.sort((a, b) => areas[a] - areas[b])[0];
    });
    const getDepth = (index: number): number =>
      parents[index] === undefined ? 0 : 1 + getDepth(parents[index]);
    rings.forEach((ring, index) => {
      if (getDepth(index) % 2) return;
      const polygon: Polygon = {
        isGeographic: true,
        datum: item.datum,
        positions: [
          ring.positions,
          ...rings.filter((_, i) => parents[i] === index).map(hole => hole.positions)
        ],
        fillColor,
        strokeColor,
        strokeWidth: item.strokeWidth ?? 1,
        depth: 0
      };
      stage.polygonData.push(polygon);
      geographicData.push({type: 'polygon', data: polygon});
    });
    contours
      .filter(c => !c.closed && c.positions.length >= 2)
      .forEach(contour => {
        const path: Path = {
          isGeographic: true,
          datum: item.datum,
          positions: contour.positions,
          strokeColor,
          strokeWidth: item.strokeWidth ?? 1
        };
        stage.pathData.push(path);
        geographicData.push({type: 'path', data: path});
      });
  });
};

function getRingArea(ring: Vec3[]) {
  return (
    ring.reduce((area, point, index) => {
      const next = ring[(index + 1) % ring.length];
      return area + point[0] * next[1] - next[0] * point[1];
    }, 0) / 2
  );
}

function containsPoint(ring: Vec3[], point: Vec3) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}

export default stageShape;

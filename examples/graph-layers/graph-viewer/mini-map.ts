// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Viewport} from '@deck.gl/core';
import type {GraphEngine} from '@deck.gl-community/graph-layers';

type Point = [number, number];
const WIDTH = 200;
const HEIGHT = 150;
const PADDING = 12;

/** A small canvas overview sharing the main graph's layout coordinates. */
export function createMiniMap(parent: HTMLElement, onRecenter: (target: Point) => void) {
  const canvas = parent.ownerDocument.createElement('canvas');
  canvas.className = 'graph-mini-map';
  canvas.setAttribute('aria-label', 'Graph overview; click to recenter');
  canvas.title = 'Click to recenter the graph';
  canvas.style.cssText =
    'position:absolute;left:16px;bottom:80px;width:200px;height:150px;' +
    'background:#f8fafc;border:1px solid #94a3b8;border-radius:8px;cursor:crosshair;z-index:1';
  canvas.hidden = true;
  parent.append(canvas);
  let transform: ReturnType<typeof fitMiniMap> = null;

  function handleClick(event: MouseEvent) {
    if (!transform) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = ((event.clientX - rect.left) * WIDTH) / rect.width;
    const y = ((event.clientY - rect.top) * HEIGHT) / rect.height;
    onRecenter(transform.unproject([x, y]));
  }
  canvas.addEventListener('click', handleClick);

  return {
    update(engine: GraphEngine | null, viewport?: Viewport) {
      const points: Point[] = [];
      for (const node of engine?.getNodes() ?? []) {
        const point = engine!.getNodePosition(node);
        if (point && Number.isFinite(point[0]) && Number.isFinite(point[1])) {
          points.push([point[0], point[1]]);
        }
      }
      transform = fitMiniMap(points);
      canvas.hidden = !transform;
      if (!transform) return;
      const ratio = parent.ownerDocument.defaultView?.devicePixelRatio ?? 1;
      const pixelWidth = Math.round(WIDTH * ratio);
      const pixelHeight = Math.round(HEIGHT * ratio);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      const context = canvas.getContext('2d');
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, WIDTH, HEIGHT);
      context.fillStyle = '#475569';
      for (const point of points) {
        const [x, y] = transform.project(point);
        context.fillRect(x - 1.5, y - 1.5, 3, 3);
      }
      if (viewport) {
        const corners = [
          [0, 0],
          [viewport.width, 0],
          [viewport.width, viewport.height],
          [0, viewport.height]
        ];
        context.beginPath();
        corners.forEach((corner, index) => {
          const world = viewport.unproject(corner);
          const [x, y] = transform!.project([world[0], world[1]]);
          if (index === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        });
        context.closePath();
        context.fillStyle = 'rgba(59,130,246,0.12)';
        context.strokeStyle = '#2563eb';
        context.fill();
        context.stroke();
      }
    },
    destroy() {
      canvas.removeEventListener('click', handleClick);
      canvas.remove();
    }
  };
}

export function fitMiniMap(points: Point[]) {
  const finitePoints = points.filter(point => point.every(Number.isFinite));
  if (!finitePoints.length) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of finitePoints) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const scale = Math.min(
    (WIDTH - 2 * PADDING) / Math.max(maxX - minX, 1),
    (HEIGHT - 2 * PADDING) / Math.max(maxY - minY, 1)
  );
  return {
    project: ([x, y]: Point): Point => [
      (x - centerX) * scale + WIDTH / 2,
      (y - centerY) * scale + HEIGHT / 2
    ],
    unproject: ([x, y]: Point): Point => [
      (x - WIDTH / 2) / scale + centerX,
      (y - HEIGHT / 2) / scale + centerY
    ]
  };
}

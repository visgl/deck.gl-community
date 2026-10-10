// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Viewport} from '@deck.gl/core';
import type {GraphEngine} from '@deck.gl-community/graph-layers';

type Point = [number, number];
const WIDTH = 200;
const HEIGHT = 150;
const PADDING = 12;

/** A cached canvas overview sharing the main graph's layout coordinates. */
export function createMiniMap(parent: HTMLElement, onRecenter: (target: Point) => void) {
  const canvas = parent.ownerDocument.createElement('canvas');
  const nodeImage = parent.ownerDocument.createElement('canvas');
  canvas.className = 'graph-mini-map';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'button');
  canvas.setAttribute('aria-label', 'Graph overview. Arrow keys move selection; Enter recenters.');
  canvas.title = 'Click to recenter, or use arrow keys and Enter';
  canvas.style.cssText =
    'position:absolute;left:16px;bottom:16px;width:200px;height:150px;' +
    'background:#f8fafc;border:1px solid #94a3b8;border-radius:8px;cursor:crosshair;z-index:1';
  canvas.hidden = true;
  parent.append(canvas);
  let transform: ReturnType<typeof fitMiniMap> = null;
  let cachedEngine: GraphEngine | null = null;
  let cachedGraphVersion = -1;
  let cachedLayoutVersion = -1;
  let cachedRatio = 0;
  let viewport: Viewport | undefined;
  let cursor: Point = [WIDTH / 2, HEIGHT / 2];

  function handleClick(event: MouseEvent) {
    if (!transform || canvas.hidden) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    cursor = [
      ((event.clientX - rect.left - canvas.clientLeft) * WIDTH) / canvas.clientWidth,
      ((event.clientY - rect.top - canvas.clientTop) * HEIGHT) / canvas.clientHeight
    ];
    onRecenter(transform.unproject(cursor));
    drawOverview();
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (!transform || canvas.hidden) return;
    const moves: Record<string, Point> = {
      ArrowLeft: [-10, 0],
      ArrowRight: [10, 0],
      ArrowUp: [0, -10],
      ArrowDown: [0, 10]
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      cursor = [
        Math.max(0, Math.min(WIDTH, cursor[0] + move[0])),
        Math.max(0, Math.min(HEIGHT, cursor[1] + move[1]))
      ];
      drawOverview();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onRecenter(transform.unproject(cursor));
    }
  }

  function handleFocus() {
    canvas.style.outline = parent.ownerDocument.activeElement === canvas ? '2px solid #2563eb' : '';
    canvas.style.outlineOffset = '2px';
    drawOverview();
  }

  function drawOverview() {
    const context = canvas.getContext('2d');
    if (!context || !transform) return;
    context.setTransform(cachedRatio, 0, 0, cachedRatio, 0, 0);
    context.clearRect(0, 0, WIDTH, HEIGHT);
    context.drawImage(nodeImage, 0, 0, WIDTH, HEIGHT);
    if (viewport) {
      const corners = [
        [0, 0],
        [viewport.width, 0],
        [viewport.width, viewport.height],
        [0, viewport.height]
      ];
      context.beginPath();
      corners.forEach((corner, index) => {
        const world = viewport!.unproject(corner);
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
    if (parent.ownerDocument.activeElement === canvas) {
      context.beginPath();
      context.arc(cursor[0], cursor[1], 4, 0, Math.PI * 2);
      context.fillStyle = '#dc2626';
      context.fill();
    }
  }

  canvas.addEventListener('click', handleClick);
  canvas.addEventListener('keydown', handleKeyDown);
  canvas.addEventListener('focus', handleFocus);
  canvas.addEventListener('blur', handleFocus);

  return {
    update(engine: GraphEngine | null, nextViewport?: Viewport, reservedRightWidth = 0) {
      viewport = nextViewport;
      const parentRect = parent.getBoundingClientRect();
      let left = 16;
      for (const widget of parent.querySelectorAll<HTMLElement>(
        '.deck-widget-pan,.deck-widget-zoom-range'
      )) {
        const rect = widget.getBoundingClientRect();
        if (rect.width && rect.height && rect.bottom > parentRect.bottom - HEIGHT - 16) {
          left = Math.max(left, rect.right - parentRect.left + 12);
        }
      }
      canvas.style.left = `${left}px`;
      const ratio = parent.ownerDocument.defaultView?.devicePixelRatio ?? 1;
      const graphVersion = engine?.getGraphVersion() ?? -1;
      const layoutVersion = engine?.getLayoutLastUpdate() ?? -1;
      if (
        engine !== cachedEngine ||
        graphVersion !== cachedGraphVersion ||
        layoutVersion !== cachedLayoutVersion ||
        ratio !== cachedRatio
      ) {
        cachedEngine = engine;
        cachedGraphVersion = graphVersion;
        cachedLayoutVersion = layoutVersion;
        cachedRatio = ratio;
        const points: Point[] = [];
        for (const node of engine?.getNodes() ?? []) {
          const point = engine!.getNodePosition(node);
          if (point && Number.isFinite(point[0]) && Number.isFinite(point[1]))
            points.push([point[0], point[1]]);
        }
        transform = fitMiniMap(points);
        canvas.width = nodeImage.width = Math.round(WIDTH * ratio);
        canvas.height = nodeImage.height = Math.round(HEIGHT * ratio);
        const context = nodeImage.getContext('2d');
        if (context && transform) {
          context.setTransform(ratio, 0, 0, ratio, 0, 0);
          context.fillStyle = '#475569';
          for (const point of points) {
            const [x, y] = transform.project(point);
            context.fillRect(x - 1.5, y - 1.5, 3, 3);
          }
        }
      }
      canvas.hidden = !transform || left + WIDTH + 16 > parentRect.width - reservedRightWidth;
      if (!canvas.hidden) drawOverview();
    },
    destroy() {
      canvas.removeEventListener('click', handleClick);
      canvas.removeEventListener('keydown', handleKeyDown);
      canvas.removeEventListener('focus', handleFocus);
      canvas.removeEventListener('blur', handleFocus);
      canvas.remove();
      nodeImage.width = nodeImage.height = canvas.width = canvas.height = 0;
      cachedEngine = null;
      transform = null;
      viewport = undefined;
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

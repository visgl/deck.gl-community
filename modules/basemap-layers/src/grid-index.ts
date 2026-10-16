// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * How a placed part lets others overlap it, as MapLibre GL JS's `text-overlap` / `icon-overlap`:
 * `never` overlaps nothing and is overlapped by nothing; `always` overlaps anything; `cooperative`
 * overlaps `always` and `cooperative` parts, but not `never` ones.
 */
export type OverlapMode = 'never' | 'always' | 'cooperative';

/** Whether a part placed with `mode` may overlap one placed with `placedMode`. */
export function allowsOverlap(mode: OverlapMode, placedMode: OverlapMode): boolean {
  return mode === 'always' || (mode !== 'never' && placedMode !== 'never');
}

/**
 * A grid of screen-space boxes and circles for label placement, as MapLibre GL JS's `GridIndex`:
 * the plane is cut into square cells, each holding the shapes that reach into it, so that a test
 * compares a shape only with the shapes of the cells it covers. Coordinates are pixels; a shape
 * that reaches outside the grid is clamped to its edge cells.
 */
export class GridIndex {
  readonly width: number;
  readonly height: number;
  private readonly cellSize: number;
  private readonly columns: number;
  private readonly rows: number;
  /** Per cell, the indices of the shapes in it. */
  private readonly cells: number[][];
  /** Per shape: `x1, y1, x2, y2` for a box, `x, y, radius, NaN` for a circle. */
  private readonly shapes: number[] = [];
  private readonly modes: OverlapMode[] = [];
  /** The query count at which each shape was last compared, so a query compares it once. */
  private readonly seen: number[] = [];
  private query = 0;

  constructor(width: number, height: number, cellSize: number) {
    this.width = width;
    this.height = height;
    this.cellSize = cellSize;
    this.columns = Math.max(1, Math.ceil(width / cellSize));
    this.rows = Math.max(1, Math.ceil(height / cellSize));
    this.cells = Array.from({length: this.columns * this.rows}, () => []);
  }

  /** The number of shapes inserted. */
  get size(): number {
    return this.modes.length;
  }

  /** Adds a box from `x1, y1` to `x2, y2`. */
  insert(x1: number, y1: number, x2: number, y2: number, mode: OverlapMode = 'never'): void {
    this.add([x1, y1, x2, y2], mode, x1, y1, x2, y2);
  }

  /** Adds a circle. */
  insertCircle(x: number, y: number, radius: number, mode: OverlapMode = 'never'): void {
    this.add([x, y, radius, Number.NaN], mode, x - radius, y - radius, x + radius, y + radius);
  }

  /** Whether a box placed with `mode` would overlap a shape that it may not overlap. */
  hitTest(x1: number, y1: number, x2: number, y2: number, mode: OverlapMode = 'never'): boolean {
    return this.test(x1, y1, x2, y2, mode, (sx1, sy1, sx2, sy2) =>
      Number.isNaN(sy2)
        ? circleIntersectsBox(sx1, sy1, sx2, x1, y1, x2, y2)
        : x1 <= sx2 && y1 <= sy2 && x2 >= sx1 && y2 >= sy1
    );
  }

  /** Whether a circle placed with `mode` would overlap a shape that it may not overlap. */
  hitTestCircle(x: number, y: number, radius: number, mode: OverlapMode = 'never'): boolean {
    return this.test(x - radius, y - radius, x + radius, y + radius, mode, (sx1, sy1, sx2, sy2) =>
      Number.isNaN(sy2)
        ? (sx1 - x) ** 2 + (sy1 - y) ** 2 <= (sx2 + radius) ** 2
        : circleIntersectsBox(x, y, radius, sx1, sy1, sx2, sy2)
    );
  }

  /** Whether a box lies at least partly within the grid. */
  isInside(x1: number, y1: number, x2: number, y2: number): boolean {
    return x2 >= 0 && y2 >= 0 && x1 < this.width && y1 < this.height;
  }

  private add(
    shape: number[],
    mode: OverlapMode,
    x1: number,
    y1: number,
    x2: number,
    y2: number
  ): void {
    const index = this.modes.length;
    this.shapes.push(...shape);
    this.modes.push(mode);
    this.seen.push(-1);
    this.forEachCell(x1, y1, x2, y2, cell => {
      this.cells[cell].push(index);
      return false;
    });
  }

  private test(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    mode: OverlapMode,
    intersects: (sx1: number, sy1: number, sx2: number, sy2: number) => boolean
  ): boolean {
    if (!this.isInside(x1, y1, x2, y2)) {
      return false;
    }
    const query = ++this.query;
    const {shapes, modes, seen} = this;
    return this.forEachCell(x1, y1, x2, y2, cell => {
      for (const index of this.cells[cell]) {
        if (seen[index] === query) {
          continue;
        }
        seen[index] = query;
        const offset = index * 4;
        if (
          !allowsOverlap(mode, modes[index]) &&
          intersects(shapes[offset], shapes[offset + 1], shapes[offset + 2], shapes[offset + 3])
        ) {
          return true;
        }
      }
      return false;
    });
  }

  /** Calls `visit` for each cell the box reaches, until it returns `true`. */
  private forEachCell(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    visit: (cell: number) => boolean
  ): boolean {
    const column1 = this.toCell(x1, this.columns);
    const row1 = this.toCell(y1, this.rows);
    const column2 = this.toCell(x2, this.columns);
    const row2 = this.toCell(y2, this.rows);
    for (let column = column1; column <= column2; column++) {
      for (let row = row1; row <= row2; row++) {
        if (visit(row * this.columns + column)) {
          return true;
        }
      }
    }
    return false;
  }

  private toCell(value: number, count: number): number {
    return Math.max(0, Math.min(count - 1, Math.floor(value / this.cellSize)));
  }
}

function circleIntersectsBox(
  x: number,
  y: number,
  radius: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): boolean {
  const dx = x - Math.max(x1, Math.min(x, x2));
  const dy = y - Math.max(y1, Math.min(y, y2));
  return dx * dx + dy * dy <= radius * radius;
}

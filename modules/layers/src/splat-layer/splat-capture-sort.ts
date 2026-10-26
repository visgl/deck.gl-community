// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/** Working arrays of one capture's depth sort, reused between sorts. */
export type SplatSortScratch = {
  depths: Float32Array;
  indices: Uint32Array;
  keys: Uint16Array;
  counts: Uint32Array;
};

export function createSplatSortScratch(count: number): SplatSortScratch {
  return {
    depths: new Float32Array(count),
    indices: new Uint32Array(count),
    keys: new Uint16Array(count),
    counts: new Uint32Array(65537)
  };
}

/**
 * Back-to-front order of the Gaussians in `[0, limit)` in front of the camera whose bounding
 * spheres (`support` times the largest sigma) reach the frustum, as the 3DGS rasterizer keeps any
 * Gaussian whose footprint touches the image: one 16-bit counting sort on view depth. `bounds`
 * holds XYZ and the largest sigma per Gaussian; `matrix` maps the capture's metres to clip space,
 * column major. Writes `order` and returns how many it holds.
 *
 * This function is also the sort worker's source, so it references nothing outside its body.
 */
export function sortSplatCapture(
  bounds: Float32Array,
  limit: number,
  matrix: ArrayLike<number>,
  support: number,
  order: Uint32Array,
  scratch: SplatSortScratch
): number {
  const m = matrix;
  const perspective = m[3] !== 0 || m[7] !== 0 || m[11] !== 0;
  // the side planes w + x, w - x, w + y and w - y >= 0, four coefficients each, and the length
  // of each plane's normal
  const planes = new Float64Array(16);
  const lengths = new Float64Array(4);
  for (let k = 0; k < 4; k++) {
    const axis = k < 2 ? 0 : 1;
    const sign = k % 2 ? -1 : 1;
    for (let column = 0; column < 4; column++)
      planes[k * 4 + column] = m[column * 4 + 3] + sign * m[column * 4 + axis];
    lengths[k] = Math.hypot(planes[k * 4], planes[k * 4 + 1], planes[k * 4 + 2]);
  }
  const {depths, indices, keys, counts} = scratch;
  let visible = 0;
  let near = Infinity;
  let far = -Infinity;
  for (let i = 0; i < limit; i++) {
    const x = bounds[i * 4],
      y = bounds[i * 4 + 1],
      z = bounds[i * 4 + 2];
    const reach = -support * bounds[i * 4 + 3];
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (perspective && !(w > 0)) continue;
    let inside = true;
    for (let k = 0; k < 4; k++) {
      const p = k * 4;
      if (
        !(
          planes[p] * x + planes[p + 1] * y + planes[p + 2] * z + planes[p + 3] >=
          reach * lengths[k]
        )
      ) {
        inside = false;
        break;
      }
    }
    if (!inside) continue;
    // perspective depth is w; an orthographic view's is clip z
    const depth = perspective ? w : m[2] * x + m[6] * y + m[10] * z + m[14];
    depths[visible] = depth;
    indices[visible] = i;
    visible++;
    if (depth < near) near = depth;
    if (depth > far) far = depth;
  }
  counts.fill(0);
  // key 0 is the farthest, so it draws first
  const scale = far > near ? 65535 / (far - near) : 0;
  for (let j = 0; j < visible; j++) {
    const key = ((far - depths[j]) * scale) | 0;
    keys[j] = key;
    counts[key + 1]++;
  }
  for (let key = 0; key < 65536; key++) counts[key + 1] += counts[key];
  for (let j = 0; j < visible; j++) order[counts[keys[j]]++] = indices[j];
  return visible;
}

const WORKER_SOURCE = `const sort = (${sortSplatCapture.toString()});
let bounds = null;
let scratch = null;
self.onmessage = event => {
  const message = event.data;
  if (message.bounds) {
    bounds = message.bounds;
    const count = bounds.length / 4;
    scratch = {
      depths: new Float32Array(count),
      indices: new Uint32Array(count),
      keys: new Uint16Array(count),
      counts: new Uint32Array(65537)
    };
    return;
  }
  const limit = Math.min(message.limit, bounds.length / 4);
  const length = Math.ceil(limit / message.rowLength) * message.rowLength;
  const order =
    message.buffer && message.buffer.byteLength >= length * 4
      ? new Uint32Array(message.buffer)
      : new Uint32Array(length);
  const count = sort(bounds, limit, message.matrix, message.support, order, scratch);
  self.postMessage({id: message.id, order, count}, [order.buffer]);
};`;

let workerUrl: string | null | undefined;
function getWorkerUrl(): string | null {
  if (workerUrl === undefined) {
    try {
      workerUrl =
        typeof Worker !== 'undefined' && typeof Blob !== 'undefined'
          ? URL.createObjectURL(new Blob([WORKER_SOURCE], {type: 'text/javascript'}))
          : null;
    } catch {
      workerUrl = null;
    }
  }
  return workerUrl;
}

/**
 * Keeps one capture's draw order current off the main thread. At most one sort is in flight; a
 * camera that moves meanwhile is sorted once the running sort returns, and the layer draws the last
 * order until then. Without workers (tests, strict CSP) it sorts synchronously.
 */
export class SplatCaptureSorter {
  private worker: Worker | null = null;
  private scratch: SplatSortScratch | null = null;
  private busy = false;
  private queued: {id: number; matrix: Float64Array; limit: number; support: number} | null = null;
  private spare: ArrayBuffer | null = null;
  private latest = 0;
  private answered = 0;

  /**
   * @param onOrder receives each order and how many Gaussians it holds
   * @param rowLength orders are padded to a multiple of this length
   */
  constructor(
    private bounds: Float32Array,
    private onOrder: (order: Uint32Array, count: number) => void,
    private rowLength = 1
  ) {
    const url = getWorkerUrl();
    if (url) {
      try {
        this.worker = new Worker(url);
        // the worker owns a copy; the capture's bounds stay usable here
        const copy = bounds.slice();
        this.worker.postMessage({bounds: copy}, [copy.buffer]);
        this.worker.onmessage = event => this.receive(event.data);
      } catch {
        this.worker = null;
      }
    }
  }

  /** Whether the order for the latest request has arrived. */
  get settled(): boolean {
    return !this.busy && this.answered === this.latest;
  }

  /** Order the first `limit` Gaussians for a capture-to-clip matrix and support radius. */
  sort(matrix: Float64Array, limit: number, support = 3) {
    const id = ++this.latest;
    if (this.busy) this.queued = {id, matrix, limit, support};
    else this.start(id, matrix, limit, support);
  }

  /** Hand an order back for the next sort to fill. */
  recycle(order: Uint32Array) {
    if (this.worker && (!this.spare || order.buffer.byteLength > this.spare.byteLength))
      this.spare = order.buffer as ArrayBuffer;
  }

  destroy() {
    this.worker?.terminate();
    this.worker = null;
    this.queued = null;
    this.onOrder = () => {};
  }

  private start(id: number, matrix: Float64Array, limit: number, support: number) {
    this.busy = true;
    if (this.worker) {
      const buffer = this.spare;
      this.spare = null;
      const message = {id, matrix, limit, support, buffer, rowLength: this.rowLength};
      this.worker.postMessage(message, buffer ? [buffer] : []);
      return;
    }
    const count = Math.min(limit, this.bounds.length / 4);
    this.scratch ||= createSplatSortScratch(this.bounds.length / 4);
    const order = new Uint32Array(Math.ceil(count / this.rowLength) * this.rowLength);
    const visible = sortSplatCapture(this.bounds, count, matrix, support, order, this.scratch);
    this.receive({id, order, count: visible});
  }

  private receive({id, order, count}: {id: number; order: Uint32Array; count: number}) {
    this.busy = false;
    this.answered = id;
    const queued = this.queued;
    this.queued = null;
    // a camera that moved during this sort is sorted next
    if (queued) this.start(queued.id, queued.matrix, queued.limit, queued.support);
    this.onOrder(order, count);
  }
}

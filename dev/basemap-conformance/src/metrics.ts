// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * Structural metrics comparing a candidate render (any renderer) with a reference render
 * (MapLibre GL JS) of the same scene: SSIM, edge alignment and label recall. Plain functions over
 * pixel arrays, so they run (and are tested) in Node as well as in the browser.
 */

/** A grayscale image, one luma value (0-255) per pixel, row-major. */
export type GrayImage = {width: number; height: number; data: Float32Array};

/** Converts RGBA pixels (alpha ignored: the renders are composited on white) to luma. */
export function toGray(rgba: ArrayLike<number>, width: number, height: number): GrayImage {
  const data = new Float32Array(width * height);
  for (let i = 0; i < data.length; i++) {
    // ITU-R BT.601 luma, as in the original SSIM paper's grayscale conversion.
    data[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  }
  return {width, height, data};
}

/** A normalized 1D Gaussian kernel. */
function gaussianKernel(sigma: number, radius: number): Float32Array {
  const kernel = new Float32Array(radius * 2 + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const value = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + radius] = value;
    sum += value;
  }
  return kernel.map(value => value / sum);
}

/** Separable convolution with edge clamping. */
function blur(data: Float32Array, width: number, height: number, kernel: Float32Array) {
  const radius = (kernel.length - 1) / 2;
  const temp = new Float32Array(data.length);
  const out = new Float32Array(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const xx = Math.min(width - 1, Math.max(0, x + k));
        sum += data[y * width + xx] * kernel[k + radius];
      }
      temp[y * width + x] = sum;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const yy = Math.min(height - 1, Math.max(0, y + k));
        sum += temp[yy * width + x] * kernel[k + radius];
      }
      out[y * width + x] = sum;
    }
  }
  return out;
}

function assertSameSize(a: GrayImage, b: GrayImage) {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`Image sizes differ: ${a.width}x${a.height} and ${b.width}x${b.height}`);
  }
}

/**
 * Mean structural similarity (Wang et al. 2004) of two grayscale images, with the paper's
 * 11-tap Gaussian window (sigma 1.5), K1 = 0.01 and K2 = 0.03. Also returns the per-pixel SSIM map.
 */
export function ssim(a: GrayImage, b: GrayImage): {mean: number; map: Float32Array} {
  assertSameSize(a, b);
  const {width, height} = a;
  const kernel = gaussianKernel(1.5, 5);
  const n = width * height;
  const aa = new Float32Array(n);
  const bb = new Float32Array(n);
  const ab = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    aa[i] = a.data[i] * a.data[i];
    bb[i] = b.data[i] * b.data[i];
    ab[i] = a.data[i] * b.data[i];
  }
  const muA = blur(a.data, width, height, kernel);
  const muB = blur(b.data, width, height, kernel);
  const sAA = blur(aa, width, height, kernel);
  const sBB = blur(bb, width, height, kernel);
  const sAB = blur(ab, width, height, kernel);
  const c1 = (0.01 * 255) ** 2;
  const c2 = (0.03 * 255) ** 2;
  const map = new Float32Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const varA = sAA[i] - muA[i] * muA[i];
    const varB = sBB[i] - muB[i] * muB[i];
    const cov = sAB[i] - muA[i] * muB[i];
    const value =
      ((2 * muA[i] * muB[i] + c1) * (2 * cov + c2)) /
      ((muA[i] * muA[i] + muB[i] * muB[i] + c1) * (varA + varB + c2));
    map[i] = value;
    sum += value;
  }
  return {mean: sum / n, map};
}

/**
 * Thin edges: Gaussian smoothing (sigma 1), Sobel gradient, non-maximum suppression along the
 * gradient direction, and a fixed magnitude threshold. A fixed threshold, rather than one relative
 * to the image, keeps a blank render edge-free. Returns 1 for edge pixels.
 */
export function detectEdges(image: GrayImage, threshold = 40): Uint8Array {
  const {width, height} = image;
  const smooth = blur(image.data, width, height, gaussianKernel(1, 2));
  const magnitude = new Float32Array(width * height);
  const direction = new Uint8Array(width * height);
  const at = (x: number, y: number) =>
    smooth[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gx =
        at(x + 1, y - 1) +
        2 * at(x + 1, y) +
        at(x + 1, y + 1) -
        at(x - 1, y - 1) -
        2 * at(x - 1, y) -
        at(x - 1, y + 1);
      const gy =
        at(x - 1, y + 1) +
        2 * at(x, y + 1) +
        at(x + 1, y + 1) -
        at(x - 1, y - 1) -
        2 * at(x, y - 1) -
        at(x + 1, y - 1);
      magnitude[y * width + x] = Math.hypot(gx, gy);
      // Gradient direction quantized to 0, 45, 90 or 135 degrees.
      const angle = ((Math.atan2(gy, gx) * 180) / Math.PI + 180) % 180;
      direction[y * width + x] = Math.round(angle / 45) % 4;
    }
  }
  const OFFSETS = [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1]
  ];
  const edges = new Uint8Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const m = magnitude[i];
      if (m < threshold) {
        continue;
      }
      const [dx, dy] = OFFSETS[direction[i]];
      if (m >= magnitude[i + dy * width + dx] && m >= magnitude[i - dy * width - dx]) {
        edges[i] = 1;
      }
    }
  }
  return edges;
}

/** Edge pixels dilated by `radius` (Chebyshev distance). */
function dilate(edges: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const out = new Uint8Array(edges.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!edges[y * width + x]) {
        continue;
      }
      for (let yy = Math.max(0, y - radius); yy <= Math.min(height - 1, y + radius); yy++) {
        for (let xx = Math.max(0, x - radius); xx <= Math.min(width - 1, x + radius); xx++) {
          out[yy * width + xx] = 1;
        }
      }
    }
  }
  return out;
}

export type EdgeScores = {precision: number; recall: number; f: number};

/**
 * Edge alignment: the share of candidate edge pixels within `tolerance` pixels of a reference edge
 * (precision), the share of reference edge pixels within `tolerance` of a candidate edge (recall),
 * and their harmonic mean. A geometry offset larger than the tolerance lowers both.
 */
export function edgeScores(
  reference: Uint8Array,
  candidate: Uint8Array,
  width: number,
  height: number,
  tolerance = 1
): EdgeScores {
  const nearReference = dilate(reference, width, height, tolerance);
  const nearCandidate = dilate(candidate, width, height, tolerance);
  let referenceCount = 0;
  let candidateCount = 0;
  let matchedReference = 0;
  let matchedCandidate = 0;
  for (let i = 0; i < reference.length; i++) {
    if (reference[i]) {
      referenceCount++;
      matchedReference += nearCandidate[i];
    }
    if (candidate[i]) {
      candidateCount++;
      matchedCandidate += nearReference[i];
    }
  }
  if (referenceCount === 0 && candidateCount === 0) {
    return {precision: 1, recall: 1, f: 1};
  }
  const precision = candidateCount ? matchedCandidate / candidateCount : 0;
  const recall = referenceCount ? matchedReference / referenceCount : 0;
  const f = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return {precision, recall, f};
}

/**
 * The comparison key of a label: case-folded, without whitespace. Wrapping replaces a space with a
 * line break, or inserts one after a hyphen or between ideographs, so whitespace is not compared.
 * Recall measures which labels are drawn, not their casing or wrapping.
 */
export function normalizeLabel(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

export type LabelScores = {
  recall: number;
  precision: number;
  /** Distinct reference labels. */
  referenceCount: number;
  /** Distinct candidate labels. */
  candidateCount: number;
  /** Reference labels the candidate does not draw. */
  missing: string[];
  /** Candidate labels the reference does not draw. */
  extra: string[];
};

/** The distinct labels of a list by comparison key, each with its first text (for reports). */
function getDistinctLabels(labels: string[]): Map<string, string> {
  const distinct = new Map<string, string>();
  for (const label of labels) {
    const key = normalizeLabel(label);
    if (key && !distinct.has(key)) {
      distinct.set(key, label.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim());
    }
  }
  return distinct;
}

/** Recall and precision of the distinct label strings drawn by the candidate. */
export function labelScores(reference: string[], candidate: string[]): LabelScores {
  const referenceSet = getDistinctLabels(reference);
  const candidateSet = getDistinctLabels(candidate);
  const missing = [...referenceSet]
    .filter(([key]) => !candidateSet.has(key))
    .map(([, text]) => text)
    .sort();
  const extra = [...candidateSet]
    .filter(([key]) => !referenceSet.has(key))
    .map(([, text]) => text)
    .sort();
  const matched = referenceSet.size - missing.length;
  return {
    recall: referenceSet.size ? matched / referenceSet.size : 1,
    precision: candidateSet.size ? matched / candidateSet.size : referenceSet.size ? 0 : 1,
    referenceCount: referenceSet.size,
    candidateCount: candidateSet.size,
    missing,
    extra
  };
}

/** The metrics recorded per scene. Higher is better for every one of them. */
export type SceneMetrics = {
  ssim: number;
  edgeF: number;
  labelRecall: number;
  labelPrecision: number;
  /** Distinct labels in the reference render; sets the label-metric tolerance. */
  referenceLabels: number;
  candidateLabels: number;
};

export const METRICS = ['ssim', 'edgeF', 'labelRecall', 'labelPrecision'] as const;
export type MetricName = (typeof METRICS)[number];

export const METRIC_LABELS: Record<MetricName, string> = {
  ssim: 'SSIM',
  edgeF: 'Edge F',
  labelRecall: 'Label recall',
  labelPrecision: 'Label precision'
};

/**
 * How far a metric may fall below its baseline before the check fails: render noise across GPUs
 * and drivers, not real changes. Label metrics also allow one label of slack, since one label of a
 * few is a large fraction.
 */
export const TOLERANCES: Record<MetricName, number> = {
  ssim: 0.01,
  edgeF: 0.02,
  labelRecall: 0.02,
  labelPrecision: 0.02
};

export function getTolerance(metric: MetricName, baseline: SceneMetrics): number {
  const tolerance = TOLERANCES[metric];
  if (metric === 'labelRecall') {
    return Math.max(tolerance, 1 / Math.max(1, baseline.referenceLabels));
  }
  if (metric === 'labelPrecision') {
    return Math.max(tolerance, 1 / Math.max(1, baseline.candidateLabels));
  }
  return tolerance;
}

/** Metrics computed from two RGBA renders of one scene and their label lists. */
export function computeSceneMetrics({
  width,
  height,
  reference,
  candidate,
  referenceLabels,
  candidateLabels
}: {
  width: number;
  height: number;
  reference: ArrayLike<number>;
  candidate: ArrayLike<number>;
  referenceLabels: string[];
  candidateLabels: string[];
}): {
  metrics: SceneMetrics;
  ssimMap: Float32Array;
  referenceEdges: Uint8Array;
  candidateEdges: Uint8Array;
  labels: LabelScores;
} {
  const a = toGray(reference, width, height);
  const b = toGray(candidate, width, height);
  const structural = ssim(a, b);
  const referenceEdges = detectEdges(a);
  const candidateEdges = detectEdges(b);
  const edges = edgeScores(referenceEdges, candidateEdges, width, height);
  const labels = labelScores(referenceLabels, candidateLabels);
  return {
    metrics: {
      ssim: round(structural.mean),
      edgeF: round(edges.f),
      labelRecall: round(labels.recall),
      labelPrecision: round(labels.precision),
      referenceLabels: labels.referenceCount,
      candidateLabels: labels.candidateCount
    },
    ssimMap: structural.map,
    referenceEdges,
    candidateEdges,
    labels
  };
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export type Baseline = Record<string, SceneMetrics>;

/** The metrics of one scene that fell below their baseline by more than the tolerance. */
/** Scores are stored to 4 decimals; two rounded values can differ by up to this much. */
const ROUNDING = 1e-4;

/** The lowest score of a metric that passes the check against a baseline. */
export function getFloor(metric: MetricName, baseline: SceneMetrics): number {
  return baseline[metric] - getTolerance(metric, baseline) - ROUNDING;
}

export function getRegressions(measured: SceneMetrics, baseline: SceneMetrics): string[] {
  return METRICS.filter(metric => measured[metric] < getFloor(metric, baseline)).map(
    metric =>
      `${METRIC_LABELS[metric]} ${measured[metric].toFixed(4)} is below its baseline ` +
      `${baseline[metric].toFixed(4)} (tolerance ${getTolerance(metric, baseline).toFixed(4)})`
  );
}

/**
 * The baseline after a run: every metric keeps the better of its baseline and the measured value,
 * so bounds only tighten. Scenes without a baseline take the measured values. A label metric's
 * tolerance depends on its label count, so it is taken from the run only when that also raises the
 * metric's floor (score minus tolerance): a better score with fewer labels must not loosen it.
 */
export function tightenBaseline(baseline: Baseline, measured: Baseline): Baseline {
  const next: Baseline = {...baseline};
  for (const [scene, metrics] of Object.entries(measured)) {
    const previous = baseline[scene];
    if (!previous) {
      next[scene] = metrics;
      continue;
    }
    const tightened = {...previous};
    for (const metric of METRICS) {
      if (metrics[metric] <= previous[metric]) {
        continue;
      }
      if (metric === 'labelRecall' || metric === 'labelPrecision') {
        const count = metric === 'labelRecall' ? 'referenceLabels' : 'candidateLabels';
        const candidate = {...tightened, [metric]: metrics[metric], [count]: metrics[count]};
        if (getFloor(metric, candidate) > getFloor(metric, tightened)) {
          Object.assign(tightened, {[metric]: metrics[metric], [count]: metrics[count]});
        }
      } else {
        tightened[metric] = metrics[metric];
      }
    }
    next[scene] = tightened;
  }
  return Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)));
}

function formatDelta(value: number, base: number | undefined): string {
  if (base === undefined) {
    return `${value.toFixed(3)} (new)`;
  }
  const delta = value - base;
  if (Math.abs(delta) < 0.0005) {
    return value.toFixed(3);
  }
  return `${value.toFixed(3)} (${delta > 0 ? '+' : ''}${delta.toFixed(3)})`;
}

/**
 * A Markdown table of measured metrics and their change from the baseline, for a PR description.
 * `regressions` marks the scenes that fail the check.
 */
export function formatDeltaTable(
  baseline: Baseline,
  measured: Baseline,
  regressions: Record<string, string[]> = {}
): string {
  const header = `| Scene | ${METRICS.map(metric => METRIC_LABELS[metric]).join(' | ')} |`;
  const divider = `|${' --- |'.repeat(METRICS.length + 1)}`;
  const rows = Object.entries(measured).map(([scene, metrics]) => {
    const base = baseline[scene];
    const cells = METRICS.map(metric => formatDelta(metrics[metric], base?.[metric]));
    const flag = regressions[scene]?.length ? ' **(regressed)**' : '';
    return `| ${scene}${flag} | ${cells.join(' | ')} |`;
  });
  return [header, divider, ...rows].join('\n');
}

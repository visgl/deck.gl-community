// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/** Shared procedural morphology. Values are dimensionless multipliers, not horticultural predictions. */
export type TreeCharacteristics = {
  /** Stable template seed. Rounded to an unsigned 32-bit integer. @default 0 */
  seed?: number;
  /** Horizontal crown envelope multiplier (0.6–1.5). @default 1 */
  crownSpread?: number;
  /** Vertical crown envelope multiplier (0.6–1.4). @default 1 */
  crownDepth?: number;
  /** Strength of smooth azimuthal lobes (0–2). @default 1 */
  crownAsymmetry?: number;
  /** Crown attraction-point density (0.5–1.5). @default 1 */
  branchDensity?: number;
  /** Upward growth bias multiplier (0–3). @default 1 */
  branchLift?: number;
  /** Shoot step-length multiplier (0.7–1.4). @default 1 */
  internodeLength?: number;
  /** Leaf Gaussian size multiplier (0.5–1.8). @default 1 */
  leafSize?: number;
  /** Number of leaves per shared template (0.25–2). @default 1 */
  leafDensity?: number;
};
export type ResolvedTreeCharacteristics = Required<TreeCharacteristics>;
const RANGES = {
  crownSpread: [0.6, 1.5],
  crownDepth: [0.6, 1.4],
  crownAsymmetry: [0, 2],
  branchDensity: [0.5, 1.5],
  branchLift: [0, 3],
  internodeLength: [0.7, 1.4],
  leafSize: [0.5, 1.8],
  leafDensity: [0.25, 2]
} as const;
/** Quantize slider inputs to 0.01, reject non-finite values, and keep bounded growth work. */
export function resolveTreeCharacteristics(
  input: TreeCharacteristics = {}
): ResolvedTreeCharacteristics {
  const result = {
    seed: Number.isFinite(input.seed) ? Math.round(input.seed!) >>> 0 : 0
  } as ResolvedTreeCharacteristics;
  for (const key of Object.keys(RANGES) as (keyof typeof RANGES)[]) {
    const [min, max] = RANGES[key];
    const value = Number.isFinite(input[key]) ? input[key]! : 1;
    result[key] = Math.round(Math.max(min, Math.min(max, value)) * 100) / 100;
  }
  return result;
}
export function getTreeCharacteristicsKey(input?: TreeCharacteristics): string {
  return Object.values(resolveTreeCharacteristics(input)).join(',');
}
/** LRU template ownership: interactive morphology cannot retain an unbounded history of slider states. */
export class TreeTemplateCache<T> {
  private entries = new Map<string, T>();
  constructor(private capacity = 16) {}
  get size() {
    return this.entries.size;
  }
  get(key: string): T | undefined {
    const value = this.entries.get(key);
    if (value !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }
  set(key: string, value: T): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    if (this.entries.size > this.capacity) this.entries.delete(this.entries.keys().next().value!);
  }
}

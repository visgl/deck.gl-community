export const COLLAPSED_ACTIVITY_MIN_WIDTH_MS = 0.001;
export const COLLAPSED_ACTIVITY_MAX_ROWS_PER_RANK = 1024;
export const COLLAPSED_ACTIVITY_FALLBACK_COLOR_RGB = [54, 54, 54] as const;
export const DEFAULT_COLLAPSED_ACTIVITY_ICICLE_BAND_COUNT = 6;
export const COLLAPSED_ACTIVITY_ICICLE_TOTAL_HEIGHT = 0.84;

export function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

export function toRgb(value: unknown): [number, number, number] | undefined {
  if (!Array.isArray(value) || value.length < 3) {
    return undefined;
  }
  const [r, g, b] = value as number[];
  if (![r, g, b].every(component => Number.isFinite(component))) {
    return undefined;
  }
  return [r, g, b];
}

export function getCollapsedActivityStep(windowDurationMs: number, depthCount: number): number {
  if (!(windowDurationMs > 0) || !Number.isFinite(windowDurationMs)) {
    return COLLAPSED_ACTIVITY_MIN_WIDTH_MS;
  }
  const safeDepthCount = Math.max(1, depthCount);
  const bucketsPerDepth = Math.max(
    1,
    Math.floor(COLLAPSED_ACTIVITY_MAX_ROWS_PER_RANK / safeDepthCount)
  );
  return Math.max(COLLAPSED_ACTIVITY_MIN_WIDTH_MS, windowDurationMs / bucketsPerDepth);
}

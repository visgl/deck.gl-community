import {formatDuration} from '@deck.gl-community/timeline-layers';

/** Formats one graph-relative duration for a time-axis label. */
export function formatRelativeTimeAxisDuration(
  durationMs: number,
  format: 'long' | 'short',
  includeUnit: boolean
): string {
  if (!Number.isFinite(durationMs)) {
    return '';
  }
  if (durationMs === 0) {
    return '0';
  }

  const absoluteDurationMs = Math.abs(durationMs);
  if (absoluteDurationMs < 1) {
    return includeUnit
      ? formatCompactRelativeTimeAxisDuration(durationMs)
      : formatDuration(durationMs, format);
  }

  if (!includeUnit) {
    return formatDuration(durationMs, format);
  }

  const suffix = getRelativeTimeAxisDurationSuffix(durationMs);
  return `${formatDuration(durationMs, format)}${suffix}`;
}

/** Returns the compact duration unit suffix for one graph-relative axis duration. */
function getRelativeTimeAxisDurationSuffix(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs === 0) {
    return '';
  }

  const absoluteDurationMs = Math.abs(durationMs);
  return absoluteDurationMs >= 24 * 60 * 60 * 1000
    ? 'd'
    : absoluteDurationMs >= 60 * 60 * 1000
      ? 'h'
      : absoluteDurationMs >= 60 * 1000
        ? 'm'
        : absoluteDurationMs >= 1000
          ? 's'
          : absoluteDurationMs >= 1
            ? 'ms'
            : absoluteDurationMs >= 0.001
              ? 'µs'
              : 'ns';
}

/** Formats one graph-relative duration using compact numeric units. */
function formatCompactRelativeTimeAxisDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs)) {
    return '';
  }
  if (durationMs === 0) {
    return '0';
  }

  const sign = durationMs < 0 ? '-' : '';
  const absoluteDurationMs = Math.abs(durationMs);
  const unit =
    absoluteDurationMs >= 24 * 60 * 60 * 1000
      ? {divisor: 24 * 60 * 60 * 1000, suffix: 'd'}
      : absoluteDurationMs >= 60 * 60 * 1000
        ? {divisor: 60 * 60 * 1000, suffix: 'h'}
        : absoluteDurationMs >= 60 * 1000
          ? {divisor: 60 * 1000, suffix: 'm'}
          : absoluteDurationMs >= 1000
            ? {divisor: 1000, suffix: 's'}
            : absoluteDurationMs >= 1
              ? {divisor: 1, suffix: 'ms'}
              : absoluteDurationMs >= 0.001
                ? {divisor: 0.001, suffix: 'µs'}
                : {divisor: 0.000001, suffix: 'ns'};
  const scaledValue = absoluteDurationMs / unit.divisor;
  const formattedValue =
    scaledValue >= 100
      ? scaledValue.toFixed(0)
      : scaledValue >= 10
        ? scaledValue.toFixed(1).replace(/\.0$/, '')
        : scaledValue.toFixed(2).replace(/(?:\.0+|(?<=\.\d)0)$/, '');

  return `${sign}${formattedValue}${unit.suffix}`;
}

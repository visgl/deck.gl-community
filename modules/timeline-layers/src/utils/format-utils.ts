// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * Convert a time in microseconds to a human-readable string
 * @param us Time in microseconds
 */
export function formatTimeMs(timeMs: number, space: boolean = true): string {
  const sep = space ? ' ' : '';
  const us = timeMs * 1000;
  if (us === 0) {
    return '0s';
  }
  if (Math.abs(us) < 1000) {
    return `${floatToStr(us)}${sep}µs`;
  }
  const ms = us / 1000;
  if (Math.abs(ms) < 1000) {
    return `${floatToStr(ms)}${sep} ms`;
  }
  const s = ms / 1000;
  if (Math.abs(s) < 60) {
    return `${floatToStr(s)}${sep} s`;
  }
  const m = s / 60;
  if (Math.abs(m) < 60) {
    return `${floatToStr(m)}${sep} min`;
  }
  const h = m / 60;
  if (Math.abs(h) < 24) {
    return `${floatToStr(h)}${sep} hrs`;
  }
  const d = h / 24;
  return `${floatToStr(d)}${sep} days`;
}

export function formatTimeRangeMs(startMs: number, endMs: number): string {
  return `${formatTimeMs(startMs)} - ${formatTimeMs(endMs)}`;
}

/**
 * Convert a float to a string
 */
function floatToStr(f: number, roundDigits: number = 5): string {
  if (Number.isInteger(f)) {
    return f.toString();
  }

  for (let i = 1; i < roundDigits - 1; i++) {
    const rounded = parseFloat(f.toPrecision(i));
    if (rounded === f) {
      return rounded.toPrecision(i);
    }
  }

  return f.toPrecision(roundDigits);
}

// export function formatTimesUs(ticks: number[]): string {
//   // Try from 0 up to a reasonable max (e.g. 20)
//   for (let d = 0; d <= 20; d++) {
//     const seen = new Set<string>();
//     let allDistinct = true;
//     for (const t of ticks) {
//       // Format each tick with d decimals
//       const str = t.toFixed(d);
//       if (seen.has(str)) {
//         allDistinct = false;
//         break;
//       }
//       seen.add(str);
//     }
//     if (allDistinct) {
//       return d;
//     }
//   }
//   // Fallback if somehow not distinct even at 20 decimals
//   return 20;
// }

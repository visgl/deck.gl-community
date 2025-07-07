// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

export function getZoomedRange(
  startTime: number,
  endTime: number,
  bounds: [number, number, number, number]
) {
  const [startTimeZoomed, , endTimeZoomed] = bounds;
  // console.log(`startTimeZoomed: ${startTimeZoomed}, endTimeZoomed: ${endTimeZoomed}, tickInterval: ${tickInterval} tickCountZoomed: ${tickCountZoomed}`);
  return [Math.max(startTime, startTimeZoomed), Math.min(endTime, endTimeZoomed)];
}

/**
 * Get nicely rounded tick close to the natural spacing
 * @param startTime
 * @param endTime
 * @param tickCount
 * @returns
 */
export function getPrettyTicks(startTime: number, endTime: number, tickCount: number = 5) {
  const range = endTime - startTime;
  const roughStep = range / (tickCount - 1);
  const exponent = Math.floor(Math.log10(roughStep));
  const base = Math.pow(10, exponent);
  const multiples = [1, 2, 5, 10];

  // Find the smallest multiple that is greater than or equal to roughStep
  const niceStep = multiples.find((m) => base * m >= roughStep) * base;

  const niceStart = Math.ceil(startTime / niceStep) * niceStep;
  const niceEnd = Math.floor(endTime / niceStep) * niceStep;

  const ticks = [];
  for (let t = niceStart; t <= niceEnd; t += niceStep) {
    ticks.push(t);
  }

  return ticks;
}

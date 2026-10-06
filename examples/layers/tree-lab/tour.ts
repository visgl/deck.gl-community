// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {SEASONS, SPECIES} from './scene';

export const FILM_DURATION = SPECIES.length * 12;

/** One shared clock drives seasonal stages, sunlight and wind for repeatable reviews. */
export function getTourFrame(seconds: number, film = false) {
  const duration = film ? 12 : 32;
  const time = ((seconds % duration) + duration) % duration;
  const phase = time / duration;
  const azimuth = phase * Math.PI * 2 - Math.PI * 0.3;
  const elevation = 0.55 + 0.4 * Math.sin(phase * Math.PI);
  const z = Math.sin(elevation);
  const horizontal = Math.cos(elevation);
  return {
    season: SEASONS[Math.min(3, Math.floor(phase * 4))],
    species: SPECIES[Math.floor(Math.max(0, seconds) / 12) % SPECIES.length],
    sunAngle: phase * 360,
    direction: [-Math.cos(azimuth) * horizontal, -Math.sin(azimuth) * horizontal, -z] as [
      number,
      number,
      number
    ],
    windTime: seconds,
    cameraBearing: 22 + Math.sin(phase * Math.PI * 2) * 18
  };
}

/* !
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT License.
 */

import {type Cube} from './interfaces';

/** Keep ordinal slots stable, shrinking removed records at their previous positions. */
export function patchCubeArray(
  allocatedSize: number,
  empty: Partial<Cube>,
  cubes: Cube[],
  previous: Cube[] = []
) {
  cubes = cubes.map((cube, index) =>
    cube.ordinal === undefined ? {...cube, ordinal: index} : cube
  );
  for (const cube of cubes) {
    if (!Number.isSafeInteger(cube.ordinal) || cube.ordinal < 0) {
      throw new Error('Cube ordinals must be non-negative safe integers');
    }
    allocatedSize = Math.max(allocatedSize, cube.ordinal + 1);
  }
  const patched = Array.from(
    {length: Math.max(allocatedSize, previous.length)},
    (_, ordinal): Cube => ({
      ...empty,
      ordinal,
      isEmpty: true,
      position: [...(previous[ordinal]?.position ?? [0, 0, 0])],
      size: [0, 0, 0],
      color: [0, 0, 0, 0]
    })
  );
  const ordinals = new Set<number>();
  for (const cube of cubes) {
    if (ordinals.has(cube.ordinal)) throw new Error(`Duplicate cube ordinal: ${cube.ordinal}`);
    ordinals.add(cube.ordinal);
    patched[cube.ordinal] = cube;
  }
  return patched;
}

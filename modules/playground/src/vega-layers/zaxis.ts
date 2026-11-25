/* !
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT License.
 */

import type {Position} from './legacy-types';
import {lineZ} from './defaults';
import {type Vec3} from './interfaces';

export function zSwap(v3: Vec3 | Position) {
  const temp = -v3[1]; // negeative y to positive z
  if (v3[0] === lineZ) {
    v3[0] = 0;
  }
  v3[1] = v3[2];
  v3[2] = temp;
}

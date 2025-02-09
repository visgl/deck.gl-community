// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
// Copyright 2022 Foursquare Labs, Inc.

import {constructPermutationMatrix} from '../../src/webgl/texture/reorder-bands';

test('constructPermutationMatrix', () => {
  [
    [
      [0, 1, 2, 3],
      // prettier-ignore
      [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
      ]
    ],
    [
      [2, 1, 3, 0],
      // prettier-ignore
      [
        0, 0, 1, 0,
        0, 1, 0, 0,
        0, 0, 0, 1,
        1, 0, 0, 0,
      ]
    ],
    // For input of length < 4, fill in identity
    [
      [2, 1, 0],
      // prettier-ignore
      [
        0, 0, 1, 0,
        0, 1, 0, 0,
        1, 0, 0, 0,
        0, 0, 0, 1,
      ]
    ]
  ].forEach(([ordering, expected]) => {
    const result = constructPermutationMatrix(ordering);
    expect(result).toEqual(expected);
  });
});

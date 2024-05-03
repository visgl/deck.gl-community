// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

export const mixedGetPosition = (getPosition, getOffset) => {
  if (!getOffset) {
    return getPosition;
  }

  if (typeof getOffset === 'function') {
    return (d) => {
      const [x, y] = getPosition(d);
      const [offX, offY] = getOffset(d);
      return [x + offX, y + offY];
    };
  }

  const [offX, offY] = getOffset;
  return (d) => {
    const [x, y] = getPosition(d);
    return [x + offX, y + offY];
  };
};

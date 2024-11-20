// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

type Point = {lon: number; lat: number};
export type WikipediaEntry = {
  thumbnail: {
    source: string;
  };
  pageid: string;
  coordinates: Point[];
};

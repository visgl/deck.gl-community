// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import { FilterContext } from '@deck.gl/core';

export type DeclarativeLayerFilter = Record<
  string,
  | {
      include: string[];
    }
  | {
      exclude: string[];
    }
>;

type RegexpLayerFilter = Record<
  string,
  | {
      include: RegExp[];
    }
  | {
      exclude: RegExp[];
    }
>;

export function makeLayerFilter(
  filters: DeclarativeLayerFilter,
): (context: FilterContext) => boolean {
  // Pre-compile the regexps for performance
  const regexpFilters: RegexpLayerFilter = {};
  for (const [key, value] of Object.entries(filters)) {
    if ('include' in value) {
      regexpFilters[key] = {
        include: value.include.map((v) => new RegExp(v)),
      };
    } else {
      regexpFilters[key] = {
        exclude: value.exclude.map((v) => new RegExp(v)),
      };
    }
  }

  // Return a function that checks if a layer matches the filter
  return ({ viewport, layer }: FilterContext) => {
    let visible = true;
    const viewFilters = regexpFilters[viewport.id] || ({} as Record<string, RegExp[]>);
    // Check if the layer matches the filters for this viewport
    if ('include' in viewFilters) {
      if (!viewFilters.include.some((regexp) => regexp.test(layer.id))) {
        visible = false;
      }
    }
    if ('exclude' in viewFilters) {
      if (viewFilters.exclude.some((regexp) => regexp.test(layer.id))) {
        visible = false;
      }
    }
    // if (!visible) {
    //   console.log(`Viewport ${viewport.id}: filtering out layer ${layer.id}`);
    // }
    return visible;
  };
}

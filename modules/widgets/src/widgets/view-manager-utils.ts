// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Deck, Viewport} from '@deck.gl/core';

export type DeckWithViewManager = Deck & {
  viewManager?: {
    getViewport: (id: string) => Viewport | null;
    getViewState: (id: string) => any;
    viewState?: any;
  };
};

export function hasViewManager(deck: Deck | null): deck is DeckWithViewManager {
  return Boolean(deck && typeof deck === 'object' && 'viewManager' in deck);
}

export function cloneViewState(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') {
    return {...(value as Record<string, unknown>)};
  }
  return {};
}

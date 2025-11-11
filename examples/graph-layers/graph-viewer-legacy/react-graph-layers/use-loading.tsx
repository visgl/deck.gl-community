// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {useMemo, useReducer} from 'react';

const loadingReducer = (state, action) => {
  switch (action.type) {
    case 'startLayout':
      return {loaded: false, rendered: false, isLoading: true};
    case 'layoutDone':
      return state.loaded ? state : {...state, loaded: true};
    case 'afterRender':
      if (!state.loaded) {
        return state;
      }

      // not interested after the first render, the state won't change
      return state.rendered ? state : {...state, rendered: true, isLoading: false};
    default:
      throw new Error(`Unhandled action type: ${action.type}`);
  }
};

export const useLoading = () => {
  const [{isLoading}, loadingDispatch] = useReducer(loadingReducer, {isLoading: true});

  const callbacks = useMemo(
    () => ({
      onLayoutStart: () => loadingDispatch({type: 'startLayout'}),
      onLayoutDone: () => loadingDispatch({type: 'layoutDone'})
    }),
    [loadingDispatch]
  );

  return [{isLoading}, loadingDispatch, callbacks] as const;
};

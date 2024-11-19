// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {useLayoutEffect, useReducer} from 'react';

const loadingReducer = (state, action) => {
  console.log('loadingReducer', state, action);
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

export const useLoading = (engine) => {
  const [{isLoading}, loadingDispatch] = useReducer(loadingReducer, {isLoading: true});

  useLayoutEffect(() => {
    const layoutStarted = () => loadingDispatch({type: 'startLayout'});
    const layoutEnded = () => loadingDispatch({type: 'layoutDone'});

    console.log('adding listeners')
    engine.addEventListener('onLayoutStart', layoutStarted);
    engine.addEventListener('onLayoutDone', layoutEnded);

    return () => {
      console.log('removing listeners')
      engine.removeEventListener('onLayoutStart', layoutStarted);
      engine.removeEventListener('onLayoutDone', layoutEnded);
    };
  }, [engine]);

  return [{isLoading}, loadingDispatch];
};

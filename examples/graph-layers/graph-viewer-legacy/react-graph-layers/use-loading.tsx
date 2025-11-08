// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {useLayoutEffect, useReducer} from 'react';

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

export const useLoading = (engine) => {
  const [{isLoading}, loadingDispatch] = useReducer(loadingReducer, {isLoading: true});

  useLayoutEffect(() => {
    if (!engine || typeof engine.setProps !== 'function') {
      return () => undefined;
    }

    const layoutStarted = () => loadingDispatch({type: 'startLayout'});
    const layoutEnded = () => loadingDispatch({type: 'layoutDone'});

    const previousCallbacks = engine.props?.callbacks ?? {};
    engine.setProps({
      callbacks: {
        ...previousCallbacks,
        onLayoutStart: (detail) => {
          layoutStarted();
          previousCallbacks.onLayoutStart?.(detail);
        },
        onLayoutDone: (detail) => {
          layoutEnded();
          previousCallbacks.onLayoutDone?.(detail);
        }
      }
    });

    return () => {
      engine.setProps({callbacks: previousCallbacks});
    };
  }, [engine]);

  return [{isLoading}, loadingDispatch];
};
